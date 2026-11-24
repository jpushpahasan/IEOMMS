import { useCallback, useEffect, useState } from 'react';
import { BadgeCheck, ListChecks, Lock, Paperclip, UserPlus } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, uaeToday } from '../../lib/format';
import { Alert, Button, Card, cx, Empty, Field, Modal, Spinner, useToast } from '../../components/ui';
import { ActivityModal, ActivityStatus, SectionBar } from '../../components/Activity';

/** Candidate profile tab: the full checklist grouped by section. */
export function Checklist({ candidate, onChange }: { candidate: any; onChange: () => void }) {
  const { can } = useApp();
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [sel, setSel] = useState<any>(null);
  const [register, setRegister] = useState(false);
  const [hideDone, setHideDone] = useState(false);
  const load = useCallback(() => { api.get(`/onboarding/candidates/${candidate.id}`).then(setD); }, [candidate.id]);
  useEffect(load, [load]);
  if (!d) return <Spinner />;
  const refresh = () => { load(); onChange(); };
  if (!d.activities.length) {
    return <Card><Empty icon={<ListChecks className="size-6" />} title="No onboarding checklist yet">
      {can('onboarding.verify') && candidate.status !== 'cancelled' && <Button className="mt-3" onClick={async () => { await api.post(`/onboarding/candidates/${candidate.id}/generate`); toast('success', 'Checklist generated.'); refresh(); }}>Generate checklist</Button>}
    </Empty></Card>;
  }
  const acts = d.activities as any[];
  const applicable = acts.filter((a) => a.status !== 'not_applicable');
  const done = applicable.filter((a) => a.status === 'completed').length;
  const overdue = acts.filter((a) => a.overdue).length;
  const reg = acts.find((a) => a.workflow_key === 'hr_registration');
  const canRegister = can('employees.manage') && !d.employee && ['arrived', 'onboarding', 'awaiting_clearance', 'ready_for_deployment', 'deployed', 'on_hold'].includes(candidate.status);

  return (
    <div className="space-y-5">
      <Card>
        <div className="flex flex-wrap items-center gap-6">
          <div><div className="text-3xl font-semibold text-slate-900 tabular-nums">{applicable.length ? Math.round((done / applicable.length) * 100) : 0}%</div><div className="text-xs text-slate-500">{done} of {applicable.length} applicable activities</div></div>
          <div className="flex-1 grid min-w-64 grid-cols-6 gap-3">
            {Object.keys(d.sections).map((s) => {
              const rows = acts.filter((a) => a.section === s && a.status !== 'not_applicable');
              return <div key={s}><div className="mb-1 truncate text-[11px] font-medium text-slate-500">{s}. {d.sections[s]}</div><SectionBar done={rows.filter((a) => a.status === 'completed').length} total={rows.length} overdue={rows.filter((a) => a.overdue).length} /></div>;
            })}
          </div>
          <div className="text-right text-xs text-slate-500">
            {overdue > 0 && <div className="text-sm font-semibold text-red-600">{overdue} overdue</div>}
            Template: {d.header?.template_name || 'default'}<br />
            {d.employee ? <span className="inline-flex items-center gap-1 font-medium text-emerald-700"><BadgeCheck className="size-3.5" />Employee {d.employee.employee_no}</span> : 'Not yet registered as employee'}
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          {canRegister && <Button size="sm" icon={<UserPlus className="size-3.5" />} onClick={() => setRegister(true)}>HR registration (create employee no.)</Button>}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="accent-brand-600" checked={hideDone} onChange={(e) => setHideDone(e.target.checked)} />Hide completed / not applicable</label>
        </div>
      </Card>
      {Object.entries(d.sections).map(([s, name]) => {
        const rows = acts.filter((a) => a.section === s && (!hideDone || !['completed', 'not_applicable'].includes(a.status)));
        if (!rows.length) return null;
        return (
          <Card key={s} title={`${s}. ${name}`} bodyClass="p-0">
            <ul className="divide-y divide-slate-100">
              {rows.map((a) => (
                <li key={a.id} onClick={() => setSel(a)} className={cx('grid cursor-pointer gap-2 px-4 py-2.5 hover:bg-brand-50/40 md:grid-cols-[1fr_170px_110px_110px_170px] md:items-center', a.overdue && 'bg-red-50/40', a.status === 'not_applicable' && 'opacity-60')}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-sm font-medium text-slate-800"><span className="w-6 shrink-0 text-right text-xs text-slate-400 tabular-nums">{a.seq}.</span>{a.name}
                      {a.locked && <Lock className="size-3 text-slate-400" aria-label="automatic" />}{a.document_id && <Paperclip className="size-3 text-slate-400" aria-label="document" />}</div>
                    {(a.verification_remarks || a.na_reason || a.remarks) && <div className="ml-7.5 truncate text-xs text-slate-500">{(a.status === 'rejected' && a.verification_remarks) || (a.status === 'not_applicable' && a.na_reason?.replace(/^Auto: /, '')) || (a.remarks || '').replace(/^Auto: /, '')}</div>}
                  </div>
                  <div className="text-xs text-slate-600">{a.department}<div className="text-slate-400">{a.responsible_name}</div></div>
                  <div className={cx('text-xs', a.overdue ? 'font-semibold text-red-600' : 'text-slate-600')}>Plan {fmtDate(a.planned_date)}</div>
                  <div className="text-xs text-slate-600">{a.actual_completion_date ? `Done ${fmtDate(a.actual_completion_date)}` : ''}</div>
                  <div className="md:text-right"><ActivityStatus a={a} /></div>
                </li>
              ))}
            </ul>
          </Card>
        );
      })}
      {sel && <ActivityModal a={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); refresh(); }} />}
      {register && <RegisterModal candidateId={candidate.id} planned={reg?.planned_date} onClose={() => setRegister(false)} onDone={() => { setRegister(false); refresh(); }} />}
    </div>
  );
}

export function RegisterModal({ candidateId, planned, onClose, onDone }: { candidateId: number; planned?: string; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ joining_date: planned && planned <= uaeToday() ? planned : uaeToday(), file_no: '', remarks: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr({});
    try { const r = await api.post('/employees', { candidate_id: candidateId, ...f }); toast('success', `Registered as employee ${r.employee_no}.`); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="HR registration" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={submit}>Register employee</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">Creates the employee number in the Employee Master and completes activity 16.</p>
        {err._ && <Alert tone="error">{err._}</Alert>}
        <Field label="Joining date" required error={err.joining_date}><input type="date" className="input" value={f.joining_date} max={uaeToday()} onChange={(e) => setF({ ...f, joining_date: e.target.value })} /></Field>
        <Field label="Employee file no." error={err.file_no}><input className="input" value={f.file_no} onChange={(e) => setF({ ...f, file_no: e.target.value })} /></Field>
        <Field label="Remarks" error={err.remarks}><input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
