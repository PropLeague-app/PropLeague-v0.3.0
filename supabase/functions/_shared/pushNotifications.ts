// Shared APNs sending helper for edge functions (settle-week, send-roster-
// reminders). Copied into each function's bundle from _shared/ the same way
// as playoffLogic.ts -- see that file's header for why this isn't a
// cross-directory import.
//
// Talks to Apple's HTTP/2 APNs API directly via native fetch + Web Crypto
// (both available in Deno's edge runtime) rather than pulling in an npm APNs
// library -- the whole protocol here is: sign a short JWT with the .p8 auth
// key, POST it as a bearer token per-request. No npm package needed for that.
//
// Required secrets (Dashboard -> Edge Functions -> Secrets), NEVER commit the
// real values anywhere:
//   APNS_KEY_ID     -- the 10-char Key ID shown when you created the APNs key
//   APNS_TEAM_ID    -- your Apple Developer Team ID (same one Xcode shows on
//                      the signing tab)
//   APNS_BUNDLE_ID  -- the app's bundle id, e.g. com.propleague.app
//   APNS_AUTH_KEY   -- the full contents of the downloaded AuthKey_XXXX.p8
//                      file, pasted as-is (including the BEGIN/END lines)
//   APNS_ENV        -- optional, 'production' (default) or 'sandbox'. Every
//                      TestFlight and App Store build uses production APNs --
//                      only an Xcode debug build run straight from source
//                      uses sandbox. Leave unset unless you're testing a
//                      debug build.
//
// NOT yet verified against a real device: written from Apple's documented
// APNs HTTP/2 provider protocol (JWT ES256 auth, POST /3/device/<token>),
// not a guess, but there's no network path to api.push.apple.com from this
// environment to confirm end-to-end -- the first real send after Hunter sets
// the secrets and deploys is the real test. Check the `failures` array this
// module returns; a non-empty one names exactly which token/reason failed.

const APNS_KEY_ID = Deno.env.get('APNS_KEY_ID');
const APNS_TEAM_ID = Deno.env.get('APNS_TEAM_ID');
const APNS_BUNDLE_ID = Deno.env.get('APNS_BUNDLE_ID');
const APNS_AUTH_KEY = Deno.env.get('APNS_AUTH_KEY');
const APNS_HOST = Deno.env.get('APNS_ENV') === 'sandbox' ? 'api.sandbox.push.apple.com' : 'api.push.apple.com';

function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let str = '';
  for (const b of arr) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Signing keys are cross-invocation-cacheable (imported once per isolate);
// the JWT itself is only valid ~1hr and Apple asks providers not to mint a
// fresh one per request, so it's cached too, refreshed with 5 min of margin.
let cachedKey: CryptoKey | null = null;
let cachedJwt: { token: string; expiresAtMs: number } | null = null;

async function getSigningKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  if (!APNS_AUTH_KEY) throw new Error('APNS_AUTH_KEY secret is not set');
  const pem = APNS_AUTH_KEY.replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  cachedKey = await crypto.subtle.importKey('pkcs8', der, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  return cachedKey;
}

async function getAuthJwt(): Promise<string> {
  const now = Date.now();
  if (cachedJwt && now < cachedJwt.expiresAtMs) return cachedJwt.token;
  if (!APNS_KEY_ID || !APNS_TEAM_ID) throw new Error('APNS_KEY_ID / APNS_TEAM_ID secrets are not set');

  const header = { alg: 'ES256', kid: APNS_KEY_ID };
  const payload = { iss: APNS_TEAM_ID, iat: Math.floor(now / 1000) };
  const signingInput = `${base64url(new TextEncoder().encode(JSON.stringify(header)))}.${base64url(new TextEncoder().encode(JSON.stringify(payload)))}`;

  const key = await getSigningKey();
  // Web Crypto's ECDSA signature for a P-256 key is already raw (r||s,
  // 64 bytes) -- exactly the IEEE P1363 form JWS ES256 requires, no DER
  // re-encoding needed (that's only a concern for RSA/other curve APIs).
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(signingInput));

  const token = `${signingInput}.${base64url(signature)}`;
  cachedJwt = { token, expiresAtMs: now + 50 * 60 * 1000 }; // refresh after 50 min, Apple allows up to 60
  return token;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Arbitrary extra fields merged into the APNs payload alongside `aps`, for the client to route on tap (e.g. { screen: 'matchup', matchupId }). */
  data?: Record<string, unknown>;
}

