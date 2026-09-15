import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
// Supabase is retiring the legacy anon JWT in favor of a new, non-JWT
// "publishable key" (sb_publishable_...) -- see
// https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
// and supabase/functions/_shared/supabaseAdminKey.ts's header for the fuller
// story (this migration started after the project's legacy service_role key
// was exposed in a screenshot, Sept 2026). Prefer the new publishable key
// once it's set in .env.local; fall back to the legacy anon key until then
// so this keeps working with no required change on your end.
const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  throw new Error(
    'Missing Supabase env vars. Copy .env.example to .env.local and fill in your project URL + anon/publishable key ' +
      '(Supabase dashboard → Project Settings → API Keys).',
  );
}

export const supabase = createClient(supabaseUrl, supabaseKey);
