import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { AlertTriangle, Ban, BedDouble, CalendarClock, Gauge, ListChecks, Wallet, FileSignature, PauseCircle, Plane, PlaneLanding, PlaneTakeoff, UserCheck, Users } from 'lucide-react';
import { api, qs } from '../lib/api';
import { useApp } from '../lib/app';
import { fmtDate, fmtMoney } from '../lib/format';
import { Card, cx, Empty, PageHeader, Spinner, Stat, TONE_HEX } from '../components/ui';
import { StatusBadge } from './Candidates';

const BAR = '#17385f';

function HBar({ data, onClick }: { data: { name: string; n: number }[]; onClick?: (name: string) => void }) {
  if (!data.length) return <Empty title="No data yet" />;
  return (
    <ResponsiveContainer width="100%" height={Math.max(160, data.length * 30)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid horizontal={false} stroke="#f1f5f9" />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 12, fill: '#334155' }} axisLine={false} tickLine={false} />
        <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v) => [v, 'Candidates']} />
        <Bar dataKey="n" fill={BAR} radius={[0, 4, 4, 0]} barSize={16} onClick={(d: any) => onClick?.(d.name)} className={onClick ? 'cursor-pointer' : ''} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** The 14 questions management asks every morning, answered from live data, each linking to the detail. */
