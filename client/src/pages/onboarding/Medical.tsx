import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FileText, Search, Stethoscope } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtTs, toLocalInput } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';
import { Avatar, StatusBadge } from '../Candidates';

export function Medical() {
  const { can, enumLabel, enumTone } = useApp();
  const [f, setF] = useState({ filter: new URLSearchParams(window.location.search).get('filter') || '', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [vm, setVm] = useState<any>(null);
  const [om, setOm] = useState<any>(null);
  const load = useCallback(() => { setRows(null); api.get(`/medical${qs(f)}`).then(setRows); }, [f]);
  useEffect(load, [load]);
  const manage = can('medical.manage');
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Medical" subtitle="UAE immigration (visa) medical fitness and occupational health examinations are separate processes and are recorded separately." />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
            {[['', 'All'], ['awaiting_visa', 'Awaiting visa medical'], ['awaiting_occ', 'Awaiting occupational'], ['unfit', 'Unfit / follow-up']].map(([v, l]) => (
              <button key={v} onClick={() => setF({ ...f, filter: v })} className={cx('rounded-md px-2.5 py-1 text-xs font-medium', f.filter === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>
            ))}
          </div>
          <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Employee…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        </div>
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<Stethoscope className="size-6" />} title="No employees in this view" /> : (
          <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/80"><tr><th className="th pl-4">Employee</th><th className="th border-l border-slate-200">Visa medical (immigration)</th><th className="th">Result</th><th className="th" /><th className="th border-l border-slate-200">Occupational health</th><th className="th">Fitness</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r) => (
              <tr key={r.id}>
                <td className="td pl-4"><div className="flex items-center gap-2.5"><Avatar name={r.full_name} photoId={r.photo_document_id} size="sm" />
                  <div><Link to={`/candidates/${r.id}?tab=checklist`} className="font-medium text-slate-800 hover:text-brand-700">{r.full_name}</Link><div className="text-xs text-slate-500">{r.reference_no} · {r.trade} · <StatusBadge status={r.status} /></div></div></div></td>
                <td className="td border-l border-slate-100 text-xs">{r.vm_id ? <><div className="font-medium text-slate-700">{r.medical_centre}</div>
                  <div>{r.vm_attended ? `Attended ${fmtDate(r.vm_attended)}` : r.vm_appointment ? `Appointment ${fmtTs(r.vm_appointment)}` : 'Not scheduled'}</div></> : <span className="text-slate-400">No record{r.arrival_date ? ` · arrival ${fmtDate(r.arrival_date)}` : ''}</span>}</td>
                <td className="td">{r.vm_id && <><Badge tone={enumTone('visa_medical_result', r.vm_result)}>{enumLabel('visa_medical_result', r.vm_result)}</Badge>
                  {r.vm_result === 'fit' && <div className={cx('mt-0.5 text-[11px]', r.vm_verified_at ? 'text-emerald-700' : 'font-semibold text-amber-700')}>{r.vm_verified_at ? 'Verified' : 'Needs verification'}</div>}
                  {r.vm_doc && <a href={`/api/documents/${r.vm_doc}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-brand-700"><FileText className="size-3" />Certificate</a>}</>}</td>
                <td className="td">{manage && <Button size="sm" variant={r.vm_id ? 'secondary' : 'primary'} onClick={() => setVm(r)}>{r.vm_id ? (r.vm_result === 'retest' ? 'Re-test' : 'Update') : 'Schedule'}</Button>}</td>
                <td className="td border-l border-slate-100 text-xs">{r.om_id ? <><div className="font-medium text-slate-700">{r.clinic}</div>
                  <div>{r.om_exam ? `Examined ${fmtDate(r.om_exam)}` : r.om_appointment ? `Appointment ${fmtTs(r.om_appointment)}` : 'Not scheduled'}</div></> : <span className="text-slate-400">No record</span>}</td>
                <td className="td">{r.om_id && <><Badge tone={enumTone('occ_fitness', r.om_fitness)}>{enumLabel('occ_fitness', r.om_fitness)}</Badge>
                  {r.restrictions && <div className="max-w-40 truncate text-[11px] text-slate-500" title={r.restrictions}>{r.restrictions}</div>}
                  {r.om_doc && <a href={`/api/documents/${r.om_doc}/file`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-[11px] text-brand-700"><FileText className="size-3" />Report</a>}</>}</td>
                <td className="td">{manage && <Button size="sm" variant={r.om_id ? 'secondary' : 'primary'} onClick={() => setOm(r)}>{r.om_id ? (['unfit', 'temporarily_unfit'].includes(r.om_fitness) ? 'Re-examine' : 'Update') : 'Schedule'}</Button>}</td>
              </tr>
            ))}</tbody></table></div>
        )}
      </Card>
      {vm && <VisaMedicalModal r={vm} onClose={() => setVm(null)} onDone={() => { setVm(null); load(); }} />}
      {om && <OccModal r={om} onClose={() => setOm(null)} onDone={() => { setOm(null); load(); }} />}
    </div>
  );
}

function useSubmit(onDone: () => void) {
  const toast = useToast();
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr({});
    try { await fn(); toast('success', msg); onDone(); } catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return { err, busy, run };
}
const form = (v: Record<string, any>, file: File | null) => { const fd = new FormData(); for (const [k, x] of Object.entries(v)) fd.append(k, x ?? ''); if (file) fd.append('file', file); return fd; };

function VisaMedicalModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const fresh = !r.vm_id || r.vm_result === 'retest';
  const [f, setF] = useState<any>({ medical_centre: r.medical_centre || '', application_no: fresh ? '' : r.application_no || '', appointment_at: fresh ? '' : toLocalInput(r.vm_appointment),
    attended_date: fresh ? '' : r.vm_attended || '', result: fresh ? 'pending' : r.vm_result, result_date: fresh ? '' : r.vm_result_date || '', remarks: '' });
  const [file, setFile] = useState<File | null>(null);
  const { err, busy, run } = useSubmit(onDone);
  const save = () => run(() => (fresh ? api.post('/medical/visa', form({ ...f, candidate_id: r.id }, file)) : api.put(`/medical/visa/${r.vm_id}`, form(f, file))), 'Visa medical saved.');
  return (
    <Modal open onClose={onClose} title={`UAE visa medical — ${r.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button>
      {!fresh && r.vm_result === 'fit' && !r.vm_verified_at && r.vm_doc && <Button variant="subtle" loading={busy} onClick={() => run(() => api.post(`/medical/visa/${r.vm_id}/verify`), 'Result verified.')}>Verify Fit result</Button>}
      <Button loading={busy} onClick={save}>{fresh ? (r.vm_result === 'retest' ? 'Record re-test' : 'Create record') : 'Save'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        {r.vm_verified_at && <div className="sm:col-span-2"><Alert tone="success">Fit result verified. Changing the result requires a re-test.</Alert></div>}
        <Field label="Medical fitness centre" required error={err.medical_centre} className="sm:col-span-2"><input className="input" value={f.medical_centre} onChange={(e) => setF({ ...f, medical_centre: e.target.value })} /></Field>
        <Field label="Medical application no." error={err.application_no}><input className="input" value={f.application_no} onChange={(e) => setF({ ...f, application_no: e.target.value })} /></Field>
        <Field label="Appointment" error={err.appointment_at}><input type="datetime-local" className="input" value={f.appointment_at} onChange={(e) => setF({ ...f, appointment_at: e.target.value })} /></Field>
        <Field label="Attended on" error={err.attended_date}><input type="date" className="input" value={f.attended_date} onChange={(e) => setF({ ...f, attended_date: e.target.value })} /></Field>
        <Field label="Result" error={err.result}><select className="input" value={f.result} disabled={!!r.vm_verified_at} onChange={(e) => setF({ ...f, result: e.target.value })}>{options?.enums.visa_medical_result.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Result date" error={err.result_date}><input type="date" className="input" value={f.result_date} onChange={(e) => setF({ ...f, result_date: e.target.value })} /></Field>
        <Field label="Fitness certificate (PDF/JPG/PNG)" error={err.file}><input type="file" accept=".pdf,.jpg,.jpeg,.png" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        <Field label="Remarks" className="sm:col-span-2"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        {f.result === 'unfit' && <div className="sm:col-span-2"><Alert tone="warning">An Unfit visa medical result must be escalated to HR; the residence visa cannot proceed.</Alert></div>}
      </div>
    </Modal>
  );
}

function OccModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const fresh = !r.om_id || ['unfit', 'temporarily_unfit'].includes(r.om_fitness);
  const [f, setF] = useState<any>({ clinic: r.clinic || '', appointment_at: fresh ? '' : toLocalInput(r.om_appointment), exam_date: fresh ? '' : r.om_exam || '', tests_performed: '',
    fitness: fresh ? 'pending' : r.om_fitness, restrictions: fresh ? '' : r.restrictions || '', report_date: fresh ? '' : r.om_report_date || '', next_review_date: fresh ? '' : r.next_review_date || '' });
  const [file, setFile] = useState<File | null>(null);
  const { err, busy, run } = useSubmit(onDone);
  const save = () => run(() => (fresh ? api.post('/medical/occupational', form({ ...f, candidate_id: r.id }, file)) : api.put(`/medical/occupational/${r.om_id}`, form(f, file))), 'Occupational medical saved.');
  return (
    <Modal open onClose={onClose} title={`Occupational health — ${r.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>{fresh ? 'Create record' : 'Save'}</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Occupational health clinic" required error={err.clinic} className="sm:col-span-2"><input className="input" value={f.clinic} onChange={(e) => setF({ ...f, clinic: e.target.value })} /></Field>
        <Field label="Appointment" error={err.appointment_at}><input type="datetime-local" className="input" value={f.appointment_at} onChange={(e) => setF({ ...f, appointment_at: e.target.value })} /></Field>
        <Field label="Examination date" error={err.exam_date}><input type="date" className="input" value={f.exam_date} onChange={(e) => setF({ ...f, exam_date: e.target.value })} /></Field>
        <Field label="Tests performed" className="sm:col-span-2"><input className="input" placeholder="Audiometry, spirometry, vision, ECG…" value={f.tests_performed} onChange={(e) => setF({ ...f, tests_performed: e.target.value })} /></Field>
        <Field label="Fitness category" error={err.fitness}><select className="input" value={f.fitness} onChange={(e) => setF({ ...f, fitness: e.target.value })}>{options?.enums.occ_fitness.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
        <Field label="Report date" error={err.report_date}><input type="date" className="input" value={f.report_date} onChange={(e) => setF({ ...f, report_date: e.target.value })} /></Field>
        {['fit_with_restrictions', 'temporarily_unfit'].includes(f.fitness) && <Field label="Restrictions" required={f.fitness === 'fit_with_restrictions'} error={err.restrictions} className="sm:col-span-2"><textarea rows={2} className="input" value={f.restrictions} onChange={(e) => setF({ ...f, restrictions: e.target.value })} /></Field>}
        <Field label="Next review date" required={f.fitness === 'temporarily_unfit'} error={err.next_review_date}><input type="date" className="input" value={f.next_review_date} onChange={(e) => setF({ ...f, next_review_date: e.target.value })} /></Field>
        <Field label="Fitness report (PDF/JPG/PNG)"><input type="file" accept=".pdf,.jpg,.jpeg,.png" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
    </Modal>
  );
}

export { useSubmit, form };
