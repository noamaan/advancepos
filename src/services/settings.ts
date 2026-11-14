import { doc, getDoc, setDoc } from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { db, storage } from '../lib/firebase';
import { DEFAULT_SETTINGS, type BusinessSettings, type UserProfile } from '../types';
import { audit } from './audit';

const REF = () => doc(db, 'settings', 'business');

export async function getSettings(): Promise<BusinessSettings> {
  const snap = await getDoc(REF());
  if (!snap.exists()) return { ...DEFAULT_SETTINGS };
  return { ...DEFAULT_SETTINGS, ...(snap.data() as Partial<BusinessSettings>) };
}

export async function saveSettings(next: BusinessSettings, actor: UserProfile): Promise<void> {
  await setDoc(REF(), { ...next, updatedBy: actor.name, updatedAt: Date.now() }, { merge: true });
  await audit(actor, 'settings.update', 'settings', 'business', `Updated shop settings (${next.bizName})`);
}

/** Upload a logo file to Firebase Storage and return its download URL. */
export async function uploadLogo(file: File): Promise<string> {
  const r = ref(storage, `branding/logo-${Date.now()}-${file.name.replace(/[^\w.-]/g, '_')}`);
  await uploadBytes(r, file, { contentType: file.type });
  return getDownloadURL(r);
}
