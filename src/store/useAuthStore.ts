import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabaseClient';
import { useAppStore } from './useAppStore';
import type { MatchupDetailMode, ThemeMode, UserProfile } from '../types';

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
  /** Re-editing username/avatar from Settings, after onboarding is already done
   * (see chat: SettingsHome's "My Profile" card used to call the app-store-local
   * updateProfile only, which never reached Supabase -- reverted on every
   * sign-out). Shares completeProfileSetup's write path but leaves `onboarded`
   * alone and only patches whichever field was actually passed. */
  updateProfile: (partial: { username?: string; avatarEmoji?: string }) => Promise<{ ok: boolean; error?: string }>;
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


// Per-account, per-device state that sign-out used to wipe along with everything else: the local-only
// look settings (theme, simple/advanced matchup view, scaled vs classic P/L colors), which chat
// messages were already read, and which finished-week results were already shown. Losing them made a
// log out and back in replay every old result popup, mark all chat unread, and reset the colors to
// classic. They are stashed under the signed-out user's id and restored when that same account signs
// back in, so a different account on the same device still starts fresh.
const LOCAL_STATE_KEY = (userId: string) => `propleague-local-state:${userId}`;

function stashLocalState(userId: string) {
  try {
    const { profile, lastSeenChatByLeague, seenMatchupResultIds } = useAppStore.getState();
    localStorage.setItem(
      LOCAL_STATE_KEY(userId),
      JSON.stringify({
        themeMode: profile?.themeMode,
        accentColor: profile?.accentColor,
        matchupDetailMode: profile?.matchupDetailMode,
        plColorScale: profile?.plColorScale,
        lastSeenChatByLeague,
        seenMatchupResultIds,
      }),
    );
  } catch {
    // Storage unavailable: the user just starts fresh, same as before.
  }
}

function restoreLocalState(userId: string) {
  try {
    const raw = localStorage.getItem(LOCAL_STATE_KEY(userId));
    if (!raw) return;
    const saved = JSON.parse(raw) as {
      themeMode?: ThemeMode;
      accentColor?: UserProfile['accentColor'];
      matchupDetailMode?: MatchupDetailMode;
      plColorScale?: 'classic' | 'scaled' | 'mono';
      lastSeenChatByLeague?: Record<string, string>;
      seenMatchupResultIds?: Record<string, true>;
    };
    useAppStore.setState((state) => ({
      lastSeenChatByLeague: { ...saved.lastSeenChatByLeague, ...state.lastSeenChatByLeague },
      seenMatchupResultIds: { ...saved.seenMatchupResultIds, ...state.seenMatchupResultIds },
      profile: state.profile
        ? {
            ...state.profile,
            themeMode: state.profile.themeMode ?? saved.themeMode,
            accentColor: state.profile.accentColor ?? saved.accentColor,
            matchupDetailMode: state.profile.matchupDetailMode ?? saved.matchupDetailMode,
            plColorScale: state.profile.plColorScale ?? saved.plColorScale,
          }
        : state.profile,
    }));
    localStorage.removeItem(LOCAL_STATE_KEY(userId));
  } catch {
    // Corrupt or unavailable: ignore.
  }
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
    restoreLocalState(profile.id);
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
    const signingOutId = get().user?.id;
    if (signingOutId) stashLocalState(signingOutId);
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

  updateProfile: async (partial) => {
    const userId = get().user?.id;
    if (!userId) return { ok: false, error: 'Not signed in.' };
    const patch: { username?: string; avatar_emoji?: string } = {};
    if (partial.username !== undefined) patch.username = partial.username;
    if (partial.avatarEmoji !== undefined) patch.avatar_emoji = partial.avatarEmoji;
    if (Object.keys(patch).length === 0) return { ok: true };
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
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

  updatePassword: async (newPassword) => {
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    if (error) return { ok: false, error: error.message };
    return { ok: true };
  },
}));
