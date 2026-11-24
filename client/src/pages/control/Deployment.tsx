import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { BadgeCheck, CheckCircle2, CircleAlert, CircleDashed, HardHat, Rocket, ShieldCheck, XCircle } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtDateTime, uaeToday } from '../../lib/format';
import { Alert, Badge, Button, Card, Empty, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';
import { Avatar, StatusBadge } from '../Candidates';
import { DecideModal } from './Approvals';

const GROUPS: [string, string][] = [['awaiting_clearance', 'Awaiting final clearance'], ['ready_for_deployment', 'Ready for deployment'], ['deployed', 'Deployed'], ['onboarding', 'Still onboarding']];

export function Deployment() {
  const { can, enumLabel, enumTone } = useApp();
  const [rows, setRows] = useState<any[] | null>(null);
  const [panel, setPanel] = useState<any>(null);
  const [request, setRequest] = useState<any>(null);
  const [confirm, setConfirm] = useState<any>(null);
  const [decide, setDecide] = useState<any>(null);
  const load = useCallback(() => { api.get('/clearance').then(setRows); }, []);
  useEffect(load, [load]);
  if (!rows) return <Spinner />;
  return (
    <div className="mx-auto max-w-[1400px] space-y-5">
      <PageHeader title="Clearance & deployment" subtitle="HR approves final clearance against the ten mandatory checks; Operations requests deployment, an approver signs it off, and Operations confirms the actual reporting to work." />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {GROUPS.map(([k, l]) => <div key={k} className="card p-4"><div className="text-xs text-slate-500">{l}</div><div className="text-2xl font-semibold tabular-nums">{rows.filter((r) => r.status === k).length}</div></div>)}
      </div>
      {GROUPS.map(([k, l]) => {
        const list = rows.filter((r) => r.status === k);
        if (!list.length) return null;
        return (
          <Card key={k} title={l} bodyClass="p-0">
            <ul className="divide-y divide-slate-100">{list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Avatar name={r.full_name} photoId={r.photo_document_id} size="sm" />
                <div className="min-w-48 flex-1"><Link to={`/candidates/${r.id}?tab=clearance`} className="font-medium text-slate-800 hover:text-brand-700">{r.full_name}</Link>
                  <div className="text-xs text-slate-500">{r.employee_no || r.reference_no} · {r.position} · {r.project}{r.cleared_on ? ` · cleared ${fmtDate(r.cleared_on)}` : ''}</div></div>
                {k === 'onboarding' && <div className="flex items-center gap-2"><div className="h-1.5 w-24 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${r.pct || 0}%` }} /></div><span className="text-xs">{r.pct || 0}%</span></div>}
                {r.deployment_status && <div className="text-xs"><Badge tone={enumTone('deployment_status', r.deployment_status)}>{enumLabel('deployment_status', r.deployment_status)}</Badge>
                  <div className="mt-0.5 text-slate-500">{r.site} · {r.supervisor_name} · {r.actual_reporting_date ? `reported ${fmtDate(r.actual_reporting_date)}` : `planned ${fmtDate(r.planned_reporting_date)}`}</div></div>}
                <div className="flex gap-1.5">
                  {k === 'awaiting_clearance' && can('clearance.approve') && <Button size="sm" icon={<ShieldCheck className="size-3.5" />} onClick={() => setPanel(r)}>Review clearance</Button>}
                  {k === 'ready_for_deployment' && can('deployment.manage') && !['requested', 'approved'].includes(r.deployment_status) && <Button size="sm" icon={<HardHat className="size-3.5" />} onClick={() => setRequest(r)}>Request deployment</Button>}
                  {r.deployment_status === 'requested' && can('clearance.approve') && <Button size="sm" onClick={() => setDecide({ url: `/deployments/${r.deployment_id}/decide`, title: `Deployment of ${r.full_name}`, reject: false })}>Approve</Button>}
                  {r.deployment_status === 'approved' && can('deployment.manage') && <Button size="sm" icon={<Rocket className="size-3.5" />} onClick={() => setConfirm(r)}>Confirm reporting</Button>}
                  {k !== 'deployed' && <Button size="sm" variant="ghost" onClick={() => setPanel(r)}>Checks</Button>}
                </div>
              </li>
            ))}</ul>
          </Card>
        );
      })}
      {rows.length === 0 && <Card><Empty icon={<Rocket className="size-6" />} title="No employees in onboarding yet" /></Card>}
      {panel && <Modal open onClose={() => setPanel(null)} size="lg" title={`Final clearance — ${panel.full_name}`}><ClearancePanel candidateId={panel.id} onChange={() => { setPanel(null); load(); }} /></Modal>}
      {request && <RequestModal r={request} onClose={() => setRequest(null)} onDone={() => { setRequest(null); load(); }} />}
      {confirm && <ConfirmModal r={confirm} onClose={() => setConfirm(null)} onDone={() => { setConfirm(null); load(); }} />}
      {decide && <DecideModal {...decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); load(); }} />}
    </div>
  );
}

