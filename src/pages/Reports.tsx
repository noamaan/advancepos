import { useMemo, useState } from 'react';
import { orderBy } from 'firebase/firestore';
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
  PieChart, Pie, Cell, Legend,
} from 'recharts';
import { useCollection } from '../hooks/fs';
import { useAuth } from '../store/auth';
import { useSettings } from '../store/settings';
import { Stat, Badge } from '../components/ui';
import {
  exportSalesReport, exportInventoryReport, exportPurchasesReport,
  exportTransactionsReport, exportProfitReport,
} from '../lib/excel';
import { dateKey, endOfDay, inr, monthKey, round2, startOfDay } from '../lib/format';
import type { Product, Purchase, Sale } from '../types';

const ok = (s: Sale) => s.paymentStatus === 'success';
const COLORS = ['#f5b942', '#38bdf8', '#a78bfa', '#34d399', '#f87171', '#fbbf24'];

export function Reports() {
  const { can } = useAuth();
  const { settings } = useSettings();
  const [sales] = useCollection<Sale>('sales', [orderBy('createdAt', 'desc')]);
  const [products] = useCollection<Product>('products');
  const [purchases] = useCollection<Purchase>('purchases', [orderBy('createdAt', 'desc')]);

  const today = dateKey(Date.now());
  const thisMonth = monthKey(Date.now());
  const [from, setFrom] = useState(dateKey(Date.now() - 29 * 864e5));
  const [to, setTo] = useState(today);

  const inRange = (t: number) => t >= startOfDay(new Date(from).getTime()) && t <= endOfDay(new Date(to).getTime());
  const rangedSales = useMemo(() => sales.filter((s) => inRange(s.createdAt)), [sales, from, to]);
  const rangedPurchases = useMemo(() => purchases.filter((p) => inRange(p.createdAt)), [purchases, from, to]);

  const paid = useMemo(() => rangedSales.filter(ok), [rangedSales]);
  const todayPaid = useMemo(() => sales.filter((s) => ok(s) && dateKey(s.createdAt) === today), [sales, today]);
  const monthPaid = useMemo(() => sales.filter((s) => ok(s) && monthKey(s.createdAt) === thisMonth), [sales, thisMonth]);

  const sum = (arr: Sale[]) => round2(arr.reduce((a, s) => a + s.total, 0));
  const cashTotal = sum(paid.filter((s) => s.paymentMethod === 'cash'));
  const upiTotal = sum(paid.filter((s) => s.paymentMethod === 'upi'));
  const profit = round2(paid.reduce((a, s) => a + s.profit, 0));
  const expenses = round2(rangedPurchases.reduce((a, p) => a + p.total, 0));
  const inventoryValue = round2(products.filter((p) => p.active).reduce((a, p) => a + p.stockQty * p.purchasePrice, 0));
  const lowStock = products.filter((p) => p.active && p.stockQty <= (p.lowStockThreshold ?? settings.lowStockDefault));

  const dailySeries = useMemo(() => {
    const map = new Map<string, number>();
    for (let d = startOfDay(new Date(from).getTime()); d <= endOfDay(new Date(to).getTime()); d += 864e5) map.set(dateKey(d), 0);
    for (const s of paid) map.set(dateKey(s.createdAt), round2((map.get(dateKey(s.createdAt)) ?? 0) + s.total));
    return [...map.entries()].map(([d, v]) => ({ day: d.slice(5), sales: v }));
  }, [paid, from, to]);

  const bestSellers = useMemo(() => {
    const m = new Map<string, { name: string; qty: number; revenue: number }>();
    for (const s of paid) for (const i of s.items) {
      const cur = m.get(i.productId) ?? { name: i.name + (i.size ? ` ${i.size}` : ''), qty: 0, revenue: 0 };
      cur.qty += i.qty; cur.revenue = round2(cur.revenue + i.lineTotal);
      m.set(i.productId, cur);
    }
    return [...m.values()].sort((a, b) => b.qty - a.qty).slice(0, 8);
  }, [paid]);

  const splitData = [
    { name: 'Cash', value: cashTotal },
    { name: 'UPI', value: upiTotal },
  ];

  return (
    <div className="stack">
      <div className="page-head">
        <div><h2>Reports & analytics</h2><span className="muted">Live — updates in real time for every connected device.</span></div>
        <div className="row wrap">
          <input className="input slim" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input slim" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      <div className="stats-grid">
        <Stat label="Today's sales" value={inr(sum(todayPaid))} sub={`${todayPaid.length} bills`} />
        <Stat label="This month" value={inr(sum(monthPaid))} sub={`${monthPaid.length} bills`} />
        <Stat label="Range revenue" value={inr(sum(paid))} sub={`${from} → ${to}`} />
        <Stat label="Transactions" value={String(rangedSales.length)} sub={`${rangedSales.filter((s) => s.paymentStatus === 'pending').length} pending`} />
        <Stat label="Cash collected" value={inr(cashTotal)} tone="good" />
        <Stat label="UPI collected" value={inr(upiTotal)} tone="good" />
        {can('viewCost') && <Stat label="Gross profit (est.)" value={inr(profit)} tone="good" />}
        {can('viewCost') && <Stat label="Purchase expenses" value={inr(expenses)} tone="warn" />}
        <Stat label="Inventory value (cost)" value={inr(inventoryValue)} />
        <Stat label="Low-stock items" value={String(lowStock.length)} tone={lowStock.length > 0 ? 'warn' : 'good'} />
      </div>

      {can('excel') && (
        <div className="card pad-sm row wrap">
          <b style={{ marginRight: 8 }}>Export range:</b>
          <button className="btn" onClick={() => exportSalesReport(rangedSales, startOfDay(new Date(from).getTime()), endOfDay(new Date(to).getTime()))}>Sales .xlsx</button>
          <button className="btn" onClick={() => exportInventoryReport(products.filter((p) => p.active))}>Inventory .xlsx</button>
          <button className="btn" onClick={() => exportPurchasesReport(rangedPurchases, startOfDay(new Date(from).getTime()), endOfDay(new Date(to).getTime()))}>Purchases .xlsx</button>
          <button className="btn" onClick={() => exportTransactionsReport(rangedSales, startOfDay(new Date(from).getTime()), endOfDay(new Date(to).getTime()))}>Transactions .xlsx</button>
          {can('viewCost') && <button className="btn" onClick={() => exportProfitReport(rangedSales, rangedPurchases, startOfDay(new Date(from).getTime()), endOfDay(new Date(to).getTime()))}>Profit & expense .xlsx</button>}
        </div>
      )}

      <div className="charts-grid">
        <div className="card pad">
          <h4 className="chart-title">Daily sales (range)</h4>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={dailySeries}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--line)" />
              <XAxis dataKey="day" stroke="var(--muted)" fontSize={11} />
              <YAxis stroke="var(--muted)" fontSize={11} />
              <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8 }} formatter={(v: number) => [inr(v), 'Sales']} />
              <Bar dataKey="sales" fill="#f5b942" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="card pad">
          <h4 className="chart-title">Cash vs UPI (range)</h4>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={splitData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={3}>
                {splitData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 8 }} formatter={(v: number) => inr(v)} />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>

        <div className="card pad">
          <h4 className="chart-title">Best sellers by quantity</h4>
          <table className="table">
            <thead><tr><th>Product</th><th className="num">Qty</th><th className="num">Revenue</th></tr></thead>
            <tbody>
              {bestSellers.map((b) => (
                <tr key={b.name}><td>{b.name}</td><td className="num"><b>{b.qty}</b></td><td className="num">{inr(b.revenue)}</td></tr>
              ))}
              {bestSellers.length === 0 && <tr><td colSpan={3} className="muted center pad">No sales in range.</td></tr>}
            </tbody>
          </table>
        </div>

        <div className="card pad">
          <h4 className="chart-title">Low-stock alerts</h4>
          <table className="table">
            <thead><tr><th>Product</th><th className="num">Stock</th><th className="num">Alert at</th></tr></thead>
            <tbody>
              {lowStock.slice(0, 8).map((p) => (
                <tr key={p.id}>
                  <td>{p.name} <span className="muted small">{p.size}</span></td>
                  <td className="num"><Badge tone={p.stockQty <= 0 ? 'bad' : 'warn'}>{p.stockQty}</Badge></td>
                  <td className="num">{p.lowStockThreshold ?? settings.lowStockDefault}</td>
                </tr>
              ))}
              {lowStock.length === 0 && <tr><td colSpan={3} className="muted center pad">All stocked up 🎉</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
