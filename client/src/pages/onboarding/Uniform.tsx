import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Check, Search, Shirt, Trash2 } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, uaeToday } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';
import { MasterTable, type Col } from '../admin/Settings';
import { Avatar, StatusBadge } from '../Candidates';

const CATS = ['uniform', 'safety_shoes', 'ppe', 'id_card'];

export function Uniform() {
  const { can, options } = useApp();
  const [tab, setTab] = useState<'issues' | 'items'>('issues');
  const itemCols: Col[] = [{ key: 'name', label: 'Item', required: true },
    { key: 'category', label: 'Category', type: 'select', required: true, options: () => options?.enums.uniform_category || [], show: (r) => options?.enums.uniform_category.find((o) => o.value === r.category)?.label || r.category },
    { key: 'needs_size', label: 'Size required', type: 'bool' }, { key: 'default_qty', label: 'Default qty', required: true }];
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Uniform & PPE" subtitle="Measurements, uniform, safety shoes, PPE and ID card distribution. Items count as distributed once the employee acknowledges receipt." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {([['issues', 'Distribution'], ['items', 'Items']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
      </div>
      {tab === 'issues' ? <Distribution /> : <MasterTable masterKey="uniform_items" title="Uniform / PPE items" cols={itemCols} readOnly={!can('uniform.manage')} />}
    </div>
  );
}

function Distribution() {
  const { enumLabel } = useApp();
  const [f, setF] = useState({ filter: 'pending', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const load = useCallback(() => { setRows(null); api.get(`/uniform${qs(f)}`).then(setRows); }, [f]);
  useEffect(load, [load]);
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {[['pending', 'Not fully issued'], ['not_measured', 'Not measured'], ['unacknowledged', 'Awaiting acknowledgement'], ['', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setF({ ...f, filter: v })} className={cx('rounded-md px-2.5 py-1 text-xs font-medium', f.filter === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>))}
        </div>
        <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Employee…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<Shirt className="size-6" />} title="Nobody in this view" /> : (
        <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr><th className="th pl-4">Employee</th><th className="th">Sizes</th>{CATS.map((c) => <th key={c} className="th">{enumLabel('uniform_category', c)}</th>)}<th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => (
            <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => setSel(r)}>
              <td className="td pl-4"><div className="flex items-center gap-2.5"><Avatar name={r.full_name} photoId={r.photo_document_id} size="sm" /><div><div className="font-medium text-slate-800">{r.full_name}</div><div className="text-xs text-slate-500">{r.trade} · <StatusBadge status={r.status} /></div></div></div></td>
              <td className="td text-xs">{r.measured_date ? `Shirt ${r.shirt_size || '—'} · Coverall ${r.coverall_size || '—'} · Shoe ${r.shoe_size || '—'}` : <span className="font-medium text-amber-700">Not measured</span>}</td>
              {CATS.map((c) => { const i = r.issues?.[c]; return <td key={c} className="td">{!i ? <span className="text-xs text-slate-400">—</span> : i.ack ? <Badge tone="green"><Check className="size-3" />Acknowledged</Badge> : <Badge tone="amber">Issued, not acknowledged</Badge>}</td>; })}
              <td className="td text-right"><Button size="sm" variant="secondary">Open</Button></td>
            </tr>
          ))}</tbody></table></div>
      )}
      {sel && <EmployeeUniform r={sel} onClose={() => { setSel(null); load(); }} />}
    </Card>
  );
}

