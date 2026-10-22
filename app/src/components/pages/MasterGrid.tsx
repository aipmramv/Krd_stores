// An editable master-data grid over one collection: filter, sort, inline edit, add, delete,
// bulk edit of selected rows, and CSV export/import (Excel opens and saves CSV). Edits are
// validated per column, saved through the data store and audited.
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { db, type NewDoc } from '../../db';
import type { Filter } from '../../db/filter';
import { useQuery } from '../../db/hooks';
import type { Coll, Collections } from '../../db/schema';
import { download, parseCsv, toCsv } from '../../services/csv';
import { toast } from '../../state/actions';

type Row<C extends Coll> = Collections[C];
type Val = string | number | boolean | string[];
export interface Col<T> {
  key: string; label: string;
  type?: 'text' | 'number' | 'select' | 'multi' | 'bool';
  options?: string[];
  /** Computed, read-only value (not stored). */
  value?: (row: T) => string | number;
  render?: (row: T) => ReactNode;
  required?: boolean; min?: number; num?: boolean; readOnly?: boolean; width?: string;
  /** Set when the row is created (it keys other records), then read-only. */
  fixed?: boolean;
}

const get = (r: object, k: string) => (r as Record<string, unknown>)[k];
const show = (v: unknown) => (Array.isArray(v) ? v.join(', ') : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : v === undefined || v === null ? '' : String(v));

function coerce<T>(c: Col<T>, raw: string): Val {
  if (c.type === 'number') return Number(raw);
  if (c.type === 'bool') return /^(yes|true|1|y)$/i.test(raw.trim());
  if (c.type === 'multi') return raw.split(/[,;|]/).map(x => x.trim()).filter(Boolean);
  return raw.trim();
}
function check<T>(c: Col<T>, v: Val): string | null {
  if (c.required && (v === '' || (Array.isArray(v) && !v.length))) return `${c.label} is required`;
  if (c.type === 'number' && (Number.isNaN(v) || (c.min !== undefined && (v as number) < c.min))) return `${c.label} must be a number${c.min !== undefined ? ` of at least ${c.min}` : ''}`;
  if (c.type === 'select' && c.options && v !== '' && !c.options.includes(v as string)) return `${c.label} must be one of ${c.options.join(', ')}`;
  if (c.type === 'multi' && c.options && (v as string[]).some(x => !c.options!.includes(x))) return `${c.label} values must be from ${c.options.join(', ')}`;
  return null;
}

function Editor<T>({ c, v, done }: { c: Col<T>; v: unknown; done: (v: Val | null) => void }) {
  const [x, setX] = useState<Val>((v as Val) ?? (c.type === 'multi' ? [] : ''));
  const keys = (e: React.KeyboardEvent) => { if (e.key === 'Enter') done(x); if (e.key === 'Escape') done(null); };
  if (c.type === 'select') return <select autoFocus value={x as string} onChange={e => done(e.target.value)} onBlur={() => done(null)} onKeyDown={keys}>{c.options!.map(o => <option key={o}>{o}</option>)}</select>;
  if (c.type === 'bool') return <select autoFocus value={x ? 'Yes' : 'No'} onChange={e => done(e.target.value === 'Yes')} onBlur={() => done(null)}><option>Yes</option><option>No</option></select>;
  if (c.type === 'multi') return (
    <span className="multi" onKeyDown={keys}>
      {c.options!.map(o => <label key={o}><input type="checkbox" checked={(x as string[]).includes(o)} onChange={e => setX(e.target.checked ? [...(x as string[]), o] : (x as string[]).filter(y => y !== o))} />{o}</label>)}
      <button className="btn" onClick={() => done(x)}>Save</button>
    </span>
  );
  return <input autoFocus type={c.type === 'number' ? 'number' : 'text'} value={x as string | number} onChange={e => setX(c.type === 'number' ? +e.target.value : e.target.value)} onBlur={() => done(x)} onKeyDown={keys} />;
}

export interface GridProps<C extends Coll> {
  coll: C; title: string; subtitle?: ReactNode; cols: Col<Row<C>>[];
  filter?: Filter; sortKey: string; canEdit: boolean; who: string;
  /** Builds a new document's _id from the entered values (else generated). */
  idOf?: (d: Record<string, Val>) => string; defaults?: Record<string, Val>;
  initialQuery?: string; extraActions?: ReactNode;
  /** Normalises a new or imported row before it is checked and saved (e.g. upper-case part numbers). */
  prepare?: (d: Record<string, Val>) => Record<string, Val>;
}

