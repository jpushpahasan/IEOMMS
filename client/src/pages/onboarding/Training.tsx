import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, GraduationCap, Search } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, uaeToday } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';
import { MasterTable, type Col } from '../admin/Settings';
import { form, useSubmit } from './Medical';

export function Training() {
  const { can, options } = useApp();
  const [tab, setTab] = useState<'records' | 'templates' | 'courses'>('records');
  const courseCols: Col[] = [
    { key: 'code', label: 'Code', required: true }, { key: 'name', label: 'Course', required: true },
    { key: 'category', label: 'Category', type: 'select', required: true, options: () => options?.enums.training_category || [], show: (r) => options?.enums.training_category.find((o) => o.value === r.category)?.label || r.category },
    { key: 'duration_hours', label: 'Hours', required: true }, { key: 'validity_months', label: 'Validity (months)' }, { key: 'provider', label: 'Provider' },
  ];
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Training" subtitle="Training plans are generated from each trade's and project's training template; results complete the onboarding checklist." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {([['records', 'Training records'], ['templates', 'Trade & project templates'], ['courses', 'Course catalogue']] as const).map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>))}
      </div>
      {tab === 'records' && <Records />}
      {tab === 'templates' && <Templates />}
      {tab === 'courses' && <MasterTable masterKey="training_courses" title="Training courses" cols={courseCols} readOnly={!can('training.manage')} />}
    </div>
  );
}

function Records() {
  const { options, can, enumLabel, enumTone } = useApp();
  const [f, setF] = useState({ status: 'open', category: '', trade_id: '', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<any>(null);
  const [bulk, setBulk] = useState<'schedule' | 'result' | null>(null);
  const load = useCallback(() => { setRows(null); setChecked(new Set()); api.get(`/training/records${qs(f)}`).then(setRows); }, [f]);
  useEffect(load, [load]);
  const manage = can('training.manage');
  const toggle = (id: number) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="open">Open (required / scheduled / failed / absent)</option><option value="">All</option>
          {options?.enums.training_status.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className="input w-auto" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} aria-label="Category"><option value="">All categories</option>{options?.enums.training_category.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
        <select className="input w-auto" value={f.trade_id} onChange={(e) => setF({ ...f, trade_id: e.target.value })} aria-label="Trade"><option value="">All trades</option>{options?.trades.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}</select>
        <div className="relative min-w-48 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Employee…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        {manage && checked.size > 0 && <><span className="text-sm text-slate-600">{checked.size} selected</span>
          <Button size="sm" variant="secondary" onClick={() => setBulk('schedule')}>Schedule session</Button><Button size="sm" onClick={() => setBulk('result')}>Record results</Button></>}
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<GraduationCap className="size-6" />} title="No training records match" /> : (
        <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr>{manage && <th className="th w-8 pl-4"><input type="checkbox" className="accent-brand-600" aria-label="Select all" checked={checked.size === rows.length} onChange={(e) => setChecked(e.target.checked ? new Set(rows.map((r) => r.id)) : new Set())} /></th>}
            <th className={cx('th', !manage && 'pl-4')}>Employee</th><th className="th">Course</th><th className="th">Scheduled</th><th className="th">Completed</th><th className="th">Score</th><th className="th">Expiry</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{rows.map((r) => (
            <tr key={r.id} className={checked.has(r.id) ? 'bg-brand-50/50' : ''}>
              {manage && <td className="td pl-4"><input type="checkbox" className="accent-brand-600" checked={checked.has(r.id)} onChange={() => toggle(r.id)} aria-label={`Select ${r.full_name}`} /></td>}
              <td className={cx('td', !manage && 'pl-4')}><Link to={`/candidates/${r.candidate_id}?tab=checklist`} className="font-medium text-slate-800 hover:text-brand-700">{r.full_name}</Link><div className="text-xs text-slate-500">{r.trade} · {r.project}</div></td>
              <td className="td"><div>{r.course}</div><div className="text-xs text-slate-500">{enumLabel('training_category', r.category)}{r.requires_assessment ? ' · assessed' : ''}{r.is_mandatory ? '' : ' · optional'}</div></td>
              <td className="td">{fmtDate(r.scheduled_date)}</td><td className="td">{fmtDate(r.completed_date)}</td><td className="td tabular-nums">{r.score ?? '—'}</td>
              <td className="td">{fmtDate(r.expiry_date)}</td>
              <td className="td"><Badge tone={enumTone('training_status', r.status)}>{enumLabel('training_status', r.status)}</Badge>{r.certificate_document_id && <a href={`/api/documents/${r.certificate_document_id}/file`} target="_blank" rel="noreferrer" className="ml-1 inline-flex text-brand-700" aria-label="Certificate"><FileText className="size-3.5" /></a>}</td>
              <td className="td text-right">{manage && <Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Update</Button>}</td>
            </tr>
          ))}</tbody></table></div>
      )}
      {edit && <RecordModal r={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); load(); }} />}
      {bulk && <BulkModal mode={bulk} ids={[...checked]} onClose={() => setBulk(null)} onDone={() => { setBulk(null); load(); }} />}
    </Card>
  );
}

function RecordModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const [f, setF] = useState<any>({ status: r.status, scheduled_date: r.scheduled_date || '', completed_date: r.completed_date || '', trainer: r.trainer || '', score: r.score ?? '', remarks: r.remarks || '' });
  const [file, setFile] = useState<File | null>(null);
  const { err, busy, run } = useSubmit(onDone);
  return (
    <Modal open onClose={onClose} title={`${r.course} — ${r.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={() => run(() => api.put(`/training/records/${r.id}`, form(f, file)), 'Training record saved.')}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        {r.requires_assessment && <div className="sm:col-span-2"><Alert tone="info">This course needs an assessment: record Passed (with score) or Failed.</Alert></div>}
        <Field label="Status" error={err.status}><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{options?.enums.training_status.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Trainer / provider" error={err.trainer}><input className="input" value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })} /></Field>
        <Field label="Scheduled date" error={err.scheduled_date}><input type="date" className="input" value={f.scheduled_date} onChange={(e) => setF({ ...f, scheduled_date: e.target.value })} /></Field>
        <Field label="Completion date" error={err.completed_date}><input type="date" className="input" max={uaeToday()} value={f.completed_date} onChange={(e) => setF({ ...f, completed_date: e.target.value })} /></Field>
        <Field label="Score (%)" error={err.score}><input className="input" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} /></Field>
        <Field label={r.category === 'mohre' ? 'MOHRE training record' : 'Certificate'}><input type="file" accept=".pdf,.jpg,.jpeg,.png" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <Field label={f.status === 'exempted' ? 'Exemption reason' : 'Remarks'} required={f.status === 'exempted'} error={err.remarks} className="sm:col-span-2"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function BulkModal({ mode, ids, onClose, onDone }: { mode: 'schedule' | 'result'; ids: number[]; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(mode === 'schedule' ? { status: 'scheduled', scheduled_date: uaeToday(), trainer: '' } : { status: 'passed', completed_date: uaeToday(), score: '', trainer: '' });
  const [result, setResult] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { const r = await api.post('/training/records/bulk', { ids, ...f }); setResult(r); if (r.updated === ids.length) { toast('success', `${r.updated} record(s) updated.`); onDone(); } }
    catch (e) { if (e instanceof ApiError) toast('error', e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={result ? onDone : onClose} title={mode === 'schedule' ? `Schedule session (${ids.length})` : `Record results (${ids.length})`}
      footer={<><Button variant="secondary" onClick={result ? onDone : onClose}>Close</Button>{!result && <Button loading={busy} onClick={submit}>Apply</Button>}</>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {mode === 'result' && <Field label="Result"><select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}><option value="passed">Passed</option><option value="attended">Attended (no assessment)</option><option value="failed">Failed</option><option value="absent">Absent</option></select></Field>}
        {mode === 'schedule' ? <Field label="Session date"><input type="date" className="input" value={f.scheduled_date} onChange={(e) => setF({ ...f, scheduled_date: e.target.value })} /></Field>
          : <Field label="Completion date"><input type="date" className="input" max={uaeToday()} value={f.completed_date} onChange={(e) => setF({ ...f, completed_date: e.target.value })} /></Field>}
        {mode === 'result' && <Field label="Score (%) — for assessed courses"><input className="input" value={f.score} onChange={(e) => setF({ ...f, score: e.target.value })} /></Field>}
        <Field label="Trainer / provider"><input className="input" value={f.trainer} onChange={(e) => setF({ ...f, trainer: e.target.value })} /></Field>
        {result && <div className="sm:col-span-2"><Alert tone={result.updated === ids.length ? 'success' : 'warning'}>{result.updated} of {ids.length} updated.
          {result.results.filter((r: any) => !r.ok).map((r: any) => <div key={r.id} className="text-xs">Record {r.id}: {r.error}</div>)}</Alert></div>}
      </div>
    </Modal>
  );
}

function Templates() {
  const { options, can } = useApp();
  const toast = useToast();
  const [req, setReq] = useState<any>(null);
  const [courses, setCourses] = useState<any[]>([]);
  const [target, setTarget] = useState<{ kind: 'trade' | 'project'; id: number; label: string } | null>(null);
  const load = () => { api.get('/training/requirements').then(setReq); api.get('/masters/training_courses').then((c) => setCourses(c.filter((x: any) => x.is_active))); };
  useEffect(() => { load(); }, []);
  if (!req || !options) return <Spinner />;
  const block = (kind: 'trade' | 'project', list: any[]) => list.map((t) => {
    const items = req[`${kind}s`].filter((r: any) => r[`${kind}_id`] === t.id);
    return (
      <div key={`${kind}${t.id}`} className="rounded-xl border border-slate-200 bg-white p-4">
        <div className="mb-2 flex items-center justify-between"><div className="font-semibold text-slate-800">{t.label}</div>
          {can('training.manage') && <Button size="sm" variant="ghost" onClick={() => setTarget({ kind, id: t.id, label: t.label })}>Edit</Button>}</div>
        {items.length === 0 ? <p className="text-xs text-slate-400">No {kind === 'trade' ? 'courses' : 'client-specific courses'}</p> : (
          <ul className="space-y-1 text-sm">{items.map((i: any) => <li key={i.course_id} className="flex items-center justify-between gap-2"><span className="truncate">{i.course}</span>
            <span className="flex shrink-0 gap-1">{i.requires_assessment && <Badge tone="amber">Assessed</Badge>}{!i.is_mandatory && <Badge>Optional</Badge>}</span></li>)}</ul>
        )}
      </div>
    );
  });
  return (
    <div className="space-y-5">
      <Alert tone="info">Saving a template adds the new courses to every active employee of that trade/project who already has a checklist; existing training records are kept.</Alert>
      <h3 className="text-sm font-semibold text-slate-700">By trade</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{block('trade', options.trades)}</div>
      <h3 className="text-sm font-semibold text-slate-700">Client / project-specific</h3>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{block('project', options.projects)}</div>
      {target && <RequirementEditor target={target} courses={courses} current={req[`${target.kind}s`].filter((r: any) => r[`${target.kind}_id`] === target.id)}
        onClose={() => setTarget(null)} onDone={(r) => { setTarget(null); load(); toast('success', `Saved. ${r.added} training record(s) added for ${r.candidates} active employee(s).`); }} />}
    </div>
  );
}

function RequirementEditor({ target, courses, current, onClose, onDone }: { target: { kind: string; id: number; label: string }; courses: any[]; current: any[]; onClose: () => void; onDone: (r: any) => void }) {
  const { enumLabel } = useApp();
  const [sel, setSel] = useState<Record<number, { on: boolean; mandatory: boolean; assess: boolean }>>(() => Object.fromEntries(courses.map((c) => {
    const x = current.find((r) => r.course_id === c.id);
    return [c.id, { on: !!x, mandatory: x ? x.is_mandatory : true, assess: x ? x.requires_assessment : c.category === 'competency' }];
  })));
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try { onDone(await api.put(`/training/requirements/${target.kind}/${target.id}`, { courses: Object.entries(sel).filter(([, v]) => v.on).map(([id, v]) => ({ course_id: Number(id), is_mandatory: v.mandatory, requires_assessment: v.assess })) })); }
    finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="lg" title={`Training template — ${target.label}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>Save template</Button></>}>
      <table className="min-w-full divide-y divide-slate-100 text-sm">
        <thead><tr><th className="th">Course</th><th className="th">Include</th><th className="th">Mandatory</th><th className="th">Assessment</th></tr></thead>
        <tbody className="divide-y divide-slate-100">{courses.map((c) => {
          const v = sel[c.id];
          return (
            <tr key={c.id} className={v.on ? '' : 'text-slate-400'}><td className="py-1.5 pr-3">{c.name}<div className="text-xs text-slate-400">{enumLabel('training_category', c.category)}</div></td>
              <td><input type="checkbox" className="accent-brand-600" checked={v.on} onChange={(e) => setSel({ ...sel, [c.id]: { ...v, on: e.target.checked } })} /></td>
              <td><input type="checkbox" className="accent-brand-600" disabled={!v.on} checked={v.mandatory} onChange={(e) => setSel({ ...sel, [c.id]: { ...v, mandatory: e.target.checked } })} /></td>
              <td><input type="checkbox" className="accent-brand-600" disabled={!v.on} checked={v.assess} onChange={(e) => setSel({ ...sel, [c.id]: { ...v, assess: e.target.checked } })} /></td></tr>
          );
        })}</tbody>
      </table>
    </Modal>
  );
}
