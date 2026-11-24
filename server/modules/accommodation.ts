// Module 3 — Accommodation: camps, rooms, bed allocation, check-in / check-out.
// Occupancy is always derived from allocations; capacity is enforced here AND by database triggers/indexes.
import express, { type Request } from 'express';
import { db, one, type Q } from '../db/index.ts';
import { asyncH, badRequest, conflict, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate, type Schema } from '../lib/validate.ts';
import { label } from '../lib/enums.ts';
import { resync } from '../lib/onboarding.ts';

export const accommodationRouter = express.Router();
const ACTIVE = `('allocated','checked_in')`;
const HOUSABLE = ['selected', 'pre_arrival', 'travel_confirmed', 'arrived', 'onboarding', 'awaiting_clearance', 'ready_for_deployment', 'deployed', 'on_hold'];
const ARRIVED = ['arrived', 'onboarding', 'awaiting_clearance', 'ready_for_deployment', 'deployed', 'on_hold'];

const CAMP_SCHEMA: Schema = {
  name: { type: 'text', label: 'Camp / building name', required: true, max: 150 },
  location: { type: 'text', label: 'Location', max: 200 },
  emirate: { type: 'enum', label: 'Emirate', options: 'emirate' },
  supervisor_name: { type: 'text', label: 'Accommodation supervisor' },
  supervisor_phone: { type: 'phone', label: 'Supervisor contact' },
  facilities: { type: 'longtext', label: 'Facilities available', max: 1000 },
  status: { type: 'enum', label: 'Status', required: true, options: 'camp_status' },
};
const ROOM_SCHEMA: Schema = {
  camp_id: { type: 'ref', label: 'Camp', required: true },
  block: { type: 'text', label: 'Building / block', max: 50 },
  room_number: { type: 'text', label: 'Room number', required: true, max: 20 },
  room_type: { type: 'enum', label: 'Room type', required: true, options: 'room_type' },
  bed_capacity: { type: 'int', label: 'Total bed capacity', required: true },
  gender: { type: 'enum', label: 'Gender', required: true, options: 'room_gender' },
  facilities: { type: 'longtext', label: 'Facilities', max: 500 },
  status: { type: 'enum', label: 'Status', required: true, options: 'camp_status' },
};

function dbError(e: any) {
  if (e?.code === '23514' && /capacity|available|exceeds/.test(String(e.message))) return conflict(String(e.message).replace(/^.*?: /, ''));
  if (e?.code === '23505' && String(e.constraint || e.message).includes('uq_alloc_bed')) return conflict('That bed was just taken by another allocation. Choose another bed.');
  if (e?.code === '23505' && String(e.constraint || e.message).includes('uq_alloc_candidate')) return conflict('This candidate already has an active accommodation allocation.');
  if (e?.code === '23505' && String(e.constraint || e.message).includes('uq_room_number')) return conflict('A room with this number already exists in this camp/block.', { room_number: 'Already exists.' });
  if (e?.code === '23505') return conflict('A record with this name already exists.', { name: 'Already exists.' });
  return e;
}

const STATS = `SELECT ac.id, ac.name, ac.location, ac.emirate, ac.status, ac.supervisor_name, ac.supervisor_phone, ac.facilities,
    count(DISTINCT ar.id)::int AS rooms,
    coalesce(sum(ar.bed_capacity) FILTER (WHERE ar.status = 'active'), 0)::int AS capacity,
    (SELECT count(*)::int FROM accommodation_allocations aa JOIN accommodation_rooms r2 ON r2.id = aa.room_id WHERE r2.camp_id = ac.id AND aa.status = 'checked_in') AS occupied,
    (SELECT count(*)::int FROM accommodation_allocations aa JOIN accommodation_rooms r2 ON r2.id = aa.room_id WHERE r2.camp_id = ac.id AND aa.status = 'allocated') AS reserved
  FROM accommodation_camps ac LEFT JOIN accommodation_rooms ar ON ar.camp_id = ac.id`;

