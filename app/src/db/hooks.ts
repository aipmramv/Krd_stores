// React hooks over the data store: a query re-runs whenever its collection changes.
import { useEffect, useState } from 'react';
import { db, onChange } from './index';
import type { Filter, FindOpts } from './filter';
import type { Coll, Collections } from './schema';

export interface Query<T> { data: T; loading: boolean; error: Error | null }

export function useQuery<C extends Coll>(c: C, filter: Filter = {}, opts: FindOpts = {}): Query<Collections[C][]> {
  const key = JSON.stringify([filter, opts]);
  const [state, setState] = useState<Query<Collections[C][]>>({ data: [], loading: true, error: null });
  useEffect(() => {
    let live = true;
    const [f, o] = JSON.parse(key) as [Filter, FindOpts];
    const run = () => db.find(c, f, o).then(
      data => { if (live) setState({ data, loading: false, error: null }); },
      error => { if (live) setState(s => ({ ...s, loading: false, error })); },
    );
    run();
    const off = onChange(changed => { if (changed === c) run(); });
    return () => { live = false; off(); };
  }, [c, key]);
  return state;
}

export function useDoc<C extends Coll>(c: C, id: string | null | undefined): Query<Collections[C] | null> {
  const q = useQuery(c, id ? { _id: id } : { _id: { $in: [] } }, { limit: 1 });
  return { ...q, data: q.data[0] ?? null };
}
