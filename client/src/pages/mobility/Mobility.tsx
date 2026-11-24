import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Clock, Hourglass, PlaneLanding, Ticket, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtMoney, fmtTs } from '../../lib/format';
import { Badge, Card, cx, Empty, PageHeader, Spinner, Stat } from '../../components/ui';
import { MasterTable, type Col } from '../admin/Settings';

export function Mobility() {
  const { can } = useApp();
  const [tab, setTab] = useState<'overview' | 'agencies' | 'vehicles'>('overview');
  const tabs = [['overview', 'Overview & calendar'], ['agencies', 'Travel agencies'], ['vehicles', 'Pickup vehicles']] as const;
  const agencyCols: Col[] = [
    { key: 'name', label: 'Agency', required: true }, { key: 'contact_person', label: 'Contact person' }, { key: 'phone', label: 'Contact number' },
    { key: 'email', label: 'Email' }, { key: 'office_location', label: 'Office location' }, { key: 'payment_terms', label: 'Payment terms' },
    { key: 'is_approved', label: 'Approved', type: 'bool' },
  ];
  const vehicleCols: Col[] = [
    { key: 'registration_no', label: 'Registration', required: true }, { key: 'name', label: 'Vehicle', required: true },
    { key: 'vehicle_type', label: 'Type', type: 'select', required: true, options: () => [{ value: 'car', label: 'Car' }, { value: 'van', label: 'Van' }, { value: 'minibus', label: 'Minibus' }, { value: 'bus', label: 'Bus' }] },
    { key: 'seats', label: 'Seats', required: true }, { key: 'driver_name', label: 'Default driver' }, { key: 'driver_phone', label: 'Driver contact' },
  ];
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="International Mobility" subtitle="Travel pipeline, arrivals calendar, approved travel agencies and pickup vehicles." />
      <div className="mb-4 inline-flex rounded-lg border border-slate-200 bg-white p-1">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
      </div>
      {tab === 'overview' && <Overview />}
      {tab === 'agencies' && <MasterTable masterKey="travel_agencies" title="Travel agencies" cols={agencyCols} readOnly={!can('mobility.manage')} />}
      {tab === 'vehicles' && <MasterTable masterKey="vehicles" title="Pickup vehicles" cols={vehicleCols} readOnly={!can('mobility.manage')} />}
    </div>
  );
}

