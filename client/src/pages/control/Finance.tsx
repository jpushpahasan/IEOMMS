import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { CheckCircle2, Download, FileText, Pencil, Plus, Search, Trash2, Wallet } from 'lucide-react';
import { api, ApiError, download, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtMoney, uaeToday } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, Stat, useToast } from '../../components/ui';
import { DecideModal } from './Approvals';

const money = (v: unknown) => fmtMoney(v as string);

export function Finance() {
  const { options } = useApp();
  const [f, setF] = useState({ q: '', project_id: '', agency_id: '', nationality: '', category: '', payment_status: '', verification_status: '', from: '', to: '' });
  const [sum, setSum] = useState<any>(null);
  const [v, setV] = useState(0);
  useEffect(() => { setSum(null); const { q: _q, ...rest } = f; api.get(`/finance/summary${qs(rest)}`).then(setSum); }, [f, v]);
  const sel = (k: keyof typeof f, label: string, opts: { value: string | number; label: string }[]) => (
    <select className="input w-auto" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} aria-label={label}><option value="">{label}</option>{opts.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
  );
  const t = sum?.totals;
  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader title="Financial tracking" subtitle="Estimated and actual mobilisation cost per employee, with finance verification. Flight tickets are recorded automatically when issued."
        actions={<Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/finance/expenses${qs({ ...f, export: 'xlsx' })}`)}>Export</Button>} />
      <Card bodyClass="flex flex-wrap items-center gap-2 p-3">
        {sel('project_id', 'All projects', (options?.projects || []).map((p) => ({ value: p.id, label: p.label })))}
        {sel('agency_id', 'All agencies', (options?.agencies || []).map((p) => ({ value: p.id, label: p.label })))}
        {sel('nationality', 'All nationalities', (options?.countries || []).map((c) => ({ value: c, label: c })))}
        {sel('category', 'All categories', options?.enums.expense_category || [])}
        {sel('payment_status', 'Any payment', options?.enums.payment_status || [])}
        {sel('verification_status', 'Any verification', options?.enums.verification_status || [])}
        <input type="date" className="input w-auto" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} aria-label="From" />
        <input type="date" className="input w-auto" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} aria-label="To" />
      </Card>
      {!sum ? <Spinner /> : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
            <Stat label="Total estimated" value={money(t.estimated)} icon={<Wallet className="size-5" />} tone="slate" />
            <Stat label="Total actual" value={money(t.actual)} icon={<Wallet className="size-5" />} tone="indigo" />
            <Stat label="Variance (invoiced lines)" value={money(t.variance)} tone={Number(t.variance) > 0 ? 'red' : 'green'} sub={t.variance_pct !== null ? `${t.variance_pct > 0 ? '+' : ''}${t.variance_pct}% vs estimate` : ''} />
            <Stat label="Average per employee" value={money(t.average_per_employee)} tone="cyan" sub={`${t.employees} employees`} />
            <Stat label="Outstanding (unpaid)" value={money(t.outstanding)} tone="amber" />
            <Stat label="Awaiting verification" value={t.pending_verification} tone="purple" sub={`${t.lines} cost lines`} />
          </div>
          <div className="grid gap-5 xl:grid-cols-2">
            <Breakdown title="By project" rows={sum.byProject} chart />
            <Breakdown title="By cost category" rows={sum.byCategory} chart />
            <Breakdown title="By recruitment agency" rows={sum.byAgency} />
            <Breakdown title="By nationality" rows={sum.byNationality} />
          </div>
        </>
      )}
      <Expenses filters={f} q={f.q} setQ={(q) => setF({ ...f, q })} onChange={() => setV((x) => x + 1)} />
    </div>
  );
}

function Breakdown({ title, rows, chart }: { title: string; rows: any[]; chart?: boolean }) {
  return (
    <Card title={title} bodyClass="p-0">
      {rows.length === 0 ? <Empty title="No costs yet" /> : <>
        {chart && <div className="px-2 pt-3"><ResponsiveContainer width="100%" height={Math.max(160, rows.length * 34)}>
          <BarChart data={rows.map((r) => ({ name: r.name, Estimated: Number(r.estimated), Actual: Number(r.actual) }))} layout="vertical" margin={{ left: 8, right: 16 }}>
            <CartesianGrid horizontal={false} stroke="#f1f5f9" />
            <XAxis type="number" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={(x) => `${Math.round(x / 1000)}k`} />
            <YAxis type="category" dataKey="name" width={170} tick={{ fontSize: 11, fill: '#334155' }} axisLine={false} tickLine={false} />
            <Tooltip formatter={(x) => fmtMoney(x as number)} cursor={{ fill: '#f8fafc' }} /><Legend wrapperStyle={{ fontSize: 12 }} />
            <Bar dataKey="Estimated" fill="#cbd5e1" barSize={9} radius={[0, 3, 3, 0]} /><Bar dataKey="Actual" fill="#17385f" barSize={9} radius={[0, 3, 3, 0]} />
          </BarChart></ResponsiveContainer></div>}
        <table className="min-w-full divide-y divide-slate-100 text-sm">
          <thead className="bg-slate-50/80"><tr><th className="th pl-4">{title.replace('By ', '')}</th><th className="th text-right">Employees</th><th className="th text-right">Estimated</th><th className="th text-right">Actual</th><th className="th pr-4 text-right">Variance</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => (
            <tr key={r.name}><td className="td pl-4">{r.name}</td><td className="td text-right tabular-nums">{r.employees}</td><td className="td text-right tabular-nums">{fmtMoney(r.estimated)}</td>
              <td className="td text-right font-medium tabular-nums">{fmtMoney(r.actual)}</td><td className={cx('td pr-4 text-right tabular-nums', Number(r.variance) > 0 ? 'text-red-600' : 'text-emerald-700')}>{fmtMoney(r.variance)}</td></tr>
          ))}</tbody>
        </table>
      </>}
    </Card>
  );
}

/** Expense lines; also used on the candidate profile with a fixed candidate. */
export function Expenses({ filters, q, setQ, candidateId, onChange }: { filters?: Record<string, string>; q?: string; setQ?: (q: string) => void; candidateId?: number; onChange?: () => void }) {
  const { can, enumLabel, enumTone, user } = useApp();
  const toast = useToast();
  const [rows, setRows] = useState<any[] | null>(null);
  const [edit, setEdit] = useState<any>(null);
  const [decide, setDecide] = useState<any>(null);
  const load = useCallback(() => { setRows(null); api.get(`/finance/expenses${qs(candidateId ? { candidate_id: candidateId } : { ...filters })}`).then(setRows); }, [filters, candidateId]);
  useEffect(load, [load]);
  const changed = () => { load(); onChange?.(); };
  const remove = async (e: any) => {
    if (!confirm('Delete this unpaid, unverified cost line?')) return;
    try { await api.del(`/finance/expenses/${e.id}`); toast('success', 'Deleted.'); changed(); } catch (x) { if (x instanceof ApiError) toast('error', x.message); }
  };
  const totals = (rows || []).reduce((s, r) => ({ est: s.est + Number(r.estimated_cost), act: s.act + Number(r.actual_cost || 0), inv: s.inv + (r.actual_cost === null ? 0 : Number(r.estimated_cost)) }), { est: 0, act: 0, inv: 0 });
  return (
    <Card title={candidateId ? 'Mobilisation costs' : 'Cost lines'} bodyClass="p-0" actions={<>
      {setQ && <div className="relative w-64"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Employee, supplier, invoice…" value={q} onChange={(e) => setQ(e.target.value)} /></div>}
      {can('finance.manage') && <Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setEdit({ candidate_id: candidateId ? String(candidateId) : '' })}>Add cost</Button>}</>}>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<Wallet className="size-6" />} title="No cost lines" /> : (
        <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr>{!candidateId && <th className="th pl-4">Employee</th>}<th className={cx('th', !!candidateId && 'pl-4')}>Category</th><th className="th">Supplier / invoice</th>
            <th className="th text-right">Estimated</th><th className="th text-right">Actual</th><th className="th text-right">Variance</th><th className="th">Payment</th><th className="th">Verification</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((e) => {
            const own = (e.updated_by || e.created_by) === user?.id;
            return (
              <tr key={e.id}>
                {!candidateId && <td className="td pl-4"><Link to={`/candidates/${e.candidate_id}?tab=costs`} className="font-medium text-slate-800 hover:text-brand-700">{e.full_name}</Link><div className="text-xs text-slate-500">{e.project}</div></td>}
                <td className={cx('td', !!candidateId && 'pl-4')}>{enumLabel('expense_category', e.category)}<div className="max-w-52 truncate text-xs text-slate-500">{e.description}{e.source ? ' · automatic' : ''}</div></td>
                <td className="td text-xs">{e.supplier || '—'}<div className="text-slate-500">{e.invoice_no ? `Inv. ${e.invoice_no}` : ''}{e.invoice_date ? ` · ${fmtDate(e.invoice_date)}` : ''}
                  {e.invoice_document_id && <a href={`/api/documents/${e.invoice_document_id}/file`} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-brand-700" aria-label="Invoice"><FileText className="size-3.5" /></a>}</div></td>
                <td className="td text-right tabular-nums">{fmtMoney(e.estimated_cost)}</td>
                <td className="td text-right font-medium tabular-nums">{e.actual_cost === null ? <span className="text-slate-400">pending</span> : fmtMoney(e.actual_cost)}</td>
                <td className={cx('td text-right tabular-nums', Number(e.variance) > 0 && e.actual_cost !== null ? 'text-red-600' : 'text-emerald-700')}>{e.actual_cost === null ? '—' : fmtMoney(e.variance)}</td>
                <td className="td"><Badge tone={enumTone('payment_status', e.payment_status)}>{enumLabel('payment_status', e.payment_status)}</Badge>{e.payment_date && <div className="text-[11px] text-slate-500">{fmtDate(e.payment_date)}</div>}</td>
                <td className="td"><Badge tone={enumTone('verification_status', e.verification_status)}>{enumLabel('verification_status', e.verification_status)}</Badge>{e.verified_by_name && <div className="text-[11px] text-slate-500">{e.verified_by_name}</div>}</td>
                <td className="td text-right">
                  {can('finance.verify') && e.verification_status === 'pending' && e.actual_cost !== null && (!own || can('approvals.self')) && <Button size="sm" variant="subtle" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setDecide({ url: `/finance/expenses/${e.id}/verify`, title: enumLabel('expense_category', e.category), reject: false, verify: true })}>Verify</Button>}
                  {can('finance.manage') && <Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setEdit(e)} aria-label="Edit" />}
                  {can('finance.manage') && !e.source && e.verification_status !== 'verified' && e.payment_status === 'unpaid' && <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => remove(e)} aria-label="Delete" />}
                </td>
              </tr>
            );
          })}</tbody>
          <tfoot className="bg-slate-50 text-sm font-semibold"><tr><td className="td pl-4" colSpan={candidateId ? 2 : 3}>Total ({rows.length})</td><td className="td text-right tabular-nums">{fmtMoney(totals.est)}</td><td className="td text-right tabular-nums">{fmtMoney(totals.act)}</td><td className="td text-right tabular-nums">{fmtMoney(totals.act - totals.inv)}</td><td colSpan={3} /></tr></tfoot>
        </table></div>
      )}
      {edit && <ExpenseModal e={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); changed(); }} />}
      {decide && <DecideModal {...decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); toast('success', 'Saved.'); changed(); }} />}
    </Card>
  );
}

function ExpenseModal({ e, onClose, onDone }: { e: any; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const toast = useToast();
  const editing = !!e.id;
  const locked = e.verification_status === 'verified';
  const [cands, setCands] = useState<any[]>([]);
  const [f, setF] = useState<any>({ candidate_id: String(e.candidate_id || ''), category: e.category || '', description: e.description || '', estimated_cost: e.estimated_cost || '', actual_cost: e.actual_cost ?? '',
    supplier: e.supplier || '', invoice_no: e.invoice_no || '', invoice_date: e.invoice_date || '', payment_status: e.payment_status || 'unpaid', payment_date: e.payment_date || '', remarks: e.remarks || '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing && !e.candidate_id) api.get('/candidates?pageSize=200&sort=full_name&dir=asc').then((r) => setCands(r.rows)); }, [editing, e.candidate_id]);
  const submit = async () => {
    setBusy(true); setErr({});
    const fd = new FormData();
    const body = locked ? { payment_status: f.payment_status, payment_date: f.payment_date, remarks: f.remarks } : f;
    for (const [k, v] of Object.entries(body)) if (!(editing && k === 'candidate_id')) fd.append(k, v as string);
    if (file) fd.append('file', file);
    try { editing ? await api.put(`/finance/expenses/${e.id}`, fd) : await api.post('/finance/expenses', fd); toast('success', 'Cost line saved.'); onDone(); }
    catch (x) { if (x instanceof ApiError) setErr({ ...(x.details || {}), _: x.message }); } finally { setBusy(false); }
  };
  const inp = (k: string, label: string, type = 'text', dis = false) => <Field label={label} error={err[k]}><input type={type} className="input" disabled={dis || locked} value={f[k]} onChange={(x) => setF({ ...f, [k]: x.target.value })} /></Field>;
  return (
    <Modal open onClose={onClose} size="lg" title={editing ? 'Edit cost line' : 'Add mobilisation cost'} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={submit}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        {err._ && <div className="sm:col-span-3"><Alert tone="error">{err._}</Alert></div>}
        {locked && <div className="sm:col-span-3"><Alert tone="info">Verified by finance — only payment details and remarks can change.</Alert></div>}
        {e.source && <div className="sm:col-span-3"><Alert tone="info">Recorded automatically from the flight booking; the ticket cost changes there.</Alert></div>}
        {!editing && !e.candidate_id && <Field label="Employee" required error={err.candidate_id} className="sm:col-span-3"><select className="input" value={f.candidate_id} onChange={(x) => setF({ ...f, candidate_id: x.target.value })}><option value="">Select…</option>{cands.map((c) => <option key={c.id} value={c.id}>{c.full_name} — {c.reference_no}</option>)}</select></Field>}
        <Field label="Cost category" required error={err.category}><select className="input" disabled={locked || !!e.source} value={f.category} onChange={(x) => setF({ ...f, category: x.target.value })}><option value="">Select…</option>{options?.enums.expense_category.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <div className="sm:col-span-2">{inp('description', 'Description')}</div>
        {inp('estimated_cost', 'Estimated cost (AED)')}{inp('actual_cost', 'Actual cost (AED)', 'text', !!e.source)}{inp('supplier', 'Supplier / service provider')}
        {inp('invoice_no', 'Invoice number')}{inp('invoice_date', 'Invoice date', 'date')}
        <Field label="Supporting invoice"><input type="file" accept=".pdf,.jpg,.jpeg,.png" className="input" disabled={locked} onChange={(x) => setFile(x.target.files?.[0] || null)} /></Field>
        <Field label="Payment status" error={err.payment_status}><select className="input" value={f.payment_status} onChange={(x) => setF({ ...f, payment_status: x.target.value })}>{options?.enums.payment_status.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Payment date" error={err.payment_date}><input type="date" className="input" max={uaeToday()} value={f.payment_date} onChange={(x) => setF({ ...f, payment_date: x.target.value })} /></Field>
        <div />
        <Field label="Remarks" className="sm:col-span-3"><textarea rows={2} className="input" value={f.remarks} onChange={(x) => setF({ ...f, remarks: x.target.value })} /></Field>
      </div>
    </Modal>
  );
}
