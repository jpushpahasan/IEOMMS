import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRightLeft, BedDouble, Building2, DoorOpen, LogIn, LogOut, Pencil, Plus, Users, Wrench, XCircle } from 'lucide-react';
import { api, ApiError, qs } from '../../lib/api';
import { useApp } from '../../lib/app';
import { fmtDate, fmtTs, uaeToday } from '../../lib/format';
import { Alert, Badge, Button, Card, cx, Empty, Field, Modal, PageHeader, Spinner, Stat, useToast } from '../../components/ui';
import { StatusBadge } from '../Candidates';

type Tab = 'overview' | 'board' | 'allocations' | 'setup';

export function Accommodation() {
  const { can } = useApp();
  const [tab, setTab] = useState<Tab>('overview');
  const [allocFor, setAllocFor] = useState<{ candidate?: any; room?: any; bed?: number } | null>(null);
  const [version, setVersion] = useState(0);
  const refresh = () => setVersion((v) => v + 1);
  const tabs: [Tab, string][] = [['overview', 'Availability'], ['board', 'Bed board'], ['allocations', 'Allocations'], ...(can('accommodation.manage') ? [['setup', 'Camps & rooms'] as [Tab, string]] : [])];
  return (
    <div className="mx-auto max-w-[1500px]">
      <PageHeader title="Accommodation" subtitle="Camp capacity, bed allocation and check-in. Occupancy is calculated from allocations and can never exceed room capacity."
        actions={can('accommodation.manage') && <Button icon={<Plus className="size-4" />} onClick={() => setAllocFor({})}>Allocate bed</Button>} />
      <div className="scroll-thin mb-4 flex gap-1 overflow-x-auto rounded-lg border border-slate-200 bg-white p-1 sm:inline-flex">
        {tabs.map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={cx('rounded-md px-3 py-1.5 text-sm font-medium whitespace-nowrap', tab === k ? 'bg-navy-900 text-white' : 'text-slate-600 hover:bg-slate-100')}>{l}</button>)}
      </div>
      {tab === 'overview' && <Overview key={version} onAllocate={(candidate) => setAllocFor({ candidate })} />}
      {tab === 'board' && <Board key={version} onAllocate={(room, bed) => setAllocFor({ room, bed })} onChange={refresh} />}
      {tab === 'allocations' && <Allocations key={version} onChange={refresh} />}
      {tab === 'setup' && <Setup />}
      {allocFor && <AllocateModal init={allocFor} onClose={() => setAllocFor(null)} onDone={() => { setAllocFor(null); refresh(); }} />}
    </div>
  );
}

function OccBar({ occupied, reserved, capacity }: { occupied: number; reserved: number; capacity: number }) {
  const pct = (n: number) => (capacity ? (n / capacity) * 100 : 0);
  return (
    <div className="flex h-2.5 overflow-hidden rounded-full bg-slate-100" title={`${occupied} occupied, ${reserved} reserved of ${capacity}`}>
      <div className="bg-navy-800" style={{ width: `${pct(occupied)}%` }} /><div className="bg-amber-400" style={{ width: `${pct(reserved)}%` }} />
    </div>
  );
}

