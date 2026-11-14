import {
  collection, doc, getDocs, limit, query, runTransaction, serverTimestamp, deleteField, where,
} from 'firebase/firestore';
import { db, firebaseReady } from '../lib/firebase';
import * as L from '../store/localdb';
import { round2, uid } from '../lib/format';
import type { Product, Purchase, UserProfile, MovementType } from '../types';
import { audit, auditTx } from './audit';

const Lb = () => { L.initLocalDb(); };

/** Throw if another (active) product already uses this barcode. */
async function assertBarcodeFree(barcode: string, excludeId?: string): Promise<void> {
  const code = barcode.trim();
  if (!code) return;
  if (!firebaseReady) {
    Lb();
    const hit = L.list<Product & { id: string }>('products').find((p) => p.barcode === code && p.id !== excludeId && p.active);
    if (hit) throw new Error(`Barcode ${code} already belongs to "${hit.name}"`);
    return;
  }
  const dup = await getDocs(query(collection(db, 'products'), where('barcode', '==', code), limit(5)));
  const other = dup.docs.find((d) => d.id !== excludeId);
  if (other) throw new Error(`Barcode ${code} already belongs to "${(other.data() as Product).name}"`);
}

export type ProductInput = Omit<Product, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'stockQty'>
  & { stockQty?: number };

const prodRef = (id: string) => doc(db, 'products', id);
const zero = (n: number) => round2(Math.max(0, n));

/** Create a product. Opening stock is written via a movement for traceability. */
export async function createProduct(input: ProductInput, actor: UserProfile): Promise<string> {
  const id = uid();
  await assertBarcodeFree(input.barcode ?? '');
  if (!firebaseReady) {
    Lb();
    const now = Date.now();
    const opening = Math.max(0, Math.floor(input.stockQty ?? 0));
    const p: Product = {
      id, name: input.name.trim(), category: input.category.trim(), brand: input.brand.trim(),
      size: input.size.trim(), unit: input.unit.trim() || 'bottle', barcode: (input.barcode ?? '').trim(),
      purchasePrice: zero(input.purchasePrice), sellingPrice: zero(input.sellingPrice),
      stockQty: opening, lowStockThreshold: input.lowStockThreshold, active: input.active,
      createdAt: now, updatedAt: now, createdBy: actor.name, updatedBy: actor.name,
    };
    L.put('products', p as unknown as L.Row);
    if (opening > 0) {
      L.put('stock_movements', {
        id: uid(), productId: id, productName: p.name, type: 'import',
        qtyDelta: opening, balanceAfter: opening, refId: `product-${id}`,
        note: 'Opening stock', createdAt: now, createdBy: actor.name,
      });
    }
    await audit(actor, 'product.create', 'products', id, `Created "${p.name}" (${p.category}, ${p.size}) stock ${opening}`);
    return id;
  }
  await runTransaction(db, async (t) => {
    const now = Date.now();
    const opening = Math.max(0, Math.floor(input.stockQty ?? 0));
    const p: Product = {
      id,
      name: input.name.trim(),
      category: input.category.trim(),
      brand: input.brand.trim(),
      size: input.size.trim(),
      unit: input.unit.trim() || 'bottle',
      barcode: (input.barcode ?? '').trim(),
      purchasePrice: zero(input.purchasePrice),
      sellingPrice: zero(input.sellingPrice),
      stockQty: opening,
      lowStockThreshold: input.lowStockThreshold,
      active: input.active,
      createdAt: now, updatedAt: now,
      createdBy: actor.name, updatedBy: actor.name,
    };
    t.set(prodRef(id), p);
    if (opening > 0) {
      t.set(doc(collection(db, 'stock_movements')), {
        id: uid(), productId: id, productName: p.name, type: 'import' as MovementType,
        qtyDelta: opening, balanceAfter: opening, refId: `product-${id}`,
        note: 'Opening stock', createdAt: now, createdBy: actor.name,
      });
    }
    auditTx(t, actor, 'product.create', 'products', id, `Created "${p.name}" (${p.category}, ${p.size}) stock ${opening}`);
  });
  return id;
}

