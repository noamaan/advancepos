import { collection, doc, runTransaction, type Transaction } from 'firebase/firestore';
import { db, firebaseReady } from '../lib/firebase';
import * as L from '../store/localdb';
import { round2, uid } from '../lib/format';
import type { CartLine, Product, Sale, SaleItem, UserProfile, PaymentMethod } from '../types';
import { audit, auditTx } from './audit';

const saleRef = (id: string) => doc(db, 'sales', id);
const prodRef = (id: string) => doc(db, 'products', id);
const counterRef = () => doc(db, 'meta', 'counters');

export interface CheckoutTotals {
  items: SaleItem[];
  subtotal: number;
  discount: number;
  discountPct: number;
  taxRate: number;
  tax: number;
  total: number;
  profit: number;
}

export function computeTotals(lines: CartLine[], discount: number, taxRate: number): CheckoutTotals {
  const items: SaleItem[] = lines.map((l) => {
    const lineGross = round2(l.product.sellingPrice * l.qty);
    const lineTotal = round2(Math.max(0, lineGross - (l.discount || 0)));
    return {
      productId: l.product.id, name: l.product.name, size: l.product.size, unit: l.product.unit,
      qty: l.qty, price: l.product.sellingPrice, purchasePrice: l.product.purchasePrice, lineTotal,
    };
  });
  const subtotal = round2(items.reduce((s, i) => s + i.price * i.qty, 0));
  const lineDiscounts = round2(subtotal - items.reduce((s, i) => s + i.lineTotal, 0));
  const totalDiscount = round2(lineDiscounts + (discount || 0));
  const preTax = round2(Math.max(0, subtotal - totalDiscount));
  const tax = round2((preTax * (taxRate || 0)) / 100);
  const total = round2(preTax + tax);
  const cogs = round2(items.reduce((s, i) => s + i.purchasePrice * i.qty, 0));
  const profit = round2(preTax - cogs); // estimated gross profit (tax excluded)
  const discountPct = subtotal > 0 ? round2((totalDiscount / subtotal) * 100) : 0;
  return { items, subtotal, discount: totalDiscount, discountPct, taxRate: taxRate || 0, tax, total, profit };
}

/** Atomic bill-number allocation inside a transaction. */
async function nextBillNo(t: Transaction, prefix: string): Promise<string> {
  const ref = counterRef();
  const snap = await t.get(ref);
  const n = snap.exists() ? ((snap.data() as { bill?: number }).bill ?? 0) + 1 : 1;
  t.set(ref, { bill: n }, { merge: true });
  return `${prefix}${String(n).padStart(5, '0')}`;
}

/** Read & validate every cart line's product inside a transaction (locks nothing, re-reads fresh). */
async function readProducts(t: Transaction, items: SaleItem[]): Promise<Map<string, { p: Product; ref: ReturnType<typeof prodRef> }>> {
  const out = new Map<string, { p: Product; ref: ReturnType<typeof prodRef> }>();
  for (const item of items) {
    const ref = prodRef(item.productId);
    const snap = await t.get(ref);
    if (!snap.exists()) throw new Error(`"${item.name}" no longer exists`);
    const p = snap.data() as Product;
    if (!p.active) throw new Error(`"${p.name}" is deactivated`);
    if (p.stockQty < item.qty)
      throw new Error(`Insufficient stock for "${p.name}" — have ${p.stockQty}, need ${item.qty}`);
    out.set(item.productId, { p, ref });
  }
  return out;
}

