export const uid = (): string =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;

export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function inr(n: number, symbol = '₹'): string {
  const v = round2(Math.abs(n));
  const str = v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${n < 0 ? '−' : ''}${symbol}${str}`;
}

export function fmtDate(ts: number): string {
  return new Date(ts).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}
export function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true });
}
export function fmtDateTime(ts: number): string {
  return `${fmtDate(ts)}, ${fmtTime(ts)}`;
}
export function dateKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function monthKey(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function startOfDay(ts: number): number {
  const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime();
}
export function endOfDay(ts: number): number {
  const d = new Date(ts); d.setHours(23, 59, 59, 999); return d.getTime();
}

export function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function parseNum(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}
