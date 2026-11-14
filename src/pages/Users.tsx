import { useState } from 'react';
import { useCollection } from '../hooks/fs';
import { useAuth } from '../store/auth';
import { Badge, ConfirmDialog, Field, Modal, useToast } from '../components/ui';
import { createUser, sendReset, setUserActive, updateUser } from '../services/users';
import { ALL_PERM_KEYS, effectivePerms, PERMS, ROLE_DEFAULTS, type PermKey } from '../lib/permissions';
import { fmtDateTime } from '../lib/format';
import type { Role, UserProfile } from '../types';
import { orderBy } from 'firebase/firestore';

export function Users() {
  const { profile, can, isDeveloper } = useAuth();
  const toast = useToast();
  const [users] = useCollection<UserProfile>('users', [orderBy('createdAt', 'asc')]);

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [role, setRole] = useState<Role>('cashier');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState<UserProfile | null>(null);
  const [deact, setDeact] = useState<UserProfile | null>(null);

  async function doCreate() {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await createUser(name, email, pw, role, {}, profile);
      toast('ok', `Account created for ${email}`);
      setCreating(false); setName(''); setEmail(''); setPw(''); setRole('cashier');
    } catch (e) {
      const code = (e as { code?: string }).code;
      toast('err', code === 'auth/email-already-in-use' ? 'That email already has a login' : (e as Error).message);
    } finally { setBusy(false); }
  }

  function toggleOverride(u: UserProfile, key: PermKey) {
    if (!isDeveloper && !can('usersManage')) return;
    const eff = effectivePerms(u)[key];
    const isDefault = !(key in (u.permOverrides ?? {}));
   let next: Record<string, boolean>;
    if (isDefault) next = { ...u.permOverrides, [key]: !eff }; // step 1: override opposite
    else next = { ...u.permOverrides }; delete next[key];      // step 2: back to role default
    u.permOverrides = next;
    if (!profile) return;
    updateUser(u.uid, { permOverrides: next }, profile).then(() => undefined).catch((e) => toast('err', (e as Error).message));
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div><h2>Users & permissions</h2><span className="muted">Role presets plus per-person overrides. Audit-logged.</span></div>
        {can('usersManage') && <button className="btn btn-primary" onClick={() => setCreating(true)}>+ Add user</button>}
      </div>

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Last active</th><th></th></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.uid} className={!u.active ? 'row-muted' : ''}>
                <td><b>{u.name}</b><div className="muted small">{u.email}</div></td>
                <td><Badge tone={u.role === 'developer' ? 'info' : u.role === 'admin' ? 'ok' : 'muted'}>{u.role}</Badge></td>
                <td>{u.active ? <Badge tone="ok">active</Badge> : <Badge tone="bad">deactivated</Badge>}</td>
                <td className="muted small">{u.lastActiveAt ? fmtDateTime(u.lastActiveAt) : '—'}</td>
                <td className="row-end">
                  {can('usersManage') && <button className="btn btn-mini" onClick={() => setEdit(u)}>Permissions</button>}
                  {can('usersManage') && <button className="btn btn-mini" onClick={() => { void sendReset(u.email).then(() => toast('ok', `Password-reset email sent to ${u.email}`)).catch((e) => toast('err', (e as Error).message)); }}>Reset password</button>}
                  {can('usersDelete') && u.uid !== profile?.uid && (
                    <button className="btn btn-mini btn-danger-ghost" onClick={() => setDeact(u)}>{u.active ? 'Deactivate' : 'Reactivate'}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <Modal title="Add user" onClose={() => setCreating(false)}>
          <div className="form-grid">
            <Field label="Full name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
            <Field label="Email (login)"><input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></Field>
            <Field label="Temporary password" hint="Min 8 chars — user can change it via Settings → My password"><input className="input" type="text" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
            <Field label="Role">
              <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
                <option value="cashier">Cashier — billing + view stock</option>
                <option value="manager">Manager — + inventory, purchases, reports, refunds</option>
                <option value="admin">Admin — + settings, users, backup</option>
                {isDeveloper && <option value="developer">Developer — full super-admin</option>}
              </select>
            </Field>
          </div>
          <p className="muted small">Permissions start from the role preset; fine-tune them per user afterwards.</p>
          <div className="row-end"><button className="btn" onClick={() => setCreating(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={doCreate}>{busy ? 'Creating…' : 'Create account'}</button></div>
        </Modal>
      )}

      {edit && (
        <Modal title={`Permissions — ${edit.name}`} onClose={() => setEdit(null)} wide>
          <div className="form-grid">
            <Field label="Role">
              <select className="input" value={edit.role} disabled={edit.role === 'developer' && !isDeveloper}
                onChange={(e) => {
                  const r = e.target.value as Role;
                  setEdit({ ...edit, role: r });
                  if (profile) updateUser(edit.uid, { role: r }, profile).then(() => toast('ok', 'Role updated')).catch((err) => toast('err', (err as Error).message));
                }}>
                {(['cashier', 'manager', 'admin', ...(isDeveloper ? ['developer' as Role] : [])]).map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </Field>
          </div>
          <div className="perm-grid">
            {ALL_PERM_KEYS.map((k) => {
              const eff = effectivePerms(edit)[k];
              const over = k in (edit.permOverrides ?? {});
              const isDefault = ROLE_DEFAULTS[edit.role].includes(k);
              return (
                <button key={k} className={`perm ${eff ? 'perm-on' : ''} ${over ? 'perm-over' : ''}`}
                  disabled={edit.role === 'developer'}
                  title={over ? 'Custom override — click to revert to role default' : 'Click to override role default'}
                  onClick={() => { const nu = { ...edit }; toggleOverride(nu, k); setEdit({ ...nu }); }}>
                  <span className="perm-dot" />
                  {PERMS[k].label}
                  <span className="perm-src">{over ? 'custom' : isDefault ? 'role' : 'off'}</span>
                </button>
              );
            })}
          </div>
          {edit.role === 'developer' && <p className="muted small">Developer always has every permission.</p>}
          <div className="row-end"><button className="btn btn-primary" onClick={() => setEdit(null)}>Done</button></div>
        </Modal>
      )}

      {deact && (
        <ConfirmDialog danger={deact.active}
          text={deact.active ? `Deactivate ${deact.name}? They will be signed out and blocked on every device.` : `Reactivate ${deact.name}?`}
          onNo={() => setDeact(null)}
          onYes={async () => {
            try { await setUserActive(deact.uid, !deact.active, profile!); toast('ok', 'Updated'); }
            catch (e) { toast('err', (e as Error).message); }
            setDeact(null);
          }} />
      )}
    </div>
  );
}
