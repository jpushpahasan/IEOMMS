import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Download, Search, UserPlus, UsersRound } from 'lucide-react';
import { api, download, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { daysUntil, fmtDate, fmtDateTime } from '../../lib/format';
import { Badge, Button, Card, cx, Empty, PageHeader, Spinner } from '../../components/ui';
import { Avatar, StatusBadge } from '../Candidates';
import { RegisterModal } from './Checklist';

export function Employees() {
  const { can, options, enumLabel, enumTone } = useApp();
  const nav = useNavigate();
  const [f, setF] = useState({ q: '', project_id: '', status: '' });
  const [d, setD] = useState<any>(null);
  const [reg, setReg] = useState<any>(null);
  const load = useCallback(() => { setD(null); api.get(`/employees${qs(f)}`).then(setD); }, [f]);
  useEffect(load, [load]);
  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader title="Employee master" subtitle="Employees registered by HR after arrival, with visa, Emirates ID, accommodation and onboarding progress."
        actions={<Button variant="secondary" icon={<Download className="size-4" />} onClick={() => download(`/employees${qs({ ...f, export: 'xlsx' })}`)}>Export</Button>} />
      {d?.pending.length > 0 && can('employees.manage') && (
        <Card title={<span className="flex items-center gap-2"><UserPlus className="size-4 text-amber-600" />Awaiting HR registration ({d.pending.length})</span>} bodyClass="p-0">
          <ul className="divide-y divide-slate-100">{d.pending.map((p: any) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-2.5"><div className="min-w-0 flex-1"><Link to={`/candidates/${p.id}?tab=checklist`} className="font-medium text-slate-800 hover:text-brand-700">{p.full_name}</Link>
              <div className="text-xs text-slate-500">{p.reference_no} · {p.position} · {p.project} · arrived {fmtDateTime(p.arrived_at)}</div></div>
              <StatusBadge status={p.status} /><Button size="sm" onClick={() => setReg(p)}>Register</Button></li>
          ))}</ul>
        </Card>
      )}
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          <div className="relative min-w-56 flex-1"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" /><input className="input pl-9" placeholder="Name, employee no., Emirates ID…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></div>
          <select className="input w-auto" value={f.project_id} onChange={(e) => setF({ ...f, project_id: e.target.value })} aria-label="Project"><option value="">All projects</option>{options?.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}</select>
          <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status"><option value="">All stages</option>{options?.enums.candidate_status.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        </div>
        {!d ? <Spinner /> : d.rows.length === 0 ? <Empty icon={<UsersRound className="size-6" />} title="No employees registered yet">Employees appear here after HR registration (onboarding activity 16).</Empty> : (
          <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/80"><tr><th className="th pl-4">Employee</th><th className="th">Position / project</th><th className="th">Joined</th><th className="th">Residence visa</th><th className="th">Emirates ID</th><th className="th">Accommodation</th><th className="th">Onboarding</th><th className="th">Stage</th></tr></thead>
            <tbody className="divide-y divide-slate-100">{d.rows.map((r: any) => {
              const vd = daysUntil(r.residence_expiry_date);
              return (
                <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => nav(`/candidates/${r.candidate_id}`)}>
                  <td className="td pl-4"><div className="flex items-center gap-2.5"><Avatar name={r.full_name} photoId={r.photo_document_id} size="sm" /><div><div className="font-medium text-slate-800">{r.full_name}</div><div className="font-mono text-xs text-slate-500">{r.employee_no}</div></div></div></td>
                  <td className="td">{r.position}<div className="text-xs text-slate-500">{r.project}</div></td>
                  <td className="td">{fmtDate(r.joining_date)}</td>
                  <td className="td"><Badge tone={enumTone('residence_status', r.residence_status || 'not_started')}>{enumLabel('residence_status', r.residence_status || 'not_started')}</Badge>
                    {r.residence_expiry_date && <div className={cx('text-xs', vd !== null && vd < 60 ? 'font-semibold text-red-600' : 'text-slate-500')}>exp. {fmtDate(r.residence_expiry_date)}</div>}</td>
                  <td className="td font-mono text-xs">{r.eid_number || '—'}</td>
                  <td className="td max-w-52 truncate text-xs">{r.accommodation || '—'}</td>
                  <td className="td"><div className="flex items-center gap-2"><div className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-brand-500" style={{ width: `${r.onboarding_pct || 0}%` }} /></div><span className="text-xs tabular-nums">{r.onboarding_pct ?? 0}%</span></div></td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                </tr>
              );
            })}</tbody></table></div>
        )}
      </Card>
      {reg && <RegisterModal candidateId={reg.id} onClose={() => setReg(null)} onDone={() => { setReg(null); load(); }} />}
    </div>
  );
}
