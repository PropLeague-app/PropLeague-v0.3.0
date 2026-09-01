import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { useAppStore } from './useAppStore';

export interface AuthProfile {
  id: string;
  username: string;
  avatarEmoji: string;
  oddsFormat: 'american' | 'decimal';
  /** False right after signup (the DB trigger creates a bare placeholder row) until
   * ProfileSetup sets a real username/avatar. Drives the /profile-setup redirect. */
  onboarded: boolean;
}

interface EmailAuthResult {
  ok: boolean;
  error?: string;
  /** Only meaningful on signUpWithEmail — true when the project requires email
   * confirmation and no session was returned yet. */
  needsEmailConfirmation?: boolean;
}

interface AuthState {
  session: Session | null;
  user: User | null;
  profile: AuthProfile | null;
  /** True until the initial getSession() check resolves — lets the router avoid
   * flashing /welcome before we know whether a session already exists. */
  loading: boolean;

  init: () => void;
  signUpWithEmail: (email: string, password: string) => Promise<EmailAuthResult>;
  signInWithEmail: (email: string, password: string) => Promise<EmailAuthResult>;
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  signOut: () => Promise<void>;
  completeProfileSetup: (username: string, avatarEmoji: string) => Promise<{ ok: boolean; error?: string }>;
  requestPasswordReset: (email: string) => Promise<{ ok: boolean; error?: string }>;
  updatePassword: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
}

interface ProfileRow {
  id: string;
  username: string;
  avatar_emoji: string;
  odds_format: string;
  onboarded: boolean;
}

function rowToProfile(row: ProfileRow): AuthProfile {
  return {
    id: row.id,
    username: row.username,
    avatarEmoji: row.avatar_emoji,
    oddsFormat: row.odds_format === 'decimal' ? 'decimal' : 'american',
    onboarded: row.onboarded,
  };
}

async function fetchProfile(userId: string): Promise<AuthProfile | null> {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, username, avatar_emoji, odds_format, onboarded')
    .eq('id', userId)
    .single();
  if (error || !data) return null;
  return rowToProfile(data as ProfileRow);
}

/** Keeps the existing app-wide UserProfile (read by most screens today) in sync
 * with the real Supabase-backed profile, once onboarding is complete. This is
 * what lets every existing screen keep working unchanged for now, rather than
 * every `useAppStore((s) => s.profile)` call site needing to move to
 * useAuthStore in this same step. */
function syncAppStoreProfile(profile: AuthProfile | null) {
  if (profile && profile.onboarded) {
    useAppStore.getState().setProfile({
      username: profile.username,
      avatarEmoji: profile.avatarEmoji,
      oddsFormat: profile.oddsFormat,
    });
  }
}

let initialized = false;

export const useAuthStore = create<AuthState>()((set, get) => ({
  session: null,
  user: null,
  profile: null,
  loading: true,

  // Guarded against double-invocation (e.g. React StrictMode double-effects) —
  // the listener must only ever be attached once per page load.
  init: () => {
    if (initialized) return;
    initialized = true;

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      const profile = session ? await fetchProfile(session.user.id) : null;
      syncAppStoreProfile(profile);
      set({ session, user: session?.user ?? null, profile, loading: false });
    });

    supabase.auth.onAuthStateChange(async (_event, session) => {
      const profile = session ? await fetchProfile(session.user.id) : null;
      syncAppStoreProfile(profile);
      set({ session, user: session?.user ?? null, profile, loading: false });
    });
  },

  signUpWithEmail: async (email, password) => {
    const { data, error } = await supabase.auth.signUp({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true, needsEmailConfirmation: !data.session };
  },

  signInWithEmail: async (email, password) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  signInWithGoogle: async () => {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  },

  signInWithApple: async () => {
    await supabase.auth.signInWithOAuth({ provider: 'apple', options: { redirectTo: window.location.origin } });
  },

  signOut: async () => {
    await supabase.auth.signOut();
    set({ session: null, user: null, profile: null });
    // Leagues are still local-only at this stage of the build (Step 3 moves them
    // server-side) — clearing them on sign-out is safe for now. Revisit once
    // leagues live in Supabase: sign-out should then only clear local session
    // state, never remote data.
    useAppStore.getState().factoryReset();
  },

  completeProfileSetup: async (username, avatarEmoji) => {
    const userId = get().user?.id;
    if (!userId) return { ok: false, error: 'Not signed in.' };
    const { data, error } = await supabase
      .from('profiles')
      .update({ username, avatar_emoji: avatarEmoji, onboarded: true })
      .eq('id', userId)
      .select('id, username, avatar_emoji, odds_format, onboarded')
      .single();
    if (error || !data) {
      const message = error?.code === '23505' ? 'That username is taken.' : (error?.message ?? 'Something went wrong.');
      return { ok: false, error: message };
    }
    const profile = rowToProfile(data as ProfileRow);
    syncAppStoreProfile(profile);
    set({ profile });
    return { ok: true };
  },

  requestPasswordReset: async (email) => {
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/reset-password`,
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },

  updatePassword: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
}));
