import { DEFAULT_SETTINGS } from '../types';

// ── Local data engine ───────────────────────────────────────────────────────
// Used ONLY when Firebase env keys are absent. Data persists in localStorage.
// Same semantics as the Firestore services: atomic mutations, pub/sub refresh.

export type Row = Record<string, unknown> & { id: string };
type Shape = Record<string, Record<string, Row>>;

const DB_KEY = 'apos-localdb-v1';
const PW_KEY = 'apos-localdb-pw-v1';

let db: Shape | null = null;
const listeners = new Map<string, Set<() => void>>();

function persist() {
  try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch { /* quota — ignore */ }
}
export function emit(col: string) {
  persist();
  listeners.get(col)?.forEach((cb) => cb());
}
export function subscribe(col: string, cb: () => void): () => void {
  let set = listeners.get(col);
  if (!set) { set = new Set(); listeners.set(col, set); }
  set.add(cb);
  return () => { set!.delete(cb); };
}
export function list<T = Row>(col: string): T[] {
  return Object.values(db![col] ?? {}).map((r) => ({ ...(r as object) }) as T);
}
export function get<T = Row>(col: string, id: string): T | null {
  const r = db![col]?.[id];
  return r ? ({ ...(r as object) } as T) : null;
}
export function put<T extends Row>(col: string, row: T): void {
  if (!db![col]) db![col] = {};
  db![col][row.id] = { ...(row as object) } as T;
  emit(col);
}

// ── password helpers (local mode only — SHA-256 at rest, never plaintext after first login) ──
type PwMap = Record<string, { hash?: string; plain?: string }>;
function pwMap(): PwMap {
  try { return JSON.parse(localStorage.getItem(PW_KEY) ?? '{}'); } catch { return {}; }
}
function savePw(m: PwMap) { localStorage.setItem(PW_KEY, JSON.stringify(m)); }
async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function verifyLocalPassword(email: string, pw: string): Promise<boolean> {
  const entry = pwMap()[email.toLowerCase()];
  if (!entry) return false;
  const hash = await sha256(pw);
  if (entry.hash) return entry.hash === hash;
  // first successful check upgrades a seeded plaintext to its hash
  if (entry.plain === pw) { savePw({ ...pwMap(), [email.toLowerCase()]: { hash } }); return true; }
  return false;
}
export async function setLocalPassword(email: string, pw: string): Promise<void> {
  savePw({ ...pwMap(), [email.toLowerCase()]: { hash: await sha256(pw) } });
}

// ── seeding ─────────────────────────────────────────────────────────────────
function seed(): Shape {
  const now = Date.now();
  const mk = (id: string, name: string, category: string, brand: string, size: string, unit: string, pp: number, sp: number, qty: number, low: number | null): Row => ({
    id, name, category, brand, size, unit, purchasePrice: pp, sellingPrice: sp,
    stockQty: qty, lowStockThreshold: low, active: true,
    createdAt: now, updatedAt: now, createdBy: 'seed', updatedBy: 'seed',
  });
  return {
    users: {
      'dev-local-0001': {
        id: 'dev-local-0001', uid: 'dev-local-0001', name: 'Developer', email: 'dev@local',
        role: 'developer', permOverrides: {}, active: true, createdAt: now, createdBy: 'seed', lastActiveAt: now,
      },
      'cashier-0001': {
        id: 'cashier-0001', uid: 'cashier-0001', name: 'Cashier Demo', email: 'staff@local',
        role: 'cashier', permOverrides: {}, active: true, createdAt: now, createdBy: 'seed', lastActiveAt: now,
      },
    },
    settings: { business: { id: 'business', ...DEFAULT_SETTINGS } },
    meta: { counters: { id: 'counters', bill: 0 } },
    products: {
      'p-king650': mk('p-king650', 'Kingfisher Premium', 'Strong Beer', 'Kingfisher', '650ml', 'bottle', 125, 170, 24, 12),
      'p-king500c': mk('p-king500c', 'Kingfisher Premium Can', 'Strong Beer', 'Kingfisher', '500ml can', 'can', 100, 140, 36, 12),
      'p-bud650': mk('p-bud650', 'Budweiser', 'Beer', 'Budweiser', '650ml', 'bottle', 140, 190, 18, 8),
      'p-tuborg650': mk('p-tuborg650', 'Tuborg Strong', 'Strong Beer', 'Tuborg', '650ml', 'bottle', 120, 165, 30, 10),
      'p-hein500': mk('p-hein500', 'Heineken', 'Beer', 'Heineken', '500ml can', 'can', 165, 220, 12, 6),
      'p-corona355': mk('p-corona355', 'Corona Extra', 'Beer', 'Corona', '355ml', 'bottle', 200, 280, 8, 6),
      'p-carlsberg650': mk('p-carlsberg650', 'Carlsberg Smooth', 'Beer', 'Carlsberg', '650ml', 'bottle', 130, 175, 0, 6),
    },
    sales: {}, purchases: {}, stock_movements: {}, audit_logs: {},
  };
}

export function initLocalDb(): void {
  if (db) return;
  try {
    const raw = localStorage.getItem(DB_KEY);
    db = raw ? (JSON.parse(raw) as Shape) : seed();
  } catch { db = seed(); }
  if (!db!.users) db = seed();
  if (!pwMap()['dev@local']) savePw({
    'dev@local': { hash: 'e1c6aed02ce2c79f6b761533a6b501e29d5bc16cd9f187df8f5f6924413de223' },
    'staff@local': { hash: '02defbfb8190f9d0719ef7a23da2049bd2e61442bc14021a6d8a4ae35ca334b7' },
  });
  persist();
}
