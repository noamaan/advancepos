import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, signOut,
  EmailAuthProvider, reauthenticateWithCredential, updatePassword,
  type User,
} from 'firebase/auth';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { auth, db, DEVELOPER_EMAILS, firebaseReady } from '../lib/firebase';
import * as L from './localdb';
import type { UserProfile } from '../types';
import { effectivePerms, type PermKey } from '../lib/permissions';

export const LOCAL_MODE = !firebaseReady;
if (LOCAL_MODE) L.initLocalDb();

const SESSION_KEY = 'apos-local-session';

interface AuthState {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  noProfile: boolean;
  isDeveloper: boolean;
  can: (key: PermKey) => boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  changePassword: (current: string, next: string) => Promise<void>;
  refreshProfile: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

function readLocalProfile(uid: string): UserProfile | null {
  const r = L.get<UserProfile & { id: string }>('users', uid);
  if (!r) return null;
  const { id: _id, ...rest } = r;
  return rest as UserProfile;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [noProfile, setNoProfile] = useState(false);

  async function loadProfileRemote(u: User | null) {
    if (!u) { setProfile(null); setNoProfile(false); return; }
    const snap = await getDoc(doc(db, 'users', u.uid));
    if (!snap.exists()) { setProfile(null); setNoProfile(true); return; }
    const p = { uid: u.uid, ...(snap.data() as Omit<UserProfile, 'uid'>) };
    setNoProfile(false);
    setProfile(p);
    updateDoc(doc(db, 'users', u.uid), { lastActiveAt: Date.now() }).catch(() => undefined);
  }

  function loadProfileLocal(uid: string | null) {
    if (!uid) { setProfile(null); setNoProfile(false); return; }
    const p = readLocalProfile(uid);
    if (!p) { setProfile(null); setNoProfile(true); return; }
    setNoProfile(false);
    setProfile(p);
    L.put('users', { id: uid, ...p } as L.Row);
  }

  useEffect(() => {
    if (LOCAL_MODE) {
      const uid = localStorage.getItem(SESSION_KEY);
      if (uid) {
        const p = readLocalProfile(uid);
        if (p) {
          setUser({ uid, email: p.email } as unknown as User);
          setNoProfile(false);
          setProfile(p);
        }
      }
      setLoading(false);
      return;
    }
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setLoading(true);
      try { await loadProfileRemote(u); } catch { /* keep previous */ }
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
      const mail = email.trim().toLowerCase();
      if (LOCAL_MODE) {
        const ok = await L.verifyLocalPassword(mail, password);
        if (!ok) { const err = new Error('Invalid credentials') as Error & { code?: string }; err.code = 'auth/invalid-credential'; throw err; }
        const found = L.list<UserProfile & { id: string }>('users').find((u) => u.email === mail);
        if (!found) { const err = new Error('No staff profile for this login') as Error & { code?: string }; err.code = 'auth/invalid-credential'; throw err; }
        localStorage.setItem(SESSION_KEY, found.id);
        setUser({ uid: found.id, email: mail } as unknown as User);
        loadProfileLocal(found.id);
        return;
      }
      const cred = await signInWithEmailAndPassword(auth, mail, password);
      await loadProfileRemote(cred.user);
    },
    logout: async () => {
      if (LOCAL_MODE) { localStorage.removeItem(SESSION_KEY); setUser(null); setProfile(null); return; }
      await signOut(auth);
    },
    changePassword: async (current, next) => {
      if (LOCAL_MODE) {
        if (!profile) throw new Error('Not signed in');
        const ok = await L.verifyLocalPassword(profile.email, current);
        if (!ok) throw new Error('Current password is wrong');
        await L.setLocalPassword(profile.email, next);
        return;
      }
      const u = auth.currentUser;
      if (!u || !u.email) throw new Error('Not signed in');
      await reauthenticateWithCredential(u, EmailAuthProvider.credential(u.email, current));
      await updatePassword(u, next);
    },
    refreshProfile: async () => {
      if (LOCAL_MODE) { const uid = localStorage.getItem(SESSION_KEY); loadProfileLocal(uid); return; }
      await loadProfileRemote(auth.currentUser);
    },
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
  if (LOCAL_MODE) return true; // local mode: dev role comes from the local users DB
  return DEVELOPER_EMAILS.includes(email.trim().toLowerCase());
}