// ------------------------------------------------------------------ overview
accommodationRouter.get('/accommodation/overview', requirePerm('accommodation.view'), asyncH(async (_req, res) => {
  const camps = (await db.many(`${STATS} GROUP BY ac.id ORDER BY ac.name`)).map((c): Record<string, any> => ({
    ...c, available: c.status === 'active' ? Math.max(0, c.capacity - c.occupied - c.reserved) : 0,
  }));
  const active = camps.filter((c) => c.status === 'active');
  const totals = {
    capacity: active.reduce((s, c) => s + c.capacity, 0),
    occupied: active.reduce((s, c) => s + c.occupied, 0),
    reserved: active.reduce((s, c) => s + c.reserved, 0),
    available: active.reduce((s, c) => s + c.available, 0),
  };
  const awaiting = await db.many(`SELECT c.id, c.full_name, c.reference_no, c.gender, c.nationality, c.status, c.expected_joining_date, p.name AS project,
      b.arrival_at, b.status AS booking_status
    FROM candidates c JOIN projects p ON p.id = c.project_id
    LEFT JOIN flight_bookings b ON b.candidate_id = c.id AND b.status <> 'cancelled'
    WHERE NOT c.is_archived AND c.status IN ('pre_arrival','travel_confirmed','arrived','onboarding','awaiting_clearance','ready_for_deployment')
      AND NOT EXISTS (SELECT 1 FROM accommodation_allocations a WHERE a.candidate_id = c.id AND a.status IN ${ACTIVE})
    ORDER BY (c.status IN ('arrived','onboarding','awaiting_clearance','ready_for_deployment')) DESC, b.arrival_at NULLS LAST, c.expected_joining_date NULLS LAST
    LIMIT 200`);
  res.json({ totals: { ...totals, occupancy: totals.capacity ? Math.round(((totals.occupied + totals.reserved) / totals.capacity) * 1000) / 10 : 0 }, camps, awaiting });
}));

/** Bed board: every room with its beds and who is in them. */
accommodationRouter.get('/accommodation/board', requirePerm('accommodation.view'), asyncH(async (req, res) => {
  const campId = req.query.camp_id ? Number(req.query.camp_id) : null;
  const rooms = await db.many(`SELECT ar.*, ac.name AS camp_name, ac.status AS camp_status FROM accommodation_rooms ar JOIN accommodation_camps ac ON ac.id = ar.camp_id
    WHERE ($1::int IS NULL OR ar.camp_id = $1) ORDER BY ac.name, ar.block NULLS FIRST, ar.room_number`, [campId]);
  const allocs = await db.many(`SELECT aa.id, aa.room_id, aa.bed_number, aa.status, aa.expected_checkin_date, aa.actual_checkin_date,
      c.id AS candidate_id, c.full_name, c.reference_no, c.nationality, c.status AS candidate_status
    FROM accommodation_allocations aa JOIN candidates c ON c.id = aa.candidate_id
    WHERE aa.status IN ${ACTIVE} AND aa.room_id = ANY($1::int[])`, [rooms.map((r) => r.id)]);
  res.json(rooms.map((r) => ({
    ...r,
    beds: Array.from({ length: r.bed_capacity }, (_, i) => ({ bed: i + 1, allocation: allocs.find((a) => a.room_id === r.id && a.bed_number === i + 1) || null })),
  })));
}));

// ------------------------------------------------------------------ camps & rooms
accommodationRouter.get('/accommodation/camps', requirePerm('accommodation.view'), asyncH(async (_req, res) => {
  res.json(await db.many(`${STATS} GROUP BY ac.id ORDER BY ac.name`));
}));

accommodationRouter.post('/accommodation/camps', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const data = validate(CAMP_SCHEMA, { status: 'active', ...(req.body || {}) });
  const cols = Object.keys(data);
  try {
    const row = await db.tx(async (q) => {
      const r = (await q.query(`INSERT INTO accommodation_camps(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => data[c]))).rows[0];
      await audit(q, req, 'create', 'accommodation_camps', r.id, null, r);
      return r;
    });
    res.status(201).json(row);
  } catch (e) { throw dbError(e); }
}));

accommodationRouter.put('/accommodation/camps/:id', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(CAMP_SCHEMA, req.body || {}, true);
  const cols = Object.keys(data);
  try {
    await db.tx(async (q) => {
      const old = await one(q, 'SELECT * FROM accommodation_camps WHERE id = $1 FOR UPDATE', [id]);
      if (!old) throw notFound('Camp not found.');
      if (data.status && data.status !== 'active' && old.status === 'active') {
        const n = await one(q, `SELECT count(*)::int AS n FROM accommodation_allocations aa JOIN accommodation_rooms ar ON ar.id = aa.room_id WHERE ar.camp_id = $1 AND aa.status IN ${ACTIVE}`, [id]);
        if (n!.n) throw conflict(`${n!.n} people are allocated to this camp. Move or check them out before changing its status.`);
      }
      const row = (await q.query(`UPDATE accommodation_camps SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => data[c])])).rows[0];
      const d = diff(old, row);
      await audit(q, req, 'update', 'accommodation_camps', id, d.old, d.new);
    });
  } catch (e) { throw dbError(e); }
  res.json({ ok: true });
}));

