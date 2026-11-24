import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Plane, Plus, Search } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtMoney, fmtTs } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';
import { PickupBadge } from './Mobility';

export function BookingStatus({ status }: { status: string }) {
  const { enumLabel, enumTone } = useApp();
  return <Badge tone={enumTone('booking_status', status)} dot>{enumLabel('booking_status', status)}</Badge>;
}

export function Bookings() {
  const { options, can } = useApp();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const [rows, setRows] = useState<any[] | null>(null);
  const [q, setQ] = useState('');
  const params = useMemo(() => Object.fromEntries(sp.entries()), [sp]);
  const [newOpen, setNewOpen] = useState(sp.get('new') === '1');
  useEffect(() => { setRows(null); const { new: _n, ...p } = params; api.get(`/bookings${qs(p)}`).then(setRows); }, [params]);
  const set = (k: string, v: string) => { const n = new URLSearchParams(sp); if (v) n.set(k, v); else n.delete(k); n.delete('new'); setSp(n, { replace: true }); };
  const filtered = (rows || []).filter((r) => !q || `${r.full_name} ${r.reference_no} ${r.booking_no} ${r.flight_number || ''} ${r.booking_reference || ''}`.toLowerCase().includes(q.toLowerCase()));
  const statusTabs = [['', 'All'], ['open', 'In progress'], ['approval_pending', 'Approval pending'], ['ticket_issued', 'Ticket issued'], ['travel_completed', 'Travelled'], ['cancelled', 'Cancelled']];

  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Flight bookings" subtitle="Travel requests, agency quotations, approvals and ticketing for every candidate."
        actions={can('mobility.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setNewOpen(true)}>New travel request</Button>} />
      <Card bodyClass="p-0">
        <div className="flex flex-col gap-3 border-b border-slate-100 p-3 lg:flex-row lg:items-center">
          <div className="scroll-thin flex gap-1 overflow-x-auto">
            {statusTabs.map(([v, l]) => (
              <button key={v} onClick={() => set('status', v)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap', (sp.get('status') || '') === v ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>
            ))}
          </div>
          <div className="flex flex-1 flex-wrap gap-2 lg:justify-end">
            <div className="relative min-w-56 flex-1 lg:max-w-xs"><Search className="absolute top-2.5 left-3 size-4 text-slate-400" />
              <input className="input pl-9" placeholder="Name, booking no., flight, PNR…" value={q} onChange={(e) => setQ(e.target.value)} /></div>
            <select className="input w-auto" value={sp.get('airport') || ''} onChange={(e) => set('airport', e.target.value)} aria-label="Airport">
              <option value="">All airports</option>{options?.enums.airport.map((o) => <option key={o.value} value={o.value}>{o.value}</option>)}
            </select>
            <input type="date" className="input w-auto" value={sp.get('from') || ''} onChange={(e) => set('from', e.target.value)} aria-label="Travel from" />
            <input type="date" className="input w-auto" value={sp.get('to') || ''} onChange={(e) => set('to', e.target.value)} aria-label="Travel to" />
          </div>
        </div>
        {!rows ? <Spinner /> : filtered.length === 0 ? <Empty icon={<Plane className="size-6" />} title="No flight bookings">Create a travel request for a selected candidate to start collecting quotations.</Empty> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/80"><tr>
                <th className="th pl-4">Booking</th><th className="th">Candidate</th><th className="th">Route</th><th className="th">Travel date</th>
                <th className="th">Flight</th><th className="th">Quotes</th><th className="th text-right">Ticket cost</th><th className="th">Status</th><th className="th">Pickup</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((r) => (
                  <tr key={r.id} className="cursor-pointer hover:bg-brand-50/40" onClick={() => nav(`/bookings/${r.id}`)}>
                    <td className="td pl-4"><Link to={`/bookings/${r.id}`} onClick={(e) => e.stopPropagation()} className="font-mono text-xs font-medium text-brand-700">{r.booking_no}</Link>
                      {r.booking_reference && <div className="font-mono text-[11px] text-slate-500">PNR {r.booking_reference}</div>}</td>
                    <td className="td"><div className="font-medium text-slate-800">{r.full_name}</div><div className="font-mono text-xs text-slate-500">{r.reference_no}</div></td>
                    <td className="td">{r.departure_city}, {r.departure_country}<div className="text-xs text-slate-500">→ {r.arrival_airport}</div></td>
                    <td className="td">{r.arrival_at ? fmtTs(r.arrival_at) : fmtDate(r.confirmed_travel_date || r.preferred_travel_date)}
                      <div className="text-xs text-slate-500">{r.arrival_at ? 'arrival (UAE)' : r.confirmed_travel_date ? 'confirmed' : 'preferred'}</div></td>
                    <td className="td">{r.flight_number ? <><div>{r.flight_number}</div><div className="text-xs text-slate-500">{r.airline}</div></> : '—'}</td>
                    <td className="td">{r.quote_count ? <span>{r.quote_count}<span className="text-xs text-slate-500"> · from {fmtMoney(r.min_fare)}</span></span> : '—'}</td>
                    <td className="td text-right tabular-nums">{r.ticket_cost ? fmtMoney(r.ticket_cost) : '—'}</td>
                    <td className="td"><BookingStatus status={r.status} /></td>
                    <td className="td"><PickupBadge status={r.pickup_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {newOpen && <NewBookingModal onClose={() => setNewOpen(false)} onDone={(id) => nav(`/bookings/${id}`)} />}
    </div>
  );
}

export function NewBookingModal({ onClose, onDone, candidateId }: { onClose: () => void; onDone: (id: number) => void; candidateId?: number }) {
  const { options } = useApp();
  const toast = useToast();
  const [eligible, setEligible] = useState<any[] | null>(null);
  const [f, setF] = useState<any>({ candidate_id: candidateId ? String(candidateId) : '', departure_country: '', departure_city: '', arrival_airport: 'DXB', preferred_travel_date: '', remarks: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.get('/bookings/eligible').then((r) => {
    setEligible(r);
    if (candidateId) { const c = r.find((x: any) => x.id === candidateId); if (c) pickCandidate(c); }
  }); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const pickCandidate = (c: any) => setF((x: any) => ({ ...x, candidate_id: String(c.id), departure_country: c.source_country || c.nationality,
    arrival_airport: c.emirate === 'Abu Dhabi' ? 'AUH' : c.emirate === 'Sharjah' ? 'SHJ' : 'DXB', preferred_travel_date: c.expected_joining_date || x.preferred_travel_date }));
  const submit = async () => {
    setBusy(true); setErr({});
    try { const b = await api.post('/bookings', f); toast('success', `Travel request ${b.booking_no} created.`); onDone(b.id); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="New travel request" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Create request</Button></>}>
      {!eligible ? <Spinner /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
          {eligible.length === 0 && <div className="sm:col-span-2"><Alert tone="info">Every Selected / Pre-arrival candidate already has a travel request.</Alert></div>}
          <Field label="Candidate" required error={err.candidate_id} className="sm:col-span-2">
            <select className="input" value={f.candidate_id} onChange={(e) => { const c = eligible.find((x) => String(x.id) === e.target.value); if (c) pickCandidate(c); else setF({ ...f, candidate_id: '' }); }}>
              <option value="">Select…</option>
              {eligible.map((c) => <option key={c.id} value={c.id}>{c.full_name} — {c.reference_no} ({c.nationality}{c.expected_joining_date ? `, joining ${fmtDate(c.expected_joining_date)}` : ''})</option>)}
            </select>
          </Field>
          <Field label="Departure country" required error={err.departure_country}>
            <select className="input" value={f.departure_country} onChange={(e) => setF({ ...f, departure_country: e.target.value })}>
              <option value="">Select…</option>{options?.countries.map((c) => <option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Departure city" required error={err.departure_city}><input className="input" value={f.departure_city} onChange={(e) => setF({ ...f, departure_city: e.target.value })} /></Field>
          <Field label="Arrival airport (UAE)" required error={err.arrival_airport}>
            <select className="input" value={f.arrival_airport} onChange={(e) => setF({ ...f, arrival_airport: e.target.value })}>
              {options?.enums.airport.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
          <Field label="Preferred travel date" required error={err.preferred_travel_date}><input type="date" className="input" value={f.preferred_travel_date} onChange={(e) => setF({ ...f, preferred_travel_date: e.target.value })} /></Field>
          <Field label="Remarks" error={err.remarks} className="sm:col-span-2"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}
