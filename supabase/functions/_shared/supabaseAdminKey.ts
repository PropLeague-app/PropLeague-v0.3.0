// Shared helper for getting the admin (RLS-bypassing) key every edge
// function uses to create its Supabase client. Copied into each function's
// bundle from _shared/ the same way as playoffLogic.ts/pushNotifications.ts
// -- see playoffLogic.ts's header for why this isn't a cross-directory
// import.
//
// Background: Supabase is retiring the legacy `service_role` JWT in favor of
// a new, non-JWT "secret key" system (sb_secret_...) -- see
// https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys.
// Once a secret key exists on the project (Dashboard -> Settings -> API Keys
// -> "Publishable and secret API keys" tab), Supabase injects it into every
// edge function automatically as SUPABASE_SECRET_KEYS, a JSON object keyed
// by name -- the one created via the dashboard's default flow is named
// "default". This matters because the project's legacy service_role JWT was
// exposed in a screenshot (Sept 2026) and, once migrated to JWT Signing
// Keys, Supabase no longer supports rotating/reissuing that legacy key --
// migrating to the new secret-key system is the only way to actually
// invalidate the leaked one (via "Disable JWT-based API keys" once every
// caller, including this function, is confirmed running on the new key).
//
// This helper prefers SUPABASE_SECRET_KEYS and falls back to the legacy
// SUPABASE_SERVICE_ROLE_KEY JWT if the new one isn't set yet, so this code
// is safe to deploy immediately -- no ordering requirement between
// "deploy this" and "create the secret key in the dashboard." Once the key
// is created and every function that reads this has been redeployed at
// least once, the legacy key can be disabled.
//
// createClient() from supabase-js accepts either key type identically (both
// go through here) -- no header changes needed, the client library handles
// apikey vs Authorization internally based on the key's format.
export function getSupabaseAdminKey(): string {
  const secretKeysRaw = Deno.env.get('SUPABASE_SECRET_KEYS');
  if (secretKeysRaw) {
    try {
      const parsed = JSON.parse(secretKeysRaw);
      const key = parsed?.default;
      if (typeof key === 'string' && key.length > 0) return key;
    } catch {
      // Malformed/unexpected shape -- fall through to the legacy key rather
      // than throwing, so a Supabase-side change to this env var's shape
      // doesn't take every edge function down at once.
    }
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}
