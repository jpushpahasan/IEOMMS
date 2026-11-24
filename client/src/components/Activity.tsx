import { useState } from 'react';
import { CheckCircle2, FileText, Lock, RotateCcw, Upload, XCircle } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app';
import { fmtDate, fmtDateTime, uaeToday } from '../lib/format';
import { Alert, Badge, Button, cx, Field, Modal, useToast } from './ui';

export function ActivityStatus({ a }: { a: { status: string; overdue?: boolean } }) {
  const { enumLabel, enumTone } = useApp();
  return (
    <span className="inline-flex items-center gap-1">
      <Badge tone={enumTone('activity_status', a.status)}>{enumLabel('activity_status', a.status)}</Badge>
      {a.overdue && <Badge tone="red">Overdue</Badge>}
    </span>
  );
}

export function SectionBar({ done, total, overdue }: { done: number; total: number; overdue?: number }) {
  const pct = total ? Math.round((done / total) * 100) : 0;
  return (
    <div className="min-w-16" title={`${done}/${total} completed${overdue ? `, ${overdue} overdue` : ''}`}>
      <div className="flex h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cx('h-full', pct === 100 ? 'bg-emerald-500' : overdue ? 'bg-red-500' : 'bg-brand-500')} style={{ width: `${pct}%` }} /></div>
      <div className={cx('mt-0.5 text-[10px] tabular-nums', overdue ? 'font-semibold text-red-600' : 'text-slate-500')}>{total ? `${done}/${total}` : 'n/a'}</div>
    </div>
  );
}

