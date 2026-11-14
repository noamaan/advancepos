import { useMemo, useRef, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import { useCollection } from '../hooks/fs';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { Badge, ConfirmDialog, Field, Modal, useToast } from '../components/ui';
import { adjustStock, createProduct, deleteProduct, updateProduct, type ProductInput } from '../services/inventory';
import { importProducts, applyPriceUpdates } from '../services/importer';
import { parseProductFile, parsePriceFile, downloadProductTemplate, downloadPriceTemplate, exportInventoryReport, exportMovements } from '../lib/excel';
import { fmtDateTime, inr } from '../lib/format';
import type { Product, StockMovement } from '../types';

const EMPTY: ProductInput = {
  name: '', category: '', brand: '', size: '', unit: 'bottle',
  purchasePrice: 0, sellingPrice: 0, stockQty: 0, lowStockThreshold: null, active: true,
};

export function Inventory() {
  const { profile, can } = useAuth();
  const { settings } = useSettings();
  const toast = useToast();
  const [products] = useCollection<Product>('products', [orderBy('name')]);
  const [movements] = useCollection<StockMovement>('stock_movements', [orderBy('createdAt', 'desc')]);

  const [q, setQ] = useState('');
  const [cat, setCat] = useState('All');
  const [show, setShow] = useState<'active' | 'low' | 'out' | 'inactive' | 'all'>('active');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState<ProductInput>(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [adj, setAdj] = useState<{ p: Product } | null>(null);
  const [adjDelta, setAdjDelta] = useState('');
  const [adjNote, setAdjNote] = useState('');
  const [del, setDel] = useState<Product | null>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const priceRef = useRef<HTMLInputElement>(null);
  const [showMoves, setShowMoves] = useState(false);

  const thresholdOf = (p: Product) => p.lowStockThreshold ?? settings.lowStockDefault;
  const categories = useMemo(() => ['All', ...Array.from(new Set(products.map((p) => p.category))).sort()], [products]);
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return products.filter((p) => {
      if (show === 'active' && !p.active) return false;
      if (show === 'inactive' && p.active) return false;
      if (show === 'low' && !(p.active && p.stockQty > 0 && p.stockQty <= thresholdOf(p))) return false;
      if (show === 'out' && !(p.active && p.stockQty <= 0)) return false;
      if (cat !== 'All' && p.category !== cat) return false;
      if (needle && !`${p.name} ${p.brand} ${p.size} ${p.category}`.toLowerCase().includes(needle)) return false;
      return true;
    });
  }, [products, q, cat, show, settings.lowStockDefault]);

  const invValue = useMemo(() => products.filter((p) => p.active).reduce((a, p) => a + p.stockQty * p.purchasePrice, 0), [products]);

  function openForm(p?: Product) {
    if (p) {
      setEditingId(p.id); setAdding(false);
      setForm({ name: p.name, category: p.category, brand: p.brand, size: p.size, unit: p.unit, purchasePrice: p.purchasePrice, sellingPrice: p.sellingPrice, lowStockThreshold: p.lowStockThreshold, active: p.active });
    } else { setEditingId(null); setAdding(true); setForm({ ...EMPTY, category: settings.categories[0] ?? '' }); }
  }
  function closeForm() { setEditingId(null); setAdding(false); setForm(EMPTY); }

  async function saveForm() {
    if (!profile || busy) return;
    if (!form.name.trim()) { toast('err', 'Product name is required'); return; }
    if ((form.sellingPrice ?? 0) <= 0) { toast('err', 'Selling price must be above 0'); return; }
    setBusy(true);
    try {
      if (editingId) { await updateProduct(editingId, form, profile); toast('ok', 'Product updated'); }
      else { await createProduct(form, profile); toast('ok', `Added "${form.name}"`); }
      closeForm();
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); }
  }

  async function doAdjust() {
    if (!profile || !adj) return;
    const d = Math.trunc(Number(adjDelta));
    try {
      await adjustStock(adj.p.id, d, adjNote, profile);
      toast('ok', 'Stock adjusted');
      setAdj(null); setAdjDelta(''); setAdjNote('');
    } catch (e) { toast('err', (e as Error).message); }
  }

  async function onImportFile(f: File) {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const rows = await parseProductFile(f);
      const { created, updated } = await importProducts(rows, profile);
      toast('ok', `Import done — ${created} new, ${updated} updated`);
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; }
  }
  async function onPriceFile(f: File) {
    if (!profile || busy) return;
    setBusy(true);
    try {
      const rows = await parsePriceFile(f);
      const r = await applyPriceUpdates(rows, profile);
      toast('ok', `Prices updated: ${r.updated}${r.skipped ? `, skipped ${r.skipped}` : ''}`);
    } catch (e) { toast('err', (e as Error).message); } finally { setBusy(false); if (priceRef.current) priceRef.current.value = ''; }
  }

  const canManage = can('inventoryManage');
  const canAdjust = can('stockAdjust');
  const formOpen = editingId !== null || adding;

  return (
    <div className="stack">
      <div className="page-head">
        <div><h2>Inventory</h2><span className="muted">Stock value: <b>{inr(invValue)}</b> · {products.filter((p) => p.active).length} active products</span></div>
        <div className="row">
          {can('excel') && <>
            <button className="btn" onClick={() => exportInventoryReport(products.filter((p) => p.active))}>⬇ Export .xlsx</button>
            <button className="btn" onClick={downloadProductTemplate}>📄 Template</button>
            <button className="btn" onClick={() => fileRef.current?.click()}>⬆ Import .xlsx/.csv</button>
            <button className="btn" onClick={() => priceRef.current?.click()}>⇅ Bulk price update</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && onImportFile(e.target.files[0])} />
            <input ref={priceRef} type="file" accept=".xlsx,.xls,.csv" hidden onChange={(e) => e.target.files?.[0] && onPriceFile(e.target.files[0])} />
          </>}
          <button className="btn" onClick={() => setShowMoves(true)}>🧭 Stock history</button>
          {canManage && <button className="btn btn-primary" onClick={() => openForm()}>+ Add product</button>}
        </div>
      </div>

      <div className="card pad-sm">
        <div className="row wrap">
          <input className="input grow" placeholder="Search products…" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input slim" value={cat} onChange={(e) => setCat(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</select>
          <select className="input slim" value={show} onChange={(e) => setShow(e.target.value as typeof show)}>
            <option value="active">Active</option><option value="low">⚠ Low stock</option><option value="out">⛔ Out of stock</option><option value="inactive">Deactivated</option><option value="all">All</option>
          </select>
        </div>
      </div>

      <div className="card table-card">
        <table className="table">
          <thead><tr>
            <th>Product</th><th>Category</th><th>Size</th>{can('viewCost') && <th className="num">Cost</th>}<th className="num">Price</th><th className="num">Stock</th><th className="num">Low at</th>{(canManage || canAdjust) && <th></th>}
          </tr></thead>
          <tbody>
            {filtered.map((p) => {
              const low = p.stockQty <= thresholdOf(p);
              return (
                <tr key={p.id} className={!p.active ? 'row-muted' : ''}>
                  <td><b>{p.name}</b>{p.brand && <div className="muted small">{p.brand}</div>}</td>
                  <td>{p.category}</td>
                  <td>{p.size || '—'}</td>
                  {can('viewCost') && <td className="num">{inr(p.purchasePrice)}</td>}
                  <td className="num">{inr(p.sellingPrice)}</td>
                  <td className="num">{p.stockQty <= 0 ? <Badge tone="bad">0</Badge> : low ? <Badge tone="warn">{p.stockQty}</Badge> : p.stockQty} <span className="muted small">{p.unit}</span></td>
                  <td className="num">{thresholdOf(p)}</td>
                  {(canManage || canAdjust) && (
                    <td className="row-end">
                      {canAdjust && <button className="btn btn-mini" onClick={() => setAdj({ p })}>± Stock</button>}
                      {canManage && <button className="btn btn-mini" onClick={() => openForm(p)}>Edit</button>}
                      {canManage && <button className="btn btn-mini btn-danger-ghost" onClick={() => setDel(p)}>✕</button>}
                    </td>
                  )}
                </tr>
              );
            })}
            {filtered.length === 0 && <tr><td colSpan={9} className="muted center pad">No products here yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {formOpen && canManage && (
        <Modal title={editingId ? 'Edit product' : 'Add product'} onClose={closeForm}>
          <div className="form-grid">
            <Field label="Name"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Kingfisher Premium" /></Field>
            <Field label="Category">
              <input className="input" list="cats" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} />
              <datalist id="cats">{settings.categories.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field label="Brand"><input className="input" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value })} /></Field>
            <Field label="Size"><input className="input" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })} placeholder="650ml / 500ml can" /></Field>
            <Field label="Unit"><input className="input" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="bottle" /></Field>
            <Field label="Purchase price (₹)"><input className="input" type="number" min={0} step="0.01" value={form.purchasePrice || ''} onChange={(e) => setForm({ ...form, purchasePrice: Number(e.target.value) || 0 })} /></Field>
            <Field label="Selling price (₹)"><input className="input" type="number" min={0} step="0.01" value={form.sellingPrice || ''} onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) || 0 })} /></Field>
            <Field label={`Low-stock alert at (blank = shop default ${settings.lowStockDefault})`}>
              <input className="input" type="number" min={0} value={form.lowStockThreshold ?? ''} onChange={(e) => setForm({ ...form, lowStockThreshold: e.target.value === '' ? null : Number(e.target.value) })} />
            </Field>
            {!editingId && <Field label="Opening stock" hint="Logged as an import movement"><input className="input" type="number" min={0} value={form.stockQty || ''} onChange={(e) => setForm({ ...form, stockQty: Number(e.target.value) || 0 })} /></Field>}
            {editingId && <Field label="Active"><select className="input" value={form.active ? 'y' : 'n'} onChange={(e) => setForm({ ...form, active: e.target.value === 'y' })}><option value="y">Active (sellable)</option><option value="n">Deactivated</option></select></Field>}
          </div>
          <div className="row-end">
            <button className="btn" onClick={closeForm}>Cancel</button>
            <button className="btn btn-primary" disabled={busy} onClick={saveForm}>{busy ? 'Saving…' : 'Save product'}</button>
          </div>
        </Modal>
      )}

      {adj && (
        <Modal title={`Adjust stock — ${adj.p.name}`} onClose={() => setAdj(null)}>
          <p className="muted">Current stock: <b>{adj.p.stockQty} {adj.p.unit}</b>. Use negative numbers to remove stock (damage, breakage…).</p>
          <Field label="Change (+/−)"><input className="input" type="number" value={adjDelta} onChange={(e) => setAdjDelta(e.target.value)} placeholder="e.g. 24 or -2" /></Field>
          <Field label="Reason"><input className="input" value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder="Damage / count correction…" /></Field>
          <div className="row-end"><button className="btn" onClick={() => setAdj(null)}>Cancel</button><button className="btn btn-primary" onClick={doAdjust}>Apply</button></div>
        </Modal>
      )}

      {del && (
        <ConfirmDialog danger
          text={`Deactivate "${del.name}"? It will stop appearing in billing. Sales history is preserved. (Physical deletion of financial records is disabled.)`}
          onNo={() => setDel(null)}
          onYes={async () => { try { await deleteProduct(del.id, profile!); toast('ok', 'Product deactivated'); } catch (e) { toast('err', (e as Error).message); } setDel(null); }} />
      )}

      {showMoves && (
        <Modal title="Stock movement history" onClose={() => setShowMoves(false)} wide>
          <div className="row-end" style={{ marginBottom: 8 }}>
            <button className="btn" onClick={() => exportMovements(movements)}>⬇ Export .xlsx</button>
          </div>
          <div className="table-card">
            <table className="table">
              <thead><tr><th>When</th><th>Product</th><th>Type</th><th className="num">Change</th><th className="num">Balance</th><th>Note</th><th>By</th></tr></thead>
              <tbody>
                {movements.slice(0, 300).map((m) => (
                  <tr key={m.id}>
                    <td className="muted small">{fmtDateTime(m.createdAt)}</td>
                    <td>{m.productName}</td>
                    <td><Badge tone={m.type === 'sale' ? 'info' : m.type === 'purchase' ? 'ok' : m.type === 'refund' ? 'warn' : 'muted'}>{m.type}</Badge></td>
                    <td className={`num ${m.qtyDelta < 0 ? 'neg' : 'pos'}`}>{m.qtyDelta > 0 ? `+${m.qtyDelta}` : m.qtyDelta}</td>
                    <td className="num">{m.balanceAfter}</td>
                    <td className="small">{m.note}</td>
                    <td className="small">{m.createdBy}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}
    </div>
  );
}
