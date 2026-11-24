import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Ban, Check, FileText, Plane, PlaneLanding, Plus, Send, Ticket, Trash2, X } from 'lucide-react';
import { api, ApiError } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtDateTime, fmtMoney, fmtTs, toLocalInput } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, Spinner, useToast } from '../../components/ui';
import { Avatar, StatusBadge } from '../Candidates';
import { BookingStatus } from './Bookings';
import { PickupBadge } from './Mobility';

const STEPS = ['pending_booking', 'quotation_received', 'approval_pending', 'approved', 'ticket_booked', 'ticket_issued', 'travel_completed'];

export function BookingDetail() {
  const { id } = useParams();
  const { can, enumLabel } = useApp();
  const toast = useToast();
  const [d, setD] = useState<any>(null);
  const [modal, setModal] = useState<string | null>(null);
  const load = useCallback(() => { api.get(`/bookings/${id}`).then(setD).catch(() => setD({ missing: true })); }, [id]);
  useEffect(load, [load]);
  if (!d) return <Spinner />;
  if (d.missing) return <Empty title="Booking not found"><Link to="/bookings" className="text-brand-700">Back to bookings</Link></Empty>;
  const b = d.booking;
  const manage = can('mobility.manage');
  const stepIdx = STEPS.indexOf(b.status);
  const minFare = Math.min(...d.quotations.map((q: any) => Number(q.fare)));
  const minArr = d.quotations.reduce((m: string | null, q: any) => (!m || q.arrival_at < m ? q.arrival_at : m), null);

  const act = async (path: string, body?: unknown, msg = 'Saved.') => {
    try { await api.post(`/bookings/${id}/${path}`, body); toast('success', msg); setModal(null); load(); return true; }
    catch (e) { if (e instanceof ApiError) toast('error', e.message); return false; }
  };
  const removeQuote = async (qid: number) => {
    try { await api.del(`/bookings/${id}/quotations/${qid}`); load(); } catch (e) { if (e instanceof ApiError) toast('error', e.message); }
  };

  let primary: ReactNode = null;
  if (manage && ['pending_booking', 'quotation_received'].includes(b.status)) primary = <Button icon={<Plus className="size-4" />} onClick={() => setModal('quote')}>Add quotation</Button>;
  if (b.status === 'approval_pending' && d.canDecide) primary = <><Button variant="secondary" icon={<X className="size-4" />} onClick={() => setModal('reject')}>Reject</Button><Button icon={<Check className="size-4" />} onClick={() => setModal('approve')}>Approve</Button></>;
  if (manage && b.status === 'approved') primary = <Button icon={<Ticket className="size-4" />} onClick={() => setModal('book')}>Record booking (PNR)</Button>;
  if (manage && b.status === 'ticket_booked') primary = <Button icon={<Ticket className="size-4" />} onClick={() => setModal('issue')}>Issue ticket</Button>;
  if (manage && b.status === 'ticket_issued') primary = <Button icon={<PlaneLanding className="size-4" />} onClick={() => setModal('complete')}>Confirm arrival</Button>;

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link to="/bookings" className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Flight bookings</Link>
      <section className="card p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <Avatar name={b.full_name} photoId={b.photo_document_id} />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-lg font-semibold text-slate-900">{b.booking_no}</h1><BookingStatus status={b.status} /></div>
              <div className="text-sm text-slate-500"><Link to={`/candidates/${b.candidate_id}`} className="font-medium text-brand-700 hover:underline">{b.full_name}</Link> · {b.reference_no} · {b.project} · <StatusBadge status={b.candidate_status} /></div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            {primary}
            {manage && [...STEPS.slice(0, 5), 'ticket_issued'].includes(b.status) && <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Ban className="size-4" />} onClick={() => setModal('cancel')}>Cancel booking</Button>}
          </div>
        </div>
        {b.status !== 'cancelled' ? (
          <ol className="scroll-thin mt-5 flex overflow-x-auto">
            {STEPS.map((s, i) => (
              <li key={s} className="flex min-w-28 flex-1 flex-col items-center text-center">
                <div className="flex w-full items-center">
                  <div className={cx('h-0.5 flex-1', i === 0 ? 'bg-transparent' : i <= stepIdx ? 'bg-brand-500' : 'bg-slate-200')} />
                  <span className={cx('grid size-7 shrink-0 place-items-center rounded-full text-xs font-semibold', i < stepIdx ? 'bg-brand-500 text-white' : i === stepIdx ? 'bg-navy-900 text-white ring-4 ring-brand-100' : 'bg-slate-100 text-slate-400')}>
                    {i < stepIdx ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                  </span>
                  <div className={cx('h-0.5 flex-1', i === STEPS.length - 1 ? 'bg-transparent' : i < stepIdx ? 'bg-brand-500' : 'bg-slate-200')} />
                </div>
                <span className={cx('mt-1.5 px-1 text-[11px] leading-tight', i === stepIdx ? 'font-semibold text-slate-900' : 'text-slate-500')}>{enumLabel('booking_status', s)}</span>
              </li>
            ))}
          </ol>
        ) : <div className="mt-4"><Alert tone="error">Cancelled: {b.cancel_reason}</Alert></div>}
        {b.status === 'approval_pending' && !d.canDecide && (
          <div className="mt-4"><Alert tone="info">Submitted by {b.submitted_by_name || '—'}; waiting for an approver (CEO / Management or HR Manager). {can('mobility.approve') ? 'You submitted this request, so someone else must approve it.' : ''}</Alert></div>
        )}
        {b.decision_remarks && ['quotation_received', 'approval_pending', 'approved'].includes(b.status) && (
          <div className="mt-3 text-sm text-slate-600"><span className="font-medium">{b.status === 'quotation_received' ? 'Rejected: ' : 'Note: '}</span>{b.decision_remarks}</div>
        )}
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-5">
          <Card title="Travel details">
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-3">
              {([
                ['Route', `${b.departure_city}, ${b.departure_country} → ${enumLabel('airport', b.arrival_airport)}`],
                ['Preferred travel date', fmtDate(b.preferred_travel_date)], ['Confirmed travel date', fmtDate(b.confirmed_travel_date)],
                ['Airline / flight', b.airline ? `${b.airline} ${b.flight_number || ''}` : '—'], ['Departure (local)', fmtTs(b.departure_at)],
                ['Arrival (UAE)', b.arrival_at ? `${fmtTs(b.arrival_at)}${b.arrival_terminal ? ` · ${b.arrival_terminal}` : ''}` : '—'],
                ['Transit', b.transit_details || 'Direct / —'], ['Baggage', b.baggage_allowance || '—'], ['Ticket cost', b.ticket_cost ? fmtMoney(b.ticket_cost) : '—'],
                ['Travel agency', b.agency_name || '—'], ['Booking ref. / PNR', b.booking_reference || '—'], ['Booking confirmed', fmtDate(b.booking_confirmation_date)],
                ['Requested by', b.requested_by_name || '—'], ['Approved by', b.approved_by_name ? `${b.approved_by_name}, ${fmtDateTime(b.approved_at)}` : '—'],
                ['E-ticket', b.eticket_document_id ? <a className="inline-flex items-center gap-1 text-brand-700 hover:underline" href={`/api/documents/${b.eticket_document_id}/file`} target="_blank" rel="noreferrer"><FileText className="size-3.5" />View e-ticket</a> : '—'],
              ] as [string, ReactNode][]).map(([k, v]) => <div key={k}><dt className="text-xs font-medium text-slate-500">{k}</dt><dd className="mt-0.5 text-slate-800">{v}</dd></div>)}
            </dl>
            {b.remarks && <p className="mt-4 border-t border-slate-100 pt-3 text-sm text-slate-600">{b.remarks}</p>}
          </Card>

          <Card title={`Quotations (${d.quotations.length})`} bodyClass="p-0" actions={manage && ['pending_booking', 'quotation_received'].includes(b.status) && <Button size="sm" variant="subtle" icon={<Plus className="size-3.5" />} onClick={() => setModal('quote')}>Add</Button>}>
            {d.quotations.length === 0 ? <Empty icon={<Plane className="size-6" />} title="No quotations yet">Request quotes from two or more approved agencies and record them here to compare.</Empty> : (
              <div className="scroll-thin overflow-x-auto">
                <table className="min-w-full divide-y divide-slate-100">
                  <thead className="bg-slate-50/80"><tr><th className="th pl-4">Agency</th><th className="th">Flight</th><th className="th">Departs (local)</th><th className="th">Arrives (UAE)</th><th className="th">Baggage / transit</th><th className="th text-right">Fare</th><th className="th">Valid until</th><th className="th" /></tr></thead>
                  <tbody className="divide-y divide-slate-100">
                    {d.quotations.map((q: any) => (
                      <tr key={q.id} className={q.is_selected ? 'bg-brand-50/60' : ''}>
                        <td className="td pl-4"><div className="font-medium">{q.agency_name}</div><div className="text-xs text-slate-500">{q.quote_reference || ''}</div></td>
                        <td className="td">{q.airline}<div className="text-xs text-slate-500">{q.flight_number || ''}</div></td>
                        <td className="td">{fmtTs(q.departure_at)}</td>
                        <td className="td">{fmtTs(q.arrival_at)}{q.arrival_at === minArr && d.quotations.length > 1 && <div><Badge tone="cyan">Earliest arrival</Badge></div>}</td>
                        <td className="td text-xs">{q.baggage_allowance || '—'}<div className="max-w-48 truncate text-slate-500">{q.transit_details || 'Direct'}</div></td>
                        <td className="td text-right font-semibold tabular-nums">{fmtMoney(q.fare)}{Number(q.fare) === minFare && d.quotations.length > 1 && <div><Badge tone="green">Lowest</Badge></div>}</td>
                        <td className="td text-xs">{fmtDate(q.valid_until)}</td>
                        <td className="td text-right">
                          {q.is_selected && <Badge tone="indigo">Selected</Badge>}
                          {manage && b.status === 'quotation_received' && <div className="flex justify-end gap-1">
                            <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => act('submit', { quotation_id: q.id }, 'Submitted for approval.')}>Select & submit</Button>
                            <Button size="sm" variant="ghost" className="text-red-600" icon={<Trash2 className="size-3.5" />} onClick={() => removeQuote(q.id)} aria-label="Delete quotation" />
                          </div>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card title="Airport pickup" actions={d.pickup && <PickupBadge status={d.pickup.status} />}>
            {!d.pickup ? <p className="text-sm text-slate-500">Created automatically when the ticket is issued.</p> : (
              <dl className="space-y-2 text-sm">
                <div><dt className="text-xs text-slate-500">Arrival</dt><dd>{fmtTs(d.pickup.arrival_at)} · {d.pickup.airport} {d.pickup.terminal || ''} · {d.pickup.flight_number}</dd></div>
                <div><dt className="text-xs text-slate-500">Vehicle / driver</dt><dd>{d.pickup.vehicle_registration ? `${d.pickup.vehicle_registration} · ${d.pickup.driver_name} (${d.pickup.driver_phone})` : <span className="font-medium text-red-600">Not assigned</span>}</dd></div>
                <div><dt className="text-xs text-slate-500">Coordinator</dt><dd>{d.pickup.coordinator_name || '—'}</dd></div>
                {d.pickup.actual_pickup_at && <div><dt className="text-xs text-slate-500">Picked up</dt><dd>{fmtTs(d.pickup.actual_pickup_at)}</dd></div>}
                {d.pickup.remarks && <div><dt className="text-xs text-slate-500">Remarks</dt><dd>{d.pickup.remarks}</dd></div>}
                <Link to="/pickups" className="inline-block pt-1 text-sm font-medium text-brand-700 hover:underline">Open pickup schedule →</Link>
              </dl>
            )}
          </Card>
          <Card title="Activity" bodyClass="p-0">
            <ul className="divide-y divide-slate-100">
              {d.history.map((h: any) => (
                <li key={h.id} className="px-4 py-2.5 text-sm">
                  <div className="flex justify-between gap-2"><span className="font-medium capitalize text-slate-800">{h.action.replace(/_/g, ' ')}{h.new_values?.status ? ` → ${enumLabel('booking_status', h.new_values.status)}` : ''}</span><span className="shrink-0 text-xs text-slate-400">{fmtDateTime(h.created_at)}</span></div>
                  <div className="text-xs text-slate-500">{h.username}{h.new_values?.fare ? ` · quote ${fmtMoney(h.new_values.fare)}` : ''}{h.new_values?.decision_remarks ? ` · ${h.new_values.decision_remarks}` : ''}{h.new_values?.cancel_reason ? ` · ${h.new_values.cancel_reason}` : ''}</div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      </div>

      {modal === 'quote' && <QuoteModal bookingId={Number(id)} onClose={() => setModal(null)} onDone={() => { setModal(null); load(); }} />}
      {modal === 'approve' && <SimpleModal title="Approve quotation" cta="Approve" label="Remarks (optional)" onClose={() => setModal(null)} onSubmit={(remarks) => act('decide', { decision: 'approve', remarks }, 'Approved. The selected quote is now on the booking.')} />}
      {modal === 'reject' && <SimpleModal title="Reject quotation" cta="Reject" danger required label="Reason" onClose={() => setModal(null)} onSubmit={(remarks) => act('decide', { decision: 'reject', remarks }, 'Rejected; back to quotations.')} />}
      {modal === 'cancel' && <SimpleModal title="Cancel booking" cta="Cancel booking" danger required label="Reason" note={b.status === 'ticket_issued' ? 'The candidate goes back to Pre-arrival Processing and the airport pickup is cancelled. Arrange the ticket refund with the agency.' : undefined} onClose={() => setModal(null)} onSubmit={(reason) => act('cancel', { reason }, 'Booking cancelled.')} />}
      {modal === 'complete' && <SimpleModal title="Confirm arrival in the UAE" cta="Confirm arrival" note={`Marks the travel as completed and the candidate as Arrived in UAE. Normally this happens automatically when the airport pickup is confirmed.`} onClose={() => setModal(null)} onSubmit={() => act('complete', {}, 'Arrival confirmed.')} />}
      {modal === 'book' && <BookModal onClose={() => setModal(null)} onSubmit={(v) => act('book', v, 'Booking recorded.')} />}
      {modal === 'issue' && <IssueModal booking={b} onClose={() => setModal(null)} onDone={() => { setModal(null); toast('success', 'Ticket issued. Pickup created and candidate marked Travel Confirmed.'); load(); }} />}
    </div>
  );
}

function SimpleModal({ title, cta, label, note, required, danger, onClose, onSubmit }: { title: string; cta: string; label?: string; note?: string; required?: boolean; danger?: boolean; onClose: () => void; onSubmit: (text: string) => Promise<boolean> }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const go = async () => { if (required && !text.trim()) return setErr('Required.'); setBusy(true); await onSubmit(text); setBusy(false); };
  return (
    <Modal open onClose={onClose} title={title} size="sm" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant={danger ? 'danger' : 'primary'} loading={busy} onClick={go}>{cta}</Button></>}>
      <div className="space-y-3">{note && <p className="text-sm text-slate-600">{note}</p>}
        {label && <Field label={label} required={required} error={err}><textarea rows={3} className="input" value={text} onChange={(e) => setText(e.target.value)} /></Field>}</div>
    </Modal>
  );
}

function BookModal({ onClose, onSubmit }: { onClose: () => void; onSubmit: (v: any) => Promise<boolean> }) {
  const [f, setF] = useState({ booking_reference: '', booking_confirmation_date: new Date().toISOString().slice(0, 10) });
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title="Record ticket booking" size="sm" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={async () => { setBusy(true); await onSubmit(f); setBusy(false); }}>Save</Button></>}>
      <div className="space-y-3">
        <Field label="Booking reference / PNR" required><input className="input uppercase" value={f.booking_reference} onChange={(e) => setF({ ...f, booking_reference: e.target.value })} /></Field>
        <Field label="Booking confirmation date" required><input type="date" className="input" value={f.booking_confirmation_date} onChange={(e) => setF({ ...f, booking_confirmation_date: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

function IssueModal({ booking, onClose, onDone }: { booking: any; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ flight_number: booking.flight_number || '', departure_at: toLocalInput(booking.departure_at), arrival_at: toLocalInput(booking.arrival_at), arrival_terminal: booking.arrival_terminal || '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return setErr({ file: 'Upload the e-ticket (PDF, JPG or PNG).' });
    setBusy(true); setErr({});
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) fd.append(k, v);
    fd.append('file', file);
    try { await api.post(`/bookings/${booking.id}/issue`, fd); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Issue ticket" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={submit}>Issue ticket</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><Alert tone="info">Confirm the final flight details from the e-ticket. The e-ticket is filed in the candidate's documents and an airport pickup is created.</Alert></div>
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Flight number" required error={err.flight_number}><input className="input uppercase" value={f.flight_number} onChange={(e) => setF({ ...f, flight_number: e.target.value })} /></Field>
        <Field label="Arrival terminal" error={err.arrival_terminal}><input className="input" value={f.arrival_terminal} onChange={(e) => setF({ ...f, arrival_terminal: e.target.value })} /></Field>
        <Field label="Departure (local time at origin)" required error={err.departure_at}><input type="datetime-local" className="input" value={f.departure_at} onChange={(e) => setF({ ...f, departure_at: e.target.value })} /></Field>
        <Field label="Arrival (UAE time)" required error={err.arrival_at}><input type="datetime-local" className="input" value={f.arrival_at} onChange={(e) => setF({ ...f, arrival_at: e.target.value })} /></Field>
        <Field label="E-ticket" required error={err.file} className="sm:col-span-2"><input type="file" accept=".pdf,.jpg,.jpeg,.png" className="input" onChange={(e) => setFile(e.target.files?.[0] || null)} /></Field>
      </div>
    </Modal>
  );
}

function QuoteModal({ bookingId, onClose, onDone }: { bookingId: number; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const toast = useToast();
  const approved = (options?.travelAgencies || []).filter((a) => a.is_approved);
  const [f, setF] = useState<any>({ travel_agency_id: '', quote_reference: '', airline: '', flight_number: '', departure_at: '', arrival_at: '', arrival_terminal: '', transit_details: '', baggage_allowance: '30 kg', fare: '', valid_until: '', remarks: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const inp = (k: string, label: string, type = 'text', required = false, cls = '') => (
    <Field label={label} required={required} error={err[k]} className={cls}><input type={type} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></Field>
  );
  const submit = async () => {
    setBusy(true); setErr({});
    try { await api.post(`/bookings/${bookingId}/quotations`, f); toast('success', 'Quotation added.'); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Add agency quotation" size="lg" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={submit}>Add quotation</Button></>}>
      <div className="grid gap-3 sm:grid-cols-3">
        {err._ && <div className="sm:col-span-3"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Travel agency" required error={err.travel_agency_id} className="sm:col-span-2">
          <select className="input" value={f.travel_agency_id} onChange={(e) => setF({ ...f, travel_agency_id: e.target.value })}>
            <option value="">Select an approved agency…</option>{approved.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
          </select>
        </Field>
        {inp('quote_reference', 'Quote reference')}
        {inp('airline', 'Airline', 'text', true)}{inp('flight_number', 'Flight number')}{inp('arrival_terminal', 'Arrival terminal')}
        {inp('departure_at', 'Departure (local time)', 'datetime-local', true)}{inp('arrival_at', 'Arrival (UAE time)', 'datetime-local', true)}{inp('baggage_allowance', 'Baggage allowance')}
        {inp('fare', 'Fare (AED)', 'text', true)}{inp('valid_until', 'Valid until', 'date')}
        <div />
        {inp('transit_details', 'Transit details', 'text', false, 'sm:col-span-3')}
        {inp('remarks', 'Remarks', 'text', false, 'sm:col-span-3')}
      </div>
    </Modal>
  );
}

