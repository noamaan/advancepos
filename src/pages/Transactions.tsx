import { useMemo, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '../hooks/fs';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { Badge, ConfirmDialog, Modal, useToast } from '../components/ui';
import { Invoice, printNow } from '../components/Invoice';
import { confirmUpiPaid, markUpiFailed, refundSale } from '../services/sales';
import { exportTransactionsReport } from '../lib/excel';
import { dateKey, endOfDay, fmtDateTime, inr, startOfDay } from '../lib/format';
import type { Sale } from '../types';

const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'muted' | 'info'> = {
  success: 'ok', pending: 'warn', failed: 'bad', refunded: 'muted',
};

export function Transactions() {
  const { profile, can } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const [sales] = useCollection<Sale>('sales', [orderBy('createdAt', 'desc')]);

  const [from, setFrom] = useState(dateKey(Date.now()));
  const [to, setTo] = useState(dateKey(Date.now()));
  const [method, setMethod] = useState<'all' | 'cash' | 'upi'>('all');
  const [status, setStatus] = useState<'all' | Sale['paymentStatus']>('all');
  const [view, setView] = useState<Sale | null>(null);
  const [refundTarget, setRefundTarget] = useState<Sale | null>(null);
  const [busy, setBusy] = useState('');

  const ranged = useMemo(() => {
    const f = startOfDay(new Date(from).getTime()); const t = endOfDay(new Date(to).getTime());
    return sales.filter((s) =>
      s.createdAt >= f && s.createdAt <= t &&
      (method === 'all' || s.paymentMethod === method) &&
      (status === 'all' || s.paymentStatus === status));
  }, [sales, from, to, method, status]);

  const totalCollected = useMemo(() => ranged.filter((s) => s.paymentStatus === 'success').reduce((a, s) => a + s.total, 0), [ranged]);

  async function verify(s: Sale) {
    if (!profile || busy) return;
    setBusy(s.id);
    try { await confirmUpiPaid(s.id, profile); toast('ok', `${s.billNo} verified & stock updated`); }
    catch (e) { toast('err', (e as Error).message); } finally { setBusy(''); }
  }
  async function fail(s: Sale) {
    if (!profile || busy) return;
    const reason = window.prompt('Reason?', 'Payment not received') ?? 'Payment not received';
    setBusy(s.id);
    try { await markUpiFailed(s.id, reason, profile); toast('info', 'Marked failed'); }
    catch (e) { toast('err', (e as Error).message); } finally { setBusy(''); }
  }

  return (
    <div className="stack">
      <div className="page-head">
        <div><h2>Transactions</h2><span className="muted">Collected in range: <b>{inr(totalCollected)}</b> · {ranged.length} bills</span></div>
        <div className="row wrap">
          <input className="input slim" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input slim" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          <select className="input slim" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}><option value="all">All methods</option><option value="cash">Cash</option><option value="upi">UPI</option></select>
          <select className="input slim" value={status} onChange={(e) => setStatus(e.target.value as typeof status)}><option value="all">All status</option><option value="success">Success</option><option value="pending">Pending</option><option value="failed">Failed</option><option value="refunded">Refunded</option></select>
          {can('excel') && <button className="btn" onClick={() => exportTransactionsReport(ranged, startOfDay(new Date(from).getTime()), endOfDay(new Date(to).getTime()))}>⬇ Export</button>}
        </div>
      </div>

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Bill</th><th>Time</th><th>Items</th><th className="num">Total</th><th>Method</th><th>Status</th><th>Cashier</th><th></th></tr></thead>
          <tbody>
            {ranged.map((s) => (
              <tr key={s.id}>
                <td><b>{s.billNo}</b></td>
                <td className="muted small">{fmtDateTime(s.createdAt)}</td>
                <td>{s.items.reduce((n, i) => n + i.qty, 0)}</td>
                <td className="num">{inr(s.total)}</td>
                <td>{s.paymentMethod.toUpperCase()}</td>
                <td><Badge tone={STATUS_TONE[s.paymentStatus]}>{s.paymentStatus}</Badge></td>
                <td className="small">{s.cashierName}</td>
                <td className="row-end">
                  <button className="btn btn-mini" onClick={() => setView(s)}>View / Print</button>
                  {s.paymentStatus === 'pending' && can('verifyPayments') && <>
                    <button className="btn btn-mini btn-pay" disabled={busy === s.id} onClick={() => verify(s)}>✔ Verify</button>
                    <button className="btn btn-mini btn-danger-ghost" disabled={busy === s.id} onClick={() => fail(s)}>✖</button>
                  </>}
                  {s.paymentStatus === 'success' && can('refunds') && (
                    <button className="btn btn-mini btn-danger-ghost" onClick={() => setRefundTarget(s)}>Refund</button>
                  )}
                </td>
              </tr>
            ))}
            {ranged.length === 0 && <tr><td colSpan={8} className="muted center pad">No transactions in this range.</td></tr>}
          </tbody>
        </table>
      </div>

      {view && (
        <Modal title={`Bill ${view.billNo}`} onClose={() => setView(null)}>
          <div className="print-preview"><Invoice sale={view} s={settings} /></div>
          {view.failReason && <p className="badge badge-bad">{view.failReason}</p>}
          {view.refundNote && <p className="muted">Refund note: {view.refundNote} (by {view.refundedBy})</p>}
          <div className="row-end">
            <button className="btn" onClick={() => setView(null)}>Close</button>
            <button className="btn btn-primary" onClick={printNow}>🖨 Reprint / Save PDF</button>
          </div>
        </Modal>
      )}
      <div className="print-area">{view && <Invoice sale={view} s={settings} />}</div>

      {refundTarget && (
        <ConfirmDialog danger
          text={`Refund ${refundTarget.billNo} (${inr(refundTarget.total)})? Stock will be returned to inventory. The financial record is preserved and flagged as refunded — no data is deleted.`}
          onNo={() => setRefundTarget(null)}
          onYes={async () => {
            const note = window.prompt('Refund reason (optional)') ?? '';
            try { await refundSale(refundTarget.id, note, profile!); toast('ok', 'Refunded & stock restored'); }
            catch (e) { toast('err', (e as Error).message); }
            setRefundTarget(null);
          }} />
      )}
    </div>
  );
}
