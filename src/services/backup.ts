import { collection, doc, getDocs, writeBatch } from 'firebase/firestore';
import { db, firebaseReady } from '../lib/firebase';
import * as L from '../store/localdb';
import { download } from '../lib/format';
import { audit } from './audit';
import type { UserProfile } from '../types';

export const BACKUP_COLLECTIONS = [
  'products', 'sales', 'purchases', 'stock_movements', 'settings', 'users', 'audit_logs', 'meta',
] as const;

/** Export the whole database as a single JSON file (manual backup). */
export async function exportBackup(actor: UserProfile): Promise<void> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  if (!firebaseReady) {
    L.initLocalDb();
    for (const c of BACKUP_COLLECTIONS) out[c] = L.list(c);
  } else {
    for (const c of BACKUP_COLLECTIONS) {
      const snap = await getDocs(collection(db, c));
      out[c] = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    }
  }
  const payload = {
    app: 'advancepos', version: 1, exportedAt: new Date().toISOString(), exportedBy: actor.email, data: out,
  };
  download(
    `advancepos-backup-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`,
    new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
  );
  await audit(actor, 'backup.export', 'database', 'all', 'Exported full JSON backup');
}

/**
 * Restore a JSON backup. Writes documents with the SAME ids (merge).
 * This does NOT delete documents that are missing from the file.
 */
export async function importBackup(file: File, actor: UserProfile): Promise<{ written: number }> {
  const parsed = JSON.parse(await file.text());
  if (parsed?.app !== 'advancepos' || !parsed.data) throw new Error('Not an AdvancePOS backup file');
  let written = 0;
  if (!firebaseReady) {
    L.initLocalDb();
    for (const c of BACKUP_COLLECTIONS) {
      const rows: Array<Record<string, unknown> & { id: string }> = parsed.data[c] ?? [];
      for (const row of rows) {
        const { id, ...rest } = row;
        if (!id) continue;
        const existing = L.get(c, id) ?? { id };
        L.put(c, { ...existing, ...rest, id } as L.Row);
        written += 1;
      }
    }
    await audit(actor, 'backup.restore', 'database', 'all', `Restored JSON backup (${written} documents)`);
    return { written };
  }
  for (const c of BACKUP_COLLECTIONS) {
    const rows: Array<Record<string, unknown> & { id: string }> = parsed.data[c] ?? [];
    for (let i = 0; i < rows.length; i += 400) {
      const batch = writeBatch(db);
      for (const row of rows.slice(i, i + 400)) {
        const { id, ...rest } = row;
        if (!id) continue;
        batch.set(doc(db, c, id), rest, { merge: true });
        written += 1;
      }
      await batch.commit();
    }
  }
  await audit(actor, 'backup.restore', 'database', 'all', `Restored JSON backup (${written} documents)`);
  return { written };
}