function Overview() {
  const nav = useNavigate();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/mobility/overview').then(setD); }, []);
  if (!d) return <Spinner />;
  const c = d.counts;
  const awaitingTicket = ['pending_booking', 'quotation_received', 'approval_pending', 'approved', 'ticket_booked'].reduce((s, k) => s + (c[k] || 0), 0);
  return (
    <div className="space-y-5">
      {d.unassigned.length > 0 && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <div><span className="font-semibold">{d.unassigned.length} airport pickup{d.unassigned.length > 1 ? 's' : ''} within 72 hours not assigned:</span>{' '}
            {d.unassigned.map((p: any) => `${p.full_name} (${fmtTs(p.arrival_at)}, ${p.airport})`).join('; ')}.{' '}
            <Link to="/pickups" className="font-semibold underline">Assign now</Link></div>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Arriving today" value={d.today} icon={<PlaneLanding className="size-5" />} tone="emerald" onClick={() => nav('/pickups')} />
        <Stat label="Arriving tomorrow" value={d.tomorrow} icon={<CalendarDays className="size-5" />} tone="cyan" onClick={() => nav('/pickups')} />
        <Stat label="Need a travel request" value={d.awaitingBooking} icon={<Hourglass className="size-5" />} tone="slate" sub="Selected / pre-arrival, no booking" onClick={() => nav('/bookings?new=1')} />
        <Stat label="Tickets in progress" value={awaitingTicket} icon={<Ticket className="size-5" />} tone="amber" sub={`${c.approval_pending || 0} awaiting approval`} onClick={() => nav('/bookings?status=open')} />
        <Stat label="Tickets issued" value={(c.ticket_issued || 0) + (c.travel_completed || 0)} icon={<Clock className="size-5" />} tone="indigo" sub={`${c.travel_completed || 0} travelled`} onClick={() => nav('/bookings?status=ticket_issued')} />
        <Stat label="Travel expenditure" value={fmtMoney(d.spend.issued)} icon={<Wallet className="size-5" />} tone="purple" sub={`+ ${fmtMoney(d.spend.committed)} approved, not issued`} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
        <ArrivalsCalendar />
        <div className="space-y-5">
          <Card title="Arrivals — next 7 days" bodyClass="p-0">
            {d.upcoming.length === 0 ? <Empty title="No confirmed arrivals this week" /> : (
              <ul className="divide-y divide-slate-100">
                {d.upcoming.map((b: any) => (
                  <li key={b.id}><Link to={`/bookings/${b.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50">
                    <div className="w-20 shrink-0 text-xs text-slate-500">{fmtTs(b.arrival_at).split(',')[0]}<div className="text-sm font-semibold text-slate-800">{fmtTs(b.arrival_at, false)}</div></div>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium text-slate-800">{b.full_name}</div><div className="text-xs text-slate-500">{b.flight_number} → {b.arrival_airport} {b.arrival_terminal || ''}</div></div>
                    <PickupBadge status={b.pickup_status} />
                  </Link></li>
                ))}
              </ul>
            )}
          </Card>
          <Card title="Country-wise mobilisation">
            {d.countries.length === 0 ? <Empty title="No bookings yet" /> : (
              <ResponsiveContainer width="100%" height={Math.max(140, d.countries.length * 30)}>
                <BarChart data={d.countries} layout="vertical" margin={{ left: 4, right: 20 }}>
                  <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                  <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                  <YAxis type="category" dataKey="name" width={90} tick={{ fontSize: 12, fill: '#334155' }} axisLine={false} tickLine={false} />
                  <Tooltip cursor={{ fill: '#f8fafc' }} formatter={(v) => [v, 'Travellers']} />
                  <Bar dataKey="n" fill="#17385f" radius={[0, 4, 4, 0]} barSize={16} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

export function PickupBadge({ status }: { status?: string | null }) {
  const { enumLabel, enumTone } = useApp();
  if (!status) return null;
  return <Badge tone={enumTone('pickup_status', status)}>{enumLabel('pickup_status', status)}</Badge>;
}

const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
function ArrivalsCalendar() {
  const [month, setMonth] = useState(() => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 7));
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { setRows(null); api.get(`/mobility/calendar?month=${month}`).then(setRows); }, [month]);
  const days = useMemo(() => {
    const first = new Date(`${month}-01T00:00:00Z`);
    const offset = (first.getUTCDay() + 6) % 7;
    const start = new Date(first.getTime() - offset * 864e5);
    return Array.from({ length: 42 }, (_, i) => new Date(start.getTime() + i * 864e5).toISOString().slice(0, 10));
  }, [month]);
  const shift = (n: number) => { const d = new Date(`${month}-01T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + n); setMonth(d.toISOString().slice(0, 7)); };
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  return (
    <Card title={<span className="flex items-center gap-2"><CalendarDays className="size-4 text-brand-600" />Travel calendar</span>}
      actions={<div className="flex items-center gap-1">
        <button className="rounded p-1 hover:bg-slate-100" onClick={() => shift(-1)} aria-label="Previous month"><ChevronLeft className="size-4" /></button>
        <span className="w-32 text-center text-sm font-medium">{label}</span>
        <button className="rounded p-1 hover:bg-slate-100" onClick={() => shift(1)} aria-label="Next month"><ChevronRight className="size-4" /></button>
      </div>} bodyClass="p-2 sm:p-3">
      <div className="mb-2 flex flex-wrap gap-3 px-1 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-emerald-500" />Confirmed arrival</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full bg-red-500" />Pickup not assigned</span>
        <span className="flex items-center gap-1"><span className="size-2 rounded-full border border-dashed border-slate-400" />Planned (not ticketed)</span>
      </div>
      {!rows ? <Spinner /> : (
        <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-slate-200 bg-slate-200 text-xs">
          {DOW.map((d) => <div key={d} className="bg-slate-50 px-2 py-1.5 text-center font-semibold text-slate-500">{d}</div>)}
          {days.map((day) => {
            const items = rows.filter((r) => r.day === day);
            const inMonth = day.startsWith(month);
            return (
              <div key={day} className={cx('min-h-24 bg-white p-1', !inMonth && 'bg-slate-50/70')}>
                <div className={cx('mb-1 flex size-6 items-center justify-center rounded-full text-[11px] font-medium', day === today ? 'bg-navy-900 text-white' : inMonth ? 'text-slate-700' : 'text-slate-300')}>{Number(day.slice(8))}</div>
                <div className="space-y-0.5">
                  {items.slice(0, 3).map((r) => (
                    <Link key={r.id} to={`/bookings/${r.id}`} title={`${r.full_name} · ${r.flight_number || 'not ticketed'}`}
                      className={cx('block truncate rounded px-1 py-0.5 text-[11px] leading-tight',
                        !r.confirmed ? 'border border-dashed border-slate-300 text-slate-500' : r.pickup_status === 'pending' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800')}>
                      {r.arrival_at ? `${String(r.arrival_at).slice(11, 16)} ` : ''}{r.full_name.split(' ')[0]}
                    </Link>
                  ))}
                  {items.length > 3 && <div className="px-1 text-[10px] text-slate-500">+{items.length - 3} more</div>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