/** Deduct stock + movements + sale doc atomically. Throws on duplicate saleId. */
async function commitSaleWithStock(t: Transaction, sale: Sale): Promise<void> {
  const existing = await t.get(saleRef(sale.id));
  if (existing.exists()) throw new Error('DUPLICATE_SALE');
  const products = await readProducts(t, sale.items);
  const now = Date.now();
  for (const item of sale.items) {
    const { p, ref } = products.get(item.productId)!;
    const after = p.stockQty - item.qty;
    t.update(ref, { stockQty: after, updatedAt: now, updatedBy: sale.cashierName });
    t.set(doc(collection(db, 'stock_movements')), {
      id: uid(), productId: p.id, productName: p.name, type: 'sale',
      qtyDelta: -item.qty, balanceAfter: after, refId: sale.id,
      note: `Sale ${sale.billNo}`, createdAt: now, createdBy: sale.cashierName,
    });
  }
  t.set(saleRef(sale.id), { ...sale, stockDeducted: true });
}

/** Idempotent client-side key for one checkout attempt (stable across retries / double clicks). */
export function newCheckoutKey(): string { return uid(); }

// ── local-mode implementations ─────────────────────────────────────────────
function localBill(prefix: string): string {
  const c = L.get<{ bill: number } & { id: string }>('meta', 'counters');
  const n = (c?.bill ?? 0) + 1;
  L.put('meta', { id: 'counters', bill: n });
  return `${prefix}${String(n).padStart(5, '0')}`;
}
function localCheckStock(items: SaleItem[]): void {
  for (const item of items) {
    const p = L.get<Product & { id: string }>('products', item.productId);
    if (!p) throw new Error(`"${item.name}" no longer exists`);
    if (!p.active) throw new Error(`"${p.name}" is deactivated`);
    if (p.stockQty < item.qty)
      throw new Error(`Insufficient stock for "${p.name}" — have ${p.stockQty}, need ${item.qty}`);
  }
}
function localDeduct(sale: Sale): void {
  const now = Date.now();
  localCheckStock(sale.items);
  for (const item of sale.items) {
    const p = L.get<Product & { id: string }>('products', item.productId)!;
    const after = p.stockQty - item.qty;
    L.put('products', { ...p, stockQty: after, updatedAt: now, updatedBy: sale.cashierName } as unknown as L.Row);
    L.put('stock_movements', {
      id: uid(), productId: p.id, productName: p.name, type: 'sale',
      qtyDelta: -item.qty, balanceAfter: after, refId: sale.id,
      note: `Sale ${sale.billNo}`, createdAt: now, createdBy: sale.cashierName,
    });
  }
}

/**
 * CASH checkout: money is (reliably) already in hand, so the sale is created as
 * 'success' AND stock is deducted in ONE atomic transaction.
 */
export async function checkoutCash(
  checkoutKey: string, lines: CartLine[], totals: CheckoutTotals,
  actor: UserProfile, invoicePrefix: string,
): Promise<string> {
  if (lines.length === 0) throw new Error('Cart is empty');
  if (!firebaseReady) {
    L.initLocalDb();
    if (L.get('sales', checkoutKey)) throw new Error('DUPLICATE_SALE');
    const now = Date.now();
    const sale: Sale = {
      id: checkoutKey, billNo: localBill(invoicePrefix), items: totals.items,
      subtotal: totals.subtotal, discount: totals.discount, discountPct: totals.discountPct,
      taxRate: totals.taxRate, tax: totals.tax, total: totals.total, profit: totals.profit,
      paymentMethod: 'cash', paymentStatus: 'success',
      cashierId: actor.uid, cashierName: actor.name,
      createdAt: now, paidAt: now, verifiedBy: actor.name, verifiedAt: now,
      failReason: null, refunded: false, refundedAt: null, refundedBy: null, refundNote: null,
      stockDeducted: false, stockRestored: false,
    };
    localDeduct(sale);
    sale.stockDeducted = true;
    L.put('sales', sale as unknown as L.Row);
    await audit(actor, 'sale.create', 'sales', checkoutKey, `Cash sale ${sale.billNo} — ₹${totals.total}`);
    return checkoutKey;
  }
  await runTransaction(db, async (t) => {
    const existing = await t.get(saleRef(checkoutKey));
    if (existing.exists()) throw new Error('DUPLICATE_SALE');
    const billNo = await nextBillNo(t, invoicePrefix);
    const now = Date.now();
    const sale: Sale = {
      id: checkoutKey, billNo, items: totals.items,
      subtotal: totals.subtotal, discount: totals.discount, discountPct: totals.discountPct,
      taxRate: totals.taxRate, tax: totals.tax, total: totals.total, profit: totals.profit,
      paymentMethod: 'cash', paymentStatus: 'success',
      cashierId: actor.uid, cashierName: actor.name,
      createdAt: now, paidAt: now, verifiedBy: actor.name, verifiedAt: now,
      failReason: null, refunded: false, refundedAt: null, refundedBy: null, refundNote: null,
      stockDeducted: false, stockRestored: false,
    };
    await commitSaleWithStock(t, sale);
    auditTx(t, actor, 'sale.create', 'sales', checkoutKey, `Cash sale ${billNo} — ₹${totals.total}`);
  });
  return checkoutKey;
}

