import { useEffect, useState } from 'react';
import type { BusinessSettings, Sale } from '../types';
import { fmtDate, fmtTime } from '../lib/format';
import { upiQrDataUrl, upiUri } from '../lib/upi';

/**
 * Thermal receipt. Rendered inside .print-area; @media print CSS hides the app
 * and prints ONLY this node at settings.paperSize mm width.
 */
export function Invoice({ sale, s }: { sale: Sale; s: BusinessSettings }) {
  const [qr, setQr] = useState('');
  useEffect(() => {
    let live = true;
    if (sale.paymentMethod === 'upi' && s.upiId) {
      upiQrDataUrl(upiUri({ pa: s.upiId, pn: s.upiPayeeName || s.bizName, am: sale.total, tn: `Bill ${sale.billNo}` }))
        .then((d) => live && setQr(d)).catch(() => undefined);
    } else setQr('');
    return () => { live = false; };
  }, [sale, s]);

  const rows = sale.items.map((i, idx) => (
    <tr key={idx}>
      <td className="ip-name">{i.name}{i.size ? ` ${i.size}` : ''}</td>
      <td className="ip-num">{i.qty}</td>
      <td className="ip-num">{i.price.toFixed(2)}</td>
      <td className="ip-num">{i.lineTotal.toFixed(2)}</td>
    </tr>
  ));

  return (
    <div className="invoice" style={{ width: `${s.paperSize}mm` }}>
      {s.logoUrl && <img className="inv-logo" src={s.logoUrl} alt="" />}
      <div className="inv-biz">{s.bizName}</div>
      {s.address && <div className="inv-line">{s.address}</div>}
      {s.phone && <div className="inv-line">Ph: {s.phone}</div>}
      <div className="inv-sep" />
      <div className="inv-row"><span>Bill: {sale.billNo}</span><span>{fmtDate(sale.createdAt)}</span></div>
      <div className="inv-row"><span>{fmtTime(sale.createdAt)}</span><span>Cashier: {sale.cashierName}</span></div>
      <div className="inv-sep" />
      <table className="inv-table">
        <thead><tr><th>Item</th><th className="ip-num">Qty</th><th className="ip-num">Rate</th><th className="ip-num">Amt</th></tr></thead>
        <tbody>{rows}</tbody>
      </table>
      <div className="inv-sep" />
      <div className="inv-row"><span>Subtotal</span><span>{sale.subtotal.toFixed(2)}</span></div>
      {sale.discount > 0 && <div className="inv-row"><span>Discount{sale.discountPct ? ` (${sale.discountPct}%)` : ''}</span><span>-{sale.discount.toFixed(2)}</span></div>}
      {sale.tax > 0 && <div className="inv-row"><span>Tax ({sale.taxRate}%)</span><span>{sale.tax.toFixed(2)}</span></div>}
      <div className="inv-row inv-grand"><span>TOTAL</span><span>₹{sale.total.toFixed(2)}</span></div>
      <div className="inv-row"><span>Payment</span><span>{sale.paymentMethod.toUpperCase()} · {sale.paymentStatus.toUpperCase()}</span></div>
      {qr && (
        <div className="inv-qr">
          <img src={qr} alt="UPI QR" />
          <div className="inv-line">Scan to pay ₹{sale.total.toFixed(0)} via UPI</div>
          <div className="inv-line inv-small">{s.upiId}</div>
        </div>
      )}
      <div className="inv-sep" />
      <div className="inv-thanks">{s.thankYouNote || 'Thank you!'}</div>
      <div className="inv-sep inv-cut" />
    </div>
  );
}

export function printNow() { window.print(); }