/** Ten-point clearance checklist with approve / reject, plus deployment history. Used on the page and in the candidate profile. */
export function ClearancePanel({ candidateId, onChange }: { candidateId: number; onChange?: () => void }) {
  const { can, enumLabel, enumTone } = useApp();
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [decide, setDecide] = useState<boolean | null>(null);
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(() => { api.get(`/clearance/${candidateId}`).then(setD); }, [candidateId]);
  useEffect(load, [load]);
  if (!d) return <Spinner />;
  const submit = async (approve: boolean) => {
    setErr('');
    try { await api.post(`/clearance/${candidateId}/decide`, { decision: approve ? 'approve' : 'reject', remarks }); toast('success', approve ? 'Final clearance approved. Operations has been notified.' : 'Clearance refused.'); setDecide(null); load(); onChange?.(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details?.remarks || e.message); }
  };
  const awaiting = d.candidate.status === 'awaiting_clearance';
  return (
    <div className="space-y-4">
      {!d.hasChecklist && <Alert tone="warning">No onboarding checklist exists for this employee.</Alert>}
      <div className="flex items-center justify-between">
        <div className="text-sm text-slate-600">Status: <StatusBadge status={d.candidate.status} /></div>
        {d.ready ? <Badge tone="green"><BadgeCheck className="size-3.5" />All checks passed</Badge> : <Badge tone="amber">{d.checks.filter((c: any) => !c.ok).length} check(s) open</Badge>}
      </div>
      <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
        {d.checks.map((c: any) => (
          <li key={c.key} className="flex gap-3 px-4 py-2.5">
            {!c.applicable ? <CircleDashed className="mt-0.5 size-4.5 shrink-0 text-slate-300" /> : c.ok ? <CheckCircle2 className="mt-0.5 size-4.5 shrink-0 text-emerald-500" /> : <CircleAlert className="mt-0.5 size-4.5 shrink-0 text-amber-500" />}
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium text-slate-800">{c.label}</div>
              <div className="text-xs text-slate-500">{!c.applicable ? 'Not applicable' : `${c.completed}/${c.total} completed`}</div>
              {c.open.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-amber-800">{c.open.map((a: any) => <li key={a.id}>{a.seq}. {a.name} — {enumLabel('activity_status', a.status)}</li>)}</ul>}
            </div>
          </li>
        ))}
      </ul>
      {awaiting && can('clearance.approve') && (
        decide === null ? <div className="flex justify-end gap-2"><Button variant="secondary" icon={<XCircle className="size-4" />} onClick={() => setDecide(false)}>Refuse</Button>
          <Button disabled={!d.ready} icon={<ShieldCheck className="size-4" />} onClick={() => setDecide(true)}>Approve final clearance</Button></div>
          : <div className="space-y-2 rounded-lg bg-slate-50 p-3">
            <Field label={decide ? 'Remarks (optional)' : 'Reason for refusing'} required={!decide} error={err}><textarea rows={2} className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
            <div className="flex justify-end gap-2"><Button variant="secondary" onClick={() => setDecide(null)}>Back</Button><Button variant={decide ? 'primary' : 'danger'} onClick={() => submit(decide)}>{decide ? 'Approve — Ready for Deployment' : 'Refuse clearance'}</Button></div>
          </div>
      )}
      {!awaiting && !['ready_for_deployment', 'deployed'].includes(d.candidate.status) && <p className="text-xs text-slate-500">Clearance can be approved once the employee reaches <b>Awaiting Final Clearance</b> (all mandatory activities completed).</p>}
      {(d.deployments.length > 0 || d.history.length > 0) && (
        <div className="space-y-2">
          <h4 className="text-xs font-semibold tracking-wider text-slate-500 uppercase">Deployment & decisions</h4>
          {d.deployments.map((x: any) => (
            <div key={x.id} className="rounded-lg border border-slate-200 p-3 text-sm">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.site}</span><Badge tone={enumTone('deployment_status', x.status)}>{enumLabel('deployment_status', x.status)}</Badge></div>
              <div className="text-xs text-slate-500">Supervisor {x.supervisor_name} {x.supervisor_phone || ''} · planned {fmtDate(x.planned_reporting_date)} · requested by {x.requested_by_name}
                {x.approved_by_name ? ` · ${x.status === 'rejected' ? 'rejected' : 'approved'} by ${x.approved_by_name}` : ''}{x.actual_reporting_date ? ` · reported ${fmtDate(x.actual_reporting_date)} (confirmed by ${x.confirmed_by_name})` : ''}</div>
              {x.decision_remarks && <div className="text-xs text-slate-600">“{x.decision_remarks}”</div>}
            </div>
          ))}
          <ul className="text-xs text-slate-600">{d.history.map((h: any) => <li key={h.id}>{fmtDateTime(h.decided_at)} — {h.approval_type.replace('_', ' ')} {h.decision} by {h.decided_by_name}{h.remarks ? `: ${h.remarks}` : ''}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function RequestModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ site: r.work_location || r.project || '', supervisor_name: '', supervisor_phone: '', planned_reporting_date: uaeToday(), remarks: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = async () => {
    try { await api.post('/deployments', { candidate_id: r.id, ...f }); toast('success', 'Deployment requested; waiting for approval.'); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); }
  };
  return (
    <Modal open onClose={onClose} title={`Request deployment — ${r.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={submit}>Request deployment</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Site / work location" required error={err.site} className="sm:col-span-2"><input className="input" value={f.site} onChange={(e) => setF({ ...f, site: e.target.value })} /></Field>
        <Field label="Site supervisor" required error={err.supervisor_name}><input className="input" value={f.supervisor_name} onChange={(e) => setF({ ...f, supervisor_name: e.target.value })} /></Field>
        <Field label="Supervisor contact" error={err.supervisor_phone}><input className="input" value={f.supervisor_phone} onChange={(e) => setF({ ...f, supervisor_phone: e.target.value })} /></Field>
        <Field label="Planned reporting date" required error={err.planned_reporting_date}><input type="date" className="input" value={f.planned_reporting_date} onChange={(e) => setF({ ...f, planned_reporting_date: e.target.value })} /></Field>
        <Field label="Remarks" className="sm:col-span-2"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function ConfirmModal({ r, onClose, onDone }: { r: any; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ actual_reporting_date: uaeToday(), remarks: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const submit = async () => {
    try { await api.post(`/deployments/${r.deployment_id}/confirm`, f); toast('success', `${r.full_name} is now Deployed.`); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`Confirm reporting to work — ${r.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button onClick={submit}>Confirm — mark Deployed</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{r.site} · supervisor {r.supervisor_name}</p>
        {err._ && <Alert tone="error">{err._}</Alert>}
        <Field label="Actual reporting date" required error={err.actual_reporting_date}><input type="date" className="input" max={uaeToday()} value={f.actual_reporting_date} onChange={(e) => setF({ ...f, actual_reporting_date: e.target.value })} /></Field>
        <Field label="Remarks"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