/**
 * UPI checkout — step 1: create a PENDING sale (NO stock movement yet).
 * Stock is only deducted by confirmUpiPaid(), after a human verifies the
 * money actually arrived. This guarantees "verification before deduction".
 */
export async function checkoutUpiPending(
  checkoutKey: string, lines: CartLine[], totals: CheckoutTotals,
  actor: UserProfile, invoicePrefix: string,
): Promise<string> {
  if (lines.length === 0) throw new Error('Cart is empty');
  if (!firebaseReady) {
    L.initLocalDb();
    if (L.get('sales', checkoutKey)) throw new Error('DUPLICATE_SALE');
    const sale: Sale = {
      id: checkoutKey, billNo: localBill(invoicePrefix), items: totals.items,
      subtotal: totals.subtotal, discount: totals.discount, discountPct: totals.discountPct,
      taxRate: totals.taxRate, tax: totals.tax, total: totals.total, profit: totals.profit,
      paymentMethod: 'upi', paymentStatus: 'pending',
      cashierId: actor.uid, cashierName: actor.name,
      createdAt: Date.now(), paidAt: null, verifiedBy: null, verifiedAt: null,
      failReason: null, refunded: false, refundedAt: null, refundedBy: null, refundNote: null,
      stockDeducted: false, stockRestored: false,
    };
    L.put('sales', sale as unknown as L.Row);
    await audit(actor, 'sale.pending', 'sales', checkoutKey, `UPI sale ${sale.billNo} awaiting payment — ₹${totals.total}`);
    return checkoutKey;
  }
  await runTransaction(db, async (t) => {
    const existing = await t.get(saleRef(checkoutKey));
    if (existing.exists()) throw new Error('DUPLICATE_SALE');
    const billNo = await nextBillNo(t, invoicePrefix);
    const sale: Sale = {
      id: checkoutKey, billNo, items: totals.items,
      subtotal: totals.subtotal, discount: totals.discount, discountPct: totals.discountPct,
      taxRate: totals.taxRate, tax: totals.tax, total: totals.total, profit: totals.profit,
      paymentMethod: 'upi', paymentStatus: 'pending',
      cashierId: actor.uid, cashierName: actor.name,
      createdAt: Date.now(), paidAt: null, verifiedBy: null, verifiedAt: null,
      failReason: null, refunded: false, refundedAt: null, refundedBy: null, refundNote: null,
      stockDeducted: false, stockRestored: false,
    };
    t.set(saleRef(checkoutKey), sale);
    auditTx(t, actor, 'sale.pending', 'sales', checkoutKey, `UPI sale ${billNo} awaiting payment — ₹${totals.total}`);
  });
  return checkoutKey;
}

/**
 * UPI — step 2: staff marks the payment as verified (checked their UPI/bank app).
 * Atomically: pending → success + deduct stock. If ANY line can no longer be
 * fulfilled, the sale is auto-failed and NO money/stock state changes silently.
 */
