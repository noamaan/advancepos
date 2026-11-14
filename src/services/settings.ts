import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage, firebaseReady } from '../lib/firebase';
import * as L from '../store/localdb';
import { DEFAULT_SETTINGS, type BusinessSettings, type UserProfile } from '../types';
import { audit } from './audit';

const REF = () => doc(db, 'settings', 'business');

export async function getSettings(): Promise<BusinessSettings> {
  if (!firebaseReady) {
    L.initLocalDb();
    const row = L.get<BusinessSettings & { id: string }>('settings', 'business');
    if (!row) return { ...DEFAULT_SETTINGS };
    const { id: _id, ...rest } = row;
    return { ...DEFAULT_SETTINGS, ...rest };
  }
  const snap = await getDoc(REF());
  if (!snap.exists()) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<BusinessSettings>) };
}

export async function saveSettings(next: BusinessSettings, actor: UserProfile): Promise<void> {
  if (!firebaseReady) {
    L.initLocalDb();
    L.put('settings', { id: 'business', ...next, updatedBy: actor.name, updatedAt: Date.now() });
    await audit(actor, 'settings.update', 'settings', 'business', `Updated shop settings (${next.bizName})`);
    return;
  }
  await setDoc(REF(), { ...next, updatedBy: actor.name, updatedAt: Date.now() }, { merge: true });
  await audit(actor, 'settings.update', 'settings', 'business', `Updated shop settings (${next.bizName})`);
}

/** Upload a logo: Firebase Storage in cloud mode, embedded data-URL in local mode. */
export async function uploadLogo(file: File): Promise<string> {
  if (!firebaseReady) {
    if (file.size > 400 * 1024) throw new Error('Local mode logo must be under 400 KB (compress it or switch to Firebase Storage)');
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(new Error('Could not read file'));
      r.readAsDataURL(file);
    });
  }
  const r = ref(storage, `branding/logo-${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}