accommodationRouter.post('/accommodation/rooms', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const body = { status: 'active', room_type: 'shared', gender: 'male', ...(req.body || {}) };
  const data = validate(ROOM_SCHEMA, body);
  if (Number(data.bed_capacity) > 20) throw badRequest('A room can have at most 20 beds.', { bed_capacity: 'Maximum 20.' });
  // Bulk creation: "101-110" creates ten rooms with the same settings.
  const range = String(data.room_number).match(/^(\d+)\s*-\s*(\d+)$/);
  const numbers = range ? Array.from({ length: Number(range[2]) - Number(range[1]) + 1 }, (_, i) => String(Number(range[1]) + i)) : [String(data.room_number)];
  if (numbers.length < 1 || numbers.length > 100) throw badRequest('A room range can contain 1–100 rooms.', { room_number: 'Use e.g. 101-120.' });
  try {
    const rows = await db.tx(async (q) => {
      const camp = await one(q, 'SELECT id FROM accommodation_camps WHERE id = $1', [data.camp_id]);
      if (!camp) throw badRequest('Camp not found.', { camp_id: 'Not found.' });
      const out = [];
      for (const n of numbers) {
        const d = { ...data, room_number: n };
        const cols = Object.keys(d);
        const r = (await q.query(`INSERT INTO accommodation_rooms(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => (d as any)[c]))).rows[0];
        await audit(q, req, 'create', 'accommodation_rooms', r.id, null, r);
        out.push(r);
      }
      return out;
    });
    res.status(201).json({ created: rows.length });
  } catch (e) { throw dbError(e); }
}));

accommodationRouter.put('/accommodation/rooms/:id', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const { camp_id: _c, ...schema } = ROOM_SCHEMA;
  const data = validate(schema, req.body || {}, true);
  if (data.bed_capacity !== undefined && Number(data.bed_capacity) > 20) throw badRequest('A room can have at most 20 beds.', { bed_capacity: 'Maximum 20.' });
  const cols = Object.keys(data);
  try {
    await db.tx(async (q) => {
      const old = await one(q, 'SELECT * FROM accommodation_rooms WHERE id = $1 FOR UPDATE', [id]);
      if (!old) throw notFound('Room not found.');
      if (data.status && data.status !== 'active') {
        const n = await one(q, `SELECT count(*)::int AS n FROM accommodation_allocations WHERE room_id = $1 AND status IN ${ACTIVE}`, [id]);
        if (n!.n) throw conflict(`${n!.n} people are allocated to this room. Move or check them out first.`);
      }
      const row = (await q.query(`UPDATE accommodation_rooms SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => data[c])])).rows[0];
      const d = diff(old, row);
      await audit(q, req, 'update', 'accommodation_rooms', id, d.old, d.new);
    });
  } catch (e) { throw dbError(e); }
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ allocations
accommodationRouter.get('/accommodation/allocations', requirePerm('accommodation.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.query.status === 'active' || !req.query.status) w.push(`aa.status IN ${ACTIVE}`);
  else if (req.query.status !== 'all') add('aa.status = ?', String(req.query.status));
  if (req.query.camp_id) add('ar.camp_id = ?', Number(req.query.camp_id));
  if (req.query.candidate_id) add('aa.candidate_id = ?', Number(req.query.candidate_id));
  if (req.query.q) add('(c.full_name ILIKE ? OR c.reference_no ILIKE ? OR ar.room_number ILIKE ?)', `%${req.query.q}%`);
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  res.json(await db.many(`SELECT aa.*, c.full_name, c.reference_no, c.nationality, c.status AS candidate_status, ar.room_number, ar.block, ar.room_type,
      ac.id AS camp_id, ac.name AS camp_name, ac.supervisor_name, ac.supervisor_phone, u.full_name AS checkin_confirmed_by_name, cu.full_name AS created_by_name
    FROM accommodation_allocations aa JOIN candidates c ON c.id = aa.candidate_id JOIN accommodation_rooms ar ON ar.id = aa.room_id
    JOIN accommodation_camps ac ON ac.id = ar.camp_id LEFT JOIN users u ON u.id = aa.checkin_confirmed_by LEFT JOIN users cu ON cu.id = aa.created_by
    ${where} ORDER BY aa.created_at DESC LIMIT 500`, params));
}));