export async function confirmUpiPaid(saleId: string, verifier: UserProfile): Promise<void> {
  if (!firebaseReady) {
    L.initLocalDb();
    const sale = L.get<Sale & { id: string }>('sales', saleId);
    if (!sale) throw new Error('Sale not found');
    if (sale.paymentMethod !== 'upi') throw new Error('Not a UPI sale');
    if (sale.paymentStatus !== 'pending') throw new Error(`Already ${sale.paymentStatus} — cannot verify twice`);
    const now = Date.now();
    try {
      localDeduct(sale);
      L.put('sales', { ...sale, paymentStatus: 'success', paidAt: now, verifiedBy: verifier.name, verifiedAt: now, stockDeducted: true } as unknown as L.Row);
      await audit(verifier, 'sale.verify', 'sales', saleId, `UPI payment verified for ${sale.billNo} — ₹${sale.total}`);
    } catch (err) {
      L.put('sales', { ...sale, paymentStatus: 'failed', failReason: `Could not fulfil at verification: ${(err as Error).message}` } as unknown as L.Row);
      await audit(verifier, 'sale.verify_failed', 'sales', saleId, `UPI verification FAILED for ${sale.billNo}: ${(err as Error).message}`);
      throw new Error(`Payment NOT captured: ${(err as Error).message}. Sale marked as failed.`);
    }
    return;
  }
  await runTransaction(db, async (t) => {
    const snap = await t.get(saleRef(saleId));
    if (!snap.exists()) throw new Error('Sale not found');
    const sale = snap.data() as Sale;
    if (sale.paymentMethod !== 'upi') throw new Error('Not a UPI sale');
    if (sale.paymentStatus !== 'pending') throw new Error(`Already ${sale.paymentStatus} — cannot verify twice`);
    const now = Date.now();
    try {
      const products = await readProducts(t, sale.items);
      for (const item of sale.items) {
        const { p, ref } = products.get(item.productId)!;
        const after = p.stockQty - item.qty;
        t.update(ref, { stockQty: after, updatedAt: now, updatedBy: verifier.name });
        t.set(doc(collection(db, 'stock_movements')), {
          id: uid(), productId: p.id, productName: p.name, type: 'sale',
          qtyDelta: -item.qty, balanceAfter: after, refId: sale.id,
          note: `Sale ${sale.billNo} (UPI verified)`, createdAt: now, createdBy: verifier.name,
        });
      }
      t.update(saleRef(saleId), {
        paymentStatus: 'success', paidAt: now,
        verifiedBy: verifier.name, verifiedAt: now, stockDeducted: true,
      });
      auditTx(t, verifier, 'sale.verify', 'sales', saleId, `UPI payment verified for ${sale.billNo} — ₹${sale.total}`);
    } catch (err) {
      // Stock disappeared while awaiting payment → fail the sale safely.
      t.update(saleRef(saleId), {
        paymentStatus: 'failed',
        failReason: `Could not fulfil at verification: ${(err as Error).message}`,
      });
      auditTx(t, verifier, 'sale.verify_failed', 'sales', saleId,
        `UPI verification FAILED for ${sale.billNo}: ${(err as Error).message}`);
      throw new Error(`Payment NOT captured: ${(err as Error).message}. Sale marked as failed.`);
    }
  });
}

