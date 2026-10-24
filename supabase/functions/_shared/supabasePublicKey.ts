// The public (RLS-respecting) key an edge function uses to build a client that acts as the
// caller, e.g. to check who is signed in. Companion to supabaseAdminKey.ts.
//
// Prefers the new publishable key, which Supabase injects as SUPABASE_PUBLISHABLE_KEYS (a JSON
// object keyed by name, "default" for the dashboard's default key), and falls back to the legacy
// SUPABASE_ANON_KEY JWT. The fallback matters only until JWT-based API keys are disabled; after
// that the anon JWT is rejected, so every caller must be on the publishable key by then.
export function getSupabasePublicKey(): string | undefined {
  const raw = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (raw) {
    try {
      const key = JSON.parse(raw)?.default;
      if (typeof key === 'string' && key.length > 0) return key;
    } catch {
      // Unexpected shape: fall through to the legacy key rather than failing every request.
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY') ?? undefined;
}
