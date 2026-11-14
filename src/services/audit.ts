import { collection, doc, addDoc, type Transaction } from 'firebase/firestore';
import { db, firebaseReady } from '../lib/firebase';
import * as L from '../store/localdb';
import { uid } from '../lib/format';
import type { UserProfile } from '../types';

type Actor = Pick<UserProfile, 'uid' | 'name'>;

function actorOf(actor: Actor) {
  return { actorId: actor.uid, actorName: actor.name };
}

/** Standalone audit entry (use inside transactions via auditTx when possible). */
export async function audit(
  actor: Actor,
  action: string, entity: string, entityId: string, summary: string,
): Promise<void> {
  try {
    const row = { ...actorOf(actor), action, entity, entityId, summary, createdAt: Date.now() };
    if (!firebaseReady) { L.initLocalDb(); L.put('audit_logs', { id: uid(), ...row } as L.Row); return; }
    await addDoc(collection(db, 'audit_logs'), row);
  } catch { /* audit must never break the operation it logs */ }
}

/** Audit entry appended atomically within an existing Firestore transaction. */
export function auditTx(
  t: Transaction,
  actor: Actor,
  action: string, entity: string, entityId: string, summary: string,
): void {
  t.set(doc(collection(db, 'audit_logs')), {
    ...actorOf(actor), action, entity, entityId, summary, createdAt: Date.now(),
  });
}
