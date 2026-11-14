import { collection, doc, addDoc, type Transaction } from 'firebase/firestore';
import { db } from '../lib/firebase';
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
    await addDoc(collection(db, 'audit_logs'), {
      ...actorOf(actor), action, entity, entityId, summary, createdAt: Date.now(),
    });
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
