/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // New publishable key (sb_publishable_...), replacing the legacy anon JWT.
  // Optional so the app keeps working on VITE_SUPABASE_ANON_KEY alone until
  // this is set -- see src/lib/supabaseClient.ts.
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