function CeoQuestions({ d }: { d: any }) {
  const { can } = useApp();
  const c = d.counts, m = d.mobility, a = d.accommodation, o = d.onboarding, fz = d.finance;
  const q: [string, string | number | null, string][] = [
    ['Candidates selected (active)', d.active, '/candidates'],
    ['Expected to arrive (ticket confirmed)', c.travel_confirmed, '/candidates?status=travel_confirmed'],
    ['Confirmed flight tickets awaiting travel', m ? c.travel_confirmed : null, '/bookings?status=ticket_issued'],
    ['Arriving today / tomorrow', m ? `${m.today} / ${m.tomorrow}` : null, '/pickups'],
    ['Awaiting airport pickup', m ? m.pickups_open : null, '/pickups'],
    ['Allocated accommodation', a ? a.occupied + a.reserved : null, '/accommodation'],
    ['Awaiting medical examinations', o ? o.awaiting_medical : null, '/medical?filter=awaiting_visa'],
    ['Visa processing pending', o ? o.awaiting_visa : null, '/visa'],
    ['Mandatory training not completed', o ? o.awaiting_training : null, '/training'],
    ['Uniform / PPE not received', o ? o.awaiting_uniform : null, '/uniform'],
    ['Onboarding activities delayed', o ? o.overdue : null, '/reports?r=overdue_activities'],
    ['Average mobilisation spend per employee', fz ? fmtMoney(fz.average) : null, '/reports?r=mobilisation_cost'],
    ['Ready for deployment', c.ready_for_deployment, '/deployment'],
    ['Actually deployed', c.deployed, '/deployment'],
  ];
  return (
    <Card title={<span className="flex items-center gap-2"><Gauge className="size-4 text-brand-600" />At a glance</span>}
      actions={can('reports.view') && <Link to="/reports" className="text-xs font-medium text-brand-700 hover:underline">All reports</Link>} bodyClass="p-0">
      <ul className="grid divide-y divide-slate-100 sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-7">
        {q.filter(([, v]) => v !== null && v !== undefined).map(([label, v, to]) => (
          <li key={label} className="border-slate-100 sm:border-b sm:odd:border-r xl:border-r">
            <Link to={to} className="flex h-full flex-col justify-between gap-1 px-4 py-3 hover:bg-brand-50/40">
              <span className="text-[11px] leading-tight text-slate-500">{label}</span>
              <span className="text-lg font-semibold text-slate-900 tabular-nums">{v}</span>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FinanceRow({ fz }: { fz: any }) {
  const nav = useNavigate();
  const variance = Number(fz.variance); // invoiced lines only
  const max = Math.max(1, ...fz.byProject.map((p: any) => Number(p.actual)));
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr_1fr]">
      <Card title={<span className="flex items-center gap-2"><Wallet className="size-4 text-brand-600" />Mobilisation expenditure</span>} actions={<Link to="/finance" className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}>
        <div className="grid grid-cols-2 gap-2">
          {([['Estimated (all lines)', fmtMoney(fz.estimated)], ['Actual (invoiced)', fmtMoney(fz.actual)], ['Variance on invoiced', fmtMoney(variance)], ['Average per employee', fmtMoney(fz.average)]] as [string, string][]).map(([k, v]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-3 py-2"><div className={cx('text-base font-semibold tabular-nums', k.startsWith('Variance') && (variance > 0 ? 'text-red-600' : 'text-emerald-700'))}>{v}</div><div className="text-[11px] text-slate-500">{k}</div></div>
          ))}
        </div>
        {fz.pending_verification > 0 && <button onClick={() => nav('/approvals')} className="mt-3 w-full rounded-lg bg-amber-50 px-3 py-2 text-left text-sm font-medium text-amber-800 hover:bg-amber-100">{fz.pending_verification} cost line(s) awaiting finance verification</button>}
      </Card>
      {[['Project-wise expenditure', fz.byProject], ['Agency-wise expenditure', fz.byAgency]].map(([title, rows]: any) => (
        <Card key={title} title={title} bodyClass="px-4 py-3">
          {rows.length === 0 ? <Empty title="No costs yet" /> : <ul className="space-y-2">{rows.slice(0, 6).map((r: any) => (
            <li key={r.name} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate text-slate-600">{r.name}</span><span className="tabular-nums">{fmtMoney(r.actual)}</span></div>
              <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-navy-800" style={{ width: `${(Number(r.actual) / max) * 100}%` }} /></div></li>
          ))}</ul>}
        </Card>
      ))}
    </div>
  );
}

function OnboardingRow({ o }: { o: any }) {
  const nav = useNavigate();
  const tiles: [string, number, string, boolean?][] = [
    ['Pending activities', o.pending, '/onboarding?tab=department'], ['Overdue activities', o.overdue, '/onboarding?tab=department', true],
    ['Awaiting verification', o.awaiting_approval, '/onboarding?tab=verification'], ['Awaiting medical clearance', o.awaiting_medical, '/medical?filter=awaiting_visa'],
    ['Awaiting visa processing', o.awaiting_visa, '/visa'], ['Awaiting training', o.awaiting_training, '/training'], ['Uniform / PPE pending', o.awaiting_uniform, '/uniform'],
  ];
  return (
    <div className="grid gap-5 xl:grid-cols-[1.2fr_1fr]">
      <Card title={<span className="flex items-center gap-2"><ListChecks className="size-4 text-brand-600" />Onboarding progress</span>} actions={<Link to="/onboarding" className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}>
        <div className="flex flex-wrap items-center gap-5">
          <div className="relative grid size-24 place-items-center">
            <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90"><circle cx="18" cy="18" r="15.5" fill="none" stroke="#f1f5f9" strokeWidth="4" />
              <circle cx="18" cy="18" r="15.5" fill="none" stroke="#14b8a6" strokeWidth="4" strokeDasharray={`${(o.pct / 100) * 97.4} 97.4`} strokeLinecap="round" /></svg>
            <div className="text-center"><div className="text-xl font-semibold tabular-nums">{o.pct}%</div><div className="text-[10px] text-slate-500">complete</div></div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-4">
            {tiles.map(([k, v, to, danger]) => (
              <button key={k} onClick={() => nav(to)} className="rounded-lg bg-slate-50 px-2 py-2 text-left hover:bg-brand-50">
                <div className={cx('text-lg font-semibold tabular-nums', danger && v > 0 ? 'text-red-600' : 'text-slate-900')}>{v}</div><div className="text-[11px] leading-tight text-slate-500">{k}</div>
              </button>
            ))}
          </div>
        </div>
      </Card>
      <Card title="Department-wise completion" bodyClass="px-4 py-3">
        <ul className="space-y-2">{o.departments.map((r: any) => {
          const pct = r.total ? Math.round((r.done / r.total) * 100) : 0;
          return (
            <li key={r.name} className="grid grid-cols-[150px_1fr_80px] items-center gap-3 text-sm">
              <span className="truncate text-slate-600">{r.name}</span>
              <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-navy-800" style={{ width: `${pct}%` }} /></div>
              <span className="text-right text-xs tabular-nums">{pct}%{r.overdue > 0 && <span className="ml-1 font-semibold text-red-600">· {r.overdue}!</span>}</span>
            </li>
          );
        })}</ul>
      </Card>
    </div>
  );
}

function MobilityRow({ d }: { d: any }) {
  const { can } = useApp();
  const nav = useNavigate();
  const m = d.mobility, a = d.accommodation;
  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_1fr_1.1fr]">
      {can('mobility.view') && (
        <Card title={<span className="flex items-center gap-2"><Plane className="size-4 text-brand-600" />Mobility</span>} actions={<Link to="/mobility" className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}>
          <div className="grid grid-cols-3 gap-2">
            {([['Arriving today', m.today, '/pickups'], ['Tomorrow', m.tomorrow, '/pickups'], ['Next 7 days', m.next7, '/pickups'],
              ['Tickets awaiting', m.awaiting_ticket, '/bookings?status=open'], ['Need travel request', m.no_booking, '/bookings?new=1'], ['Approvals pending', m.approvals, '/bookings?status=approval_pending']] as [string, number, string][]).map(([k, v, to]) => (
              <button key={k} onClick={() => nav(to)} className="rounded-lg bg-slate-50 px-2 py-2.5 text-left hover:bg-brand-50">
                <div className="text-xl font-semibold text-slate-900 tabular-nums">{v}</div><div className="text-[11px] leading-tight text-slate-500">{k}</div>
              </button>
            ))}
          </div>
          {m.pickups_unassigned > 0 && <button onClick={() => nav('/pickups')} className="mt-3 flex w-full items-center gap-2 rounded-lg bg-red-50 px-3 py-2 text-left text-sm font-medium text-red-700 hover:bg-red-100"><AlertTriangle className="size-4" />{m.pickups_unassigned} airport pickup{m.pickups_unassigned > 1 ? 's' : ''} within 72h not assigned</button>}
          <div className="mt-3 text-xs text-slate-500">Travel expenditure (issued tickets): <span className="font-semibold text-slate-800">{fmtMoney(m.travel_spend)}</span></div>
        </Card>
      )}
      {can('accommodation.view') && (
        <Card title={<span className="flex items-center gap-2"><BedDouble className="size-4 text-brand-600" />Accommodation</span>} actions={<Link to="/accommodation" className="text-xs font-medium text-brand-700 hover:underline">Open</Link>}>
          <div className="flex items-end justify-between"><div><div className="text-3xl font-semibold text-slate-900 tabular-nums">{a.occupancy}%</div><div className="text-xs text-slate-500">occupancy (occupied + reserved)</div></div>
            <div className="text-right text-sm"><span className="font-semibold text-emerald-700">{a.available}</span> <span className="text-slate-500">beds free of {a.capacity}</span></div></div>
          <div className="mt-3 flex h-2.5 overflow-hidden rounded-full bg-slate-100">
            <div className="bg-navy-800" style={{ width: `${a.capacity ? (a.occupied / a.capacity) * 100 : 0}%` }} /><div className="bg-amber-400" style={{ width: `${a.capacity ? (a.reserved / a.capacity) * 100 : 0}%` }} />
          </div>
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            {[['Occupied', a.occupied], ['Reserved', a.reserved], ['Awaiting a bed', a.awaiting]].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-slate-50 py-2"><div className={cx('text-lg font-semibold tabular-nums', k === 'Awaiting a bed' && Number(v) > 0 ? 'text-orange-600' : 'text-slate-900')}>{v}</div><div className="text-[11px] text-slate-500">{k}</div></div>
            ))}
          </div>
        </Card>
      )}
      {can('mobility.view') && (
        <Card title={<span className="flex items-center gap-2"><PlaneLanding className="size-4 text-brand-600" />Arriving today & tomorrow</span>} bodyClass="p-0">
          {d.arrivals.length === 0 ? <Empty title="No arrivals today or tomorrow" /> : (
            <ul className="scroll-thin max-h-64 divide-y divide-slate-100 overflow-y-auto">
              {d.arrivals.map((r: any) => (
                <li key={r.booking_id}><Link to={`/candidates/${r.id}?tab=travel`} className="flex items-center gap-3 px-4 py-2 hover:bg-slate-50">
                  <div className="w-16 text-xs text-slate-500">{r.arrival_at.slice(5, 10).split('-').reverse().join('/')}<div className="text-sm font-semibold text-slate-800">{r.arrival_at.slice(11, 16)}</div></div>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-slate-800">{r.full_name}</div><div className="text-xs text-slate-500">{r.flight_number} · {r.arrival_airport}</div></div>
                  <div className="flex flex-col items-end gap-0.5 text-[11px]">
                    <span className={r.pickup_status === 'pending' ? 'font-semibold text-red-600' : 'text-emerald-700'}>{r.pickup_status === 'pending' ? 'No pickup' : r.pickup_status === 'completed' ? 'Picked up' : 'Pickup set'}</span>
                    <span className={r.has_room ? 'text-emerald-700' : 'font-semibold text-orange-600'}>{r.has_room ? 'Bed ready' : 'No bed'}</span>
                  </div>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

export function Dashboard() {
  const { options, user, company, can } = useApp();
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  const [project, setProject] = useState('');
  useEffect(() => { api.get(`/dashboard${qs({ project_id: project })}`).then(setD); }, [project]);
  if (!d || !options) return <Spinner />;

  const go = (params: Record<string, string>) => nav(`/candidates${qs({ ...params, project_id: project })}`);
  const c = d.counts;
  const pipeline = options.enums.candidate_status.filter((s) => s.value !== 'cancelled').map((s) => ({ name: s.label, value: c[s.value] || 0, key: s.value, color: TONE_HEX[s.tone || 'slate'] }));
  const monthLabel = (m: string) => new Date(`${m}-01T00:00:00`).toLocaleString('en-GB', { month: 'short', year: '2-digit' });

  return (
    <div className="mx-auto max-w-[1500px] space-y-5">
      <PageHeader title={`Welcome, ${user?.full_name.split(' ')[0]}`} subtitle={`${company} · candidate pipeline overview`}
        actions={
          <select className="input w-auto" value={project} onChange={(e) => setProject(e.target.value)} aria-label="Project">
            <option value="">All projects</option>
            {options.projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        } />

      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total selected (active)" value={d.active} icon={<Users className="size-5" />} tone="indigo" onClick={() => go({})} />
        <Stat label="Selected" value={c.selected} icon={<UserCheck className="size-5" />} tone="slate" onClick={() => go({ status: 'selected' })} />
        <Stat label="Pre-arrival processing" value={c.pre_arrival} icon={<PlaneTakeoff className="size-5" />} tone="blue" onClick={() => go({ status: 'pre_arrival' })} />
        <Stat label="Contracts not signed" value={d.contracts?.unsigned ?? 0} icon={<FileSignature className="size-5" />} tone="amber" sub={`${d.contracts?.signed ?? 0} signed`} />
        <Stat label="On hold" value={c.on_hold} icon={<PauseCircle className="size-5" />} tone="purple" onClick={() => go({ status: 'on_hold' })} />
        <Stat label="Cancelled" value={c.cancelled} icon={<Ban className="size-5" />} tone="red" onClick={() => go({ status: 'cancelled', archived: 'all' })} />
      </div>

      <CeoQuestions d={d} />
      {(can('mobility.view') || can('accommodation.view')) && <MobilityRow d={d} />}
      {can('onboarding.view') && d.onboarding && <OnboardingRow o={d.onboarding} />}
      {d.finance && <FinanceRow fz={d.finance} />}

      <div className="grid gap-5 xl:grid-cols-3">
        <Card title="Onboarding pipeline" className="xl:col-span-2" actions={<Link to="/deployment" className="text-xs font-medium text-brand-700 hover:underline">Clearance & deployment</Link>}>
          <div className="grid grid-cols-3 gap-2 sm:grid-cols-5 lg:grid-cols-9">
            {pipeline.map((p, i) => (
              <button key={p.key} onClick={() => go({ status: p.key })} className="group relative rounded-lg border border-slate-200 p-2.5 text-left hover:border-brand-500/60 hover:bg-brand-50/30">
                <div className="h-1 rounded-full" style={{ background: p.color, opacity: p.value ? 1 : 0.25 }} />
                <div className="mt-2 text-xl font-semibold text-slate-900 tabular-nums">{p.value}</div>
                <div className="text-[11px] leading-tight text-slate-500">{p.name}</div>
                {i < pipeline.length - 1 && <span className="absolute top-1/2 -right-2 z-10 hidden text-slate-300 lg:block">›</span>}
              </button>
            ))}
          </div>
          <div className="mt-6">
            <div className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">Selections per month</div>
            {d.monthly.length ? (
              <ResponsiveContainer width="100%" height={180}>
                <BarChart data={d.monthly.map((m: any) => ({ ...m, label: monthLabel(m.month) }))} margin={{ left: -20, right: 8 }}>
                  <CartesianGrid vertical={false} stroke="#f1f5f9" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v) => [v, 'Selected']} />
                  <Bar dataKey="n" fill="#14b8a6" radius={[4, 4, 0, 0]} barSize={26} />
                </BarChart>
              </ResponsiveContainer>
            ) : <Empty title="No selections in the last 12 months" />}
          </div>
        </Card>

        <Card title="Status mix">
          {d.total ? (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie data={[...pipeline, { name: 'Cancelled', value: c.cancelled, key: 'cancelled', color: TONE_HEX.red }].filter((p) => p.value)} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85} paddingAngle={2} stroke="none">
                    {[...pipeline, { name: 'Cancelled', value: c.cancelled, key: 'cancelled', color: TONE_HEX.red }].filter((p) => p.value).map((p) => <Cell key={p.key} fill={p.color} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <ul className="mt-2 space-y-1.5 text-sm">
                {[...pipeline, { name: 'Cancelled', value: c.cancelled, key: 'cancelled', color: TONE_HEX.red }].filter((p) => p.value).map((p) => (
                  <li key={p.key} className="flex items-center gap-2"><span className="size-2.5 rounded-sm" style={{ background: p.color }} /><span className="flex-1 text-slate-600">{p.name}</span><span className="font-medium tabular-nums">{p.value}</span></li>
                ))}
              </ul>
            </>
          ) : <Empty title="No candidates yet" />}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card title={<span className="flex items-center gap-2"><AlertTriangle className="size-4 text-amber-500" />Passports expiring within 6 months</span>} bodyClass="p-0">
          {d.passportExpiring.length === 0 ? <Empty title="No passport validity issues" /> : (
            <ul className="divide-y divide-slate-100">
              {d.passportExpiring.map((r: any) => (
                <li key={r.id}><Link to={`/candidates/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-slate-800">{r.full_name}</div><div className="text-xs text-slate-500">{r.reference_no} · {r.nationality} · <span className="font-mono">{r.passport_number}</span></div></div>
                  <div className="text-right"><div className="text-sm">{fmtDate(r.passport_expiry_date)}</div>
                    <div className={r.days_left < 90 ? 'text-xs font-semibold text-red-600' : 'text-xs text-amber-700'}>{r.days_left < 0 ? 'expired' : `${r.days_left} days`}</div></div>
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
        <Card title={<span className="flex items-center gap-2"><CalendarClock className="size-4 text-brand-600" />Expected joining — next 30 days</span>} bodyClass="p-0">
          {d.upcomingJoining.length === 0 ? <Empty title="No joiners expected in the next 30 days" /> : (
            <ul className="divide-y divide-slate-100">
              {d.upcomingJoining.map((r: any) => (
                <li key={r.id}><Link to={`/candidates/${r.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                  <div className="w-14 shrink-0 text-center"><div className="text-xs text-slate-500 uppercase">{fmtDate(r.expected_joining_date).split(' ')[1]}</div><div className="text-lg leading-tight font-semibold text-navy-900">{fmtDate(r.expected_joining_date).split(' ')[0]}</div></div>
                  <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-slate-800">{r.full_name}</div><div className="truncate text-xs text-slate-500">{r.position} · {r.project}</div></div>
                  <StatusBadge status={r.status} />
                </Link></li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-4">
        <Card title="By nationality"><HBar data={d.byNationality} onClick={(n) => go({ nationality: n })} /></Card>
        <Card title="By project"><HBar data={d.byProject} /></Card>
        <Card title="By trade"><HBar data={d.byTrade} /></Card>
        <Card title="By recruitment agency"><HBar data={d.byAgency} /></Card>
      </div>

      <Card title="Recently registered" bodyClass="p-0" actions={<Link to="/candidates" className="text-xs font-medium text-brand-700 hover:underline">View all</Link>}>
        {d.recent.length === 0 ? <Empty title="No candidates registered yet" /> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <tbody className="divide-y divide-slate-100">
                {d.recent.map((r: any) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-slate-50" onClick={() => nav(`/candidates/${r.id}`)}>
                    <td className="td pl-4"><div className="font-medium text-slate-800">{r.full_name}</div><div className="font-mono text-xs text-slate-500">{r.reference_no}</div></td>
                    <td className="td">{r.position}<div className="text-xs text-slate-500">{r.trade}</div></td>
                    <td className="td">{r.nationality}</td>
                    <td className="td"><StatusBadge status={r.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