/** Edit product details (not stock — use adjustStock / recordPurchase for that). */
export async function updateProduct(id: string, patch: Partial<ProductInput>, actor: UserProfile): Promise<void> {
  if (patch.barcode !== undefined) await assertBarcodeFree(patch.barcode ?? '', id);
  if (!firebaseReady) {
    Lb();
    const cur = L.get<Product & { id: string }>('products', id);
    if (!cur) throw new Error('Product not found');
    L.put('products', {
      ...cur,
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.category !== undefined ? { category: patch.category.trim() } : {}),
      ...(patch.brand !== undefined ? { brand: patch.brand.trim() } : {}),
      ...(patch.size !== undefined ? { size: patch.size.trim() } : {}),
      ...(patch.unit !== undefined ? { unit: patch.unit.trim() || 'bottle' } : {}),
      ...(patch.barcode !== undefined ? { barcode: patch.barcode.trim() } : {}),
      ...(patch.purchasePrice !== undefined ? { purchasePrice: zero(patch.purchasePrice) } : {}),
      ...(patch.sellingPrice !== undefined ? { sellingPrice: zero(patch.sellingPrice) } : {}),
      ...(patch.active !== undefined ? { active: patch.active } : {}),
      ...(patch.lowStockThreshold !== undefined ? { lowStockThreshold: patch.lowStockThreshold } : {}),
      updatedAt: Date.now(), updatedBy: actor.name,
    } as unknown as L.Row);
    await audit(actor, 'product.update', 'products', id, `Edited "${patch.name ?? cur.name}"`);
    return;
  }
  await runTransaction(db, async (t) => {
    const snap = await t.get(prodRef(id));
    if (!snap.exists()) throw new Error('Product not found');
    const cur = snap.data() as Product;
    const next: Record<string, unknown> = { updatedAt: Date.now(), updatedBy: actor.name };
    if (patch.name !== undefined) next.name = patch.name.trim();
    if (patch.category !== undefined) next.category = patch.category.trim();
    if (patch.brand !== undefined) next.brand = patch.brand.trim();
    if (patch.size !== undefined) next.size = patch.size.trim();
    if (patch.unit !== undefined) next.unit = patch.unit.trim() || 'bottle';
    if (patch.barcode !== undefined) next.barcode = patch.barcode.trim();
    if (patch.purchasePrice !== undefined) next.purchasePrice = zero(patch.purchasePrice);
    if (patch.sellingPrice !== undefined) next.sellingPrice = zero(patch.sellingPrice);
    if (patch.active !== undefined) next.active = patch.active;
    if (patch.lowStockThreshold !== undefined)
      next.lowStockThreshold = patch.lowStockThreshold === null ? deleteField() : patch.lowStockThreshold;
    t.update(prodRef(id), next);
    auditTx(t, actor, 'product.update', 'products', id, `Edited "${patch.name ?? cur.name}"`);
  });
  void serverTimestamp;
}

/**
 * Soft-delete: deactivate when the product has sales history is handled by the
 * caller UI; here we simply mark inactive (financial records stay intact).
 */
export async function deleteProduct(id: string, actor: UserProfile): Promise<void> {
  if (!firebaseReady) {
    Lb();
    const cur = L.get<Product & { id: string }>('products', id);
    if (!cur) throw new Error('Product not found');
    L.put('products', { ...cur, active: false, updatedAt: Date.now(), updatedBy: actor.name } as unknown as L.Row);
    await audit(actor, 'product.delete', 'products', id, `Deactivated "${cur.name}"`);
    return;
  }
  await runTransaction(db, async (t) => {
    const snap = await t.get(prodRef(id));
    if (!snap.exists()) throw new Error('Product not found');
    const p = snap.data() as Product;
    t.update(prodRef(id), { active: false, updatedAt: Date.now(), updatedBy: actor.name });
    auditTx(t, actor, 'product.delete', 'products', id, `Deactivated "${p.name}"`);
  });
}