/** UPI step-2 alt: mark a pending UPI payment as failed / not received. Stock untouched. */
export async function markUpiFailed(saleId: string, reason: string, actor: UserProfile): Promise<void> {
  if (!firebaseReady) {
    L.initLocalDb();
    const sale = L.get<Sale & { id: string }>('sales', saleId);
    if (!sale) throw new Error('Sale not found');
    if (sale.paymentStatus !== 'pending') throw new Error(`Sale is already ${sale.paymentStatus}`);
    L.put('sales', { ...sale, paymentStatus: 'failed', failReason: reason || 'Payment not received' } as unknown as L.Row);
    await audit(actor, 'sale.failed', 'sales', saleId, `UPI ${reason?.toLowerCase() || 'payment failed'} — ${sale.billNo}`);
    return;
  }
  await runTransaction(db, async (t) => {
    const snap = await t.get(saleRef(saleId));
    if (!snap.exists()) throw new Error('Sale not found');
    const sale = snap.data() as Sale;
    if (sale.paymentStatus !== 'pending') throw new Error(`Sale is already ${sale.paymentStatus}`);
    t.update(saleRef(saleId), { paymentStatus: 'failed', failReason: reason || 'Payment not received' });
    auditTx(t, actor, 'sale.failed', 'sales', saleId, `UPI ${reason?.toLowerCase() || 'payment failed'} — ${sale.billNo}`);
  });
}

/**
 * Refund a successful sale: restores stock (once, idempotent), marks sale refunded.
 * Financial record is NEVER deleted — only flagged.
 */
export async function refundSale(saleId: string, note: string, actor: UserProfile): Promise<void> {
  if (!firebaseReady) {
    L.initLocalDb();
    const sale = L.get<Sale & { id: string }>('sales', saleId);
    if (!sale) throw new Error('Sale not found');
    if (sale.refunded) throw new Error('Already refunded');
    if (sale.paymentStatus !== 'success') throw new Error('Only successful sales can be refunded');
    const now = Date.now();
    if (sale.stockDeducted && !sale.stockRestored) {
      for (const item of sale.items) {
        const p = L.get<Product & { id: string }>('products', item.productId);
        if (p) {
          const after = p.stockQty + item.qty;
          L.put('products', { ...p, stockQty: after, updatedAt: now, updatedBy: actor.name } as unknown as L.Row);
          L.put('stock_movements', {
            id: uid(), productId: p.id, productName: p.name, type: 'refund',
            qtyDelta: item.qty, balanceAfter: after, refId: sale.id,
            note: `Refund of ${sale.billNo}`, createdAt: now, createdBy: actor.name,
          });
        }
      }
    }
    L.put('sales', { ...sale, refunded: true, refundedAt: now, refundedBy: actor.name, refundNote: note || '', paymentStatus: 'refunded', stockRestored: true } as unknown as L.Row);
    await audit(actor, 'sale.refund', 'sales', saleId, `Refunded ${sale.billNo} — ₹${sale.total}${note ? ` (${note})` : ''}`);
    return;
  }
  await runTransaction(db, async (t) => {
    const snap = await t.get(saleRef(saleId));
    if (!snap.exists()) throw new Error('Sale not found');
    const sale = snap.data() as Sale;
    if (sale.refunded) throw new Error('Already refunded');
    if (sale.paymentStatus !== 'success') throw new Error('Only successful sales can be refunded');
    const now = Date.now();
    if (sale.stockDeducted && !sale.stockRestored) {
      for (const item of sale.items) {
        const ref = prodRef(item.productId);
        const ps = await t.get(ref);
        if (ps.exists()) {
          const p = ps.data() as Product;
          const after = p.stockQty + item.qty;
          t.update(ref, { stockQty: after, updatedAt: now, updatedBy: actor.name });
          t.set(doc(collection(db, 'stock_movements')), {
            id: uid(), productId: p.id, productName: p.name, type: 'refund',
            qtyDelta: item.qty, balanceAfter: after, refId: sale.id,
            note: `Refund of ${sale.billNo}`, createdAt: now, createdBy: actor.name,
          });
        }
      }
    }
    t.update(saleRef(saleId), {
      refunded: true, refundedAt: now, refundedBy: actor.name,
      refundNote: note || '', paymentStatus: 'refunded', stockRestored: true,
    });
    auditTx(t, actor, 'sale.refund', 'sales', saleId, `Refunded ${sale.billNo} — ₹${sale.total}${note ? ` (${note})` : ''}`);
  });
}

export type { PaymentMethod };
