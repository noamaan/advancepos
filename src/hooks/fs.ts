import { useEffect, useMemo, useState } from 'react';
import {
  collection, doc, onSnapshot, query, where as fbWhere, orderBy as fbOrderBy,
  type DocumentData, type WhereFilterOp, type QueryConstraint,
} from 'firebase/firestore';
import { db, firebaseReady } from '../lib/firebase';
import * as L from '../store/localdb';

export interface Where { field: string; op: WhereFilterOp; value: unknown }
export interface Order { field: string; dir: 'asc' | 'desc' }

export function useCollection<T = DocumentData>(
  name: string,
  opts: { where?: Where[]; order?: Order[] } = {},
): [Array<T & { id: string }>, boolean, Error | null] {
  const [rows, setRows] = useState<Array<T & { id: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const key = JSON.stringify(opts);

  const filtered = useMemo(() => ({
    where: opts.where ?? [], order: opts.order ?? [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [key]);

  useEffect(() => {
    setLoading(true);
    if (!firebaseReady) {
      L.initLocalDb();
      const refresh = () => {
        let data = L.list<T & { id: string }>(name);
        for (const w of filtered.where) {
          data = data.filter((r) => {
            const v = (r as Record<string, unknown>)[w.field];
            const t = w.value;
            switch (w.op) {
              case '==': return v === t;
              case '!=': return v !== t;
              case '<': return (v as number) < (t as number);
              case '<=': return (v as number) <= (t as number);
              case '>': return (v as number) > (t as number);
              case '>=': return (v as number) >= (t as number);
              case 'array-contains': return Array.isArray(v) && v.includes(t);
              default: return true;
            }
          });
        }
        for (const o of [...filtered.order].reverse()) {
          data = [...data].sort((a, b) => {
            const av = (a as Record<string, number>)[o.field] ?? 0;
            const bv = (b as Record<string, number>)[o.field] ?? 0;
            return o.dir === 'desc' ? (bv > av ? 1 : bv < av ? -1 : 0) : (av > bv ? 1 : av < bv ? -1 : 0);
          });
        }
        setRows(data);
        setLoading(false);
      };
      refresh();
      return L.subscribe(name, refresh);
    }

    const constraints: QueryConstraint[] = [
      ...filtered.where.map((w) => fbWhere(w.field, w.op, w.value)),
      ...filtered.order.map((o) => fbOrderBy(o.field, o.dir)),
    ];
    const q = query(collection(db, name), ...constraints);
    return onSnapshot(
      q,
      (snap) => { setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) }))); setLoading(false); },
      (err) => {
        setError(err as Error); setLoading(false);
        if ((err as { code?: string }).code === 'failed-precondition')
          console.error('[AdvancePOS] Missing Firestore index — open this link once:', (err as Error).message);
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);

  return [rows, loading, error];
}

export function useDoc<T = DocumentData>(path: string, id: string): [(T & { id: string }) | null, boolean] {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!firebaseReady) {
      L.initLocalDb();
      const refresh = () => { setData(L.get<T & { id: string }>(path, id)); setLoading(false); };
      refresh();
      return L.subscribe(path, refresh);
    }
    const unsub = onSnapshot(
      doc(db, path, id),
      (snap) => { setData(snap.exists() ? ({ id: snap.id, ...(snap.data() as T) }) : null); setLoading(false); },
      () => setLoading(false),
    );
    return unsub;
  }, [path, id]);
  return [data, loading];
}
