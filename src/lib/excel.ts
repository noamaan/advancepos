import * as XLSX from 'xlsx';
import { download, fmtDateTime, dateKey, monthKey, round2, parseNum } from './format';
import type { Product, Sale, Purchase, StockMovement } from '../types';

function sheet(rows: object[], header?: string[][]) {
  const ws = XLSX.utils.json_to_sheet(rows);
  if (header) XLSX.utils.sheet_add_aoa(ws, header, { origin: 'A1' });
  return ws;
}
function saveXlsx(name: string, sheets: Record<string, object[]>) {
  const wb = XLSX.utils.book_new();
  for (const [title, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, sheet(rows.length ? rows : [{ note: 'no data' }]), title.slice(0, 31));
  }
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download(`${name}.xlsx`, new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}
export function saveCsv(name: string, rows: object[]) {
  const ws = sheet(rows.length ? rows : [{ note: 'no data' }]);
  const csv = XLSX.utils.sheet_to_csv(ws);
  download(`${name}.csv`, new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
}

const paid = (s: Sale) => s.paymentStatus === 'success' || s.paymentStatus === 'refunded';

// ── Reports ────────────────────────────────────────────────────────────────

export function exportSalesReport(sales: Sale[], from: number, to: number) {
  const rows = sales.map((s) => ({
    bill_no: s.billNo, date: fmtDateTime(s.createdAt), cashier: s.cashierName,
    items: s.items.reduce((n, i) => n + i.qty, 0), subtotal: s.subtotal,
    discount: s.discount, tax: s.tax, total: s.total,
    payment: s.paymentMethod.toUpperCase(), status: s.paymentStatus,
    verified_by: s.verifiedBy ?? '', refunded: s.refunded ? 'YES' : '',
  }));
  const lines = sales.flatMap((s) => s.items.map((i) => ({
    bill_no: s.billNo, date: fmtDateTime(s.createdAt), product: i.name, size: i.size,
    qty: i.qty, price: i.price, line_total: i.lineTotal, payment: s.paymentMethod.toUpperCase(),
    status: s.paymentStatus,
  })));
  const ok = sales.filter(paid);
  const summary = [{
    from: fmtDateTime(from), to: fmtDateTime(to),
    bills: ok.length,
    revenue: round2(ok.reduce((a, s) => a + s.total, 0)),
    discounts: round2(ok.reduce((a, s) => a + s.discount, 0)),
    tax: round2(ok.reduce((a, s) => a + s.tax, 0)),
    cash: round2(ok.filter((s) => s.paymentMethod === 'cash').reduce((a, s) => a + s.total, 0)),
    upi: round2(ok.filter((s) => s.paymentMethod === 'upi').reduce((a, s) => a + s.total, 0)),
    est_profit: round2(ok.reduce((a, s) => a + s.profit, 0)),
    refunds: sales.filter((s) => s.refunded).length,
  }];
  saveXlsx(`sales-report-${dateKey(from)}-to-${dateKey(to)}`, { Summary: summary, Bills: rows, Items: lines });
}

export function exportInventoryReport(products: Product[]) {
  const rows = products.map((p) => ({
    product: p.name, category: p.category, brand: p.brand, size: p.size, unit: p.unit,
    stock: p.stockQty, purchase_price: p.purchasePrice, selling_price: p.sellingPrice,
    stock_value: round2(p.stockQty * p.purchasePrice), retail_value: round2(p.stockQty * p.sellingPrice),
    low_stock_at: p.lowStockThreshold ?? '', active: p.active ? 'YES' : 'NO',
  }));
  const summary = [{
    products: products.length,
    units_in_stock: products.reduce((a, p) => a + p.stockQty, 0),
    inventory_cost_value: round2(products.reduce((a, p) => a + p.stockQty * p.purchasePrice, 0)),
    inventory_retail_value: round2(products.reduce((a, p) => a + p.stockQty * p.sellingPrice, 0)),
  }];
  saveXlsx(`inventory-report-${dateKey(Date.now())}`, { Summary: summary, Inventory: rows });
}

export function exportPurchasesReport(purchases: Purchase[], from: number, to: number) {
  const rows = purchases.map((p) => ({
    date: fmtDateTime(p.createdAt), product: p.productName, qty: p.qty,
    unit_cost: p.unitCost, total: p.total, supplier: p.supplier, invoice: p.invoiceNo,
    by: p.createdBy, note: p.note,
  }));
  const summary = [{
    from: fmtDateTime(from), to: fmtDateTime(to),
    purchases: purchases.length,
    spent: round2(purchases.reduce((a, p) => a + p.total, 0)),
  }];
  saveXlsx(`purchases-${dateKey(from)}-to-${dateKey(to)}`, { Summary: summary, Purchases: rows });
}

export function exportTransactionsReport(sales: Sale[], from: number, to: number) {
  const rows = sales.map((s) => ({
    bill_no: s.billNo, created: fmtDateTime(s.createdAt), paid_at: s.paidAt ? fmtDateTime(s.paidAt) : '',
    method: s.paymentMethod.toUpperCase(), status: s.paymentStatus, amount: s.total,
    cashier: s.cashierName, verified_by: s.verifiedBy ?? '', verified_at: s.verifiedAt ? fmtDateTime(s.verifiedAt) : '',
    refunded_by: s.refundedBy ?? '', refund_note: s.refundNote ?? '', fail_reason: s.failReason ?? '',
  }));
  saveXlsx(`transactions-${dateKey(from)}-to-${dateKey(to)}`, { Transactions: rows });
}

export function exportProfitReport(sales: Sale[], purchases: Purchase[], from: number, to: number) {
  const ok = sales.filter(paid);
  const byDay = new Map<string, { revenue: number; profit: number; bills: number }>();
  for (const s of ok) {
    const k = dateKey(s.createdAt);
    const cur = byDay.get(k) ?? { revenue: 0, profit: 0, bills: 0 };
    cur.revenue = round2(cur.revenue + s.total); cur.profit = round2(cur.profit + s.profit); cur.bills += 1;
    byDay.set(k, cur);
  }
  const daily = [...byDay.entries()].sort().map(([date, v]) => ({ date, bills: v.bills, revenue: v.revenue, gross_profit: v.profit, margin_pct: v.revenue ? round2((v.profit / v.revenue) * 100) : 0 }));
  const summary = [{
    from: fmtDateTime(from), to: fmtDateTime(to),
    revenue: round2(ok.reduce((a, s) => a + s.total, 0)),
    gross_profit: round2(ok.reduce((a, s) => a + s.profit, 0)),
    purchase_expenses: round2(purchases.reduce((a, p) => a + p.total, 0)),
  }];
  saveXlsx(`profit-expense-${dateKey(from)}-to-${dateKey(to)}`, { Summary: summary, 'Daily P&L': daily });
}

export function exportMovements(movements: StockMovement[]) {
  saveXlsx(`stock-movements-${dateKey(Date.now())}`, {
    Movements: movements.map((m) => ({
      date: fmtDateTime(m.createdAt), product: m.productName, type: m.type,
      change: m.qtyDelta, balance_after: m.balanceAfter, ref: m.refId, note: m.note, by: m.createdBy,
    })),
  });
}

// ── Import templates & parsing ─────────────────────────────────────────────

export const PRODUCT_HEADERS = ['name', 'category', 'brand', 'size', 'unit', 'purchasePrice', 'sellingPrice', 'stockQty', 'lowStockThreshold'];

export function downloadProductTemplate() {
  const sample = [{
    name: 'Example Lager 650ml', category: 'Beer', brand: 'Example Brand', size: '650ml',
    unit: 'bottle', purchasePrice: 120, sellingPrice: 160, stockQty: 48, lowStockThreshold: 12,
  }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(sample, [PRODUCT_HEADERS]), 'Products');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download('advancepos-product-import-template.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

export function downloadPriceTemplate(products: Product[]) {
  const rows = products.map((p) => ({ id: p.id, name: p.name, sellingPrice: p.sellingPrice, purchasePrice: p.purchasePrice }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet(rows.length ? rows : [{ id: '', name: '', sellingPrice: 0, purchasePrice: 0 }]), 'Prices');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  download('advancepos-bulk-price-update.xlsx', new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
}

export interface ParsedProductRow {
  name: string; category: string; brand: string; size: string; unit: string;
  purchasePrice: number; sellingPrice: number; stockQty: number; lowStockThreshold: number | null;
}
export interface ParsedPriceRow { id: string; sellingPrice?: number; purchasePrice?: number; }

/** Parse a product-import file (xlsx or csv). Throws with a row number on bad data. */
export async function parseProductFile(file: File): Promise<ParsedProductRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (!raw.length) throw new Error('The file is empty');
  return raw.map((r, i) => {
    const name = String(r.name ?? '').trim();
    if (!name) throw new Error(`Row ${i + 2}: product name is missing`);
    return {
      name,
      category: String(r.category ?? 'Other').trim() || 'Other',
      brand: String(r.brand ?? '').trim(),
      size: String(r.size ?? '').trim(),
      unit: String(r.unit ?? 'bottle').trim() || 'bottle',
      purchasePrice: Math.max(0, parseNum(r.purchasePrice)),
      sellingPrice: Math.max(0, parseNum(r.sellingPrice)),
      stockQty: Math.max(0, Math.floor(parseNum(r.stockQty))),
      lowStockThreshold: r.lowStockThreshold === '' || r.lowStockThreshold === undefined ? null : Math.max(0, Math.floor(parseNum(r.lowStockThreshold))),
    };
  });
}

export async function parsePriceFile(file: File): Promise<ParsedPriceRow[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: '' });
  if (!raw.length) throw new Error('The file is empty');
  return raw.map((r, i) => {
    const id = String(r.id ?? '').trim();
    if (!id) throw new Error(`Row ${i + 2}: product id is missing`);
    const row: ParsedPriceRow = { id };
    if (r.sellingPrice !== '' && r.sellingPrice !== undefined) row.sellingPrice = Math.max(0, parseNum(r.sellingPrice));
    if (r.purchasePrice !== '' && r.purchasePrice !== undefined) row.purchasePrice = Math.max(0, parseNum(r.purchasePrice));
    return row;
  });
}

export function monthLabel(ts: number) { return monthKey(ts); }