export interface PushFailure {
  token: string;
  status: number;
  reason: string;
  /** True for APNs reasons that mean the token will never work again (BadDeviceToken, Unregistered, etc) -- caller should delete it from device_push_tokens. */
  shouldDeleteToken: boolean;
}

const PERMANENT_FAILURE_REASONS = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

/** Sends one push to one raw device token. Callers loop this over every token for a profile. */
export async function sendApnsPush(deviceToken: string, message: PushMessage): Promise<{ ok: true } | { ok: false; failure: PushFailure }> {
  if (!APNS_BUNDLE_ID) throw new Error('APNS_BUNDLE_ID secret is not set');
  const jwt = await getAuthJwt();

  const res = await fetch(`https://${APNS_HOST}/3/device/${deviceToken}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${jwt}`,
      'apns-topic': APNS_BUNDLE_ID,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      aps: { alert: { title: message.title, body: message.body }, sound: 'default' },
      ...message.data,
    }),
  });

  if (res.status === 200) return { ok: true };

  let reason = `http-${res.status}`;
  try {
    const body = await res.json();
    if (body?.reason) reason = body.reason;
  } catch {
    // non-JSON error body -- keep the http-<status> fallback
  }
  return { ok: false, failure: { token: deviceToken, status: res.status, reason, shouldDeleteToken: PERMANENT_FAILURE_REASONS.has(reason) } };
}

/**
 * Sends one push to every device registered for a profile (fetched from
 * device_push_tokens), and prunes any token APNs reports as permanently dead.
 * `supabase` must be a service-role client -- this bypasses the per-user RLS
 * policy on device_push_tokens by design (an edge function sends on behalf of
 * many users, not as any one of them).
 */
export async function sendPushToProfile(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  profileId: string,
  message: PushMessage,
): Promise<{ sent: number; failures: PushFailure[] }> {
  const { data: tokenRows, error } = await supabase.from('device_push_tokens').select('token').eq('profile_id', profileId);
  if (error || !tokenRows || tokenRows.length === 0) return { sent: 0, failures: [] };

  let sent = 0;
  const failures: PushFailure[] = [];
  const deadTokens: string[] = [];

  for (const row of tokenRows as { token: string }[]) {
    const result = await sendApnsPush(row.token, message);
    if (result.ok) {
      sent++;
    } else {
      failures.push(result.failure);
      if (result.failure.shouldDeleteToken) deadTokens.push(row.token);
    }
  }

  if (deadTokens.length > 0) {
    await supabase.from('device_push_tokens').delete().in('token', deadTokens);
  }

  return { sent, failures };
}

/**
 * Atomically claims a notification-dedup key so a cron-driven or rerun-safe
 * function only ever sends a given notification once. Returns true if this
 * call is the one that gets to send (first claim); false if it was already
 * claimed by an earlier run -- caller should skip sending in that case.
 */
// deno-lint-ignore no-explicit-any
export async function claimNotification(supabase: any, key: string): Promise<boolean> {
  const { data, error } = await supabase.from('notification_dedup').insert({ key }).select('key');
  if (error) {
    // Unique-violation on the primary key means someone else already claimed
    // it -- that's the expected "already sent" path, not a real error.
    if (typeof error.message === 'string' && /duplicate key|unique constraint/i.test(error.message)) return false;
    throw new Error(`claimNotification(${key}): ${error.message}`);
  }
  return !!data && data.length > 0;
}
