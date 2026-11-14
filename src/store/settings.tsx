import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, firebaseReady } from '../lib/firebase';
import { DEFAULT_SETTINGS, type BusinessSettings } from '../types';

const Ctx = createContext<{ settings: BusinessSettings }>({ settings: DEFAULT_SETTINGS });

/** Live business settings — every screen & printed bill reads from here. */
export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<BusinessSettings>(DEFAULT_SETTINGS);
  useEffect(() => {
    if (!firebaseReady) return;
    return onSnapshot(
      doc(db, 'settings', 'business'),
      (snap) => {
        if (snap.exists()) setSettings({ ...DEFAULT_SETTINGS, ...(snap.data() as Partial<BusinessSettings>) });
        else setSettings(DEFAULT_SETTINGS);
      },
      () => setSettings(DEFAULT_SETTINGS),
    );
  }, []);
  return <Ctx.Provider value={{ settings }}>{children}</Ctx.Provider>;
}

export const useSettings = () => useContext(Ctx);
