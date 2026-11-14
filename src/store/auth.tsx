import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
  type User,
} from 'firebase/auth';
import { doc, getDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db, DEVELOPER_EMAILS } from '../lib/firebase';
import type { UserProfile } from '../types';
import { effectivePerms, type PermKey } from '../lib/permissions';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  /** profile exists? (every allowed user must have a users/{uid} doc) */
  noProfile: boolean;
  isDeveloper: boolean;
  can: (key: PermKey) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);

  async function loadProfile(u: User | null) {
    if (!u) { setProfile(null); setNoProfile(false); return; }
    const snap = await getDoc(doc(db, 'users', u.uid));
    if (!snap.exists()) {
      setProfile(null); setNoProfile(true); return;
    }
    const p = { uid: u.uid, ...(snap.data() as Omit<UserProfile, 'uid'>) };
    setNoProfile(false);
    setProfile(p);
    // best-effort activity ping (do not block render)
    updateDoc(doc(db, 'users', u.uid), { lastActiveAt: Date.now() }).catch(() => undefined);
    void serverTimestamp; // kept import hot for later use
  }

  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(true);
      try { await loadProfile(u); } catch { /* network hiccup — keep previous */ }
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthState>(() => ({
    user, profile, loading, noProfile,
    isDeveloper: profile?.role === 'developer',
    can: (key) => {
      if (!profile || !profile.active) return false;
      return effectivePerms(profile)[key];
    },
    login: async (email, password) => {
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      await loadProfile(cred.user);
    },
    logout: async () => { await signOut(auth); },
    changePassword: async (current, next) => {
      const u = auth.currentUser;
      if (!u || !u.email) throw new Error('Not signed in');
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
      await updatePassword(u, next);
    },
    refreshProfile: async () => { await loadProfile(auth.currentUser); },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [user, profile, loading, noProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAuth outside provider');
  return v;
}

export function emailIsDeveloperCandidate(email: string): boolean {
  return DEVELOPER_EMAILS.includes(email.trim().toLowerCase());
}