/** Work on one onboarding activity: progress, document, complete / submit, verify, not applicable, reopen. */
export function ActivityModal({ a, candidateName, onClose, onDone }: { a: any; candidateName?: string; onClose: () => void; onDone: () => void }) {
  const { can, options, user, enumLabel } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ status: a.status, remarks: a.remarks && !String(a.remarks).startsWith('Auto:') ? a.remarks : '', planned_date: a.planned_date || '',
    responsible_user_id: String(a.responsible_user_id), actual_completion_date: uaeToday(), reason: '', verification: '' });
  const [mode, setMode] = useState<'' | 'na' | 'reopen' | 'reject'>('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const verifier = can('onboarding.verify');
  const work = a.can_work ?? true;
  const open = !['completed', 'not_applicable', 'awaiting_approval'].includes(a.status);
  const manualEditable = work && open && !a.locked;
  const canVerify = verifier && a.status === 'awaiting_approval' && (a.submitted_by !== user?.id || can('approvals.self'));

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setBusy(true); setErr({});
    try { await fn(); toast('success', msg); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr({ ...(e.details || {}), _: e.message }); } finally { setBusy(false); }
  };
  const save = () => run(() => {
    const body: any = {};
    if (manualEditable && f.status !== a.status) body.status = f.status;
    if ((f.remarks || '') !== (a.remarks && !String(a.remarks).startsWith('Auto:') ? a.remarks : '')) body.remarks = f.remarks;
    if (verifier && f.planned_date !== (a.planned_date || '')) body.planned_date = f.planned_date;
    if (verifier && f.responsible_user_id !== String(a.responsible_user_id)) body.responsible_user_id = f.responsible_user_id;
    return api.put(`/onboarding/activities/${a.id}`, body);
  }, 'Activity updated.');
  const complete = () => run(() => api.post(`/onboarding/activities/${a.id}/complete`, { actual_completion_date: f.actual_completion_date, remarks: f.remarks || undefined }),
    a.requires_verification ? 'Submitted for verification.' : 'Activity completed.');
  const upload = (file: File) => run(() => { const fd = new FormData(); fd.append('file', file); return api.post(`/onboarding/activities/${a.id}/document`, fd); }, 'Document uploaded.');

  return (
    <Modal open onClose={onClose} size="lg" title={<span>{a.seq}. {a.name}</span>}
      footer={<div className="flex w-full flex-wrap items-center gap-2">
        {verifier && open && !a.locked && <Button variant="ghost" size="sm" onClick={() => setMode('na')}>Not applicable</Button>}
        {verifier && ['completed', 'not_applicable', 'awaiting_approval'].includes(a.status) && !(a.locked && a.status === 'completed') && <Button variant="ghost" size="sm" icon={<RotateCcw className="size-3.5" />} onClick={() => setMode('reopen')}>Reopen</Button>}
        <div className="flex-1" />
        <Button variant="secondary" onClick={onClose}>Close</Button>
        {(work || verifier) && <Button variant="secondary" loading={busy} onClick={save}>Save changes</Button>}
        {canVerify && <><Button variant="danger" onClick={() => setMode('reject')} icon={<XCircle className="size-4" />}>Reject</Button>
          <Button loading={busy} icon={<CheckCircle2 className="size-4" />} onClick={() => run(() => api.post(`/onboarding/activities/${a.id}/verify`, { decision: 'approve', remarks: f.verification || undefined }), 'Verified and completed.')}>Approve</Button></>}
        {manualEditable && <Button loading={busy} icon={<CheckCircle2 className="size-4" />} onClick={complete}>{a.requires_verification ? 'Submit for verification' : 'Mark completed'}</Button>}
      </div>}>
      <div className="space-y-4">
        {candidateName && <div className="text-sm text-slate-500">{candidateName}</div>}
        <div className="flex flex-wrap gap-2 text-xs">
          <ActivityStatus a={a} />
          <Badge>{a.department}</Badge>
          {a.is_mandatory ? <Badge tone="indigo">Mandatory</Badge> : <Badge>Optional</Badge>}
          {a.requires_document && <Badge tone="orange">Document: {enumLabel('document_category', a.document_category)}</Badge>}
          {a.requires_verification && <Badge tone="amber">Verification required</Badge>}
        </div>
        {a.locked && <Alert tone="info"><span className="inline-flex items-center gap-1"><Lock className="size-3.5" />{a.lock_reason}</span></Alert>}
        {a.status === 'rejected' && a.verification_remarks && <Alert tone="error">Rejected by {a.verified_by_name}: {a.verification_remarks}</Alert>}
        {a.na_reason && a.status === 'not_applicable' && <Alert tone="info">Not applicable: {a.na_reason.replace(/^Auto: /, '')}</Alert>}
        {a.remarks && String(a.remarks).startsWith('Auto:') && <p className="text-xs text-slate-500">{a.remarks.replace(/^Auto: /, 'System: ')}</p>}
        {err._ && <Alert tone="error">{err._}</Alert>}

        <dl className="grid grid-cols-2 gap-3 rounded-lg bg-slate-50 p-3 text-sm sm:grid-cols-4">
          <div><dt className="text-xs text-slate-500">Planned</dt><dd className={a.overdue ? 'font-semibold text-red-600' : ''}>{fmtDate(a.planned_date)}</dd></div>
          <div><dt className="text-xs text-slate-500">Completed</dt><dd>{fmtDate(a.actual_completion_date)}</dd></div>
          <div><dt className="text-xs text-slate-500">Responsible</dt><dd>{a.responsible_name}</dd></div>
          <div><dt className="text-xs text-slate-500">Completed by</dt><dd>{a.completed_by_name || '—'}</dd></div>
          {a.submitted_by_name && <div><dt className="text-xs text-slate-500">Submitted</dt><dd>{a.submitted_by_name}<div className="text-xs text-slate-500">{fmtDateTime(a.submitted_at)}</div></dd></div>}
          {a.verified_by_name && <div><dt className="text-xs text-slate-500">Verified</dt><dd>{a.verified_by_name}<div className="text-xs text-slate-500">{fmtDateTime(a.verified_at)}</div></dd></div>}
        </dl>

        <div className="grid gap-3 sm:grid-cols-2">
          {manualEditable && (
            <Field label="Progress status" error={err.status}>
              <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
                {['not_started', 'pending', 'in_progress', 'awaiting_documents', 'on_hold', ...(a.status === 'rejected' ? ['rejected'] : [])].map((s) => <option key={s} value={s}>{enumLabel('activity_status', s)}</option>)}
              </select>
            </Field>
          )}
          {manualEditable && <Field label="Actual completion date" error={err.actual_completion_date}><input type="date" className="input" value={f.actual_completion_date} max={uaeToday()} onChange={(e) => setF({ ...f, actual_completion_date: e.target.value })} /></Field>}
          {verifier && open && <Field label="Planned completion date" error={err.planned_date}><input type="date" className="input" value={f.planned_date} onChange={(e) => setF({ ...f, planned_date: e.target.value })} /></Field>}
          {verifier && open && (
            <Field label="Responsible employee" error={err.responsible_user_id}>
              <select className="input" value={f.responsible_user_id} onChange={(e) => setF({ ...f, responsible_user_id: e.target.value })}>
                {options?.users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
              </select>
            </Field>
          )}
          <Field label="Remarks" error={err.remarks} className="sm:col-span-2"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
          {canVerify && <Field label="Verification remarks" className="sm:col-span-2"><textarea rows={2} className="input" value={f.verification} onChange={(e) => setF({ ...f, verification: e.target.value })} /></Field>}
        </div>

        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed border-slate-300 p-3 text-sm">
          <FileText className="size-4 text-slate-400" />
          {a.document_id ? <a href={`/api/documents/${a.document_id}/file`} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">{a.document_name || 'Supporting document'} (v{a.document_version || 1})</a>
            : <span className="text-slate-500">No supporting document{a.requires_document ? ' — required' : ''}</span>}
          {work && (open || a.auto_completed) && can('onboarding.update') && (
            <label className="ml-auto inline-flex cursor-pointer items-center gap-1 rounded-lg bg-white px-3 py-1.5 text-xs font-medium text-slate-700 ring-1 ring-slate-300 hover:bg-slate-50">
              <Upload className="size-3.5" />Upload<input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            </label>
          )}
        </div>
      </div>
      {mode && (
        <Modal open onClose={() => setMode('')} size="sm" title={mode === 'na' ? 'Mark not applicable' : mode === 'reopen' ? 'Reopen activity' : 'Reject submission'}
          footer={<><Button variant="secondary" onClick={() => setMode('')}>Back</Button>
            <Button variant={mode === 'reject' ? 'danger' : 'primary'} loading={busy} onClick={() => run(() => mode === 'reject'
              ? api.post(`/onboarding/activities/${a.id}/verify`, { decision: 'reject', remarks: f.reason })
              : api.post(`/onboarding/activities/${a.id}/${mode === 'na' ? 'not-applicable' : 'reopen'}`, { reason: f.reason }), 'Saved.')}>Confirm</Button></>}>
          <Field label="Reason" required error={err.reason || err.remarks}><textarea rows={3} className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </Modal>
      )}
    </Modal>
  );
}
