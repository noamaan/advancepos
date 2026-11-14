import { useEffect, useMemo, useRef, useState } from 'react';
import { useCollection } from '../hooks/fs';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { Modal, useToast, Spinner } from '../components/ui';
import { Invoice, printNow } from '../components/Invoice';
import { checkoutCash, checkoutUpiPending, confirmUpiPaid, markUpiFailed, computeTotals, newCheckoutKey } from '../services/sales';
import { inr, round2 } from '../lib/format';
import type { CartLine, Product, Sale } from '../types';
import { upiQrDataUrl, upiUri } from '../lib/upi';

export function POS() {
  const { profile, can } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();

  const [products] = useCollection<Product>('products', { where: [{ field: 'active', op: '==', value: true }] });
  const [pendingSales] = useCollection<Sale>('sales', { where: [{ field: 'paymentStatus', op: '==', value: 'pending' }], order: [{ field: 'createdAt', dir: 'desc' }] });

  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('All');
  const [cart, setCart] = useState<CartLine[]>([]);
  const [billDiscount, setBillDiscount] = useState(0);
  const [checkoutKey, setCheckoutKey] = useState(newCheckoutKey());
  const [busy, setBusy] = useState(false);
  const [cartOpen, setCartOpen] = useState(false);
  const [printSale, setPrintSale] = useState<Sale | null>(null);
  const [upiFlow, setUpiFlow] = useState<{ saleId: string; total: number; qr: string } | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => { searchRef.current?.focus(); }, []);

  // ── barcode scanner support ──────────────────────────────────────────────
  // USB/Bluetooth scanners act as keyboards: rapid digits then Enter.
  const scanBuf = useRef<{ s: string; last: number }>({ s: '', last: 0 });

  function beep(ok: boolean) {
    try {
      const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      const o = ctx.createOscillator(); const g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = ok ? 880 : 220; o.type = ok ? 'sine' : 'square';
      g.gain.setValueAtTime(0.08, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + (ok ? 0.12 : 0.35));
      o.start(); o.stop(ctx.currentTime + (ok ? 0.12 : 0.35));
      o.onended = () => void ctx.close();
    } catch { /* audio blocked — ignore */ }
  }

  function handleScannedCode(code: string) {
    const hit = products.find((p) => p.barcode === code && p.active !== false);
    if (hit) {
      addToCart(hit);
      beep(true);
      toast('ok', `➕ ${hit.name} added (scanned ${code})`);
    } else {
      beep(false);
      toast('err', `Unknown barcode "${code}". Add it to a product in Inventory (open the product → Barcode field → scan).`);
    }
    setSearch('');
    searchRef.current?.focus();
  }

  // Enter in the search box: exact barcode → add. Otherwise stays a text search.
  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    const code = search.trim();
    if (code.length >= 6 && /^[0-9A-Za-z-]+$/.test(code)) handleScannedCode(code);
  }

  // Safety net: scan bursts while no input is focused (e.g. after tapping tiles).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return; // inputs handle themselves
      const now = performance.now();
      if (e.key === 'Enter') {
        const { s, last } = scanBuf.current;
        scanBuf.current = { s: '', last: 0 };
        if (s.length >= 6 && now - last < 150) {
          e.preventDefault();
          handleScannedCode(s);
        }
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (now - scanBuf.current.last > 150) scanBuf.current.s = '';
        scanBuf.current.s = (scanBuf.current.s + e.key).slice(-24);
        scanBuf.current.last = now;
      } else {
        scanBuf.current.s = '';
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [products]);

  const activeProducts = useMemo(() => products.filter((p) => p.active !== false), [products]);
  const categories = useMemo(() => ['All', ...Array.from(new Set(activeProducts.map((p) => p.category))).sort()], [activeProducts]);
  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return activeProducts.filter((p) =>
      (cat === 'All' || p.category === cat) &&
      (!q || p.name.toLowerCase().includes(q) || p.brand.toLowerCase().includes(q)
        || p.size.toLowerCase().includes(q) || (p.barcode ?? '').toLowerCase().includes(q)));
  }, [activeProducts, search, cat]);

  const totals = useMemo(() => computeTotals(cart, billDiscount, settings.taxRate), [cart, billDiscount, settings.taxRate]);
  const lowIds = useMemo(() => new Set(activeProducts.filter((p) => p.stockQty <= (p.lowStockThreshold ?? settings.lowStockDefault)).map((p) => p.id)), [activeProducts, settings.lowStockDefault]);

  function addToCart(p: Product) {
    if (p.stockQty <= 0) { toast('err', `"${p.name}" is out of stock`); return; }
    setCart((c) => {
      const i = c.findIndex((l) => l.product.id === p.id);
      if (i >= 0) {
        const next = [...c];
        const q = Math.min(next[i].qty + 1, p.stockQty);
        if (q === next[i].qty) toast('err', `Only ${p.stockQty} in stock for "${p.name}"`);
        next[i] = { ...next[i], qty: q };
        return next;
      }
      return [...c, { product: p, qty: 1, discount: 0 }];
    });
    // scanner-friendly: keep the search/scan box focused when using a keyboard
    if (window.matchMedia && window.matchMedia('(pointer: fine)').matches) searchRef.current?.focus();
  }
  const setQty = (id: string, qty: number) => setCart((c) => c.map((l) => l.product.id === id ? { ...l, qty: Math.max(1, Math.min(Math.floor(qty) || 1, l.product.stockQty)) } : l));
  const setLineDisc = (id: string, d: number) => setCart((c) => c.map((l) => l.product.id === id ? { ...l, discount: Math.max(0, Math.min(d, round2(l.product.sellingPrice * l.qty))) } : l));
  const removeLine = (id: string) => setCart((c) => c.filter((l) => l.product.id !== id));
  function clearCart(nextRound = false) {
    setCart([]); setBillDiscount(0);
    if (nextRound) setCheckoutKey(newCheckoutKey());
  }

  async function doCash() {
    if (!profile || busy || cart.length === 0) return;
    setBusy(true);
    try {
      const key = checkoutKey;
      const totalsNow = totals;
      await checkoutCash(key, cart, totalsNow, profile, settings.invoicePrefix);
      toast('ok', `Bill saved — ${inr(totalsNow.total)} (cash)`);
      setPrintSale({ id: key, billNo: '', items: totalsNow.items, subtotal: totalsNow.subtotal, discount: totalsNow.discount, discountPct: totalsNow.discountPct, taxRate: totalsNow.taxRate, tax: totalsNow.tax, total: totalsNow.total, profit: totalsNow.profit, paymentMethod: 'cash', paymentStatus: 'success', cashierId: profile.uid, cashierName: profile.name, createdAt: Date.now(), paidAt: Date.now(), verifiedBy: profile.name, verifiedAt: Date.now(), failReason: null, refunded: false, refundedAt: null, refundedBy: null, refundNote: null, stockDeducted: true, stockRestored: false });
      clearCart(true);
      setCartOpen(false);
      if (cart.some((l) => lowIds.has(l.product.id))) toast('info', 'Some items are now low on stock — check Inventory.');
    } catch (err) {
      toast('err', (err as Error).message === 'DUPLICATE_SALE' ? 'This bill was already saved (duplicate prevented).' : (err as Error).message);
      if ((err as Error).message === 'DUPLICATE_SALE') setCheckoutKey(newCheckoutKey());
    } finally { setBusy(false); }
  }

  async function doUpi() {
    if (!profile || busy || cart.length === 0) return;
    if (!settings.upiId) { toast('err', 'Set your UPI ID in Settings → Business first'); return; }
    setBusy(true);
    try {
      const key = checkoutKey;
      await checkoutUpiPending(key, cart, totals, profile, settings.invoicePrefix);
      const qr = await upiQrDataUrl(upiUri({ pa: settings.upiId, pn: settings.upiPayeeName || settings.bizName, am: totals.total, tn: `Bill ${key.slice(0, 8)}` }), 220);
      setUpiFlow({ saleId: key, total: totals.total, qr });
      toast('info', 'UPI bill created — waiting for payment verification');
    } catch (err) {
      toast('err', (err as Error).message === 'DUPLICATE_SALE' ? 'Bill already created — verify it below.' : (err as Error).message);
    } finally { setBusy(false); }
  }

  async function verifyPending(s: Sale) {
    if (!profile) return;
    try {
      await confirmUpiPaid(s.id, profile);
      toast('ok', `${s.billNo} paid — stock updated`);
      setPrintSale({ ...s, paymentStatus: 'success', paidAt: Date.now(), stockDeducted: true });
      setUpiFlow(null);
      clearCart(true);
    } catch (err) { toast('err', (err as Error).message); }
  }
  async function failPending(s: Sale) {
    if (!profile) return;
    try {
      const reason = window.prompt('Reason (customer cancelled / payment not received…)', 'Payment not received') ?? 'Payment not received';
      await markUpiFailed(s.id, reason, profile);
      toast('info', `${s.billNo} marked failed — stock untouched`);
      if (upiFlow?.saleId === s.id) setUpiFlow(null);
      clearCart(true);
    } catch (err) { toast('err', (err as Error).message); }
  }

  return (
    <div className="pos-grid">
      <section className="pos-left card">
        <div className="pos-search-row">
          <input ref={searchRef} className="input" placeholder="🔍 Search or scan barcode…" value={search}
            onChange={(e) => setSearch(e.target.value)} onKeyDown={onSearchKey} inputMode="search" />
        </div>
        <div className="chip-row">
          {categories.map((c) => <button key={c} className={`chip ${cat === c ? 'chip-on' : ''}`} onClick={() => setCat(c)}>{c}</button>)}
        </div>
        <div className="grid">
          {visible.map((p) => (
            <button key={p.id} className={`tile ${p.stockQty <= 0 ? 'tile-out' : ''}`} onClick={() => addToCart(p)} disabled={p.stockQty <= 0}>
              <div className="tile-name">{p.name}</div>
              <div className="tile-meta">{p.brand} {p.size && `· ${p.size}`}</div>
              <div className="tile-foot">
                <span className="tile-price">{inr(p.sellingPrice)}</span>
                <span className={`tile-stock ${lowIds.has(p.id) ? 'stock-low' : ''}`}>{p.stockQty <= 0 ? 'OUT' : `${p.stockQty} ${p.unit}`}</span>
              </div>
            </button>
          ))}
          {visible.length === 0 && <div className="muted pad">No products match. Add products in Inventory.</div>}
        </div>
      </section>

      <section className={`pos-right card ${cartOpen ? 'cart-open' : ''}`}>
        <h3 className="cart-title">
          Current bill
          <button className="btn btn-ghost btn-mini cart-close" onClick={() => setCartOpen(false)}>✕ Close</button>
        </h3>
        <div className="cart-lines">
          {cart.map((l) => (
            <div key={l.product.id} className="cline">
              <div className="cline-main">
                <div className="cline-name">{l.product.name} <span className="muted">{l.product.size}</span></div>
                <div className="cline-sub">{inr(l.product.sellingPrice)} · stock {l.product.stockQty}</div>
              </div>
              <div className="cline-qty">
                <button className="btn btn-mini" onClick={() => setQty(l.product.id, l.qty - 1)} disabled={l.qty <= 1}>−</button>
                <input className="input qty" type="number" min={1} max={l.product.stockQty} value={l.qty} onChange={(e) => setQty(l.product.id, Number(e.target.value))} />
                <button className="btn btn-mini" onClick={() => setQty(l.product.id, l.qty + 1)} disabled={l.qty >= l.product.stockQty}>+</button>
              </div>
              <input className="input ldisc" type="number" min={0} placeholder="Disc ₹" title="Line discount (₹)"
                value={l.discount || ''} onChange={(e) => setLineDisc(l.product.id, Number(e.target.value) || 0)} />
              <div className="cline-total">{inr(round2(l.product.sellingPrice * l.qty - (l.discount || 0)))}</div>
              <button className="btn btn-ghost btn-mini" onClick={() => removeLine(l.product.id)}>✕</button>
            </div>
          ))}
          {cart.length === 0 && <div className="muted pad">Tap products on the left to add them here.</div>}
        </div>

        <div className="totals">
          <div className="trow"><span>Subtotal</span><span>{inr(totals.subtotal)}</span></div>
          <div className="trow">
            <span>Bill discount ₹</span>
            <input className="input disc-in" type="number" min={0} value={billDiscount || ''} placeholder="0"
              onChange={(e) => setBillDiscount(Math.max(0, Math.min(Number(e.target.value) || 0, totals.subtotal)))} />
          </div>
          {settings.taxRate > 0 && <div className="trow"><span>Tax ({settings.taxRate}%)</span><span>{inr(totals.tax)}</span></div>}
          <div className="trow grand"><span>Total</span><span>{inr(totals.total)}</span></div>
        </div>

        <div className="pay-row">
          <button className="btn btn-primary btn-lg" disabled={busy || cart.length === 0} onClick={doCash}>💵 Cash — {inr(totals.total)}</button>
          <button className="btn btn-pay btn-lg" disabled={busy || cart.length === 0} onClick={doUpi}>📱 UPI</button>
        </div>
        <p className="fine-print">UPI: the bill is saved as <b>pending</b> and stock moves only after you verify the payment actually arrived.</p>

        {pendingSales.length > 0 && can('verifyPayments') && (
          <div className="pending-box">
            <h4>⏳ Pending UPI payments ({pendingSales.length})</h4>
            {pendingSales.slice(0, 6).map((s) => (
              <div key={s.id} className="pending-row">
                <div>
                  <b>{s.billNo}</b> · {inr(s.total)}
                  <div className="muted small">{new Date(s.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })} by {s.cashierName}</div>
                </div>
                <div className="row-end">
                  <button className="btn btn-mini btn-pay" onClick={() => verifyPending(s)}>✔ Payment received</button>
                  <button className="btn btn-mini btn-danger-ghost" onClick={() => failPending(s)}>✖ Failed</button>
                </div>
              </div>
            ))}
          </div>
        )}
        {cart.length > 0 && <button className="btn btn-ghost btn-block" onClick={() => clearCart(false)}>Clear bill</button>}
      </section>

      {/* mobile cart FAB + scrim */}
      {cartOpen && <div className="cart-scrim" onClick={() => setCartOpen(false)} />}
      <button className="cart-fab" onClick={() => setCartOpen(true)} aria-label="Open cart">
        🧾 <b>{cart.reduce((n, l) => n + l.qty, 0)}</b> · {inr(totals.total)} →
      </button>

      {upiFlow && (
        <Modal title="Waiting for UPI payment" onClose={() => undefined} wide>
          <div className="upi-flow">
            <div className="upi-amount">{inr(upiFlow.total)}</div>
            <img className="upi-qr" src={upiFlow.qr} alt="UPI QR" />
            <p className="muted center">Customer scans with GPay / PhonePe / Paytm / BHIM.<br />Check <b>your own UPI/bank app</b> before confirming.</p>
            <div className="row-end">
              <button className="btn btn-danger-ghost" onClick={() => {
                const s = pendingSales.find((x) => x.id === upiFlow.saleId);
                if (s) void failPending(s); else setUpiFlow(null);
              }}>Payment failed / cancelled</button>
              <button className="btn btn-primary" onClick={() => {
                const s = pendingSales.find((x) => x.id === upiFlow.saleId)
                  ?? ({ id: upiFlow.saleId } as Sale);
                if (!('billNo' in s)) { // fall back to minimal object
                  void confirmUpiPaid(upiFlow.saleId, profile!).then(() => { toast('ok', 'Payment verified — stock updated'); setUpiFlow(null); clearCart(true); }).catch((e) => toast('err', (e as Error).message));
                } else void verifyPending(s);
              }}>✔ I verified the payment arrived</button>
            </div>
          </div>
        </Modal>
      )}

      {printSale && (
        <Modal title="Print bill" onClose={() => setPrintSale(null)}>
          <div className="print-preview">
            <Invoice sale={printSale} s={settings} />
          </div>
          <div className="row-end">
            <button className="btn" onClick={() => setPrintSale(null)}>Close</button>
            <button className="btn btn-primary" onClick={printNow}>🖨 Print / Save PDF</button>
          </div>
        </Modal>
      )}

      {/* hidden print area — only this is sent to the printer */}
      <div className="print-area">{printSale && <Invoice sale={printSale} s={settings} />}</div>
      {!products && <Spinner />}
    </div>
  );
}