async function placeInRoom(q: Q, cand: { id: number; gender: string }, roomId: number, bed: number | null) {
  const room = await one(q, `SELECT ar.*, ac.status AS camp_status, ac.name AS camp_name FROM accommodation_rooms ar JOIN accommodation_camps ac ON ac.id = ar.camp_id WHERE ar.id = $1 FOR UPDATE OF ar`, [roomId]);
  if (!room) throw badRequest('Room not found.', { room_id: 'Not found.' });
  if (room.status !== 'active' || room.camp_status !== 'active') throw conflict('This room or camp is not available for allocation.');
  if (room.gender !== 'any' && room.gender !== cand.gender) throw conflict(`Room ${room.room_number} is designated for ${room.gender} occupants.`);
  const taken = (await q.query(`SELECT bed_number FROM accommodation_allocations WHERE room_id = $1 AND status IN ${ACTIVE}`, [roomId])).rows.map((r) => r.bed_number);
  if (taken.length >= room.bed_capacity) throw conflict(`Room ${room.room_number} is full (${room.bed_capacity} beds).`);
  if (bed !== null) {
    if (bed < 1 || bed > room.bed_capacity) throw badRequest(`Bed number must be between 1 and ${room.bed_capacity}.`, { bed_number: 'Out of range.' });
    if (taken.includes(bed)) throw conflict(`Bed ${bed} is already taken.`, { bed_number: 'Taken.' });
    return { room, bed };
  }
  let free = 1;
  while (taken.includes(free)) free++;
  return { room, bed: free };
}

accommodationRouter.post('/accommodation/allocations', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const data = validate({
    candidate_id: { type: 'ref', label: 'Candidate', required: true },
    room_id: { type: 'ref', label: 'Room', required: true },
    bed_number: { type: 'int', label: 'Bed number' },
    allocation_date: { type: 'date', label: 'Allocation date' },
    expected_checkin_date: { type: 'date', label: 'Expected check-in date' },
    remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
  }, req.body || {});
  try {
    const row = await db.tx(async (q) => {
      const c = await one(q, 'SELECT id, gender, status, is_archived, full_name FROM candidates WHERE id = $1 FOR UPDATE', [data.candidate_id]);
      if (!c) throw badRequest('Candidate not found.', { candidate_id: 'Not found.' });
      if (c.is_archived || !HOUSABLE.includes(c.status)) throw conflict(`Accommodation cannot be allocated to a "${label('candidate_status', c.status)}" candidate.`);
      const existing = await one(q, `SELECT id FROM accommodation_allocations WHERE candidate_id = $1 AND status IN ${ACTIVE}`, [c.id]);
      if (existing) throw conflict(`${c.full_name} already has an active allocation. Use transfer to move them.`);
      const { bed } = await placeInRoom(q, { id: c.id, gender: c.gender }, Number(data.room_id), (data.bed_number as number) ?? null);
      if (!data.expected_checkin_date) {
        const b = await one(q, `SELECT arrival_at FROM flight_bookings WHERE candidate_id = $1 AND status IN ('ticket_issued','travel_completed') ORDER BY id DESC LIMIT 1`, [c.id]);
        data.expected_checkin_date = b ? String(b.arrival_at).slice(0, 10) : null;
      }
      const r = (await q.query(`INSERT INTO accommodation_allocations(candidate_id, room_id, bed_number, allocation_date, expected_checkin_date, remarks, created_by)
        VALUES ($1,$2,$3,coalesce($4::date, (now() AT TIME ZONE 'Asia/Dubai')::date),$5,$6,$7) RETURNING *`,
        [c.id, data.room_id, bed, data.allocation_date, data.expected_checkin_date, data.remarks, req.user!.id])).rows[0];
      await audit(q, req, 'create', 'accommodation_allocations', r.id, null, r);
      await resync(q, req, c.id);
      return r;
    });
    res.status(201).json(row);
  } catch (e) { throw dbError(e); }
}));