export function MasterGrid<C extends Coll>({ coll, title, subtitle, cols, filter = {}, sortKey, canEdit, who, idOf, defaults = {}, initialQuery = '', extraActions, prepare = d => d }: GridProps<C>) {
  const rows = useQuery(coll, filter, { sort: { [sortKey]: 1 } }).data as Row<C>[];
  const [q, setQ] = useState(initialQuery), [sel, setSel] = useState<Set<string>>(new Set());
  const [edit, setEdit] = useState<{ id: string; key: string } | null>(null), [draft, setDraft] = useState<Record<string, Val> | null>(null);
  const [bulk, setBulk] = useState<{ key: string; value: string }>({ key: '', value: '' });
  const [sort, setSort] = useState<{ key: string; dir: 1 | -1 } | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const editable = cols.filter(c => !c.value && !c.readOnly);
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    let out = t ? rows.filter(r => cols.some(c => show(c.value ? c.value(r) : get(r, c.key)).toLowerCase().includes(t)) || r._id.toLowerCase().includes(t)) : rows;
    if (sort) {
      const c = cols.find(x => x.key === sort.key)!;
      const v = (r: Row<C>) => (c.value ? c.value(r) : get(r, c.key)) as string | number;
      out = [...out].sort((a, b) => (v(a) > v(b) ? 1 : v(a) < v(b) ? -1 : 0) * sort.dir);
    }
    return out;
  }, [rows, q, sort, cols]);

  async function save(r: Row<C>, c: Col<Row<C>>, v: Val | null) {
    setEdit(null);
    if (v === null || JSON.stringify(v) === JSON.stringify(get(r, c.key))) return;
    const err = check(c, v);
    if (err) { toast(err); return; }
    await db.update(coll, r._id, { [c.key]: v } as Partial<Row<C>>).catch(e => toast((e as Error).message));
  }
  async function add() {
    if (!draft) return;
    const draft2 = prepare({ ...draft });
    for (const c of editable) { const err = check(c, draft2[c.key] ?? ''); if (err) { toast(err); return; } }
    const _id = idOf?.(draft2);
    if (_id && rows.some(r => r._id === _id)) { toast(`${_id} already exists`); return; }
    await db.insert(coll, { ...draft2, ...(_id ? { _id } : {}) } as unknown as NewDoc<C>).then(() => { setDraft(null); toast(`Added ${_id ?? 'row'}`); }, e => toast((e as Error).message));
  }
  async function remove(ids: string[]) {
    if (!ids.length || !window.confirm(`Delete ${ids.length} ${ids.length === 1 ? 'row' : 'rows'} from ${title}? This is recorded in the audit log.`)) return;
    for (const id of ids) await db.remove(coll, id);
    setSel(new Set());
    toast(`Deleted ${ids.length}`);
  }
  async function applyBulk() {
    const c = editable.find(x => x.key === bulk.key);
    if (!c) return;
    const v = coerce(c, bulk.value), err = check(c, v);
    if (err) { toast(err); return; }
    for (const id of sel) await db.update(coll, id, { [c.key]: v } as Partial<Row<C>>);
    toast(`${c.label} set on ${sel.size} rows`);
    setSel(new Set());
  }
  function exportCsv() {
    const list = sel.size ? shown.filter(r => sel.has(r._id)) : shown;
    download(`${coll}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(['id', ...cols.map(c => c.label)], list.map(r => [r._id, ...cols.map(c => show(c.value ? c.value(r) : get(r, c.key)))])));
  }
  async function importCsv(f: File) {
    const [head, ...data] = parseCsv(await f.text());
    if (!head) { toast('The file is empty'); return; }
    const idx = (c: Col<Row<C>>) => head.findIndex(h => [c.label, c.key].some(x => x.toLowerCase() === h.trim().toLowerCase()));
    const idCol = head.findIndex(h => /^(id|_id)$/i.test(h.trim()));
    let added = 0, updated = 0;
    const errors: string[] = [];
    for (const [n, line] of data.entries()) {
      let doc: Record<string, Val> = {};
      for (const c of editable) { const i = idx(c); if (i >= 0) doc[c.key] = coerce(c, line[i] ?? ''); }
      doc = prepare(doc);
      const bad = editable.filter(c => idx(c) >= 0).map(c => check(c, doc[c.key])).find(Boolean);
      if (bad) { errors.push(`Row ${n + 2}: ${bad}`); continue; }
      const id = (idCol >= 0 ? line[idCol]?.trim() : '') || idOf?.(doc);
      if (id && rows.some(r => r._id === id)) { await db.update(coll, id, doc as Partial<Row<C>>); updated++; }
      else {
        const missing = editable.find(c => c.required && doc[c.key] === undefined);
        if (missing) { errors.push(`Row ${n + 2}: ${missing.label} is required for a new row`); continue; }
        await db.insert(coll, { ...defaults, ...doc, ...(id ? { _id: id } : {}) } as unknown as NewDoc<C>); added++;
      }
    }
    toast(`Imported: ${added} added, ${updated} updated${errors.length ? `, ${errors.length} skipped · ${errors[0]}` : ''}`);
  }

  const all = shown.length > 0 && shown.every(r => sel.has(r._id));
  return (
    <>
      <div className="rep-hd">
        <div><h1>{title}</h1>{subtitle && <div className="sub">{subtitle}</div>}</div>
        <div className="acts">
          {extraActions}
          {canEdit && <button className="btn" onClick={() => file.current?.click()}>Import Excel/CSV</button>}
          <button className="btn" onClick={exportCsv}>Export{sel.size ? ` ${sel.size}` : ''}</button>
          {canEdit && <button className="btn primary" onClick={() => setDraft({ ...defaults })}>New</button>}
          <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void importCsv(f); }} />
        </div>
      </div>
      <div className="toolbar">
        <input className="search-in" placeholder={`Filter ${title.toLowerCase()}`} value={q} onChange={e => setQ(e.target.value)} aria-label="Filter" />
        <span style={{ flex: 1 }} />
        {!canEdit && <span className="chip">Read only for your role</span>}
        {canEdit && sel.size > 0 && <>
          <span className="sub">{sel.size} selected</span>
          <select value={bulk.key} onChange={e => setBulk({ key: e.target.value, value: '' })} aria-label="Field to set">
            <option value="">Bulk edit field…</option>{editable.filter(c => c.type !== 'multi').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
          {bulk.key && (() => { const c = editable.find(x => x.key === bulk.key)!; return c.options
            ? <select value={bulk.value} onChange={e => setBulk({ ...bulk, value: e.target.value })}><option value="">Value…</option>{c.options.map(o => <option key={o}>{o}</option>)}</select>
            : <input className="search-in" style={{ width: '8rem' }} value={bulk.value} onChange={e => setBulk({ ...bulk, value: e.target.value })} placeholder="Value" />; })()}
          <button className="btn" disabled={!bulk.key} onClick={() => void applyBulk()}>Apply</button>
          <button className="btn" onClick={() => void remove([...sel])}>Delete</button>
        </>}
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr>
            {canEdit && <th><input type="checkbox" checked={all} aria-label="Select all" onChange={() => setSel(all ? new Set() : new Set(shown.map(r => r._id)))} /></th>}
            {cols.map(c => <th key={c.key} className={c.type === 'number' || c.num ? 'num' : ''} style={c.width ? { width: c.width } : undefined}>
              <button className="th" onClick={() => setSort(s => (s?.key === c.key ? (s.dir === 1 ? { key: c.key, dir: -1 } : null) : { key: c.key, dir: 1 }))}>
                {c.label}{sort?.key === c.key ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}</button></th>)}
          </tr></thead>
          <tbody>
            {draft && <tr className="sel">
              {canEdit && <td />}
              {cols.map(c => <td key={c.key}>{c.value || (c.readOnly && !c.fixed) ? <span className="sub">—</span>
                : c.type === 'select' ? <select value={(draft[c.key] as string) ?? ''} onChange={e => setDraft({ ...draft, [c.key]: e.target.value })}><option value="" />{c.options!.map(o => <option key={o}>{o}</option>)}</select>
                : c.type === 'bool' ? <input type="checkbox" checked={!!draft[c.key]} onChange={e => setDraft({ ...draft, [c.key]: e.target.checked })} />
                : <input placeholder={c.label} type={c.type === 'number' ? 'number' : 'text'} value={show(draft[c.key])} onChange={e => setDraft({ ...draft, [c.key]: coerce(c, e.target.value) })} />}</td>)}
            </tr>}
            {shown.map(r => (
              <tr key={r._id} className={sel.has(r._id) ? 'sel' : ''}>
                {canEdit && <td><input type="checkbox" checked={sel.has(r._id)} aria-label={`Select ${r._id}`} onChange={() => { const s = new Set(sel); if (s.has(r._id)) s.delete(r._id); else s.add(r._id); setSel(s); }} /></td>}
                {cols.map((c, i) => {
                  const v = c.value ? c.value(r) : get(r, c.key);
                  const isEdit = edit?.id === r._id && edit.key === c.key;
                  const can = canEdit && !c.value && !c.readOnly && !c.fixed;
                  return (
                    <td key={c.key} className={`${c.type === 'number' || c.num ? 'num' : ''}${can ? ' ed' : ''}`} style={i === 0 ? { color: '#1450F5', fontWeight: 600 } : undefined}
                      onClick={() => { if (can && !isEdit) setEdit({ id: r._id, key: c.key }); }} title={can ? 'Click to edit' : undefined}>
                      {isEdit ? <Editor c={c} v={get(r, c.key)} done={x => void save(r, c, x)} /> : c.render ? c.render(r) : show(typeof v === 'number' ? v.toLocaleString('en-IN') : v)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="rep-ft">
        <span>{canEdit ? 'Click a cell to edit · Enter saves, Esc cancels · every change is audited' : 'Your role can view this master'} · signed in as {who}</span>
        <span>{shown.length} of {rows.length}</span>
      </div>
      {draft && <div className="rep-ft"><span /><span style={{ display: 'flex', gap: '.5rem' }}><button className="btn primary" onClick={() => void add()}>Save new row</button><button className="btn" onClick={() => setDraft(null)}>Cancel</button></span></div>}
    </>
  );
}