function EmployeeUniform({ r, onClose }: { r: any; onClose: () => void }) {
  const { can, enumLabel } = useApp();
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [m, setM] = useState<any>(null);
  const [kit, setKit] = useState<Record<number, { on: boolean; size: string; qty: string }>>({});
  const [issueDate, setIssueDate] = useState(uaeToday());
  const [ack, setAck] = useState<Set<number>>(new Set());
  const [ackDate, setAckDate] = useState(uaeToday());
  const [ackFile, setAckFile] = useState<File | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const manage = can('uniform.manage');
  const load = useCallback(() => {
    api.get(`/uniform/candidates/${r.id}`).then((x) => {
      setD(x);
      setM({ shirt_size: x.measurement?.shirt_size || '', trouser_size: x.measurement?.trouser_size || '', coverall_size: x.measurement?.coverall_size || '', shoe_size: x.measurement?.shoe_size || '', measured_date: x.measurement?.measured_date || uaeToday() });
      setAck(new Set(x.issues.filter((i: any) => !i.acknowledged).map((i: any) => i.id)));
    });
  }, [r.id]);
  useEffect(() => { load(); api.get('/masters/uniform_items').then((x) => { const act = x.filter((i: any) => i.is_active); setItems(act); setKit(Object.fromEntries(act.map((i: any) => [i.id, { on: false, size: '', qty: String(i.default_qty) }]))); }); }, [load]);
  const call = async (fn: () => Promise<unknown>, msg: string) => {
    setErr({});
    try { await fn(); toast('success', msg); load(); } catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); }
  };
  if (!d || !m) return <Modal open onClose={onClose} title={r.full_name}><Spinner /></Modal>;
  const sizeFor = (i: any) => (i.category === 'safety_shoes' ? m.shoe_size : /coverall/i.test(i.name) ? m.coverall_size : m.shirt_size);
  return (
    <Modal open onClose={onClose} size="xl" title={<span>{r.full_name} <Link to={`/candidates/${r.id}?tab=checklist`} className="ml-2 text-sm font-normal text-brand-700">checklist →</Link></span>} footer={<Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-5">
        {err._ && <Alert tone="error">{err._}</Alert>}
        <section><h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Measurements {d.measurement && <span className="font-normal normal-case">· {fmtDate(d.measurement.measured_date)} by {d.measurement.measured_by_name}</span>}</h4>
          <div className="grid gap-3 sm:grid-cols-6">
            {[['shirt_size', 'Shirt'], ['trouser_size', 'Trouser'], ['coverall_size', 'Coverall'], ['shoe_size', 'Shoe']].map(([k, l]) => <Field key={k} label={l} error={err[k]}><input className="input" disabled={!manage} value={m[k]} onChange={(e) => setM({ ...m, [k]: e.target.value })} /></Field>)}
            <Field label="Measured on" error={err.measured_date}><input type="date" className="input" disabled={!manage} max={uaeToday()} value={m.measured_date} onChange={(e) => setM({ ...m, measured_date: e.target.value })} /></Field>
            {manage && <div className="flex items-end"><Button variant="secondary" className="w-full" onClick={() => call(() => api.put(`/uniform/measurements/${r.id}`, m), 'Measurements saved.')}>Save sizes</Button></div>}
          </div></section>
        {manage && <section><h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Issue items</h4>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{items.map((i) => { const v = kit[i.id]; if (!v) return null; return (
            <label key={i.id} className={cx('flex items-center gap-2 rounded-lg border p-2 text-sm', v.on ? 'border-brand-500 bg-brand-50/50' : 'border-slate-200')}>
              <input type="checkbox" className="accent-brand-600" checked={v.on} onChange={(e) => setKit({ ...kit, [i.id]: { ...v, on: e.target.checked, size: v.size || sizeFor(i) || '' } })} />
              <span className="flex-1"><span className="block">{i.name}</span><span className="text-xs text-slate-500">{enumLabel('uniform_category', i.category)}</span></span>
              {i.needs_size && <input className="w-14 rounded border border-slate-300 px-1 py-0.5 text-xs" placeholder="Size" value={v.size} onChange={(e) => setKit({ ...kit, [i.id]: { ...v, size: e.target.value } })} />}
              <input className="w-10 rounded border border-slate-300 px-1 py-0.5 text-xs" aria-label="Quantity" value={v.qty} onChange={(e) => setKit({ ...kit, [i.id]: { ...v, qty: e.target.value } })} />
            </label>); })}</div>
          <div className="mt-2 flex items-end gap-2"><Field label="Issue date"><input type="date" className="input" max={uaeToday()} value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></Field>
            <Button onClick={() => call(() => api.post('/uniform/issues', { candidate_id: r.id, issue_date: issueDate, items: Object.entries(kit).filter(([, v]) => v.on).map(([id, v]) => ({ item_id: Number(id), size: v.size, quantity: Number(v.qty) })) }), 'Items issued. Ask the employee to acknowledge receipt.')}>Issue selected</Button></div>
        </section>}
        <section><h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Issued items</h4>
          {d.issues.length === 0 ? <p className="text-sm text-slate-500">Nothing issued yet.</p> : <table className="min-w-full divide-y divide-slate-100 text-sm">
            <thead><tr><th className="th">Item</th><th className="th">Size</th><th className="th">Qty</th><th className="th">Issued</th><th className="th">Acknowledgement</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.issues.map((i: any) => (
              <tr key={i.id}><td className="py-1.5">{!i.acknowledged && manage && <input type="checkbox" className="mr-2 accent-brand-600" checked={ack.has(i.id)} onChange={() => setAck((s) => { const n = new Set(s); if (n.has(i.id)) n.delete(i.id); else n.add(i.id); return n; })} aria-label={`Acknowledge ${i.item}`} />}{i.item}</td>
                <td>{i.size || '—'}</td><td>{i.quantity}</td><td>{fmtDate(i.issue_date)}<div className="text-xs text-slate-500">{i.issued_by_name}</div></td>
                <td>{i.acknowledged ? <span className="text-emerald-700">{fmtDate(i.acknowledged_date)}{i.ack_document_id && <a className="ml-1 text-brand-700" href={`/api/documents/${i.ack_document_id}/file`} target="_blank" rel="noreferrer">form</a>}</span> : <Badge tone="amber">Pending</Badge>}</td>
                <td className="text-right">{!i.acknowledged && manage && <button className="text-red-600" onClick={() => call(() => api.del(`/uniform/issues/${i.id}`), 'Removed.')} aria-label="Remove"><Trash2 className="size-4" /></button>}</td></tr>
            ))}</tbody></table>}
          {manage && ack.size > 0 && <div className="mt-3 grid items-end gap-2 rounded-lg bg-slate-50 p-3 sm:grid-cols-[160px_1fr_auto]">
            <Field label="Acknowledged on" error={err.acknowledged_date}><input type="date" className="input" max={uaeToday()} value={ackDate} onChange={(e) => setAckDate(e.target.value)} /></Field>
            <Field label="Signed acknowledgement form (optional)"><input type="file" accept=".pdf,.jpg,.jpeg,.png" className="input" onChange={(e) => setAckFile(e.target.files?.[0] || null)} /></Field>
            <Button onClick={() => call(() => { const fd = new FormData(); fd.append('ids', [...ack].join(',')); fd.append('acknowledged_date', ackDate); if (ackFile) fd.append('file', ackFile); return api.post('/uniform/acknowledge', fd); }, 'Acknowledgement recorded.')}>Record acknowledgement ({ack.size})</Button>
          </div>}
        </section>
      </div>
    </Modal>
  );
}
