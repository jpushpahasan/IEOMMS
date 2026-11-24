import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, BedDouble, Car, CheckCircle2, Phone, UserX } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtTs, uaeNowInput, uaeToday } from '../../lib/format';
import { Alert, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, useToast } from '../../components/ui';
import { Avatar } from '../Candidates';
import { PickupBadge } from './Mobility';

const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);

export function Pickups() {
  const { can } = useApp();
  const [f, setF] = useState(() => ({ from: addDays(uaeToday(), -1), to: addDays(uaeToday(), 14), status: '' }));
  const [rows, setRows] = useState<any[] | null>(null);
  const [assign, setAssign] = useState<any>(null);
  const [complete, setComplete] = useState<{ p: any; noShow: boolean } | null>(null);
  const load = () => { setRows(null); api.get(`/pickups${qs(f)}`).then(setRows); };
  useEffect(load, [f]); // eslint-disable-line react-hooks/exhaustive-deps
  const groups = useMemo(() => {
    const m = new Map<string, any[]>();
    for (const r of rows || []) { const d = String(r.arrival_at).slice(0, 10); if (!m.has(d)) m.set(d, []); m.get(d)!.push(r); }
    return [...m.entries()];
  }, [rows]);
  const alerts = (rows || []).filter((r) => r.alert);
  const manage = can('mobility.manage');
  const today = uaeToday();

  return (
    <div className="mx-auto max-w-[1400px]">
      <PageHeader title="Airport pickup schedule" subtitle="Every incoming employee by arrival date, with vehicle, driver and coordinator." />
      {alerts.length > 0 && (
        <div className="mb-4 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span><span className="font-semibold">{alerts.length} pickup{alerts.length > 1 ? 's' : ''} arriving within 72 hours {alerts.length > 1 ? 'have' : 'has'} no vehicle or driver.</span> They are marked in red below.</span>
        </div>
      )}
      <Card bodyClass="p-0">
        <div className="flex flex-wrap items-end gap-3 border-b border-slate-100 p-3">
          <Field label="From"><input type="date" className="input" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></Field>
          <Field label="To"><input type="date" className="input" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></Field>
          <Field label="Status">
            <select className="input" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>
              <option value="">All open & completed</option><option value="pending">Not assigned</option><option value="assigned">Assigned</option>
              <option value="completed">Picked up</option><option value="no_show">No show</option><option value="cancelled">Cancelled</option>
            </select>
          </Field>
          <div className="flex gap-1 pb-0.5">
            <Button variant="ghost" size="sm" onClick={() => setF({ ...f, from: today, to: today })}>Today</Button>
            <Button variant="ghost" size="sm" onClick={() => setF({ ...f, from: addDays(today, 1), to: addDays(today, 1) })}>Tomorrow</Button>
            <Button variant="ghost" size="sm" onClick={() => setF({ ...f, from: today, to: addDays(today, 7) })}>Next 7 days</Button>
          </div>
        </div>
        {!rows ? <Spinner /> : rows.length === 0 ? <Empty icon={<Car className="size-6" />} title="No pickups in this period">Pickups appear here automatically once tickets are issued.</Empty> : (
          <div className="divide-y divide-slate-100">
            {groups.map(([day, items]) => (
              <section key={day}>
                <h3 className={cx('sticky top-0 z-10 flex items-center gap-2 bg-slate-50 px-4 py-2 text-xs font-semibold tracking-wider uppercase', day === today ? 'text-brand-700' : 'text-slate-500')}>
                  {day === today ? 'Today · ' : day === addDays(today, 1) ? 'Tomorrow · ' : ''}{fmtDate(day)}<span className="font-normal normal-case">({items.length})</span>
                </h3>
                <ul className="divide-y divide-slate-100">
                  {items.map((p) => (
                    <li key={p.id} className={cx('grid gap-3 px-4 py-3 md:grid-cols-[70px_1.3fr_1fr_1.2fr_auto] md:items-center', p.alert && 'bg-red-50/60')}>
                      <div className="text-lg font-semibold text-navy-900 tabular-nums">{fmtTs(p.arrival_at, false)}<div className="text-[11px] font-normal text-slate-500">{p.airport} {p.terminal || ''}</div></div>
                      <div className="flex min-w-0 items-center gap-3">
                        <Avatar name={p.full_name} photoId={p.photo_document_id} size="sm" />
                        <div className="min-w-0"><Link to={`/candidates/${p.candidate_id}`} className="block truncate font-medium text-slate-800 hover:text-brand-700">{p.full_name}</Link>
                          <div className="truncate text-xs text-slate-500">{p.reference_no} · {p.nationality} · {p.project}</div></div>
                      </div>
                      <div className="text-sm"><Link to={`/bookings/${p.flight_booking_id}`} className="font-medium text-brand-700 hover:underline">{p.flight_number}</Link>
                        <div className="text-xs text-slate-500">{p.airline} from {p.departure_city}</div>
                        {p.accommodation ? <div className="mt-0.5 flex items-center gap-1 text-xs text-slate-600"><BedDouble className="size-3" />{p.accommodation}</div>
                          : <div className="mt-0.5 text-xs font-medium text-amber-700">No accommodation allocated</div>}</div>
                      <div className="text-sm">
                        {p.vehicle_registration ? <><div className="font-medium">{p.vehicle_registration} · {p.driver_name}</div>
                          <a href={`tel:${p.driver_phone}`} className="inline-flex items-center gap-1 text-xs text-slate-500 hover:text-brand-700"><Phone className="size-3" />{p.driver_phone}</a>
                          <div className="text-xs text-slate-500">Coordinator: {p.coordinator_name || '—'}</div></>
                          : <span className="font-medium text-red-600">Vehicle & driver not assigned</span>}
                        {p.actual_pickup_at && <div className="text-xs text-emerald-700">Picked up {fmtTs(p.actual_pickup_at)}</div>}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
                        <PickupBadge status={p.status} />
                        {manage && ['pending', 'assigned'].includes(p.status) && <Button size="sm" variant={p.status === 'pending' ? 'primary' : 'secondary'} onClick={() => setAssign(p)}>{p.status === 'pending' ? 'Assign' : 'Reassign'}</Button>}
                        {manage && p.status === 'assigned' && <Button size="sm" variant="subtle" icon={<CheckCircle2 className="size-3.5" />} onClick={() => setComplete({ p, noShow: false })}>Picked up</Button>}
                        {manage && ['pending', 'assigned'].includes(p.status) && <Button size="sm" variant="ghost" icon={<UserX className="size-3.5" />} onClick={() => setComplete({ p, noShow: true })}>No show</Button>}
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </Card>
      {assign && <AssignModal p={assign} onClose={() => setAssign(null)} onDone={() => { setAssign(null); load(); }} />}
      {complete && <CompleteModal p={complete.p} noShow={complete.noShow} onClose={() => setComplete(null)} onDone={() => { setComplete(null); load(); }} />}
    </div>
  );
}

function AssignModal({ p, onClose, onDone }: { p: any; onClose: () => void; onDone: () => void }) {
  const { options, user } = useApp();
  const toast = useToast();
  const [f, setF] = useState<any>({ vehicle_id: p.vehicle_id ? String(p.vehicle_id) : '', driver_name: p.driver_name || '', driver_phone: p.driver_phone || '',
    coordinator_id: String(p.coordinator_id || user?.id || ''), terminal: p.terminal || '', remarks: p.remarks || '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const pickVehicle = (id: string) => {
    const v = options?.vehicles.find((x) => String(x.id) === id);
    setF({ ...f, vehicle_id: id, driver_name: f.driver_name || v?.driver_name || '', driver_phone: f.driver_phone || v?.driver_phone || '' });
  };
  const submit = async () => {
    setBusy(true); setErr({});
    try { await api.put(`/pickups/${p.id}/assign`, f); toast('success', 'Pickup assigned.'); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={`Assign pickup — ${p.full_name}`} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={submit}>Save assignment</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="text-sm text-slate-600 sm:col-span-2">{p.flight_number} arriving {fmtTs(p.arrival_at)} at {p.airport}.</div>
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Vehicle" required error={err.vehicle_id} className="sm:col-span-2">
          <select className="input" value={f.vehicle_id} onChange={(e) => pickVehicle(e.target.value)}>
            <option value="">Select…</option>{options?.vehicles.map((v) => <option key={v.id} value={v.id}>{v.label} ({v.seats} seats)</option>)}
          </select>
        </Field>
        <Field label="Driver name" required error={err.driver_name}><input className="input" value={f.driver_name} onChange={(e) => setF({ ...f, driver_name: e.target.value })} /></Field>
        <Field label="Driver contact number" required error={err.driver_phone}><input className="input" value={f.driver_phone} onChange={(e) => setF({ ...f, driver_phone: e.target.value })} /></Field>
        <Field label="Assigned coordinator" required error={err.coordinator_id}>
          <select className="input" value={f.coordinator_id} onChange={(e) => setF({ ...f, coordinator_id: e.target.value })}>
            <option value="">Select…</option>{options?.users.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
          </select>
        </Field>
        <Field label="Terminal" error={err.terminal}><input className="input" value={f.terminal} onChange={(e) => setF({ ...f, terminal: e.target.value })} /></Field>
        <Field label="Remarks" error={err.remarks} className="sm:col-span-2"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function CompleteModal({ p, noShow, onClose, onDone }: { p: any; noShow: boolean; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ actual_pickup_at: noShow ? '' : uaeNowInput(), remarks: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true); setErr({});
    try { await api.post(`/pickups/${p.id}/complete`, { ...f, no_show: noShow }); toast('success', noShow ? 'Recorded as no-show.' : `${p.full_name} picked up and marked Arrived in UAE.`); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={noShow ? `No show — ${p.full_name}` : `Confirm pickup — ${p.full_name}`} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant={noShow ? 'danger' : 'primary'} loading={busy} onClick={submit}>{noShow ? 'Record no-show' : 'Confirm pickup'}</Button></>}>
      <div className="space-y-3">
        {err._ && <Alert tone="error">{err._}</Alert>}
        {!noShow && <p className="text-sm text-slate-600">Confirms arrival: the flight is marked Travel Completed and the candidate becomes Arrived in UAE.</p>}
        {!noShow && <Field label="Actual pickup time" required error={err.actual_pickup_at}><input type="datetime-local" className="input" value={f.actual_pickup_at} onChange={(e) => setF({ ...f, actual_pickup_at: e.target.value })} /></Field>}
        <Field label={noShow ? 'What happened?' : 'Arrival remarks'} required={noShow} error={err.remarks}><textarea rows={3} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}
