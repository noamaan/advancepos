import { collection, doc, getDocs, query, where, writeBatch, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { uid } from '../lib/format';
import { audit } from './audit';
import type { UserProfile, Product } from '../types';
import type { ParsedPriceRow, ParsedProductRow } from '../lib/excel';

/**
 * Bulk import products. Rows whose (name+size+brand) match an existing product
 * UPDATE it; the rest are CREATED. Stock from the sheet sets opening stock only
 * when creating — existing stock is never silently overwritten; the difference
 * is applied as an 'import' stock movement so it stays auditable.
 */
export async function importProducts(rows: ParsedProductRow[], actor: UserProfile): Promise<{ created: number; updated: number }> {
  let created = 0, updated = 0;
  const snap = await getDocs(collection(db, 'products'));
  const existing = new Map<string, { id: string; p: Product }>();
  for (const d of snap.docs) {
    const p = d.data() as Product;
    existing.set(`${p.name.toLowerCase()}|${p.size.toLowerCase()}|${p.brand.toLowerCase()}`, { id: d.id, p });
  }
  for (let i = 0; i < rows.length; i += 400) {
    const batch = writeBatch(db);
    const now = Date.now();
    for (const r of rows.slice(i, i + 400)) {
      const key = `${r.name.toLowerCase()}|${r.size.toLowerCase()}|${r.brand.toLowerCase()}`;
      const hit = existing.get(key);
      if (hit) {
        const delta = r.stockQty - hit.p.stockQty;
        batch.update(doc(db, 'products', hit.id), {
          category: r.category, purchasePrice: r.purchasePrice, sellingPrice: r.sellingPrice,
          lowStockThreshold: r.lowStockThreshold, stockQty: r.stockQty, active: true,
          updatedAt: now, updatedBy: actor.name,
        });
        if (delta !== 0) {
          batch.set(doc(collection(db, 'stock_movements')), {
            id: uid(), productId: hit.id, productName: hit.p.name, type: 'import',
            qtyDelta: delta, balanceAfter: r.stockQty, refId: `import-${now}`,
            note: 'Bulk import stock sync', createdAt: now, createdBy: actor.name,
          });
        }
        updated += 1;
      } else {
        const id = uid();
        batch.set(doc(db, 'products', id), {
          id, name: r.name, category: r.category, brand: r.brand, size: r.size, unit: r.unit,
          purchasePrice: r.purchasePrice, sellingPrice: r.sellingPrice,
          stockQty: r.stockQty, lowStockThreshold: r.lowStockThreshold, active: true,
          createdAt: now, updatedAt: now, createdBy: actor.name, updatedBy: actor.name,
        });
        if (r.stockQty > 0) {
          batch.set(doc(collection(db, 'stock_movements')), {
            id: uid(), productId: id, productName: r.name, type: 'import',
            qtyDelta: r.stockQty, balanceAfter: r.stockQty, refId: `import-${now}`,
            note: 'Opening stock (import)', createdAt: now, createdBy: actor.name,
          });
        }
        existing.set(key, { id, p: { stockQty: r.stockQty, name: r.name } as Product });
        created += 1;
      }
    }
    await batch.commit();
  }
  // make sure newly-imported categories appear in settings (done by Settings page live listener)
  await audit(actor, 'import.products', 'products', 'bulk', `Imported ${created} new, updated ${updated} products`);
  return { created, updated };
}

/** Bulk price update by product id (from the price template). */
export async function applyPriceUpdates(rows: ParsedPriceRow[], actor: UserProfile): Promise<{ updated: number; skipped: number }> {
  let updated = 0, skipped = 0;
  for (let i = 0; i < rows.length; i += 400) {
    const batch = writeBatch(db);
    const now = Date.now();
    const chunk = rows.slice(i, i + 400);
    const ids = chunk.map((r) => r.id);
    const refs = await Promise.all(ids.map((id) => getDocs(query(collection(db, 'products'), where('id', '==', id), limit(1)))));
    chunk.forEach((r, idx) => {
      const found = refs[idx].docs[0];
      if (!found) { skipped += 1; return; }
      const patch: Record<string, unknown> = { updatedAt: now, updatedBy: actor.name };
      if (r.sellingPrice !== undefined) patch.sellingPrice = r.sellingPrice;
      if (r.purchasePrice !== undefined) patch.purchasePrice = r.purchasePrice;
      if (r.sellingPrice === undefined && r.purchasePrice === undefined) { skipped += 1; return; }
      batch.update(found.ref, patch);
      updated += 1;
    });
    await batch.commit();
  }
  await audit(actor, 'import.prices', 'products', 'bulk', `Bulk price update: ${updated} updated, ${skipped} skipped`);
  return { updated, skipped };
}
