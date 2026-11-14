import { createUserWithEmailAndPassword, sendPasswordResetEmail } from 'firebase/auth';
import {
  collection, doc, setDoc, updateDoc, getDocs, query, where, runTransaction,
} from 'firebase/firestore';
import { auth, db, secondaryAuth, firebaseReady } from '../lib/firebase';
import * as L from '../store/localdb';
import { uid } from '../lib/format';
import type { Role, UserProfile } from '../types';
import { audit, auditTx } from './audit';

/** Create an Auth account + profile without signing out the current admin. */
export async function createUser(
  name: string, email: string, password: string, role: Role,
  permOverrides: Record<string, boolean>, creator: UserProfile,
): Promise<void> {
  if (name.trim().length < 2) throw new Error('Name is too short');
  if (password.length < 8) throw new Error('Password must be at least 8 characters');
  const mail = email.trim().toLowerCase();
  if (!firebaseReady) {
    L.initLocalDb();
    if (L.list<UserProfile & { id: string }>('users').some((u) => u.email === mail))
      throw new Error('A user with this email already exists');
    const id = uid();
    const now = Date.now();
    L.put('users', {
      id, uid: id, name: name.trim(), email: mail, role,
      permOverrides, active: true, createdAt: now, createdBy: creator.name, lastActiveAt: now,
    } as unknown as L.Row);
    await L.setLocalPassword(mail, password);
    await audit(creator, 'user.create', 'users', id, `Created ${role} account for ${mail}`);
    return;
  }
  const dup = await getDocs(query(collection(db, 'users'), where('email', '==', mail)));
  if (!dup.empty) throw new Error('A user with this email already exists');

  const { auth: sAuth, cleanup } = secondaryAuth();
  let newUid = '';
  try {
    const cred = await createUserWithEmailAndPassword(sAuth, mail, password);
    newUid = cred.user.uid;
  } finally {
    await cleanup().catch(() => undefined);
  }
  const now = Date.now();
  await runTransaction(db, async (t) => {
    t.set(doc(db, 'users', newUid), {
      name: name.trim(), email: mail, role,
      permOverrides, active: true, createdAt: now, createdBy: creator.name, lastActiveAt: now,
    });
    auditTx(t, creator, 'user.create', 'users', newUid, `Created ${role} account for ${mail}`);
  });
}

export async function updateUser(
  targetUid: string,
  patch: Partial<Pick<UserProfile, 'name' | 'role' | 'permOverrides'>>,
  actor: UserProfile,
): Promise<void> {
  if (!firebaseReady) {
    L.initLocalDb();
    const cur = L.get<UserProfile & { id: string }>('users', targetUid);
    if (!cur) throw new Error('User not found');
    if (cur.role === 'developer' && patch.role && patch.role !== 'developer' && actor.role !== 'developer')
      throw new Error('Only a developer can change a developer account');
    L.put('users', { ...cur, ...patch, id: targetUid } as unknown as L.Row);
    await audit(actor, 'user.update', 'users', targetUid,
      `Updated user ${cur.email}${patch.role ? ` (role → ${patch.role})` : ''}${patch.permOverrides ? ' (permissions changed)' : ''}`);
    return;
  }
  await runTransaction(db, async (t) => {
    const ref = doc(db, 'users', targetUid);
    const snap = await t.get(ref);
    if (!snap.exists()) throw new Error('User not found');
    const cur = snap.data();
    if (cur.role === 'developer' && patch.role && patch.role !== 'developer' && actor.role !== 'developer')
      throw new Error('Only a developer can change a developer account');
    t.update(ref, { ...patch });
    auditTx(t, actor, 'user.update', 'users', targetUid,
      `Updated user ${cur.email}${patch.role ? ` (role → ${patch.role})` : ''}${patch.permOverrides ? ' (permissions changed)' : ''}`);
  });
}

export async function setUserActive(targetUid: string, active: boolean, actor: UserProfile): Promise<void> {
  if (targetUid === actor.uid) throw new Error('You cannot deactivate your own account');
  if (!firebaseReady) {
    L.initLocalDb();
    const cur = L.get<UserProfile & { id: string }>('users', targetUid);
    if (!cur) throw new Error('User not found');
    if (cur.role === 'developer' && actor.role !== 'developer')
      throw new Error('Only a developer can deactivate a developer account');
    L.put('users', { ...cur, active, id: targetUid } as unknown as L.Row);
    await audit(actor, active ? 'user.reactivate' : 'user.deactivate', 'users', targetUid,
      `${active ? 'Reactivated' : 'Deactivated'} ${cur.email}`);
    return;
  }
  await runTransaction(db, async (t) => {
    const ref = doc(db, 'users', targetUid);
    const snap = await t.get(ref);
    if (!snap.exists()) throw new Error('User not found');
    const cur = snap.data();
    if (cur.role === 'developer' && actor.role !== 'developer')
      throw new Error('Only a developer can deactivate a developer account');
    t.update(ref, { active });
    auditTx(t, actor, active ? 'user.reactivate' : 'user.deactivate', 'users', targetUid,
      `${active ? 'Reactivated' : 'Deactivated'} ${cur.email}`);
  });
}

/** Sends a Firebase password-reset email (admins cannot set another user's password). */
export async function sendReset(targetEmail: string): Promise<void> {
  await sendPasswordResetEmail(auth, targetEmail.trim().toLowerCase());
}

/** Local mode: admin directly sets a new temporary password for the user. */
export async function localAdminSetPassword(targetEmail: string, newPw: string): Promise<void> {
  L.initLocalDb();
  if (newPw.length < 8) throw new Error('Password must be at least 8 characters');
  await L.setLocalPassword(targetEmail.trim().toLowerCase(), newPw);
}

export async function logUserManaged(actor: UserProfile, what: string): Promise<void> {
  await audit(actor, 'user.note', 'users', actor.uid, what);
}