function Overview({ onAllocate }: { onAllocate: (c: any) => void }) {
  const { can, enumLabel, enumTone } = useApp();
  const [d, setD] = useState<any>(null);
  useEffect(() => { api.get('/accommodation/overview').then(setD); }, []);
  if (!d) return <Spinner />;
  const t = d.totals;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Total bed capacity" value={t.capacity} icon={<BedDouble className="size-5" />} tone="indigo" sub="Active rooms in active camps" />
        <Stat label="Occupied (checked in)" value={t.occupied} icon={<Users className="size-5" />} tone="blue" />
        <Stat label="Reserved" value={t.reserved} icon={<DoorOpen className="size-5" />} tone="amber" sub="Allocated, awaiting check-in" />
        <Stat label="Available beds" value={t.available} icon={<BedDouble className="size-5" />} tone="green" />
        <Stat label="Occupancy" value={`${t.occupancy}%`} icon={<Building2 className="size-5" />} tone={t.occupancy > 90 ? 'red' : 'cyan'} sub="Occupied + reserved" />
        <Stat label="Awaiting accommodation" value={d.awaiting.length} icon={<Wrench className="size-5" />} tone={d.awaiting.length ? 'orange' : 'slate'} />
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_440px]">
        <div className="grid gap-4 md:grid-cols-2">
          {d.camps.map((c: any) => (
            <Card key={c.id} title={<span className="flex items-center gap-2"><Building2 className="size-4 text-slate-400" />{c.name}</span>}
              actions={<Badge tone={enumTone('camp_status', c.status)}>{enumLabel('camp_status', c.status)}</Badge>}>
              <div className="mb-3 text-xs text-slate-500">{c.location}{c.emirate ? `, ${c.emirate}` : ''} · Supervisor: {c.supervisor_name || '—'} {c.supervisor_phone ? `(${c.supervisor_phone})` : ''}</div>
              <OccBar occupied={c.occupied} reserved={c.reserved} capacity={c.capacity} />
              <div className="mt-3 grid grid-cols-4 gap-2 text-center">
                {[['Rooms', c.rooms], ['Capacity', c.capacity], ['Occupied', c.occupied + c.reserved], ['Free', c.available]].map(([k, v]) => (
                  <div key={k as string} className="rounded-lg bg-slate-50 py-2"><div className={cx('text-lg font-semibold tabular-nums', k === 'Free' && Number(v) === 0 ? 'text-red-600' : 'text-slate-900')}>{v}</div><div className="text-[11px] text-slate-500">{k}</div></div>
                ))}
              </div>
              {c.facilities && <p className="mt-3 line-clamp-2 text-xs text-slate-500">{c.facilities}</p>}
            </Card>
          ))}
          {d.camps.length === 0 && <Card className="md:col-span-2"><Empty icon={<Building2 className="size-6" />} title="No camps configured">Add camps and rooms under "Camps & rooms".</Empty></Card>}
        </div>
        <Card title="Awaiting accommodation" bodyClass="p-0">
          {d.awaiting.length === 0 ? <Empty title="Everyone in the pipeline has a bed" /> : (
            <ul className="scroll-thin max-h-[560px] divide-y divide-slate-100 overflow-y-auto">
              {d.awaiting.map((c: any) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                  <div className="min-w-0 flex-1">
                    <Link to={`/candidates/${c.id}`} className="block truncate text-sm font-medium text-slate-800 hover:text-brand-700">{c.full_name}</Link>
                    <div className="truncate text-xs text-slate-500">{c.reference_no} · {c.project}</div>
                    <div className="mt-0.5 flex items-center gap-1.5"><StatusBadge status={c.status} />{c.arrival_at && <span className="text-xs text-slate-500">arr. {fmtTs(c.arrival_at)}</span>}</div>
                  </div>
                  {can('accommodation.manage') && <Button size="sm" variant="subtle" onClick={() => onAllocate(c)}>Allocate</Button>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function Board({ onAllocate, onChange }: { onAllocate: (room: any, bed: number) => void; onChange: () => void }) {
  const { can } = useApp();
  const [camps, setCamps] = useState<any[]>([]);
  const [camp, setCamp] = useState('');
  const [rooms, setRooms] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  useEffect(() => { api.get('/accommodation/camps').then((c) => { setCamps(c); if (c[0]) setCamp((x) => x || String(c[0].id)); }); }, []);
  useEffect(() => { if (camp) { setRooms(null); api.get(`/accommodation/board?camp_id=${camp}`).then(setRooms); } else setRooms([]); }, [camp]);
  const blocks = [...new Set((rooms || []).map((r) => r.block || ''))];
  return (
    <Card bodyClass="p-0" title={<select className="input w-auto" value={camp} onChange={(e) => setCamp(e.target.value)} aria-label="Camp">{camps.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      actions={<div className="flex flex-wrap gap-3 text-[11px] text-slate-500">
        <span className="flex items-center gap-1"><span className="size-3 rounded border border-emerald-300 bg-emerald-50" />Free</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded bg-amber-400" />Reserved</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded bg-navy-800" />Checked in</span>
        <span className="flex items-center gap-1"><span className="size-3 rounded bg-slate-200" />Unavailable</span></div>}>
      {!rooms ? <Spinner /> : rooms.length === 0 ? <Empty title="No rooms in this camp" /> : (
        <div className="space-y-5 p-4">
          {blocks.map((bl) => (
            <div key={bl}>
              {bl && <h4 className="mb-2 text-xs font-semibold tracking-wider text-slate-500 uppercase">{bl}</h4>}
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
                {rooms.filter((r) => (r.block || '') === bl).map((r) => {
                  const off = r.status !== 'active' || r.camp_status !== 'active';
                  const used = r.beds.filter((b: any) => b.allocation).length;
                  return (
                    <div key={r.id} className={cx('rounded-xl border p-3', off ? 'border-slate-200 bg-slate-50' : 'border-slate-200 bg-white')}>
                      <div className="mb-2 flex items-center justify-between">
                        <div><span className="font-semibold text-slate-800">Room {r.room_number}</span><span className="ml-1.5 text-xs text-slate-500 capitalize">{r.room_type} · {r.gender}</span></div>
                        <span className={cx('text-xs font-medium', off ? 'text-slate-400' : used >= r.bed_capacity ? 'text-red-600' : 'text-emerald-700')}>{off ? r.status : `${r.bed_capacity - used}/${r.bed_capacity} free`}</span>
                      </div>
                      <div className="grid grid-cols-3 gap-1.5">
                        {r.beds.map((b: any) => {
                          const a = b.allocation;
                          return (
                            <button key={b.bed} type="button" disabled={off && !a}
                              onClick={() => (a ? setSel({ ...a, room: r }) : can('accommodation.manage') && !off && onAllocate(r, b.bed))}
                              title={a ? `${a.full_name} (${a.reference_no})` : `Bed ${b.bed} free`}
                              className={cx('rounded-md px-1.5 py-1.5 text-left text-[11px] leading-tight transition',
                                a ? (a.status === 'checked_in' ? 'bg-navy-800 text-white hover:bg-navy-700' : 'bg-amber-400 text-amber-950 hover:bg-amber-300')
                                  : off ? 'bg-slate-200 text-slate-400' : 'border border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100')}>
                              <div className="font-semibold">Bed {b.bed}</div>
                              <div className="truncate">{a ? a.full_name.split(' ')[0] : off ? '—' : 'Free'}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      {sel && <AllocationActions a={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); onChange(); }} />}
    </Card>
  );
}

function Allocations({ onChange }: { onChange: () => void }) {
  const { enumLabel, enumTone } = useApp();
  const [f, setF] = useState({ status: 'active', q: '' });
  const [rows, setRows] = useState<any[] | null>(null);
  const [sel, setSel] = useState<any>(null);
  useEffect(() => { setRows(null); api.get(`/accommodation/allocations${qs(f)}`).then(setRows); }, [f]);
  return (
    <Card bodyClass="p-0" title="Accommodation allocations" actions={<>
      <input className="input w-52" placeholder="Name, reference, room…" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} />
      <select className="input w-auto" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} aria-label="Status">
        <option value="active">Active (reserved + checked in)</option><option value="allocated">Reserved</option><option value="checked_in">Checked in</option>
        <option value="checked_out">Checked out</option><option value="cancelled">Cancelled</option><option value="all">All</option>
      </select></>}>
      {!rows ? <Spinner /> : rows.length === 0 ? <Empty title="No allocations" /> : (
        <div className="scroll-thin overflow-x-auto">
          <table className="min-w-full divide-y divide-slate-100">
            <thead className="bg-slate-50/80"><tr><th className="th pl-4">Employee</th><th className="th">Camp</th><th className="th">Room / bed</th><th className="th">Allocated</th><th className="th">Expected check-in</th><th className="th">Actual check-in</th><th className="th">Supervisor</th><th className="th">Status</th><th className="th" /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="td pl-4"><Link to={`/candidates/${a.candidate_id}`} className="font-medium text-slate-800 hover:text-brand-700">{a.full_name}</Link><div className="font-mono text-xs text-slate-500">{a.reference_no}</div></td>
                  <td className="td">{a.camp_name}</td>
                  <td className="td">{a.block ? `${a.block} · ` : ''}Room {a.room_number} · Bed {a.bed_number}</td>
                  <td className="td">{fmtDate(a.allocation_date)}</td>
                  <td className="td">{fmtDate(a.expected_checkin_date)}</td>
                  <td className="td">{fmtDate(a.actual_checkin_date)}{a.checkin_confirmed_by_name && <div className="text-xs text-slate-500">by {a.checkin_confirmed_by_name}</div>}</td>
                  <td className="td text-xs">{a.supervisor_name || '—'}<div className="text-slate-500">{a.supervisor_phone}</div></td>
                  <td className="td"><Badge tone={enumTone('allocation_status', a.status)}>{enumLabel('allocation_status', a.status)}</Badge></td>
                  <td className="td text-right">{['allocated', 'checked_in'].includes(a.status) && <Button size="sm" variant="secondary" onClick={() => setSel(a)}>Manage</Button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {sel && <AllocationActions a={sel} onClose={() => setSel(null)} onDone={() => { setSel(null); onChange(); }} />}
    </Card>
  );
}

/** Check in / check out / cancel / transfer an allocation. */
function AllocationActions({ a, onClose, onDone }: { a: any; onClose: () => void; onDone: () => void }) {
  const { can, enumLabel } = useApp();
  const toast = useToast();
  const [mode, setMode] = useState<'' | 'checkin' | 'checkout' | 'cancel' | 'transfer'>('');
  const [f, setF] = useState<any>({ actual_checkin_date: uaeToday(), checkout_date: uaeToday(), reason: '', remarks: '', room_id: '', bed_number: '' });
  const [rooms, setRooms] = useState<any[]>([]);
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (mode === 'transfer') api.get('/accommodation/board').then(setRooms); }, [mode]);
  const manage = can('accommodation.manage');
  const go = async () => {
    setBusy(true); setErr({});
    const body = mode === 'checkin' ? { actual_checkin_date: f.actual_checkin_date, remarks: f.remarks || undefined }
      : mode === 'checkout' ? { checkout_date: f.checkout_date, remarks: f.remarks } : mode === 'cancel' ? { reason: f.reason }
        : { room_id: f.room_id, bed_number: f.bed_number || undefined, remarks: f.remarks || undefined };
    try { await api.post(`/accommodation/allocations/${a.id}/${mode}`, body); toast('success', 'Saved.'); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  const room = rooms.find((r) => String(r.id) === String(f.room_id));
  return (
    <Modal open onClose={onClose} title={a.full_name} size="md"
      footer={mode ? <><Button variant="secondary" onClick={() => setMode('')}>Back</Button><Button variant={mode === 'cancel' ? 'danger' : 'primary'} loading={busy} onClick={go}>Confirm</Button></> : <Button variant="secondary" onClick={onClose}>Close</Button>}>
      <div className="space-y-3">
        <div className="rounded-lg bg-slate-50 p-3 text-sm">
          <div className="font-medium text-slate-800">{a.camp_name || a.room?.camp_name} · {a.block || a.room?.block ? `${a.block || a.room?.block} · ` : ''}Room {a.room_number || a.room?.room_number} · Bed {a.bed_number}</div>
          <div className="mt-0.5 text-slate-500">{enumLabel('allocation_status', a.status)}{a.expected_checkin_date ? ` · expected ${fmtDate(a.expected_checkin_date)}` : ''}{a.actual_checkin_date ? ` · checked in ${fmtDate(a.actual_checkin_date)}` : ''} · candidate <StatusBadge status={a.candidate_status} /></div>
        </div>
        {err._ && <Alert tone="error">{err._}</Alert>}
        {!mode && manage && (
          <div className="grid gap-2 sm:grid-cols-2">
            {a.status === 'allocated' && <Button variant="subtle" icon={<LogIn className="size-4" />} onClick={() => setMode('checkin')}>Confirm check-in</Button>}
            {a.status === 'checked_in' && <Button variant="secondary" icon={<LogOut className="size-4" />} onClick={() => setMode('checkout')}>Check out</Button>}
            <Button variant="secondary" icon={<ArrowRightLeft className="size-4" />} onClick={() => setMode('transfer')}>Transfer room / bed</Button>
            {a.status === 'allocated' && <Button variant="ghost" className="text-red-600 hover:bg-red-50" icon={<XCircle className="size-4" />} onClick={() => setMode('cancel')}>Cancel reservation</Button>}
            <Link to={`/candidates/${a.candidate_id}?tab=accommodation`} className="inline-flex items-center justify-center rounded-lg px-3.5 py-2 text-sm text-brand-700 hover:bg-brand-50">Open profile</Link>
          </div>
        )}
        {mode === 'checkin' && <Field label="Actual check-in date" required error={err.actual_checkin_date}><input type="date" className="input" value={f.actual_checkin_date} onChange={(e) => setF({ ...f, actual_checkin_date: e.target.value })} /></Field>}
        {mode === 'checkout' && <><Field label="Check-out date" required error={err.checkout_date}><input type="date" className="input" value={f.checkout_date} onChange={(e) => setF({ ...f, checkout_date: e.target.value })} /></Field>
          <Field label="Reason" required error={err.remarks}><textarea rows={2} className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field></>}
        {mode === 'cancel' && <Field label="Reason" required error={err.reason}><textarea rows={2} className="input" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>}
        {mode === 'transfer' && <>
          <Field label="New room" required error={err.room_id}>
            <select className="input" value={f.room_id} onChange={(e) => setF({ ...f, room_id: e.target.value, bed_number: '' })}>
              <option value="">Select…</option>
              {rooms.filter((r) => r.status === 'active' && r.camp_status === 'active' && r.beds.some((b: any) => !b.allocation)).map((r) => (
                <option key={r.id} value={r.id}>{r.camp_name} · {r.block ? `${r.block} · ` : ''}Room {r.room_number} ({r.gender}, {r.beds.filter((b: any) => !b.allocation).length} free)</option>
              ))}
            </select>
          </Field>
          {room && <Field label="Bed" error={err.bed_number}>
            <select className="input" value={f.bed_number} onChange={(e) => setF({ ...f, bed_number: e.target.value })}>
              <option value="">First free bed</option>{room.beds.filter((b: any) => !b.allocation).map((b: any) => <option key={b.bed} value={b.bed}>Bed {b.bed}</option>)}
            </select></Field>}
          <Field label="Reason" error={err.remarks}><input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </>}
      </div>
    </Modal>
  );
}

function AllocateModal({ init, onClose, onDone }: { init: { candidate?: any; room?: any; bed?: number }; onClose: () => void; onDone: () => void }) {
  const toast = useToast();
  const [cands, setCands] = useState<any[] | null>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [f, setF] = useState<any>({ candidate_id: init.candidate ? String(init.candidate.id) : '', room_id: init.room ? String(init.room.id) : '', bed_number: init.bed ? String(init.bed) : '', expected_checkin_date: '', remarks: '' });
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api.get('/accommodation/overview').then((d) => setCands(init.candidate && !d.awaiting.some((c: any) => c.id === init.candidate.id) ? [init.candidate, ...d.awaiting] : d.awaiting));
    api.get('/accommodation/board').then(setRooms);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const cand = cands?.find((c) => String(c.id) === f.candidate_id);
  const room = rooms.find((r) => String(r.id) === f.room_id);
  const usable = rooms.filter((r) => r.status === 'active' && r.camp_status === 'active' && r.beds.some((b: any) => !b.allocation) && (!cand || r.gender === 'any' || r.gender === cand.gender));
  const submit = async () => {
    setBusy(true); setErr({});
    try { const r = await api.post('/accommodation/allocations', { ...f, bed_number: f.bed_number || undefined }); toast('success', `Bed ${r.bed_number} allocated.`); onDone(); }
    catch (e) { if (e instanceof ApiError) setErr(e.details || { _: e.message }); } finally { setBusy(false); }
  };
  return (
    <Modal open onClose={onClose} title="Allocate accommodation" footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={submit}>Allocate</Button></>}>
      {!cands ? <Spinner /> : (
        <div className="grid gap-3 sm:grid-cols-2">
          {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
          <Field label="Employee / candidate" required error={err.candidate_id} className="sm:col-span-2">
            <select className="input" value={f.candidate_id} onChange={(e) => setF({ ...f, candidate_id: e.target.value })}>
              <option value="">Select…</option>
              {cands.map((c) => <option key={c.id} value={c.id}>{c.full_name} — {c.reference_no} ({c.gender}{c.arrival_at ? `, arriving ${fmtTs(c.arrival_at)}` : ''})</option>)}
            </select>
          </Field>
          <Field label="Room" required error={err.room_id} className="sm:col-span-2">
            <select className="input" value={f.room_id} onChange={(e) => setF({ ...f, room_id: e.target.value, bed_number: '' })}>
              <option value="">Select…</option>
              {usable.map((r) => <option key={r.id} value={r.id}>{r.camp_name} · {r.block ? `${r.block} · ` : ''}Room {r.room_number} ({r.room_type}, {r.gender}, {r.beds.filter((b: any) => !b.allocation).length}/{r.bed_capacity} free)</option>)}
            </select>
          </Field>
          <Field label="Bed" error={err.bed_number}>
            <select className="input" value={f.bed_number} onChange={(e) => setF({ ...f, bed_number: e.target.value })} disabled={!room}>
              <option value="">First free bed</option>{room?.beds.filter((b: any) => !b.allocation).map((b: any) => <option key={b.bed} value={b.bed}>Bed {b.bed}</option>)}
            </select>
          </Field>
          <Field label="Expected check-in" hint="Defaults to the flight arrival date" error={err.expected_checkin_date}><input type="date" className="input" value={f.expected_checkin_date} onChange={(e) => setF({ ...f, expected_checkin_date: e.target.value })} /></Field>
          <Field label="Remarks" error={err.remarks} className="sm:col-span-2"><input className="input" value={f.remarks} onChange={(e) => setF({ ...f, remarks: e.target.value })} /></Field>
        </div>
      )}
    </Modal>
  );
}

// ------------------------------------------------------------------ camps & rooms setup
function Setup() {
  const { options, enumLabel, enumTone } = useApp();
  const toast = useToast();
  const [camps, setCamps] = useState<any[] | null>(null);
  const [rooms, setRooms] = useState<any[]>([]);
  const [camp, setCamp] = useState<any>(null);
  const [room, setRoom] = useState<any>(null);
  const load = useCallback(() => { api.get('/accommodation/camps').then(setCamps); api.get('/accommodation/board').then(setRooms); }, []);
  useEffect(load, [load]);
  if (!camps) return <Spinner />;
  const save = async (url: string, method: 'post' | 'put', body: any, set: (e: Record<string, string>) => void) => {
    try { await api[method](url, body); toast('success', 'Saved.'); setCamp(null); setRoom(null); load(); }
    catch (e) { if (e instanceof ApiError) set(e.details || { _: e.message }); }
  };
  return (
    <div className="space-y-5">
      <Card title="Camps / buildings" bodyClass="p-0" actions={<Button size="sm" icon={<Plus className="size-3.5" />} onClick={() => setCamp({ status: 'active' })}>Add camp</Button>}>
        <div className="scroll-thin overflow-x-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead className="bg-slate-50/80"><tr><th className="th pl-4">Name</th><th className="th">Location</th><th className="th">Supervisor</th><th className="th">Rooms</th><th className="th">Capacity</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{camps.map((c) => (
            <tr key={c.id}><td className="td pl-4 font-medium">{c.name}</td><td className="td">{c.location}{c.emirate ? `, ${c.emirate}` : ''}</td><td className="td">{c.supervisor_name || '—'}<div className="text-xs text-slate-500">{c.supervisor_phone}</div></td>
              <td className="td">{c.rooms}</td><td className="td">{c.capacity}</td><td className="td"><Badge tone={enumTone('camp_status', c.status)}>{enumLabel('camp_status', c.status)}</Badge></td>
              <td className="td text-right"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setCamp(c)}>Edit</Button>
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => setRoom({ camp_id: String(c.id), room_type: 'shared', gender: 'male', status: 'active', bed_capacity: '4' })}>Rooms</Button></td></tr>
          ))}</tbody></table></div>
      </Card>
      <Card title={`Rooms (${rooms.length})`} bodyClass="p-0">
        <div className="scroll-thin max-h-[480px] overflow-auto"><table className="min-w-full divide-y divide-slate-100">
          <thead className="sticky top-0 bg-slate-50"><tr><th className="th pl-4">Camp</th><th className="th">Block</th><th className="th">Room</th><th className="th">Type</th><th className="th">Gender</th><th className="th">Beds (used / total)</th><th className="th">Status</th><th className="th" /></tr></thead>
          <tbody className="divide-y divide-slate-100">{rooms.map((r) => (
            <tr key={r.id}><td className="td pl-4">{r.camp_name}</td><td className="td">{r.block || '—'}</td><td className="td font-medium">{r.room_number}</td><td className="td capitalize">{r.room_type}</td><td className="td capitalize">{r.gender}</td>
              <td className="td">{r.beds.filter((b: any) => b.allocation).length} / {r.bed_capacity}</td><td className="td"><Badge tone={enumTone('camp_status', r.status)}>{enumLabel('camp_status', r.status)}</Badge></td>
              <td className="td text-right"><Button size="sm" variant="ghost" icon={<Pencil className="size-3.5" />} onClick={() => setRoom({ ...r, camp_id: String(r.camp_id), bed_capacity: String(r.bed_capacity) })}>Edit</Button></td></tr>
          ))}</tbody></table></div>
      </Card>
      {camp && <FormModal title={camp.id ? `Edit ${camp.name}` : 'Add camp'} init={camp} onClose={() => setCamp(null)}
        fields={[['name', 'Camp / building name', 'text', true], ['location', 'Location'], ['emirate', 'Emirate', (options?.enums.emirate || []) as any], ['supervisor_name', 'Accommodation supervisor'],
          ['supervisor_phone', 'Supervisor contact'], ['status', 'Status', options?.enums.camp_status as any, true], ['facilities', 'Facilities available', 'textarea']]}
        onSubmit={(v, set) => save(camp.id ? `/accommodation/camps/${camp.id}` : '/accommodation/camps', camp.id ? 'put' : 'post', v, set)} />}
      {room && <FormModal title={room.id ? `Edit room ${room.room_number}` : 'Add rooms'} init={room} onClose={() => setRoom(null)}
        note={room.id ? 'Capacity cannot be reduced below the highest occupied bed number.' : 'Enter one room number, or a range such as 101-120 to create several identical rooms.'}
        fields={[...(room.id ? [] : [['camp_id', 'Camp', camps.map((c) => ({ value: String(c.id), label: c.name })), true]] as any[]), ['block', 'Building / block'], ['room_number', 'Room number(s)', 'text', true],
          ['room_type', 'Room type', options?.enums.room_type as any, true], ['bed_capacity', 'Total bed capacity', 'number', true], ['gender', 'Gender', options?.enums.room_gender as any, true],
          ['status', 'Status', options?.enums.camp_status as any, true], ['facilities', 'Facilities', 'textarea']]}
        onSubmit={(v, set) => { const { camp_id, ...rest } = v; return save(room.id ? `/accommodation/rooms/${room.id}` : '/accommodation/rooms', room.id ? 'put' : 'post', room.id ? rest : { camp_id, ...rest }, set); }} />}
    </div>
  );
}

type FieldSpec = [key: string, label: string, type?: string | { value: string; label: string }[], required?: boolean];
function FormModal({ title, init, fields, note, onClose, onSubmit }: { title: string; init: any; fields: FieldSpec[]; note?: string; onClose: () => void; onSubmit: (v: any, setErr: (e: Record<string, string>) => void) => Promise<void> }) {
  const [f, setF] = useState<any>(() => Object.fromEntries(fields.map(([k]) => [k, init[k] ?? ''])));
  const [err, setErr] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <Modal open onClose={onClose} title={title} footer={<><Button variant="secondary" onClick={onClose}>Close</Button><Button loading={busy} onClick={async () => { setBusy(true); setErr({}); await onSubmit(f, setErr); setBusy(false); }}>Save</Button></>}>
      <div className="grid gap-3 sm:grid-cols-2">
        {note && <div className="sm:col-span-2"><Alert tone="info">{note}</Alert></div>}
        {err._ && <div className="sm:col-span-2"><Alert tone="error">{err._}</Alert></div>}
        {fields.map(([k, label, type = 'text', req]) => (
          <Field key={k} label={label} required={req} error={err[k]} className={type === 'textarea' ? 'sm:col-span-2' : ''}>
            {Array.isArray(type) ? <select className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })}><option value="">—</option>{type.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select>
              : type === 'textarea' ? <textarea rows={2} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
                : <input type={type} className="input" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />}
          </Field>
        ))}
      </div>
    </Modal>
  );
}
