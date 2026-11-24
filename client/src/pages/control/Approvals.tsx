import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Check, Inbox, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtDateTime, fmtMoney } from '../../lib/format';
import { Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';

export function Approvals() {
  const { enumLabel } = useApp();
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [tab, setTab] = useState<'inbox' | 'history'>('inbox');
  const [hist, setHist] = useState<any[] | null>(null);
  const [decide, setDecide] = useState<{ url: string; title: string; reject: boolean; verify?: boolean } | null>(null);
  const load = useCallback(() => { api.get('/approvals/inbox').then(setD); }, []);
  useEffect(load, [load]);
  useEffect(() => { if (tab === 'history' && !hist) api.get('/approvals/history').then(setHist).catch(() => setHist([])); }, [tab, hist]);
  if (!d) return <Spinner />;
  const Section = ({ title, n, children }: { title: string; n: number; children: ReactNode }) => n === 0 ? null : (
    <Card title={<span className="flex items-center gap-2">{title}<Badge tone="amber">{n}</Badge></span>} bodyClass="p-0"><ul className="divide-y divide-slate-100">{children}</ul></Card>
  );
  const Row = ({ who, what, when, by, actions }: { who: ReactNode; what: ReactNode; when?: string; by?: string; actions: ReactNode }) => (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <div className="min-w-0 flex-1"><div className="text-sm font-medium text-slate-800">{what}</div><div className="text-xs text-slate-500">{who}{by ? ` · requested by ${by}` : ''}{when ? ` · ${fmtDateTime(when)}` : ''}</div></div>
      <div className="flex gap-1.5">{actions}</div>
    </li>
  );
  const btns = (url: string, title: string, verify = false) => <>
    <Button size="sm" variant="ghost" className="text-red-600" icon={<X className="size-3.5" />} onClick={() => setDecide({ url, title, reject: true, verify })}>Reject</Button>
    <Button size="sm" icon={<Check className="size-3.5" />} onClick={() => setDecide({ url, title, reject: false, verify })}>{verify ? 'Verify' : 'Approve'}</Button></>;
  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader title="Approvals" subtitle="Everything waiting for your decision. Requests you submitted yourself are routed to another approver." />
      <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {([['inbox', `Waiting for me (${d.total})`], ['history', 'Decision history']] as const).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
      </div>
      {tab === 'inbox' && (d.total === 0 ? <Card><Empty icon={<Inbox className="size-6" />} title="Nothing waiting for your approval" /></Card> : <>
        <Section title="Final clearance" n={d.clearances.length}>{d.clearances.map((c: any) => (
          <Row key={c.candidate_id} who={`${c.reference_no} · ${c.project}`} what={`${c.full_name} — all mandatory onboarding completed`} when={c.requested_at}
            actions={<Link to={`/candidates/${c.candidate_id}?tab=clearance`} className="rounded-lg bg-navy-900 px-3 py-1.5 text-xs font-medium text-white">Review checklist</Link>} />))}</Section>
        <Section title="Deployment requests" n={d.deployments.length}>{d.deployments.map((x: any) => (
          <Row key={x.id} who={`${x.reference_no} · supervisor ${x.supervisor_name}`} what={`${x.full_name} → ${x.site} (reporting ${fmtDate(x.planned_reporting_date)})`} by={x.requested_by_name} when={x.requested_at}
            actions={btns(`/deployments/${x.id}/decide`, `Deployment of ${x.full_name}`)} />))}</Section>
        <Section title="Flight quotations" n={d.flights.length}>{d.flights.map((x: any) => (
          <Row key={x.id} who={`${x.reference_no} · ${x.agency || ''}`} what={`${x.booking_no} — ${x.full_name}, ${fmtMoney(x.fare)}`} by={x.requested_by_name} when={x.requested_at}
            actions={<><Link to={`/bookings/${x.id}`} className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">Compare quotes</Link>{btns(`/bookings/${x.id}/decide`, `Flight ${x.booking_no}`)}</>} />))}</Section>
        <Section title="Onboarding activity verification" n={d.activities.length}>{d.activities.map((x: any) => (
          <Row key={x.id} who={`${x.reference_no} · ${x.department} · completed ${fmtDate(x.actual_completion_date)}`} what={`${x.seq}. ${x.name} — ${x.full_name}`} by={x.requested_by_name} when={x.requested_at}
            actions={<><Link to={`/candidates/${x.candidate_id}?tab=checklist`} className="rounded-lg px-3 py-1.5 text-xs font-medium text-brand-700 hover:bg-brand-50">Open</Link>{btns(`/onboarding/activities/${x.id}/verify`, `${x.seq}. ${x.name}`)}</>} />))}</Section>
        <Section title="Expense verification" n={d.expenses.length}>{d.expenses.map((x: any) => (
          <Row key={x.id} who={`${x.reference_no} · ${x.supplier || 'no supplier'} · invoice ${x.invoice_no || '—'}`} what={`${enumLabel('expense_category', x.category)} — ${x.full_name}, ${fmtMoney(x.actual_cost)}`} by={x.requested_by_name} when={x.requested_at}
            actions={btns(`/finance/expenses/${x.id}/verify`, `${enumLabel('expense_category', x.category)} for ${x.full_name}`, true)} />))}</Section>
      </>)}
      {tab === 'history' && (!hist ? <Spinner /> : <Card bodyClass="p-0">{hist.length === 0 ? <Empty title="No decisions recorded" /> : (
        <table className="min-w-full divide-y divide-slate-100"><thead className="bg-slate-50/80"><tr><th className="th pl-4">When</th><th className="th">Type</th><th className="th">Employee</th><th className="th">Requested by</th><th className="th">Decided by</th><th className="th">Decision</th><th className="th">Remarks</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{hist.map((h) => (
            <tr key={h.id}><td className="td pl-4 text-xs">{fmtDateTime(h.decided_at)}</td><td className="td text-xs capitalize">{h.approval_type.replaceAll('_', ' ')}</td><td className="td">{h.full_name || '—'}</td>
              <td className="td">{h.requested_by_name || '—'}</td><td className="td">{h.decided_by_name}</td><td className="td"><Badge tone={h.decision === 'approved' ? 'green' : 'red'}>{h.decision}</Badge></td>
              <td className="td max-w-64 truncate text-xs">{h.remarks || ''}</td></tr>))}</tbody></table>)}</Card>)}
      {decide && <DecideModal {...decide} onClose={() => setDecide(null)} onDone={() => { setDecide(null); setHist(null); toast('success', 'Decision recorded.'); load(); }} />}
    </div>
  );
}

export function DecideModal({ url, title, reject, verify, onClose, onDone }: { url: string; title: string; reject: boolean; verify?: boolean; onClose: () => void; onDone: () => void }) {
  const [remarks, setRemarks] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true); setErr('');
    try { await api.post(url, { decision: reject ? 'reject' : verify ? 'verify' : 'approve', remarks }); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details?.remarks || e.message); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} size="sm" title={`${reject ? 'Reject' : verify ? 'Verify' : 'Approve'} — ${title}`}
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant={reject ? 'danger' : 'primary'} loading={busy} onClick={go}>{reject ? 'Reject' : verify ? 'Verify' : 'Approve'}</Button></>}>
      <Field label={reject ? 'Reason' : 'Remarks (optional)'} required={reject} error={err}><textarea rows={3} className="input" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
    </Modal>
  );
}
