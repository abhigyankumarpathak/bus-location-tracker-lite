import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { PropsWithChildren } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import type { Profile, Role } from './types';

/**
 * Authentication, ported from the full app and cut down.
 *
 * KEPT, because it is the one piece of the full app's auth model worth every
 * line: **nobody picks their own role.** An admin issues an invite carrying the
 * role, and the signup trigger reads the role off the invite row, ignoring
 * anything the client claims. Without a valid code no account is created at all.
 *
 * DROPPED: the staff portal password (`unlockStaff`) — that existed to put a
 * second lock on a coordinator's operational powers, and there is no coordinator
 * here. Also dropped: the pending-approval poll, since an invited account is
 * active immediately, exactly as in the full app.
 */

/** What an invite code turns out to be for. Checked before the account exists. */
export interface InviteDetails {
  role: Role | null;
  full_name: string;
  email: string | null;
  valid: boolean;
  reason: string | null;
}

/**
 * Look up an invite code while signed out.
 *
 * Signup shows the person who they are and what role the office gave them
 * BEFORE they fill in a password, so a wrong code fails immediately rather than
 * after they have typed everything.
 */
export async function lookupInvite(code: string): Promise<InviteDetails> {
  const { data, error } = await supabase.rpc('invite_details', {
    invite_code: code.trim(),
  });
  if (error) throw new Error(error.message);

  const row = (data as InviteDetails[] | null)?.[0];
  return (
    row ?? {
      role: null,
      full_name: '',
      email: null,
      valid: false,
      reason: 'That invite code is not recognised.',
    }
  );
}

interface AuthValue {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  /** Signed in, but there is no profile behind the session. */
  profileMissing: boolean;
  isAdmin: boolean;
  signIn(email: string, password: string): Promise<void>;
  signUp(input: {
    email: string;
    password: string;
    fullName: string;
    phone: string;
    inviteCode: string;
  }): Promise<void>;
  signOut(): Promise<void>;
  refreshProfile(): Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside <AuthProvider>');
  return value;
}

export function AuthProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  /** Signed in, but the account behind the session no longer exists. */
  const [profileMissing, setProfileMissing] = useState(false);

  const loadProfile = useCallback(async (userId: string | undefined) => {
    if (!userId) {
      setProfile(null);
      setProfileMissing(false);
      return;
    }

    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();

    setProfile((data as Profile) ?? null);

    // A session whose profile cannot be loaded is a dead end: without this the
    // app sits on a spinner for ever. It happens for real — the account was
    // deleted, or the schema was rebuilt underneath a stored session.
    setProfileMissing(Boolean(!data || error));
  }, []);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(async ({ data }) => {
      if (!active) return;
      setSession(data.session);
      await loadProfile(data.session?.user.id);
      if (active) setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, next) => {
      setSession(next);
      await loadProfile(next?.user.id);
      setLoading(false);
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signUp = useCallback<AuthValue['signUp']>(
    async ({ email, password, fullName, phone, inviteCode }) => {
      // Note what is NOT sent: a role. The signup trigger reads it off the
      // invite row and ignores anything the client claims.
      const { error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: {
            invite_code: inviteCode.trim(),
            full_name: fullName.trim(),
            phone: phone.trim(),
          },
        },
      });
      if (error) throw error;
    },
    [],
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  const refreshProfile = useCallback(async () => {
    await loadProfile(session?.user.id);
  }, [loadProfile, session?.user.id]);

  const value = useMemo<AuthValue>(
    () => ({
      session,
      profile,
      loading,
      profileMissing,
      isAdmin: profile?.role === 'admin',
      signIn,
      signUp,
      signOut,
      refreshProfile,
    }),
    [session, profile, loading, profileMissing, signIn, signUp, signOut, refreshProfile],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
