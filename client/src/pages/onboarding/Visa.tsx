import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { IdCard, Search } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { daysUntil, fmtDate } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner } from '../../components/ui';
import { Avatar, StatusBadge } from '../Candidates';
import { form, useSubmit } from './Medical';

const STAGES: [string, string][] = [['', 'All'], ['entry_permit', 'Entry permit'], ['arrival', 'Awaiting residence application'], ['residence', 'Residence visa in process'], ['eid', 'Emirates ID'], ['complete', 'Complete']];

export function Visa() {
  const { can, enumLabel, enumTone } = useApp();
  const [f, setF] = useState({ stage: '', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const load = useCallback(() => { setRows(null); api.get(`/visa${qs(f)}`).then(setRows); }, [f]);
  useEffect(load, [load]);
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Visa & immigration" subtitle="Entry / work permit, residence visa and Emirates ID for every employee." />
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="scroll-thin flex gap-0.5 overflow-x-auto rounded-lg border border-slate-200 p-0.5">
            {STAGES.map(([v, l]) => <button key={v} onClick={() => setF({ ...f, stage: v })} className={cx('rounded-md px-2.5 py-1 text-xs font-medium whitespace-nowrap', f.stage === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
          </div>
          <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Employee or Emirates ID…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        </div>
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<IdCard className="size-6" />} title="No employees in this stage" /> : (
          <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/80"><tr><th className="th pl-4">Employee</th><th className="th">Entry permit</th><th className="th">Visa medical</th><th className="th">Residence visa</th><th className="th">Emirates ID</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">{rows.map((r) => {
              const ed = daysUntil(r.entry_permit_expiry_date);
              return (
                <tr key={r.candidate_id}>
                  <td className="td pl-4"><div className="flex items-center gap-2.5"><Avatar name={r.full_name} photoId={r.photo_document_id} size="sm" />
                    <div><Link to={`/candidates/${r.candidate_id}?tab=checklist`} className="font-medium text-slate-800 hover:text-brand-700">{r.full_name}</Link><div className="text-xs text-slate-500">{r.reference_no} · <StatusBadge status={r.status} /></div></div></div></td>
                  <td className="td text-xs">{r.entry_permit_required === false ? <Badge>Not required</Badge> : r.entry_permit_issue_date ? <><div className="font-medium">{r.entry_permit_no}</div>
                    <div className={cx(ed !== null && ed < 14 && !['arrived', 'onboarding', 'awaiting_clearance'].includes(r.status) ? 'font-semibold text-red-600' : 'text-slate-500')}>expires {fmtDate(r.entry_permit_expiry_date)}</div></>
                    : r.entry_permit_applied_date ? `Applied ${fmtDate(r.entry_permit_applied_date)}` : <span className="text-slate-400">Not applied</span>}</td>
                  <td className="td">{r.vm_result ? <Badge tone={enumTone('visa_medical_result', r.vm_result)}>{enumLabel('visa_medical_result', r.vm_result)}</Badge> : <span className="text-xs text-slate-400">—</span>}</td>
                  <td className="td text-xs"><Badge tone={enumTone('residence_status', r.residence_status || 'not_started')}>{enumLabel('residence_status', r.residence_status || 'not_started')}</Badge>
                    {r.residence_expiry_date && <div className="mt-0.5 text-slate-500">UID {r.uid_no || '—'} · exp. {fmtDate(r.residence_expiry_date)}</div>}</td>
                  <td className="td text-xs">{r.eid_number ? <><div className="font-mono">{r.eid_number}</div><div className={r.eid_verified ? 'text-emerald-700' : 'text-amber-700'}>{r.eid_verified ? 'Collected & verified' : r.eid_collected_date ? 'Collected, not verified' : 'Issued'}</div></>
                    : r.eid_biometrics_date ? `Biometrics ${fmtDate(r.eid_biometrics_date)}` : <span className="text-slate-400">—</span>}</td>
                  <td className="td text-right">{can('visa.manage') && <Button size="sm" variant="secondary" onClick={() => setSel(r)}>Update</Button>}</td>
                </tr>
              );
            })}</tbody></table></div>
        )}
      </Card>
      {sel && <VisaModal r={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); load(); }} />}
    </div>
  );
}

const KEYS = ['entry_permit_required', 'work_permit_no', 'entry_permit_no', 'entry_permit_applied_date', 'entry_permit_issue_date', 'entry_permit_expiry_date', 'residence_application_no',
  'residence_application_date', 'residence_status', 'residence_file_no', 'uid_no', 'residence_issue_date', 'residence_expiry_date', 'eid_application_no', 'eid_biometrics_date',
  'eid_number', 'eid_expiry_date', 'eid_collected_date', 'eid_verified', 'remarks'];

function VisaModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const [f, setF] = useState<any>(() => Object.fromEntries(KEYS.map((k) => [k, r[k] ?? (k === 'entry_permit_required' ? true : k === 'eid_verified' ? false : k === 'residence_status' ? 'not_started' : '')])));
  const [file, setFile] = useState<File | null>(null);
  const [docCat, setDocCat] = useState('');
  const { err, busy, run } = useSubmit(onDone);
  const inp = (k: string, label: string, type = 'text', cls = '') => <Field label={label} error={err[k]} className={cls}><input type={type} className="input" value={f[k] ?? ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>;
  const save = () => run(() => api.put(`/visa/${r.candidate_id}`, form({ ...f, ...(file ? { doc_category: docCat } : {}) }, file)), 'Visa record saved.');
  return (
    <Modal open onClose={onClose} size="xl" title={`Visa & immigration — ${r.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={save}>Save</Button></>}>
      <div className="space-y-4">
        {err._ && <Alert tone="error">{err._}</Alert>}
        <section><h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Entry permit / work permit (pre-arrival)</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 text-sm sm:col-span-3"><input type="checkbox" className="accent-brand-600" checked={!!f.entry_permit_required} onChange={(e) => setF({ ...f, entry_permit_required: e.target.checked })} />Entry permit required (untick for UAE residents / GCC nationals)</label>
            {inp('work_permit_no', 'MOHRE work permit no.')}{inp('entry_permit_no', 'Entry permit no.')}{inp('entry_permit_applied_date', 'Applied', 'date')}
            {inp('entry_permit_issue_date', 'Issued', 'date')}{inp('entry_permit_expiry_date', 'Expiry', 'date')}
          </div></section>
        <section><h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Residence visa</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            {inp('residence_application_no', 'Application no.')}{inp('residence_application_date', 'Applied', 'date')}
            <Field label="Status" error={err.residence_status}><select className="input" value={f.residence_status} onChange={(e) => setF({ ...f, residence_status: e.target.value })}>{options?.enums.residence_status.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
            {inp('residence_file_no', 'File no.')}{inp('uid_no', 'UID no.')}<div />
            {inp('residence_issue_date', 'Issue / stamping date', 'date')}{inp('residence_expiry_date', 'Expiry date', 'date')}
          </div></section>
        <section><h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Emirates ID</h4>
          <div className="grid gap-3 sm:grid-cols-3">
            {inp('eid_application_no', 'Application no.')}{inp('eid_biometrics_date', 'Biometrics date', 'date')}
            <Field label="Emirates ID number" error={err.eid_number}><input className="input font-mono" placeholder="784-YYYY-NNNNNNN-N" value={f.eid_number ?? ''} onChange={(e) => setF({ ...f, eid_number: e.target.value })} /></Field>
            {inp('eid_expiry_date', 'Card expiry', 'date')}{inp('eid_collected_date', 'Collected on', 'date')}
            <label className="flex items-end gap-2 pb-2 text-sm"><input type="checkbox" className="accent-brand-600" checked={!!f.eid_verified} onChange={(e) => setF({ ...f, eid_verified: e.target.checked })} />Card verified against records</label>
            {err.eid_verified && <div className="text-xs text-red-600 sm:col-span-3">{err.eid_verified}</div>}
          </div></section>
        <section className="grid gap-3 rounded-lg border border-dashed border-slate-300 p-3 sm:grid-cols-[200px_1fr]">
          <Field label="Attach a copy of"><select className="input" value={docCat} onChange={(e) => setDocCat(e.target.value)}><option value="">—</option><option value="work_permit">Work / entry permit</option><option value="residence_visa">Residence visa</option><option value="emirates_id">Emirates ID</option></select></Field>
          <Field label="File (PDF/JPG/PNG)"><input type="file" accept=".pdf,.jpg,.jpeg,.png" className="input" disabled={!docCat} onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
        </section>
        <Field label="Remarks"><textarea rows={2} className="input" value={f.remarks ?? ''} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
