import { useEffect, useState } from 'react';
import {
  collection, doc, onSnapshot, query, type QueryConstraint, type DocumentData,
} from 'firebase/firestore';
import { db } from '../lib/firebase';

/** Live-updating list of a collection. Returns [rows, loading, error]. */
export function useCollection<T = DocumentData>(
  name: string,
  constraints: QueryConstraint[] = [],
): [Array<T & { id: string }>, boolean, Error | null] {
  const [rows, setRows] = useState<Array<T & { id: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);

  const key = JSON.stringify(constraints.map((c) => String(c)));
  useEffect(() => {
    setLoading(true);
    const q = query(collection(db, name), ...constraints);
    const unsub = onSnapshot(
      q,
      (snap) => {
        setRows(snap.docs.map((d) => ({ id: d.id, ...(d.data() as T) })));
        setLoading(false);
      },
      (err) => { setError(err as Error); setLoading(false); },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key]);

  return [rows, loading, error];
}

/** Live-updating single document. */
export function useDoc<T = DocumentData>(path: string, id: string): [(T & { id: string }) | null, boolean] {
  const [data, setData] = useState<(T & { id: string }) | null>(null);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, path, id),
      (snap) => {
        setData(snap.exists() ? ({ id: snap.id, ...(snap.data() as T) }) : null);
        setLoading(false);
      },
      () => setLoading(false),
    );
    return unsub;
  }, [path, id]);
  return [data, loading];
}
