import { useMemo, useState } from 'react';
import { orderBy, where } from 'firebase/firestore';
import { useCollection } from '../hooks/fs';
import { useAuth } from '../store/auth';
import { Field, Modal, useToast } from '../components/ui';
import { recordPurchase } from '../services/inventory';
import { exportPurchasesReport } from '../lib/excel';
import { fmtDateTime, inr, startOfDay, endOfDay, dateKey } from '../lib/format';
import type { Product, Purchase } from '../types';

export function Purchases() {
  const { profile, can } = useAuth();
  const toast = useToast();
  const [products] = useCollection<Product>('products');
  const [purchases] = useCollection<Purchase>('purchases', [orderBy('createdAt', 'desc')]);

  const [open, setOpen] = useState(false);
  const [pid, setPid] = useState('');
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [inv, setInv] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState(dateKey(Date.now() - 29 * 864e5));
  const [to, setTo] = useState(dateKey(Date.now()));

  const ranged = useMemo(() => {
    const f = startOfDay(new Date(from).getTime()); const t = endOfDay(new Date(to).getTime());
    return purchases.filter((p) => p.createdAt >= f && p.createdAt <= t);
  }, [purchases, from, to]);
  const spent = useMemo(() => ranged.reduce((a, p) => a + p.total, 0), [ranged]);

  async function save() {
    if (!profile || busy) return;
    const q = Math.trunc(Number(qty)); const c = Number(cost);
    if (!pid) { toast('err', 'Choose a product'); return; }
    if (!q || q <= 0) { toast('err', 'Quantity must be positive'); return; }
    setBusy(true);
    try {
      await recordPurchase(pid, q, c || 0, supplier, inv, note, profile);
      toast('ok', 'Purchase recorded — stock updated');
      setOpen(false); setPid(''); setQty(''); setCost(''); setSupplier(''); setInv(''); setNote('');
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div><h2>Stock purchases</h2><span className="muted">Recording a purchase immediately adds to stock (logged & auditable).</span></div>
        <div className="row">
          <input className="input slim" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input slim" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          {can('excel') && <button className="btn" onClick={() => exportPurchasesReport(ranged, startOfDay(new Date(from).getTime()), endOfDay(new Date(to).getTime()))}>⬇ Export</button>}
          <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Record purchase</button>
        </div>
      </div>

      <div className="card pad-sm muted">Period spend: <b>{inr(spent)}</b> · {ranged.length} records</div>

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Date</th><th>Product</th><th className="num">Qty</th><th className="num">Unit cost</th><th className="num">Total</th><th>Supplier</th><th>Invoice</th><th>By</th></tr></thead>
          <tbody>
            {ranged.map((p) => (
              <tr key={p.id}>
                <td className="muted small">{fmtDateTime(p.createdAt)}</td>
                <td><b>{p.productName}</b></td>
                <td className="num pos">+{p.qty}</td>
                <td className="num">{inr(p.unitCost)}</td>
                <td className="num">{inr(p.total)}</td>
                <td>{p.supplier || '—'}</td>
                <td>{p.invoiceNo || '—'}</td>
                <td className="small">{p.createdBy}</td>
              </tr>
            ))}
            {ranged.length === 0 && <tr><td colSpan={8} className="muted center pad">No purchases in this period.</td></tr>}
          </tbody>
        </table>
      </div>

      {open && (
        <Modal title="Record stock purchase" onClose={() => setOpen(false)}>
          <div className="form-grid">
            <Field label="Product">
              <select className="input" value={pid} onChange={(e) => { setPid(e.target.value); const p = products.find((x) => x.id === e.target.value); if (p) setCost(String(p.purchasePrice || '')); }}>
                <option value="">Select…</option>
                {products.filter((p) => p.active).map((p) => <option key={p.id} value={p.id}>{p.name} {p.size}</option>)}
              </select>
            </Field>
            <Field label="Quantity"><input className="input" type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} /></Field>
            <Field label="Unit cost (₹)" hint="Becomes the product's new purchase price"><input className="input" type="number" min={0} step="0.01" value={cost} onChange={(e) => setCost(e.target.value)} /></Field>
            <Field label="Supplier"><input className="input" value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
            <Field label="Invoice #"><input className="input" value={inv} onChange={(e) => setInv(e.target.value)} /></Field>
            <Field label="Note"><input className="input" value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          </div>
          <div className="row-end"><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save & add stock'}</button></div>
        </Modal>
      )}
    </div>
  );
}
