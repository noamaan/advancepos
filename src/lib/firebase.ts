import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getStorage, type FirebaseStorage } from 'firebase/storage';

export interface FirebaseEnv {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
}

const e = import.meta.env as Record<string, string | undefined>;

export const FIREBASE_ENV_KEYS = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
] as const;

export const missingKeys = FIREBASE_ENV_KEYS.filter((k) => !e[k]);
export const firebaseReady = missingKeys.length === 0;

export const DEVELOPER_EMAILS = (e.VITE_DEVELOPER_EMAILS ?? '')
  .split(',')
  .map((s) => s.trim().toLowerCase())
  .filter(Boolean);

const config: FirebaseEnv = {
  apiKey: e.VITE_FIREBASE_API_KEY ?? '',
  authDomain: e.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: e.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: e.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: e.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: e.VITE_FIREBASE_APP_ID ?? '',
};

let app: FirebaseApp | null = null;
export let auth: Auth;
export let db: Firestore;
export let storage: FirebaseStorage;

if (firebaseReady) {
  app = getApps().length ? getApps()[0] : initializeApp(config);
  auth = getAuth(app);
  db = getFirestore(app);
  storage = getStorage(app);
}

/**
 * A secondary app used ONLY to create new Auth users without signing out the
 * currently signed-in admin (Firebase client SDK quirk workaround).
 */
export function secondaryAuth(): { auth: Auth; cleanup: () => Promise<void> } {
  if (!app) throw new Error('Firebase not configured');
  const name = `secondary-${Date.now()}`;
  const secondary = initializeApp(config, name);
  const sAuth = getAuth(secondary);
  return {
    auth: sAuth,
    cleanup: async () => {
      const { deleteApp } = await import('firebase/app');
      await deleteApp(secondary);
    },
  };
}

export const firebaseApp = app;
