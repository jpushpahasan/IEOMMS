import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Archive, ArchiveRestore, ArrowLeft, Ban, BedDouble, Check, ListChecks, Plane, ShieldCheck, Wallet, Circle, Clock, Download, Eye, FileText, History, Pause, Pencil, Play, Send, Upload, Undo2 } from 'lucide-react';
import { api, ApiError } from '../lib/api';
import { useApp } from '../lib/app';
import { age, daysUntil, fileSize, fmtDate, fmtDateTime, fmtMoney, fmtTs } from '../lib/format';
import { BookingStatus, NewBookingModal } from './mobility/Bookings';
import { Checklist } from './onboarding/Checklist';
import { ClearancePanel } from './control/Deployment';
import { Expenses } from './control/Finance';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, Spinner, useToast } from '../components/ui';
import { Avatar, StatusBadge } from './Candidates';

type Tab = 'overview' | 'checklist' | 'timeline' | 'travel' | 'accommodation' | 'clearance' | 'costs' | 'documents' | 'audit';

export function CandidateProfile() {
  const { id } = useParams();
  const [sp, setSp] = useSearchParams();
  const tab = (sp.get('tab') as Tab) || 'overview';
  const { can, enumLabel } = useApp();
  const nav = useNavigate();
  const toast = useToast();
  const [data, setData] = useState<{ candidate: any; history: any[] } | null>(null);
  const [docs, setDocs] = useState<any[] | null>(null);
  const [journey, setJourney] = useState<{ bookings: any[]; pickup: any; allocations: any[] } | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(() => {
    api.get(`/candidates/${id}`).then(setData).catch((e) => { if (e instanceof ApiError && e.status === 404) setNotFound(true); });
    if (can('documents.view')) api.get(`/candidates/${id}/documents`).then(setDocs).catch(() => setDocs([]));
    api.get(`/candidates/${id}/journey`).then(setJourney).catch(() => setJourney({ bookings: [], pickup: null, allocations: [] }));
  }, [id, can]);
  useEffect(load, [load]);

  if (notFound) return <Empty title="Candidate not found"><Link className="text-brand-700" to="/candidates">Back to candidates</Link></Empty>;
  if (!data) return <Spinner />;
  const c = data.candidate;
  const pd = daysUntil(c.passport_expiry_date);
  const st = c.status as string;

  const archive = async (restore: boolean) => {
    try {
      await api.post(`/candidates/${id}/archive`, { restore });
      toast('success', restore ? 'Candidate restored.' : 'Candidate archived. The record is kept for history and reports.');
      load();
    } catch (e) { if (e instanceof ApiError) toast('error', e.message); }
  };

  const tabs: [Tab, string, ReactNode][] = [
    ['overview', 'Profile', <FileText key="o" className="size-4" />],
    ...(can('onboarding.view') ? [['checklist', 'Checklist', <ListChecks key="cl" className="size-4" />] as [Tab, string, ReactNode]] : []),
    ['timeline', 'Onboarding timeline', <Clock key="t" className="size-4" />],
    ['travel', 'Travel', <Plane key="tr" className="size-4" />],
    ['accommodation', 'Accommodation', <BedDouble key="ac" className="size-4" />],
    ...(can('onboarding.view') ? [['clearance', 'Clearance', <ShieldCheck key="cr" className="size-4" />] as [Tab, string, ReactNode]] : []),
    ...(can('finance.view') ? [['costs', 'Costs', <Wallet key="co" className="size-4" />] as [Tab, string, ReactNode]] : []),
    ...(can('documents.view') ? [['documents', `Documents${docs ? ` (${docs.filter((d) => d.is_current).length})` : ''}`, <Upload key="d" className="size-4" />] as [Tab, string, ReactNode]] : []),
    ['audit', 'Change history', <History key="a" className="size-4" />],
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <Link to="/candidates" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800"><ArrowLeft className="size-4" />Candidates</Link>
      {c.is_archived && <div className="mb-4"><Alert tone="warning">This candidate was archived on {fmtDateTime(c.archived_at)}{c.archived_by_name ? ` by ${c.archived_by_name}` : ''}. Archived records are read-only.</Alert></div>}

      <section className="card mb-5 overflow-hidden">
        <div className="h-16 bg-gradient-to-r from-navy-900 via-navy-800 to-brand-700" />
        <div className="flex flex-col gap-4 px-5 pb-5 sm:flex-row sm:items-end">
          <div className="-mt-10"><Avatar name={c.full_name} photoId={c.photo_document_id} size="lg" /></div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold text-slate-900">{c.full_name}</h1>
              <StatusBadge status={st} />
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-slate-500">
              <span className="font-mono text-slate-700">{c.reference_no}</span>
              <span>{c.position} · {c.trade}</span>
              <span>{c.nationality}</span>
              <span>{c.project}</span>
            </div>
            {c.status_reason && ['on_hold', 'cancelled'].includes(st) && (
              <div className="mt-2 text-sm text-slate-600"><span className="font-medium">{st === 'cancelled' ? `Cancelled (${enumLabel('cancel_category', c.cancel_category)})` : 'On hold'}:</span> {c.status_reason}</div>
            )}
          </div>
          {!c.is_archived && (
            <div className="flex flex-wrap gap-2">
              {can('candidates.edit') && <Button variant="secondary" icon={<Pencil className="size-4" />} onClick={() => nav(`/candidates/${id}/edit`)}>Edit</Button>}
              {can('candidates.status') && st === 'selected' && <Button variant="subtle" icon={<Send className="size-4" />} onClick={() => setAction('pre_arrival')}>Start pre-arrival</Button>}
              {can('candidates.status') && st === 'pre_arrival' && <Button variant="ghost" icon={<Undo2 className="size-4" />} onClick={() => setAction('selected')}>Back to Selected</Button>}
              {can('candidates.status') && st === 'on_hold' && <Button variant="subtle" icon={<Play className="size-4" />} onClick={() => setAction('resume')}>Resume</Button>}
              {can('candidates.status') && !['on_hold', 'cancelled', 'deployed'].includes(st) && <Button variant="secondary" icon={<Pause className="size-4" />} onClick={() => setAction('hold')}>Hold</Button>}
              {can('candidates.status') && !['cancelled', 'deployed'].includes(st) && <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<Ban className="size-4" />} onClick={() => setAction('cancel')}>Cancel</Button>}
              {can('candidates.archive') && st === 'cancelled' && <Button variant="secondary" icon={<Archive className="size-4" />} onClick={() => archive(false)}>Archive</Button>}
            </div>
          )}
          {c.is_archived && can('candidates.archive') && <Button variant="secondary" icon={<ArchiveRestore className="size-4" />} onClick={() => archive(true)}>Restore</Button>}
        </div>
        {pd !== null && pd < 183 && !['cancelled', 'deployed'].includes(st) && (
          <div className="border-t border-amber-100 bg-amber-50 px-5 py-2 text-sm text-amber-900">
            {pd < 0 ? 'Passport has expired.' : `Passport expires in ${pd} days (${fmtDate(c.passport_expiry_date)}) — under the 6-month validity normally required for UAE entry and visa processing.`}
          </div>
        )}
        <nav className="scroll-thin flex gap-1 overflow-x-auto border-t border-slate-100 px-3">
          {tabs.map(([k, label, icon]) => (
            <button key={k} onClick={() => setSp({ tab: k }, { replace: true })}
              className={cx('flex items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium whitespace-nowrap', tab === k ? 'border-brand-600 text-brand-700' : 'border-transparent text-slate-500 hover:text-slate-800')}>
              {icon}{label}
            </button>
          ))}
        </nav>
      </section>

      {tab === 'overview' && <Overview c={c} />}
      {tab === 'checklist' && <Checklist candidate={c} onChange={load} />}
      {tab === 'timeline' && <Timeline c={c} history={data.history} docs={docs || []} journey={journey} />}
      {tab === 'travel' && journey && <TravelTab c={c} journey={journey} onChange={load} />}
      {tab === 'accommodation' && journey && <AccommodationTab journey={journey} />}
      {tab === 'clearance' && <Card title="Final clearance & deployment"><ClearancePanel candidateId={c.id} onChange={load} /></Card>}
      {tab === 'costs' && <Expenses candidateId={c.id} />}
      {tab === 'documents' && docs && <Documents candidateId={Number(id)} docs={docs} readOnly={c.is_archived || !can('documents.upload')} onChange={load} />}
      {tab === 'audit' && <AuditTrail candidateId={Number(id)} />}

      <StatusModal action={action} candidateId={Number(id)} onClose={() => setAction(null)} onDone={() => { setAction(null); load(); }} />
    </div>
  );
}

