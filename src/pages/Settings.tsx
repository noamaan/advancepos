import { useEffect, useRef, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '../hooks/fs';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { Field, useToast } from '../components/ui';
import { getSettings, saveSettings, uploadLogo } from '../services/settings';
import { exportBackup, importBackup } from '../services/backup';
import { fmtDateTime } from '../lib/format';
import type { AuditLog, BusinessSettings } from '../types';

export function SettingsPage() {
  const { profile, can, changePassword } = useAuth();
  const { settings: live } = useSettings();
  const toast = useToast();
  const [form, setForm] = useState<BusinessSettings>(live);
  const [busy, setBusy] = useState(false);
  const [newCat, setNewCat] = useState('');
  const logoRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const [curPw, setCurPw] = useState('');
  const [newPw, setNewPw] = useState('');

  const [auditLogs] = useCollection<AuditLog>('audit_logs', [orderBy('createdAt', 'desc')]);
  useEffect(() => setForm(live), [live]);

  function set<K extends keyof BusinessSettings>(k: K, v: BusinessSettings[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function save() {
    if (!profile || busy) return;
    setBusy(true);
    try {
      await saveSettings({ ...form }, profile);
      toast('ok', 'Settings saved — applied everywhere instantly');
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); }
  }

  async function onLogo(f: File) {
    if (!profile) return;
    try {
      toast('info', 'Uploading logo…');
      const url = await uploadLogo(f);
      const current = await getSettings();
      await saveSettings({ ...current, logoUrl: url }, profile);
      toast('ok', 'Logo updated — it now appears on bills');
    } catch (e) { toast('err', (e as Error).message); }
  }

  async function doRestore(f: File) {
    if (!profile || busy) return;
    if (!window.confirm('Restore will overwrite documents with the same id. Continue?')) { if (restoreRef.current) restoreRef.current.value = ''; return; }
    setBusy(true);
    try {
      const r = await importBackup(f, profile);
      toast('ok', `Restored ${r.written} documents`);
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); if (restoreRef.current) restoreRef.current.value = ''; }
  }

  async function doPwChange() {
    try {
      if (newPw.length < 8) { toast('err', 'New password must be at least 8 characters'); return; }
      await changePassword(curPw, newPw);
      setCurPw(''); setNewPw('');
      toast('ok', 'Password changed');
    } catch (e) { toast('err', (e as Error).message.includes('wrong-password') || (e as { code?: string }).code === 'auth/invalid-credential' ? 'Current password is wrong' : (e as Error).message); }
  }

  const canEdit = can('settings');

  return (
    <div className="stack">
      <div className="page-head"><div><h2>Settings</h2><span className="muted">Everything here syncs instantly to every device & printed bill.</span></div>
        {canEdit && <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save settings'}</button>}
      </div>

      <div className="card pad">
        <h3 className="sec-title">🏪 Business</h3>
        <div className="form-grid">
          <Field label="Shop name"><input className="input" disabled={!canEdit} value={form.bizName} onChange={(e) => set('bizName', e.target.value)} /></Field>
          <Field label="Phone"><input className="input" disabled={!canEdit} value={form.phone} onChange={(e) => set('phone', e.target.value)} /></Field>
          <Field label="Address"><input className="input" disabled={!canEdit} value={form.address} onChange={(e) => set('address', e.target.value)} /></Field>
          <Field label="Email (on bills)"><input className="input" disabled={!canEdit} value={form.email} onChange={(e) => set('email', e.target.value)} /></Field>
          <Field label="Logo (Firebase Storage)">
            <div className="row">
              {form.logoUrl ? <img src={form.logoUrl} alt="logo" className="logo-preview" /> : <span className="muted">No logo</span>}
              {canEdit && <button className="btn" onClick={() => logoRef.current?.click()}>Upload…</button>}
              {form.logoUrl && canEdit && <button className="btn btn-ghost" onClick={() => set('logoUrl', '')}>Remove</button>}
              <input ref={logoRef} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && onLogo(e.target.files[0])} />
            </div>
          </Field>
          <Field label="Thank-you note on bill"><input className="input" disabled={!canEdit} value={form.thankYouNote} onChange={(e) => set('thankYouNote', e.target.value)} /></Field>
        </div>
      </div>

      <div className="card pad">
        <h3 className="sec-title">💳 Billing & payments</h3>
        <div className="form-grid">
          <Field label="UPI ID (VPA)" hint="Used to generate the payment QR on bills"><input className="input" disabled={!canEdit} value={form.upiId} onChange={(e) => set('upiId', e.target.value)} placeholder="shopname@okhdfcbank" /></Field>
          <Field label="UPI payee name"><input className="input" disabled={!canEdit} value={form.upiPayeeName} onChange={(e) => set('upiPayeeName', e.target.value)} /></Field>
          <Field label="Currency symbol"><input className="input" disabled={!canEdit} value={form.currency} onChange={(e) => set('currency', e.target.value)} /></Field>
          <Field label="Default tax %"><input className="input" type="number" min={0} max={100} step="0.1" disabled={!canEdit} value={form.taxRate} onChange={(e) => set('taxRate', Number(e.target.value) || 0)} /></Field>
          <Field label="Invoice prefix"><input className="input" disabled={!canEdit} value={form.invoicePrefix} onChange={(e) => set('invoicePrefix', e.target.value)} /></Field>
          <Field label="Thermal paper size">
            <select className="input" disabled={!canEdit} value={form.paperSize} onChange={(e) => set('paperSize', e.target.value as '58' | '80')}>
              <option value="58">58 mm</option><option value="80">80 mm</option>
            </select>
          </Field>
          <Field label="Low-stock alert default"><input className="input" type="number" min={0} disabled={!canEdit} value={form.lowStockDefault} onChange={(e) => set('lowStockDefault', Math.max(0, Math.floor(Number(e.target.value) || 0)))} /></Field>
        </div>
        <Field label="Product categories">
          <div className="row wrap">
            {form.categories.map((c) => (
              <span key={c} className="chip">{c}
                {canEdit && <button className="chip-x" onClick={() => set('categories', form.categories.filter((x) => x !== c))}>✕</button>}
              </span>
            ))}
            {canEdit && <>
              <input className="input slim" placeholder="New category" value={newCat} onChange={(e) => setNewCat(e.target.value)} />
              <button className="btn btn-mini" onClick={() => { const v = newCat.trim(); if (v && !form.categories.includes(v)) set('categories', [...form.categories, v]); setNewCat(''); }}>+ Add</button>
            </>}
          </div>
        </Field>
      </div>

      {(can('backup')) && (
        <div className="card pad">
          <h3 className="sec-title">🗄 Backup & restore</h3>
          <div className="row wrap">
            <button className="btn" onClick={() => profile && exportBackup(profile).then(() => toast('ok', 'Backup downloaded')).catch((e) => toast('err', (e as Error).message))}>⬇ Download full backup (JSON)</button>
            <button className="btn" onClick={() => restoreRef.current?.click()}>⬆ Restore from backup…</button>
            <input ref={restoreRef} type="file" accept=".json" hidden onChange={(e) => e.target.files?.[0] && doRestore(e.target.files[0])} />
          </div>
          <p className="muted small">Automatic: see README §9 for managed Firestore backups & the optional scheduled Cloud Function. Restore merges by document id and never removes data silently.</p>
        </div>
      )}

      {can('audit') && (
        <div className="card pad">
          <h3 className="sec-title">🧾 Audit log (latest 200)</h3>
          <table className="table">
            <thead><tr><th>When</th><th>User</th><th>Action</th><th>Detail</th></tr></thead>
            <tbody>
              {auditLogs.slice(0, 200).map((a) => (
                <tr key={a.id}><td className="muted small">{fmtDateTime(a.createdAt)}</td><td>{a.actorName}</td><td><code>{a.action}</code></td><td className="small">{a.summary}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="card pad">
        <h3 className="sec-title">🔑 My password</h3>
        <div className="form-grid">
          <Field label="Current password"><input className="input" type="password" value={curPw} onChange={(e) => setCurPw(e.target.value)} /></Field>
          <Field label="New password (min 8 chars)"><input className="input" type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} /></Field>
        </div>
        <div className="row-end"><button className="btn" onClick={doPwChange}>Change password</button></div>
      </div>
    </div>
  );
}