async function lockAlloc(q: Q, id: number) {
  const a = await one(q, `SELECT aa.*, c.status AS candidate_status, c.gender FROM accommodation_allocations aa JOIN candidates c ON c.id = aa.candidate_id WHERE aa.id = $1 FOR UPDATE OF aa`, [id]);
  if (!a) throw notFound('Allocation not found.');
  return a;
}
async function setAlloc(q: Q, req: Request, a: any, set: Record<string, unknown>, action: string) {
  set.updated_at = new Date().toISOString();
  set.updated_by = req.user!.id;
  const cols = Object.keys(set);
  const row = (await q.query(`UPDATE accommodation_allocations SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [a.id, ...cols.map((c) => set[c])])).rows[0];
  const d = diff(a, row);
  await audit(q, req, action, 'accommodation_allocations', a.id, d.old, { ...(d.new as object), candidate_id: a.candidate_id });
  await resync(q, req, a.candidate_id);
}

accommodationRouter.post('/accommodation/allocations/:id/checkin', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({ actual_checkin_date: { type: 'date', label: 'Actual check-in date', required: true }, remarks: { type: 'longtext', label: 'Remarks', max: 1000 } }, req.body || {});
  const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
  if (String(data.actual_checkin_date) > today) throw badRequest('Check-in date cannot be in the future.', { actual_checkin_date: 'Future date.' });
  await db.tx(async (q) => {
    const a = await lockAlloc(q, id);
    if (a.status !== 'allocated') throw badRequest(`Allocation is already "${label('allocation_status', a.status)}".`);
    if (!ARRIVED.includes(a.candidate_status)) throw conflict('The candidate has not arrived in the UAE yet. Confirm the arrival or airport pickup first.');
    await setAlloc(q, req, a, { status: 'checked_in', actual_checkin_date: data.actual_checkin_date, checkin_confirmed_by: req.user!.id, remarks: data.remarks ?? a.remarks }, 'checkin');
  });
  res.json({ ok: true });
}));

accommodationRouter.post('/accommodation/allocations/:id/checkout', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({ checkout_date: { type: 'date', label: 'Check-out date', required: true }, remarks: { type: 'longtext', label: 'Reason / remarks', max: 1000, required: true } }, req.body || {});
  await db.tx(async (q) => {
    const a = await lockAlloc(q, id);
    if (a.status !== 'checked_in') throw badRequest('Only checked-in residents can be checked out. Cancel a reservation instead.');
    if (String(data.checkout_date) < String(a.actual_checkin_date)) throw badRequest('Check-out cannot be before check-in.', { checkout_date: 'Before check-in.' });
    await setAlloc(q, req, a, { status: 'checked_out', checkout_date: data.checkout_date, remarks: data.remarks }, 'checkout');
  });
  res.json({ ok: true });
}));

accommodationRouter.post('/accommodation/allocations/:id/cancel', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!reason) throw badRequest('Give a reason.', { reason: 'Required.' });
  await db.tx(async (q) => {
    const a = await lockAlloc(q, id);
    if (a.status !== 'allocated') throw badRequest('Only reservations can be cancelled. Check out a resident instead.');
    await setAlloc(q, req, a, { status: 'cancelled', remarks: reason }, 'cancel');
  });
  res.json({ ok: true });
}));

accommodationRouter.post('/accommodation/allocations/:id/transfer', requirePerm('accommodation.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({ room_id: { type: 'ref', label: 'Room', required: true }, bed_number: { type: 'int', label: 'Bed number' }, remarks: { type: 'longtext', label: 'Reason', max: 1000 } }, req.body || {});
  try {
    await db.tx(async (q) => {
      const a = await lockAlloc(q, id);
      if (!['allocated', 'checked_in'].includes(a.status)) throw badRequest('Only active allocations can be transferred.');
      if (Number(data.room_id) === a.room_id && (data.bed_number == null || data.bed_number === a.bed_number)) throw badRequest('Choose a different room or bed.');
      const { bed } = await placeInRoom(q, { id: a.candidate_id, gender: a.gender }, Number(data.room_id), (data.bed_number as number) ?? null);
      await setAlloc(q, req, a, { room_id: data.room_id, bed_number: bed, remarks: data.remarks ?? a.remarks }, 'transfer');
    });
  } catch (e) { throw dbError(e); }
  res.json({ ok: true });
}));
