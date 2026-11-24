import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AlertTriangle, ClipboardCheck, ListChecks, Search, Settings2, Users } from 'lucide-react';
import { api, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate } from '../../lib/format';
import { Button, Card, cx, Empty, PageHeader, Spinner, useToast } from '../../components/ui';
import { ActivityModal, ActivityStatus, SectionBar } from '../../components/Activity';
import { Avatar, StatusBadge } from '../Candidates';

type Tab = 'overview' | 'mine' | 'department' | 'verification' | 'performance';
const SECTIONS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SECTION_NAMES: Record<string, string> = { A: 'Pre-arrival', B: 'Arrival', C: 'Medical & visa', D: 'Training', E: 'Uniform & ID', F: 'Induction' };

export function Onboarding() {
  const { can } = useApp();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'overview';
  const tabs: [Tab, string, boolean][] = [
    ['overview', 'Onboarding overview', true], ['mine', 'My tasks', true], ['department', 'Department tasks', true],
    ['verification', 'Verification queue', can('onboarding.verify')], ['performance', 'Department performance', true],
  ];
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Onboarding activities" subtitle="The 48-step onboarding checklist for every employee, by department and responsible person."
        actions={can('onboarding.templates') && <Link to="/onboarding/setup" className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"><Settings2 className="size-4" />Templates & catalogue</Link>} />
      <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 sm:inline-flex">
        {tabs.filter((t) => t[2]).map(([k, l]) => <button key={k} onClick={() => setSp({ tab: k }, { replace: true })} className={cx('rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
      </div>
      {tab === 'overview' && <Overview />}
      {(tab === 'mine' || tab === 'department') && <Tasks key={tab} scope={tab} />}
      {tab === 'verification' && <Tasks key="v" scope="verification" />}
      {tab === 'performance' && <Performance />}
    </div>
  );
}

function Overview() {
  const { options, can } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState({ q: '', project_id: '', status: '' });
  const [d, setD] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => { setD(null); api.get(`/onboarding/overview${qs(f)}`).then(setD); }, [f]);
  useEffect(load, [load]);
  const generate = async () => { setBusy(true); try { const r = await api.post('/onboarding/generate-missing'); toast('success', `${r.generated} checklist(s) generated.`); load(); } finally { setBusy(false); } };
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Search employee…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
        <select className="input w-auto" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })} aria-label="Project"><option value="">All projects</option>{options?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
        <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">All active stages</option>
          {options?.enums.candidate_status.filter((s) => s.value !== 'cancelled').map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        {d?.missing > 0 && can('onboarding.verify') && <Button variant="subtle" loading={busy} onClick={generate}>Generate {d.missing} missing checklist{d.missing > 1 ? 's' : ''}</Button>}
      </div>
      {!d ? <Spinner /> : d.rows.length === 0 ? <Empty icon={<ListChecks className="size-6" />} title="No employees in onboarding" /> : (
        <div className="scroll-thin overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/80"><tr>
              <th className="th pl-4">Employee</th><th className="th">Stage</th>
              {SECTIONS.map((s) => <th key={s} className="th" title={SECTION_NAMES[s]}>{s}. {SECTION_NAMES[s]}</th>)}
              <th className="th">Overall</th><th className="th">Next activity</th>
            </tr></thead>
            <tbody className="divide-y divide-slate-100">
              {d.rows.map((r: any) => {
                const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
                return (
                  <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => nav(`/candidates/${r.id}?tab=checklist`)}>
                    <td className="td pl-4"><div className="flex items-center gap-2.5"><Avatar name={r.full_name} photoId={r.photo_document_id} size="sm" />
                      <div><div className="font-medium text-slate-800">{r.full_name}</div><div className="text-xs text-slate-500">{r.reference_no} · {r.trade}</div></div></div></td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                    {SECTIONS.map((s) => <td key={s} className="td">{r.sections?.[s] ? <SectionBar done={r.sections[s].done} total={r.sections[s].total} overdue={r.sections[s].overdue} /> : '—'}</td>)}
                    <td className="td"><div className="text-sm font-semibold tabular-nums">{pct}%</div>{r.overdue > 0 && <div className="text-xs font-semibold text-red-600">{r.overdue} overdue</div>}</td>
                    <td className="td max-w-64 truncate text-xs text-slate-600">{r.next_activity || (r.total ? 'All done' : 'No checklist')}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

function Tasks({ scope }: { scope: 'mine' | 'department' | 'verification' }) {
  const { options, user, can } = useApp();
  const [f, setF] = useState({ status: scope === 'verification' ? 'awaiting_approval' : 'open', q: '', section: '', department_id: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  const load = useCallback(() => { setRows(null); api.get(`/onboarding/tasks${qs({ scope, ...f })}`).then(setRows); }, [scope, f]);
  useEffect(load, [load]);
  const deptName = options?.departments.find((d) => d.id === user?.department_id)?.label;
  return (
    <Card bodyClass="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
        {scope === 'department' && (can('onboarding.verify') || can('dashboard.view')) ? (
          <select className="input w-auto" value={f.department_id} onChange={(e) => setF({ ...f, department_id: e.target.value })} aria-label="Department">
            <option value="">{deptName ? `My department (${deptName})` : 'My department'}</option>{options?.departments.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
          </select>
        ) : scope === 'department' ? <span className="text-sm font-medium text-slate-700">{deptName || 'No department on your account'}</span> : null}
        {scope !== 'verification' && <div className="inline-flex rounded-lg border border-slate-200 p-0.5">
          {[['open', 'Open'], ['overdue', 'Overdue'], ['due_week', 'Due in 7 days'], ['awaiting_approval', 'Awaiting approval'], ['completed', 'Completed'], ['all', 'All']].map(([v, l]) => (
            <button key={v} onClick={() => setF({ ...f, status: v })} className={cx('rounded-md px-2.5 py-1 text-xs font-medium', f.status === v ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>
          ))}
        </div>}
        <select className="input w-auto" value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} aria-label="Section"><option value="">All sections</option>{options?.enums.section.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        <div className="relative min-w-48 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Employee or activity…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
      </div>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<ClipboardCheck className="size-6" />} title={scope === 'verification' ? 'Nothing waiting for verification' : 'No tasks match'} /> : (
        <div className="scroll-thin overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/80"><tr><th className="th pl-4">Activity</th><th className="th">Employee</th><th className="th">Department / responsible</th><th className="th">Planned</th><th className="th">Status</th><th className="th">Remarks</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.id} className={cx('cursor-pointer hover:bg-brand-50/40', a.overdue && 'bg-red-50/40')} onClick={() => setSel(a)}>
                  <td className="td pl-4"><div className="font-medium text-slate-800">{a.seq}. {a.name}</div><div className="text-xs text-slate-500">Section {a.section}{a.locked ? ' · automatic' : ''}{a.requires_document ? ' · document required' : ''}</div></td>
                  <td className="td"><Link to={`/candidates/${a.candidate_id}?tab=checklist`} onClick={(e) => e.stopPropagation()} className="font-medium text-slate-800 hover:text-brand-700">{a.full_name}</Link><div className="text-xs text-slate-500">{a.reference_no} · {a.project}</div></td>
                  <td className="td">{a.department}<div className="text-xs text-slate-500">{a.responsible_name}</div></td>
                  <td className={cx('td', a.overdue && 'font-semibold text-red-600')}>{fmtDate(a.planned_date)}</td>
                  <td className="td"><ActivityStatus a={a} /></td>
                  <td className="td max-w-56 truncate text-xs text-slate-500">{a.verification_remarks || (a.remarks || '').replace(/^Auto: /, '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && <ActivityModal a={sel} candidateName={`${sel.full_name} · ${sel.reference_no}`} onClose={() => setSel(null)} onDone={() => { setSel(null); load(); }} />}
    </Card>
  );
}

function Performance() {
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/onboarding/performance').then(setD); }, []);
  if (!d) return <Spinner />;
  return (
    <div className="space-y-5">
      <Card title="Departments" bodyClass="p-0">
        <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr><th className="th pl-4">Department</th><th className="th">Manager</th><th className="th">Completion</th><th className="th text-right">Open</th><th className="th text-right">Overdue</th><th className="th text-right">Awaiting approval</th><th className="th text-right">On time</th><th className="th text-right">Avg. days late</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.departments.map((r: any) => {
            const pct = r.total ? Math.round((r.completed / r.total) * 100) : 0;
            return (
              <tr key={r.id}><td className="td pl-4 font-medium">{r.name}</td><td className="td">{r.manager || '—'}</td>
                <td className="td"><div className="flex items-center gap-2"><div className="h-2 w-28 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${pct}%` }} /></div><span className="text-xs tabular-nums">{pct}% ({r.completed}/{r.total})</span></div></td>
                <td className="td text-right tabular-nums">{r.open}</td><td className={cx('td text-right tabular-nums', r.overdue > 0 && 'font-semibold text-red-600')}>{r.overdue}</td>
                <td className="td text-right tabular-nums">{r.awaiting_approval}</td><td className="td text-right tabular-nums">{r.completed ? `${Math.round((r.on_time / r.completed) * 100)}%` : '—'}</td>
                <td className="td text-right tabular-nums">{r.avg_days_late ?? '—'}</td></tr>
            );
          })}</tbody></table></div>
      </Card>
      <Card title={<span className="flex items-center gap-2"><Users className="size-4" />Responsible people</span>} bodyClass="p-0">
        {d.people.length === 0 ? <Empty title="No assignments" /> : <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr><th className="th pl-4">Name</th><th className="th">Department</th><th className="th text-right">Open</th><th className="th text-right">Overdue</th><th className="th text-right">Completed</th><th className="th text-right">On time</th></tr></thead>
          <tbody className="divide-y divide-slate-100">{d.people.map((p: any) => (
            <tr key={`${p.id}-${p.department}`}><td className="td pl-4 font-medium">{p.full_name}</td><td className="td">{p.department}</td><td className="td text-right">{p.open}</td>
              <td className={cx('td text-right', p.overdue > 0 && 'font-semibold text-red-600')}>{p.overdue > 0 && <AlertTriangle className="mr-1 inline size-3.5" />}{p.overdue}</td>
              <td className="td text-right">{p.completed}</td><td className="td text-right">{p.completed ? `${Math.round((p.on_time / p.completed) * 100)}%` : '—'}</td></tr>
          ))}</tbody></table></div>}
      </Card>
    </div>
  );
}