// ------------------------------------------------------------------ overview
function Dl({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-sm break-words whitespace-pre-line text-slate-800">{v === null || v === undefined || v === '' ? <span className="text-slate-400">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

function Overview({ c }: { c: any }) {
  const { enumLabel, enumTone, can } = useApp();
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card title="Personal information">
        <Dl items={[
          ['Full name (passport)', c.full_name], ['Gender', enumLabel('gender', c.gender)],
          ['Date of birth', `${fmtDate(c.date_of_birth)} (${age(c.date_of_birth)} yrs)`], ['Nationality', c.nationality],
          ['Marital status', c.marital_status ? enumLabel('marital_status', c.marital_status) : null], ['Contact number', c.contact_number],
          ['Email', c.email], ['Current address', c.current_address],
          ['Emergency contact', c.emergency_contact_name ? `${c.emergency_contact_name}${c.emergency_contact_relation ? ` (${c.emergency_contact_relation})` : ''}` : null],
          ['Emergency number', c.emergency_contact_phone],
        ]} />
      </Card>
      <Card title="Passport">
        <Dl items={[
          ['Passport number', <span className="font-mono">{c.passport_number}</span>], ['Issuing country', c.passport_issuing_country],
          ['Issue date', fmtDate(c.passport_issue_date)], ['Expiry date', fmtDate(c.passport_expiry_date)],
        ]} />
      </Card>
      <Card title="Employment information">
        <Dl items={[
          ['Position', c.position], ['Trade', c.trade], ['Department', c.department], ['Employment category', enumLabel('employment_category', c.employment_category)],
          ['Project', `${c.project} (${c.project_code})`], ['Client', c.client], ['Work location', c.work_location],
          ['Selection date', fmtDate(c.selection_date)], ['Expected joining', fmtDate(c.expected_joining_date)],
          ['Offer letter', <Badge tone={enumTone('offer_letter_status', c.offer_letter_status)}>{enumLabel('offer_letter_status', c.offer_letter_status)}</Badge>],
          ['Employment contract', <Badge tone={enumTone('contract_status', c.contract_status)}>{enumLabel('contract_status', c.contract_status)}</Badge>],
          ['Recruitment agency', c.agency || 'Direct hire'], ['Source country', c.source_country], ['Recruitment coordinator', c.coordinator],
        ]} />
      </Card>
      {can('candidates.salary') ? (
        <Card title="Monthly salary package">
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-100">
              {[['Basic salary', c.basic_salary], ['Housing allowance', c.housing_allowance], ['Transport allowance', c.transport_allowance], ['Food allowance', c.food_allowance], ['Other allowances', c.other_allowance]].map(([k, v]) => (
                <tr key={k}><td className="py-2 text-slate-600">{k}</td><td className="py-2 text-right tabular-nums">{fmtMoney(v)}</td></tr>
              ))}
              <tr className="font-semibold"><td className="py-2.5 text-slate-900">Total monthly salary</td><td className="py-2.5 text-right text-navy-900 tabular-nums">{fmtMoney(c.total_salary)}</td></tr>
            </tbody>
          </table>
        </Card>
      ) : <div />}
      <Card title="Qualifications & experience" className="lg:col-span-2">
        <Dl items={[
          ['Educational qualifications', c.educational_qualifications], ['Professional qualifications', c.professional_qualifications],
          ['Work experience', c.work_experience], ['Licences / certifications', c.licences_certifications],
          ['Previous UAE employment', c.previous_uae_experience ? (c.previous_uae_details || 'Yes') : 'No'], ['Special requirements / remarks', c.remarks],
        ]} />
        <div className="mt-4 border-t border-slate-100 pt-3 text-xs text-slate-400">
          Registered {fmtDateTime(c.created_at)}{c.created_by_name ? ` by ${c.created_by_name}` : ''}{c.updated_at ? ` · Last updated ${fmtDateTime(c.updated_at)}${c.updated_by_name ? ` by ${c.updated_by_name}` : ''}` : ''}
        </div>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ timeline
type Milestone = { label: string; done: boolean; date?: string | null; note?: string; phase?: number };

function Timeline({ c, history, docs, journey }: { c: any; history: any[]; docs: any[]; journey: { bookings: any[]; pickup: any; allocations: any[] } | null }) {
  const { enumLabel } = useApp();
  const has = (cat: string) => docs.find((d) => d.category === cat && d.is_current);
  const started = history.find((h) => h.to_status === 'pre_arrival');
  const bk = journey?.bookings.find((b) => b.status !== 'cancelled');
  const arrived = history.find((h) => h.to_status === 'arrived');
  const pickup = journey?.pickup;
  const alloc = journey?.allocations.find((a) => ['allocated', 'checked_in', 'checked_out'].includes(a.status));
  const ticketed = bk && ['ticket_issued', 'travel_completed'].includes(bk.status);
  const [acts, setActs] = useState<any[]>([]);
  useEffect(() => { api.get(`/onboarding/candidates/${c.id}`).then((d) => setActs(d.activities)).catch(() => setActs([])); }, [c.id]);
  /** Milestone done when every applicable checklist activity in `seqs` is completed. */
  const fromChecklist = (label: string, seqs: number[]): Milestone => {
    const rows = acts.filter((a) => seqs.includes(a.seq) && a.status !== 'not_applicable');
    if (!rows.length) return { label, done: false, note: acts.length ? 'Not applicable' : 'No checklist' };
    const open = rows.filter((a) => a.status !== 'completed');
    const last = rows.map((a) => a.actual_completion_date).filter(Boolean).sort().pop();
    return { label, done: open.length === 0, date: open.length ? undefined : last,
      note: open.length ? `${rows.length - open.length}/${rows.length} done · next: ${open[0].name}${open[0].overdue ? ' (overdue)' : ''}` : undefined };
  };
  const ms: Milestone[] = [
    { label: 'Candidate selected', done: true, date: c.selection_date },
    { label: 'Documentation completed', done: !!(has('passport') && has('photograph')), date: has('passport')?.uploaded_at,
      note: !has('passport') || !has('photograph') ? `Missing: ${[!has('passport') && 'passport copy', !has('photograph') && 'photograph'].filter(Boolean).join(', ')}` : undefined },
    { label: 'Pre-arrival processing started', done: !!started, date: started?.changed_at },
    { label: 'Offer letter accepted', done: c.offer_letter_status === 'accepted', note: c.offer_letter_status !== 'accepted' ? enumLabel('offer_letter_status', c.offer_letter_status) : undefined },
    { label: 'Employment contract signed', done: c.contract_status === 'signed', note: c.contract_status !== 'signed' ? enumLabel('contract_status', c.contract_status) : undefined },
    { label: 'Flight ticket issued', done: !!ticketed, date: bk?.issued_at,
      note: ticketed ? undefined : bk ? `${bk.booking_no}: ${enumLabel('booking_status', bk.status)}` : 'No travel request yet' },
    { label: 'Employee arrived in UAE', done: !!arrived, date: arrived?.changed_at, note: !arrived && ticketed ? `Expected ${bk.arrival_at?.slice(0, 16)} at ${bk.arrival_airport}` : undefined },
    { label: 'Airport pickup completed', done: pickup?.status === 'completed', date: pickup?.actual_pickup_at,
      note: pickup && pickup.status !== 'completed' ? enumLabel('pickup_status', pickup.status) : undefined },
    { label: 'Accommodation allocated', done: !!alloc, date: alloc?.allocation_date,
      note: alloc ? undefined : 'No bed allocated' },
    { label: 'Accommodation check-in', done: !!alloc?.actual_checkin_date, date: alloc?.actual_checkin_date,
      note: alloc && !alloc.actual_checkin_date ? `Reserved: ${alloc.camp_name}, Room ${alloc.room_number}, Bed ${alloc.bed_number}` : undefined },
    fromChecklist('Visa medical completed', [17, 18]), fromChecklist('Occupational medical completed', [19, 20]),
    fromChecklist('Trade training completed', [25, 26, 31, 32]), fromChecklist('MOHRE awareness training completed', [28]),
    fromChecklist('Residence visa formalities completed', [21, 22, 23, 24]), fromChecklist('Uniform & PPE distributed', [33, 34, 35, 36, 38]),
    fromChecklist('Company induction completed', [39, 40, 41, 42, 43, 44, 45]),
    fromChecklist('Final clearance approved', [46]), fromChecklist('Deployment approved', [47]), fromChecklist('Employee deployed (reported to work)', [48]),
  ];
  const doneCount = ms.filter((m) => m.done).length;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title="Onboarding timeline" actions={<span className="text-xs text-slate-500">{doneCount} of {ms.length} milestones</span>}>
        <div className="mb-5 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand-500" style={{ width: `${(doneCount / ms.length) * 100}%` }} /></div>
        <ol className="relative ml-3 border-l-2 border-slate-100">
          {ms.map((m, i) => (
            <li key={i} className="relative pb-5 pl-6 last:pb-0">
              <span className={cx('absolute top-0.5 -left-[11px] grid size-5 place-items-center rounded-full ring-4 ring-white',
                m.done ? 'bg-emerald-500 text-white' : m.phase ? 'bg-slate-200 text-slate-400' : 'bg-amber-100 text-amber-600')}>
                {m.done ? <Check className="size-3" strokeWidth={3} /> : <Circle className="size-2 fill-current" />}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cx('text-sm font-medium', m.done ? 'text-slate-900' : m.phase ? 'text-slate-400' : 'text-slate-700')}>{m.label}</span>
                {m.done && m.date && <span className="text-xs text-slate-500">{m.date.length > 10 ? fmtDateTime(m.date) : fmtDate(m.date)}</span>}
                {!m.done && !m.phase && <Badge tone="amber">Pending</Badge>}
                {m.phase && <span className="text-[11px] text-slate-400">tracked from Phase {m.phase}</span>}
              </div>
              {m.note && !m.done && <div className="mt-0.5 text-xs text-slate-500">{m.note}</div>}
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Status history">
        <ol className="space-y-3">
          {[...history].reverse().map((h) => (
            <li key={h.id} className="text-sm">
              <div className="flex flex-wrap items-center gap-1.5">
                {h.from_status && <><StatusBadge status={h.from_status} /><span className="text-slate-400">→</span></>}
                <StatusBadge status={h.to_status} />
              </div>
              {h.reason && <div className="mt-1 text-slate-600">{h.reason}</div>}
              <div className="mt-0.5 text-xs text-slate-400">{fmtDateTime(h.changed_at)}{h.changed_by_name ? ` · ${h.changed_by_name}` : ''}</div>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ travel & accommodation
function TravelTab({ c, journey, onChange }: { c: any; journey: { bookings: any[]; pickup: any }; onChange: () => void }) {
  const { can, enumLabel, enumTone } = useApp();
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const active = journey.bookings.find((b) => b.status !== 'cancelled');
  const canRequest = can('mobility.manage') && !active && ['selected', 'pre_arrival'].includes(c.status) && !c.is_archived;
  const p = journey.pickup;
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Card title="Flight bookings" bodyClass="p-0" actions={canRequest && <Button size="sm" icon={<Plane className="size-3.5" />} onClick={() => setOpen(true)}>New travel request</Button>}>
        {journey.bookings.length === 0 ? <Empty icon={<Plane className="size-6" />} title="No travel arranged yet" /> : (
          <ul className="divide-y divide-slate-100">
            {journey.bookings.map((b) => (
              <li key={b.id} className="px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  {can('mobility.view') ? <Link to={`/bookings/${b.id}`} className="font-mono text-sm font-medium text-brand-700 hover:underline">{b.booking_no}</Link> : <span className="font-mono text-sm">{b.booking_no}</span>}
                  <BookingStatus status={b.status} />
                </div>
                <div className="mt-1 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-2">
                  <span>{b.departure_city}, {b.departure_country} → {enumLabel('airport', b.arrival_airport)}</span>
                  <span>{b.flight_number ? `${b.airline} ${b.flight_number}` : `Preferred ${fmtDate(b.preferred_travel_date)}`}</span>
                  {b.departure_at && <span>Departs {fmtTs(b.departure_at)} (local)</span>}
                  {b.arrival_at && <span>Arrives {fmtTs(b.arrival_at)} (UAE){b.arrival_terminal ? ` · ${b.arrival_terminal}` : ''}</span>}
                  {b.booking_reference && <span>PNR {b.booking_reference}{b.agency_name ? ` · ${b.agency_name}` : ''}</span>}
                  {b.ticket_cost && <span>Ticket {fmtMoney(b.ticket_cost)}</span>}
                  {b.cancel_reason && <span className="text-red-600 sm:col-span-2">Cancelled: {b.cancel_reason}</span>}
                </div>
                {b.eticket_document_id && can('documents.view') && <a className="mt-1 inline-flex items-center gap-1 text-sm text-brand-700 hover:underline" href={`/api/documents/${b.eticket_document_id}/file`} target="_blank" rel="noreferrer"><FileText className="size-3.5" />E-ticket</a>}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Airport pickup">
        {!p ? <p className="text-sm text-slate-500">Created when the ticket is issued.</p> : (
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd><Badge tone={enumTone('pickup_status', p.status)}>{enumLabel('pickup_status', p.status)}</Badge></dd></div>
            <div><dt className="text-xs text-slate-500">Arrival</dt><dd>{fmtTs(p.arrival_at)} · {p.airport} {p.terminal || ''} · {p.flight_number}</dd></div>
            <div><dt className="text-xs text-slate-500">Vehicle & driver</dt><dd>{p.vehicle_registration ? `${p.vehicle_registration} · ${p.driver_name} (${p.driver_phone})` : 'Not assigned'}</dd></div>
            <div><dt className="text-xs text-slate-500">Coordinator</dt><dd>{p.coordinator_name || '—'}</dd></div>
            {p.actual_pickup_at && <div><dt className="text-xs text-slate-500">Picked up</dt><dd>{fmtTs(p.actual_pickup_at)}</dd></div>}
            {p.remarks && <div><dt className="text-xs text-slate-500">Arrival remarks</dt><dd>{p.remarks}</dd></div>}
          </dl>
        )}
      </Card>
      {open && <NewBookingModal candidateId={c.id} onClose={() => setOpen(false)} onDone={(bid) => { setOpen(false); onChange(); nav(`/bookings/${bid}`); }} />}
    </div>
  );
}

function AccommodationTab({ journey }: { journey: { allocations: any[] } }) {
  const { enumLabel, enumTone, can } = useApp();
  return (
    <Card title="Accommodation history" bodyClass="p-0" actions={can('accommodation.manage') && <Link to="/accommodation" className="text-sm font-medium text-brand-700 hover:underline">Open accommodation →</Link>}>
      {journey.allocations.length === 0 ? <Empty icon={<BedDouble className="size-6" />} title="No accommodation allocated" /> : (
        <ul className="divide-y divide-slate-100">
          {journey.allocations.map((a) => (
            <li key={a.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2"><span className="font-medium text-slate-800">{a.camp_name} · {a.block ? `${a.block} · ` : ''}Room {a.room_number} · Bed {a.bed_number}</span>
                <Badge tone={enumTone('allocation_status', a.status)}>{enumLabel('allocation_status', a.status)}</Badge></div>
              <div className="mt-1 grid gap-x-6 gap-y-1 text-sm text-slate-600 sm:grid-cols-3">
                <span>Allocated {fmtDate(a.allocation_date)}</span><span>Expected check-in {fmtDate(a.expected_checkin_date)}</span>
                <span>Checked in {fmtDate(a.actual_checkin_date)}</span>
                {a.checkout_date && <span>Checked out {fmtDate(a.checkout_date)}</span>}
                <span className="sm:col-span-2">Supervisor: {a.supervisor_name || '—'} {a.supervisor_phone ? `(${a.supervisor_phone})` : ''} · {a.location}</span>
                {a.remarks && <span className="sm:col-span-3 text-slate-500">{a.remarks}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ documents
function Documents({ candidateId, docs, readOnly, onChange }: { candidateId: number; docs: any[]; readOnly: boolean; onChange: () => void }) {
  const { options, enumLabel } = useApp();
  const [upload, setUpload] = useState<{ category?: string; replaces?: any } | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [showOld, setShowOld] = useState(false);
  const current = docs.filter((d) => d.is_current);
  const required = ['passport', 'photograph'];
  const missing = required.filter((r) => !current.some((d) => d.category === r));
  const list = showOld ? docs : current;

  return (
    <>
      {missing.length > 0 && !readOnly && (
        <div className="mb-4"><Alert tone="warning">Still required: {missing.map((m) => enumLabel('document_category', m)).join(', ')}.{' '}
          {missing.map((m) => <button key={m} className="ml-2 font-medium underline" onClick={() => setUpload({ category: m })}>Upload {enumLabel('document_category', m).toLowerCase()}</button>)}</Alert></div>
      )}
      <Card title="Document repository" bodyClass="p-0" actions={<>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="accent-brand-600" checked={showOld} onChange={(e) => setShowOld(e.target.checked)} />Show previous versions</label>
        {!readOnly && <Button size="sm" icon={<Upload className="size-3.5" />} onClick={() => setUpload({})}>Upload</Button>}
      </>}>
        {list.length === 0 ? <Empty icon={<FileText className="size-6" />} title="No documents uploaded yet">Passport copy and photograph are needed first.</Empty> : (
          <div className="scroll-thin overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-100">
              <thead className="bg-slate-50/80"><tr><th className="th pl-4">Category</th><th className="th">File</th><th className="th">Doc. no.</th><th className="th">Expiry</th><th className="th">Version</th><th className="th">Uploaded</th><th className="th" /></tr></thead>
              <tbody className="divide-y divide-slate-100">
                {list.map((d) => {
                  const ed = daysUntil(d.expiry_date);
                  return (
                    <tr key={d.id} className={d.is_current ? '' : 'bg-slate-50/60 text-slate-400'}>
                      <td className="td pl-4 font-medium">{enumLabel('document_category', d.category)}{d.title && <div className="text-xs font-normal text-slate-500">{d.title}</div>}</td>
                      <td className="td"><div className="max-w-[220px] truncate">{d.original_name}</div><div className="text-xs text-slate-400">{fileSize(d.size_bytes)}</div></td>
                      <td className="td font-mono text-xs">{d.document_number || '—'}</td>
                      <td className="td">{d.expiry_date ? <span className={cx(ed !== null && ed < 0 ? 'font-semibold text-red-600' : ed !== null && ed < 60 ? 'text-amber-700' : '')}>{fmtDate(d.expiry_date)}</span> : '—'}</td>
                      <td className="td">v{d.version}{!d.is_current && <span className="ml-1 text-xs">(superseded)</span>}</td>
                      <td className="td text-xs">{fmtDateTime(d.uploaded_at)}<div className="text-slate-400">{d.uploaded_by_name}</div></td>
                      <td className="td text-right">
                        <div className="flex justify-end gap-1">
                          <Button size="sm" variant="ghost" icon={<Eye className="size-3.5" />} onClick={() => setPreview(d)}>View</Button>
                          <a className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100" href={`/api/documents/${d.id}/file?download=1`}><Download className="size-3.5" />Download</a>
                          {d.is_current && !readOnly && <Button size="sm" variant="ghost" icon={<Upload className="size-3.5" />} onClick={() => setUpload({ category: d.category, replaces: d })}>New version</Button>}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {upload && options && <UploadModal candidateId={candidateId} init={upload} onClose={() => setUpload(null)} onDone={() => { setUpload(null); onChange(); }} />}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `${enumLabel('document_category', preview.category)} — v${preview.version}` : ''} size="xl">
        {preview && (preview.mime_type === 'application/pdf'
          ? <iframe title="Document preview" src={`/api/documents/${preview.id}/file`} className="h-[70vh] w-full rounded-lg border border-slate-200" />
          : <img src={`/api/documents/${preview.id}/file`} alt={preview.original_name} className="mx-auto max-h-[70vh] rounded-lg" />)}
      </Modal>
    </>
  );
}

function UploadModal({ candidateId, init, onClose, onDone }: { candidateId: number; init: { category?: string; replaces?: any }; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const toast = useToast();
  const [f, setF] = useState({ category: init.category || '', title: '', document_number: init.replaces?.document_number || '', issue_date: '', expiry_date: '', remarks: '' });
  const [file, setFile] = useState<File | null>(null);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!file) return setErr({ file: 'Choose a file.' });
    setBusy(true); setErr({});
    const fd = new FormData();
    for (const [k, v] of Object.entries(f)) if (v) fd.append(k, v);
    if (init.replaces) fd.append('replaces_id', String(init.replaces.id));
    fd.append('file', file);
    try {
      const r = await api.post(`/candidates/${candidateId}/documents`, fd);
      toast('success', r.version > 1 ? `Uploaded as version ${r.version}.` : 'Document uploaded.');
      onDone();
    } catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={init.replaces ? 'Upload new version' : 'Upload document'}
      footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={submit} loading={busy}>Upload</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        <Field label="Category" required error={err.category} className="sm:col-span-2">
          <select className="input" value={f.category} disabled={!!init.replaces} onChange={(e) => setF({ ...f, category: e.target.value })}>
            <option value="">Select…</option>
            {options!.enums.document_category.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </Field>
        <Field label="File (PDF, JPG or PNG, max 4 MB)" required error={err.file} className="sm:col-span-2">
          <input type="file" accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png" className="input file:mr-3 file:rounded-md file:border-0 file:bg-slate-100 file:px-3 file:py-1 file:text-sm" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        </Field>
        <Field label="Title / description" error={err.title} className="sm:col-span-2"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
        <Field label="Document number" error={err.document_number}><input className="input" value={f.document_number} onChange={(e) => setF({ ...f, document_number: e.target.value })} /></Field>
        <div />
        <Field label="Issue date" error={err.issue_date}><input type="date" className="input" value={f.issue_date} onChange={(e) => setF({ ...f, issue_date: e.target.value })} /></Field>
        <Field label="Expiry date" error={err.expiry_date}><input type="date" className="input" value={f.expiry_date} onChange={(e) => setF({ ...f, expiry_date: e.target.value })} /></Field>
        <Field label="Remarks" error={err.remarks} className="sm:col-span-2"><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
      </div>
    </Modal>
  );
}

// ------------------------------------------------------------------ audit trail
const FIELD_LABELS: Record<string, string> = { updated_by: '', status: 'Status', reason: 'Reason', is_archived: 'Archived' };
function AuditTrail({ candidateId }: { candidateId: number }) {
  const [rows, setRows] = useState<any[] | null>(null);
  useEffect(() => { api.get(`/candidates/${candidateId}/audit`).then(setRows); }, [candidateId]);
  if (!rows) return <Spinner />;
  const fmt = (v: unknown) => (v === null || v === undefined || v === '' ? '∅' : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const ACTION: Record<string, string> = { create: 'Registered', update: 'Edited', status_change: 'Status changed', archive: 'Archived', restore: 'Restored',
    document_upload: 'Document uploaded', document_version: 'New document version', document_download: 'Document downloaded' };
  return (
    <Card title="Change history" bodyClass="p-0">
      {rows.length === 0 ? <Empty title="No changes recorded" /> : (
        <ul className="divide-y divide-slate-100">
          {rows.map((r) => (
            <li key={r.id} className="px-4 py-3">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-medium text-slate-800">{ACTION[r.action] || r.action}</span>
                <span className="text-slate-500">by {r.username || 'system'}</span>
                <span className="ml-auto text-xs text-slate-400">{fmtDateTime(r.created_at)}</span>
              </div>
              {r.action === 'update' && r.new_values && (
                <div className="mt-1.5 space-y-0.5 text-xs">
                  {Object.keys(r.new_values).filter((k) => FIELD_LABELS[k] !== '').map((k) => (
                    <div key={k} className="text-slate-600"><span className="font-medium">{FIELD_LABELS[k] || k.replace(/_/g, ' ')}:</span>{' '}
                      <span className="text-red-600 line-through">{fmt(r.old_values?.[k])}</span> → <span className="text-emerald-700">{fmt(r.new_values[k])}</span></div>
                  ))}
                </div>
              )}
              {r.action === 'status_change' && <div className="mt-1 text-xs text-slate-600">{fmt(r.old_values?.status)} → {fmt(r.new_values?.status)}{r.new_values?.reason ? ` — ${r.new_values.reason}` : ''}</div>}
              {(r.action === 'document_upload' || r.action === 'document_version') && <div className="mt-1 text-xs text-slate-600">{r.new_values?.original_name} (v{r.new_values?.version})</div>}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ------------------------------------------------------------------ status modal
const ACTIONS: Record<string, { title: string; text: string; reason: boolean; cta: string; danger?: boolean }> = {
  pre_arrival: { title: 'Start pre-arrival processing', text: 'Moves the candidate to Pre-arrival Processing (contract, permits, travel preparation).', reason: false, cta: 'Start pre-arrival' },
  selected: { title: 'Return to Selected', text: 'Moves the candidate back to Selected.', reason: true, cta: 'Return to Selected' },
  hold: { title: 'Put on hold', text: 'The candidate will resume from the current status when released.', reason: true, cta: 'Put on hold' },
  resume: { title: 'Resume candidate', text: 'Returns the candidate to the status they had before the hold.', reason: false, cta: 'Resume' },
  cancel: { title: 'Cancel candidate', text: 'The record is kept for history and reporting and can later be archived.', reason: true, cta: 'Cancel candidate', danger: true },
};

function StatusModal({ action, candidateId, onClose, onDone }: { action: string | null; candidateId: number; onClose: () => void; onDone: () => void }) {
  const { options } = useApp();
  const toast = useToast();
  const [reason, setReason] = useState('');
  const [cat, setCat] = useState('');
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { setReason(''); setCat(''); setErr({}); }, [action]);
  if (!action) return null;
  const a = ACTIONS[action];
  const submit = async () => {
    setBusy(true); setErr({});
    try {
      await api.post(`/candidates/${candidateId}/status`, { action, reason, cancel_category: cat || undefined });
      toast('success', 'Status updated.');
      onDone();
    } catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title={a.title} size="sm"
      footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button variant={a.danger ? 'danger' : 'primary'} onClick={submit} loading={busy}>{a.cta}</Button></>}>
      <div className="space-y-3">
        <p className="text-sm text-slate-600">{a.text}</p>
        {err._ && <Alert tone="error">{err._}</Alert>}
        {action === 'cancel' && (
          <Field label="Cancellation category" required error={err.cancel_category}>
            <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}>
              <option value="">Select…</option>
              {options?.enums.cancel_category.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </Field>
        )}
        <Field label={a.reason ? 'Reason' : 'Note (optional)'} required={a.reason} error={err.reason}>
          <textarea rows={3} className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