/** Manual stock adjustment (+/−) with movement + audit, atomic. */
export async function adjustStock(
  id: string, delta: number, note: string, actor: UserProfile,
): Promise<void> {
  if (!Number.isInteger(delta) || delta === 0) throw new Error('Adjustment must be a non-zero whole number');
  if (!firebaseReady) {
    Lb();
    const p = L.get<Product & { id: string }>('products', id);
    if (!p) throw new Error('Product not found');
    const after = p.stockQty + delta;
    if (after < 0) throw new Error(`Cannot reduce stock below 0 (current ${p.stockQty}, change ${delta})`);
    const now = Date.now();
    L.put('products', { ...p, stockQty: after, updatedAt: now, updatedBy: actor.name } as unknown as L.Row);
    L.put('stock_movements', {
      id: uid(), productId: id, productName: p.name, type: 'adjustment',
      qtyDelta: delta, balanceAfter: after, refId: `adj-${uid()}`,
      note: note || 'Manual adjustment', createdAt: now, createdBy: actor.name,
    });
    await audit(actor, 'stock.adjust', 'products', id, `"${p.name}" stock ${delta > 0 ? '+' : ''}${delta} → ${after}`);
    return;
  }
  await runTransaction(db, async (t) => {
    const ref = prodRef(id);
    const snap = await t.get(ref);
    if (!snap.exists()) throw new Error('Product not found');
    const p = snap.data() as Product;
    const after = p.stockQty + delta;
    if (after < 0) throw new Error(`Cannot reduce stock below 0 (current ${p.stockQty}, change ${delta})`);
    const now = Date.now();
    t.update(ref, { stockQty: after, updatedAt: now, updatedBy: actor.name });
    t.set(doc(collection(db, 'stock_movements')), {
      id: uid(), productId: id, productName: p.name, type: 'adjustment' as MovementType,
      qtyDelta: delta, balanceAfter: after, refId: `adj-${uid()}`,
      note: note || 'Manual adjustment', createdAt: now, createdBy: actor.name,
    });
    auditTx(t, actor, 'stock.adjust', 'products', id, `"${p.name}" stock ${delta > 0 ? '+' : ''}${delta} → ${after}`);
  });
}

/** Record a stock purchase → increments stock atomically, logs movement + purchase + audit. */
export async function recordPurchase(
  productId: string, qty: number, unitCost: number, supplier: string,
  invoiceNo: string, note: string, actor: UserProfile,
): Promise<string> {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error('Quantity must be a positive whole number');
  const purchaseId = uid();
  if (!firebaseReady) {
    Lb();
    const p = L.get<Product & { id: string }>('products', productId);
    if (!p) throw new Error('Product not found');
    const after = p.stockQty + qty;
    const now = Date.now();
    const purchase: Purchase = {
      id: purchaseId, productId, productName: p.name, qty,
      unitCost: zero(unitCost), total: zero(qty * unitCost),
      supplier: supplier.trim(), invoiceNo: invoiceNo.trim(), note: note.trim(),
      createdAt: now, createdBy: actor.name,
    };
    L.put('purchases', purchase as unknown as L.Row);
    L.put('products', { ...p, stockQty: after, purchasePrice: zero(unitCost) || p.purchasePrice, updatedAt: now, updatedBy: actor.name } as unknown as L.Row);
    L.put('stock_movements', {
      id: uid(), productId, productName: p.name, type: 'purchase',
      qtyDelta: qty, balanceAfter: after, refId: purchaseId,
      note: `Purchase from ${supplier || 'supplier'}${invoiceNo ? ` #${invoiceNo}` : ''}`,
      createdAt: now, createdBy: actor.name,
    });
    await audit(actor, 'purchase.create', 'purchases', purchaseId, `Bought ${qty} × "${p.name}"`);
    return purchaseId;
  }
  await runTransaction(db, async (t) => {
    const ref = prodRef(productId);
    const snap = await t.get(ref);
    if (!snap.exists()) throw new Error('Product not found');
    const p = snap.data() as Product;
    const after = p.stockQty + qty;
    const now = Date.now();
    const purchase: Purchase = {
      id: purchaseId, productId, productName: p.name, qty,
      unitCost: zero(unitCost), total: zero(qty * unitCost),
      supplier: supplier.trim(), invoiceNo: invoiceNo.trim(), note: note.trim(),
      createdAt: now, createdBy: actor.name,
    };
    t.set(doc(db, 'purchases', purchaseId), purchase);
    t.update(ref, {
      stockQty: after,
      purchasePrice: zero(unitCost) || p.purchasePrice, // latest cost becomes product cost
      updatedAt: now, updatedBy: actor.name,
    });
    t.set(doc(collection(db, 'stock_movements')), {
      id: uid(), productId, productName: p.name, type: 'purchase' as MovementType,
      qtyDelta: qty, balanceAfter: after, refId: purchaseId,
      note: `Purchase from ${supplier || 'supplier'}${invoiceNo ? ` #${invoiceNo}` : ''}`,
      createdAt: now, createdBy: actor.name,
    });
    auditTx(t, actor, 'purchase.create', 'purchases', purchaseId, `Bought ${qty} × "${p.name}"`);
  });
  return purchaseId;
}
