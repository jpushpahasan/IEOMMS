// Module 2 — International mobility: flight bookings, quotations, approvals, ticketing and airport pickups.
import express, { type Request } from 'express';
import { db, one, type Q, type Row } from '../db/index.ts';
import { asyncH, badRequest, conflict, forbidden, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { can } from '../lib/rbac.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate, type Schema } from '../lib/validate.ts';
import { label } from '../lib/enums.ts';
import { advanceCandidate } from '../lib/lifecycle.ts';
import { recordDocument, removeStored, storeUpload, upload } from './documents.ts';
import { resync } from '../lib/onboarding.ts';
import { recordApproval } from '../lib/approvals.ts';
import { syncTicketExpense } from './finance.ts';

export const mobilityRouter = express.Router();

const OPEN = ['pending_booking', 'quotation_received', 'approval_pending', 'approved', 'ticket_booked'];
const PRE_TRAVEL = ['selected', 'pre_arrival'];

const BOOKING_SCHEMA: Schema = {
  candidate_id: { type: 'ref', label: 'Candidate', required: true },
  departure_country: { type: 'country', label: 'Departure country', required: true, max: 80 },
  departure_city: { type: 'text', label: 'Departure city', required: true, max: 100 },
  arrival_airport: { type: 'enum', label: 'Arrival airport', required: true, options: 'airport' },
  preferred_travel_date: { type: 'date', label: 'Preferred travel date', required: true },
  remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
};
const QUOTE_SCHEMA: Schema = {
  travel_agency_id: { type: 'ref', label: 'Travel agency', required: true },
  quote_reference: { type: 'text', label: 'Quote reference', max: 40 },
  airline: { type: 'text', label: 'Airline', required: true, max: 100 },
  flight_number: { type: 'text', label: 'Flight number', max: 20, pattern: [/^[A-Za-z0-9]{2}\s?\d{1,4}[A-Za-z]?$/, 'Use the airline code and number, e.g. EK 523.'] },
  departure_at: { type: 'datetime', label: 'Departure (local time)', required: true },
  arrival_at: { type: 'datetime', label: 'Arrival (UAE time)', required: true },
  arrival_terminal: { type: 'text', label: 'Terminal', max: 20 },
  transit_details: { type: 'longtext', label: 'Transit details', max: 500 },
  baggage_allowance: { type: 'text', label: 'Baggage allowance', max: 60 },
  fare: { type: 'money', label: 'Fare (AED)', required: true },
  valid_until: { type: 'date', label: 'Quote valid until' },
  remarks: { type: 'longtext', label: 'Remarks', max: 500 },
};

async function nextBookingNo(q: Q) {
  const year = new Date(Date.now() + 4 * 3600_000).getUTCFullYear();
  const r = await one(q, `INSERT INTO reference_counters(key, year, last_value) VALUES ('flight_booking', $1, 1)
    ON CONFLICT (key, year) DO UPDATE SET last_value = reference_counters.last_value + 1 RETURNING last_value`, [year]);
  return `FB-${year}-${String(r!.last_value).padStart(5, '0')}`;
}

async function lockBooking(q: Q, id: number) {
  const b = await one(q, 'SELECT * FROM flight_bookings WHERE id = $1 FOR UPDATE', [id]);
  if (!b) throw notFound('Flight booking not found.');
  return b;
}
const need = (b: Row, ...statuses: string[]) => {
  if (!statuses.includes(b.status)) {
    throw badRequest(`Not possible while the booking is "${label('booking_status', b.status)}".`);
  }
};
async function setBooking(q: Q, req: Request, b: Row, set: Record<string, unknown>, action: string) {
  set.updated_at = new Date().toISOString();
  set.updated_by = req.user!.id;
  const cols = Object.keys(set);
  const row = (await q.query(`UPDATE flight_bookings SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [b.id, ...cols.map((c) => set[c])])).rows[0];
  const d = diff(b, row);
  await audit(q, req, action, 'flight_bookings', b.id, d.old, { ...(d.new as object), candidate_id: b.candidate_id });
  return row;
}
const uniqueOpen = (e: any) => {
  if (e?.code === '23505' && String(e.constraint || e.message).includes('uq_fb_candidate_open')) return conflict('This candidate already has an open flight booking.');
  return e;
};

const BOOKING_SELECT = `SELECT b.*, c.full_name, c.reference_no, c.nationality, c.status AS candidate_status, c.passport_number, c.passport_expiry_date,
    c.photo_document_id, p.name AS project, ta.name AS agency_name, ru.full_name AS requested_by_name, su.full_name AS submitted_by_name,
    au.full_name AS approved_by_name, ap.id AS pickup_id, ap.status AS pickup_status
  FROM flight_bookings b JOIN candidates c ON c.id = b.candidate_id JOIN projects p ON p.id = c.project_id
  LEFT JOIN travel_agencies ta ON ta.id = b.travel_agency_id LEFT JOIN users ru ON ru.id = b.requested_by
  LEFT JOIN users su ON su.id = b.submitted_by LEFT JOIN users au ON au.id = b.approved_by
  LEFT JOIN airport_pickups ap ON ap.flight_booking_id = b.id`;

// ------------------------------------------------------------------ overview & calendar
mobilityRouter.get('/mobility/overview', requirePerm('mobility.view'), asyncH(async (_req, res) => {
  const [counts, today, tomorrow, upcoming, unassigned, spend, countries, awaitingTravel] = await Promise.all([
    db.many(`SELECT status, count(*)::int AS n FROM flight_bookings GROUP BY 1`),
    db.one(`SELECT count(*)::int AS n FROM flight_bookings WHERE status IN ('ticket_issued','travel_completed') AND arrival_at::date = (now() AT TIME ZONE 'Asia/Dubai')::date`),
    db.one(`SELECT count(*)::int AS n FROM flight_bookings WHERE status IN ('ticket_issued','travel_completed') AND arrival_at::date = (now() AT TIME ZONE 'Asia/Dubai')::date + 1`),
    db.many(`${BOOKING_SELECT} WHERE b.status IN ('ticket_issued','travel_completed') AND b.arrival_at >= (now() AT TIME ZONE 'Asia/Dubai')::date
      AND b.arrival_at < (now() AT TIME ZONE 'Asia/Dubai')::date + 8 ORDER BY b.arrival_at LIMIT 30`),
    db.many(`SELECT ap.*, c.full_name, c.reference_no FROM airport_pickups ap JOIN candidates c ON c.id = ap.candidate_id
      WHERE ap.status = 'pending' AND ap.arrival_at < (now() AT TIME ZONE 'Asia/Dubai') + interval '72 hours' ORDER BY ap.arrival_at`),
    db.one(`SELECT coalesce(sum(ticket_cost) FILTER (WHERE status IN ('ticket_issued','travel_completed')), 0) AS issued,
        coalesce(sum(ticket_cost) FILTER (WHERE status IN ('approved','ticket_booked')), 0) AS committed,
        count(*) FILTER (WHERE status IN ('ticket_issued','travel_completed'))::int AS tickets FROM flight_bookings`),
    db.many(`SELECT departure_country AS name, count(*)::int AS n FROM flight_bookings WHERE status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`),
    db.one(`SELECT count(*)::int AS n FROM candidates c WHERE NOT c.is_archived AND c.status IN ('selected','pre_arrival')
      AND NOT EXISTS (SELECT 1 FROM flight_bookings b WHERE b.candidate_id = c.id AND b.status <> 'cancelled')`),
  ]);
  res.json({ counts: Object.fromEntries(counts.map((r) => [r.status, r.n])), today: today!.n, tomorrow: tomorrow!.n, upcoming, unassigned, spend, countries,
    awaitingBooking: awaitingTravel!.n });
}));

mobilityRouter.get('/mobility/calendar', requirePerm('mobility.view'), asyncH(async (req, res) => {
  const m = String(req.query.month || '').match(/^(\d{4})-(\d{2})$/);
  const start = m ? `${m[1]}-${m[2]}-01` : new Date().toISOString().slice(0, 8) + '01';
  res.json(await db.many(`SELECT b.id, b.booking_no, b.status, b.flight_number, b.airline, b.arrival_airport, b.arrival_at,
      coalesce(b.arrival_at::date, b.confirmed_travel_date, b.preferred_travel_date) AS day,
      b.arrival_at IS NOT NULL AS confirmed, c.id AS candidate_id, c.full_name, c.reference_no, ap.status AS pickup_status
    FROM flight_bookings b JOIN candidates c ON c.id = b.candidate_id LEFT JOIN airport_pickups ap ON ap.flight_booking_id = b.id
    WHERE b.status <> 'cancelled' AND coalesce(b.arrival_at::date, b.confirmed_travel_date, b.preferred_travel_date)
      BETWEEN $1::date - 7 AND ($1::date + interval '1 month' + interval '7 days')::date
    ORDER BY day, b.arrival_at NULLS LAST`, [start]));
}));

// ------------------------------------------------------------------ bookings
mobilityRouter.get('/bookings', requirePerm('mobility.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.query.status === 'open') w.push(`b.status IN ('pending_booking','quotation_received','approval_pending','approved','ticket_booked')`);
  else if (req.query.status) add('b.status = ?', String(req.query.status));
  if (req.query.q) add(`(c.full_name ILIKE ? OR c.reference_no ILIKE ? OR b.booking_no ILIKE ? OR b.flight_number ILIKE ? OR b.booking_reference ILIKE ?)`, `%${req.query.q}%`);
  if (req.query.airport) add('b.arrival_airport = ?', String(req.query.airport));
  if (req.query.agency) add('b.travel_agency_id = ?', Number(req.query.agency));
  if (req.query.from) add('coalesce(b.confirmed_travel_date, b.preferred_travel_date) >= ?', String(req.query.from));
  if (req.query.to) add('coalesce(b.confirmed_travel_date, b.preferred_travel_date) <= ?', String(req.query.to));
  if (req.query.candidate_id) add('b.candidate_id = ?', Number(req.query.candidate_id));
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const rows = await db.many(`${BOOKING_SELECT} ${where} ORDER BY CASE WHEN b.status IN ('cancelled','travel_completed') THEN 1 ELSE 0 END,
    coalesce(b.confirmed_travel_date, b.preferred_travel_date), b.id LIMIT 500`, params);
  const quoteCounts = rows.length ? await db.many(`SELECT booking_id, count(*)::int AS n, min(fare) AS min_fare FROM flight_quotations WHERE booking_id = ANY($1::int[]) GROUP BY 1`, [rows.map((r) => r.id)]) : [];
  const qc = new Map(quoteCounts.map((r) => [r.booking_id, r]));
  res.json(rows.map((r) => ({ ...r, quote_count: qc.get(r.id)?.n || 0, min_fare: qc.get(r.id)?.min_fare || null })));
}));

/** Candidates who can get a booking: selected or in pre-arrival, without an open booking. */
mobilityRouter.get('/bookings/eligible', requirePerm('mobility.manage'), asyncH(async (_req, res) => {
  res.json(await db.many(`SELECT c.id, c.full_name, c.reference_no, c.nationality, c.source_country, c.expected_joining_date, c.status, p.emirate
    FROM candidates c JOIN projects p ON p.id = c.project_id
    WHERE NOT c.is_archived AND c.status IN ('selected','pre_arrival')
      AND NOT EXISTS (SELECT 1 FROM flight_bookings b WHERE b.candidate_id = c.id AND b.status <> 'cancelled')
    ORDER BY c.expected_joining_date NULLS LAST, c.full_name`));
}));

mobilityRouter.get('/bookings/:id', requirePerm('mobility.view', 'candidates.view'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const b = await db.one(`${BOOKING_SELECT} WHERE b.id = $1`, [id]);
  if (!b) throw notFound('Flight booking not found.');
  if (!can(req.user, 'mobility.view')) throw forbidden();
  const quotations = await db.many(`SELECT q.*, ta.name AS agency_name, ta.is_approved, u.full_name AS created_by_name,
      (EXTRACT(EPOCH FROM (q.arrival_at - q.departure_at)) / 60)::int AS raw_minutes
    FROM flight_quotations q JOIN travel_agencies ta ON ta.id = q.travel_agency_id LEFT JOIN users u ON u.id = q.created_by
    WHERE q.booking_id = $1 ORDER BY q.fare, q.id`, [id]);
  const pickup = await db.one(`SELECT ap.*, u.full_name AS coordinator_name FROM airport_pickups ap LEFT JOIN users u ON u.id = ap.coordinator_id WHERE ap.flight_booking_id = $1`, [id]);
  const history = await db.many(`SELECT id, action, username, old_values, new_values, created_at FROM audit_logs
    WHERE (entity = 'flight_bookings' AND entity_id = $1) OR (entity = 'flight_quotations' AND (new_values->>'booking_id')::int = $1)
    ORDER BY created_at DESC, id DESC LIMIT 100`, [id]);
  const canDecide = can(req.user, 'mobility.approve') && (b.submitted_by !== req.user!.id || can(req.user, 'approvals.self'));
  res.json({ booking: b, quotations, pickup, history, canDecide });
}));

mobilityRouter.post('/bookings', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const data = validate(BOOKING_SCHEMA, req.body || {});
  try {
    const row = await db.tx(async (q) => {
      const c = await one(q, 'SELECT id, status, is_archived, full_name FROM candidates WHERE id = $1 FOR UPDATE', [data.candidate_id]);
      if (!c) throw badRequest('Candidate not found.', { candidate_id: 'Not found.' });
      if (c.is_archived || !PRE_TRAVEL.includes(c.status)) throw badRequest(`Travel can only be arranged for Selected or Pre-arrival candidates (currently "${label('candidate_status', c.status)}").`, { candidate_id: 'Not eligible.' });
      data.booking_no = await nextBookingNo(q);
      data.requested_by = req.user!.id;
      data.created_by = req.user!.id;
      const cols = Object.keys(data);
      const b = (await q.query(`INSERT INTO flight_bookings(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => data[k]))).rows[0];
      await audit(q, req, 'create', 'flight_bookings', b.id, null, b);
      await advanceCandidate(q, req, Number(data.candidate_id), 'pre_arrival', ['selected'], `Travel requested (${b.booking_no})`);
      return b;
    });
    res.status(201).json(row);
  } catch (e) { throw uniqueOpen(e); }
}));

mobilityRouter.put('/bookings/:id', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const { candidate_id: _ignore, ...schema } = BOOKING_SCHEMA;
  const extra: Schema = {
    confirmed_travel_date: { type: 'date', label: 'Confirmed travel date' },
    baggage_allowance: { type: 'text', label: 'Baggage allowance', max: 60 },
    transit_details: { type: 'longtext', label: 'Transit details', max: 500 },
    arrival_terminal: { type: 'text', label: 'Terminal', max: 20 },
  };
  const data = validate({ ...schema, ...extra }, req.body || {}, true);
  await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, ...OPEN);
    if (Object.keys(data).length) await setBooking(q, req, b, data, 'update');
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ quotations
mobilityRouter.post('/bookings/:id/quotations', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(QUOTE_SCHEMA, req.body || {});
  const out = await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, 'pending_booking', 'quotation_received');
    const ag = await one(q, 'SELECT is_approved, is_active, name FROM travel_agencies WHERE id = $1', [data.travel_agency_id]);
    if (!ag) throw badRequest('Travel agency not found.', { travel_agency_id: 'Not found.' });
    if (!ag.is_approved || !ag.is_active) throw badRequest(`${ag.name} is not an approved, active travel agency.`, { travel_agency_id: 'Agency not approved.' });
    // Departure is origin local time and arrival UAE time; allow for up to 14h of time-zone difference.
    const dep = new Date(`${String(data.departure_at).replace(' ', 'T')}:00Z`).getTime();
    const arr = new Date(`${String(data.arrival_at).replace(' ', 'T')}:00Z`).getTime();
    if (arr <= dep - 14 * 3600_000 || arr > dep + 72 * 3600_000) throw badRequest('Arrival must be after departure (allowing for time-zone difference) and within 72 hours.', { arrival_at: 'Check the arrival time.' });
    data.booking_id = id;
    data.created_by = req.user!.id;
    if (data.flight_number) data.flight_number = String(data.flight_number).toUpperCase();
    const cols = Object.keys(data);
    const row = (await q.query(`INSERT INTO flight_quotations(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((k) => data[k]))).rows[0];
    await audit(q, req, 'create', 'flight_quotations', row.id, null, row);
    if (b.status === 'pending_booking') await setBooking(q, req, b, { status: 'quotation_received' }, 'status_change');
    return row;
  });
  res.status(201).json(out);
}));

mobilityRouter.delete('/bookings/:id/quotations/:qid', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const qid = toId(req.params.qid);
  await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, 'pending_booking', 'quotation_received');
    const row = await one(q, 'DELETE FROM flight_quotations WHERE id = $1 AND booking_id = $2 RETURNING *', [qid, id]);
    if (!row) throw notFound('Quotation not found.');
    await audit(q, req, 'delete', 'flight_quotations', qid, row, { booking_id: id });
    const left = await one(q, 'SELECT count(*)::int AS n FROM flight_quotations WHERE booking_id = $1', [id]);
    if (!left!.n) await setBooking(q, req, b, { status: 'pending_booking' }, 'status_change');
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ workflow
mobilityRouter.post('/bookings/:id/submit', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const qid = toId(req.body?.quotation_id);
  await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, 'quotation_received');
    const quote = await one(q, 'SELECT * FROM flight_quotations WHERE id = $1 AND booking_id = $2', [qid, id]);
    if (!quote) throw badRequest('Select one of this booking\'s quotations.');
    if (quote.valid_until && quote.valid_until < new Date().toISOString().slice(0, 10)) throw badRequest('This quotation has expired. Ask the agency for a new quote.');
    await q.query('UPDATE flight_quotations SET is_selected = (id = $2) WHERE booking_id = $1', [id, qid]);
    await setBooking(q, req, b, { status: 'approval_pending', selected_quotation_id: qid, submitted_by: req.user!.id, decision_remarks: String(req.body?.remarks || '').slice(0, 1000) || null }, 'submit');
  });
  res.json({ ok: true });
}));

mobilityRouter.post('/bookings/:id/decide', requirePerm('mobility.approve'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const decision = req.body?.decision;
  const remarks = String(req.body?.remarks || '').trim().slice(0, 1000);
  if (!['approve', 'reject'].includes(decision)) throw badRequest('Decision must be approve or reject.');
  if (decision === 'reject' && !remarks) throw badRequest('Give a reason for rejecting.', { remarks: 'Required when rejecting.' });
  await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, 'approval_pending');
    if (b.submitted_by === req.user!.id && !can(req.user, 'approvals.self')) throw forbidden('You submitted this request, so another approver must decide it.');
    await recordApproval(q, req, { type: 'flight_quotation', entity: 'flight_bookings', entityId: id, candidateId: b.candidate_id, requestedBy: b.submitted_by,
      decision: decision === 'approve' ? 'approved' : 'rejected', remarks });
    if (decision === 'reject') {
      await q.query('UPDATE flight_quotations SET is_selected = FALSE WHERE booking_id = $1', [id]);
      await setBooking(q, req, b, { status: 'quotation_received', selected_quotation_id: null, decision_remarks: remarks, approved_by: null, approved_at: null }, 'reject');
      return;
    }
    const quote = await one(q, 'SELECT * FROM flight_quotations WHERE id = $1', [b.selected_quotation_id]);
    if (!quote) throw badRequest('The selected quotation no longer exists.');
    await setBooking(q, req, b, {
      status: 'approved', approved_by: req.user!.id, approved_at: new Date().toISOString(), decision_remarks: remarks || null,
      travel_agency_id: quote.travel_agency_id, airline: quote.airline, flight_number: quote.flight_number, departure_at: quote.departure_at,
      arrival_at: quote.arrival_at, arrival_terminal: quote.arrival_terminal, transit_details: quote.transit_details,
      baggage_allowance: quote.baggage_allowance, ticket_cost: quote.fare, confirmed_travel_date: String(quote.departure_at).slice(0, 10),
    }, 'approve');
  });
  res.json({ ok: true });
}));

mobilityRouter.post('/bookings/:id/book', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({
    booking_reference: { type: 'text', label: 'Booking reference / PNR', required: true, max: 30, pattern: [/^[A-Za-z0-9-]{5,30}$/, '5–30 letters, digits or dashes.'] },
    booking_confirmation_date: { type: 'date', label: 'Booking confirmation date', required: true },
  }, req.body || {});
  data.booking_reference = String(data.booking_reference).toUpperCase();
  await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, 'approved');
    await setBooking(q, req, b, { ...data, status: 'ticket_booked' }, 'book');
  });
  res.json({ ok: true });
}));

/** Ticket issued: e-ticket upload required (critical step). Creates the airport pickup and confirms travel. */
mobilityRouter.post('/bookings/:id/issue', requirePerm('mobility.manage'), upload.single('file'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({
    flight_number: { type: 'text', label: 'Flight number', required: true, max: 20, pattern: [/^[A-Za-z0-9]{2}\s?\d{1,4}[A-Za-z]?$/, 'Use the airline code and number, e.g. EK 523.'] },
    departure_at: { type: 'datetime', label: 'Departure (local time)', required: true },
    arrival_at: { type: 'datetime', label: 'Arrival (UAE time)', required: true },
    arrival_terminal: { type: 'text', label: 'Terminal', max: 20 },
  }, req.body || {});
  data.flight_number = String(data.flight_number).toUpperCase();
  const f = await storeUpload(req.file);
  try {
    await db.tx(async (q) => {
      const b = await lockBooking(q, id);
      need(b, 'ticket_booked');
      const doc = await recordDocument(q, req, b.candidate_id, f, { category: 'flight_ticket', title: `E-ticket ${data.flight_number} (${b.booking_reference})`, document_number: b.booking_reference });
      const row = await setBooking(q, req, b, { ...data, status: 'ticket_issued', eticket_document_id: doc.id, confirmed_travel_date: String(data.departure_at).slice(0, 10) }, 'issue');
      await q.query(`INSERT INTO airport_pickups(candidate_id, flight_booking_id, arrival_at, airport, terminal, flight_number)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (flight_booking_id) DO UPDATE SET arrival_at = EXCLUDED.arrival_at, terminal = EXCLUDED.terminal,
        flight_number = EXCLUDED.flight_number, status = CASE WHEN airport_pickups.status = 'cancelled' THEN 'pending' ELSE airport_pickups.status END`,
        [b.candidate_id, id, row.arrival_at, row.arrival_airport, row.arrival_terminal, row.flight_number]);
      await advanceCandidate(q, req, b.candidate_id, 'travel_confirmed', PRE_TRAVEL, `Ticket issued: ${row.flight_number} arriving ${row.arrival_airport} ${String(row.arrival_at).slice(0, 16)}`);
      await syncTicketExpense(q, req, id);
      await resync(q, req, b.candidate_id);
    });
  } catch (e) { removeStored(f); throw e; }
  res.json({ ok: true });
}));

export async function completeTravel(q: Q, req: Request, b: Row, reason: string) {
  if (b.status === 'ticket_issued') await setBooking(q, req, b, { status: 'travel_completed' }, 'complete');
  await advanceCandidate(q, req, b.candidate_id, 'arrived', ['travel_confirmed'], reason);
  await resync(q, req, b.candidate_id);
}

mobilityRouter.post('/bookings/:id/complete', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, 'ticket_issued');
    await completeTravel(q, req, b, `Arrival confirmed (${b.flight_number})`);
  });
  res.json({ ok: true });
}));

mobilityRouter.post('/bookings/:id/cancel', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!reason) throw badRequest('Give a reason for cancelling.', { reason: 'Required.' });
  await db.tx(async (q) => {
    const b = await lockBooking(q, id);
    need(b, ...OPEN, 'ticket_issued');
    await setBooking(q, req, b, { status: 'cancelled', cancel_reason: reason }, 'cancel');
    await q.query(`UPDATE airport_pickups SET status = 'cancelled', updated_at = now(), updated_by = $2 WHERE flight_booking_id = $1 AND status IN ('pending','assigned')`, [id, req.user!.id]);
    if (b.status === 'ticket_issued') await advanceCandidate(q, req, b.candidate_id, 'pre_arrival', ['travel_confirmed'], `Flight ${b.booking_no} cancelled: ${reason}`);
    await syncTicketExpense(q, req, id);
    await resync(q, req, b.candidate_id);
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ airport pickups
mobilityRouter.get('/pickups', requirePerm('mobility.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.from) add('ap.arrival_at >= ?::date', String(req.query.from));
  if (req.query.to) add('ap.arrival_at < ?::date + 1', String(req.query.to));
  if (req.query.status) add('ap.status = ANY(?::text[])', String(req.query.status).split(','));
  else w.push(`ap.status <> 'cancelled'`);
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  res.json(await db.many(`SELECT ap.*, c.full_name, c.reference_no, c.nationality, c.contact_number, c.photo_document_id, b.booking_no, b.airline,
      b.departure_city, b.departure_country, p.name AS project, u.full_name AS coordinator_name,
      (ap.status = 'pending' AND ap.arrival_at < (now() AT TIME ZONE 'Asia/Dubai') + interval '72 hours') AS alert,
      (SELECT ac.name || ' · ' || coalesce(ar.block || ' ', '') || 'Room ' || ar.room_number || ' · Bed ' || aa.bed_number
         FROM accommodation_allocations aa JOIN accommodation_rooms ar ON ar.id = aa.room_id JOIN accommodation_camps ac ON ac.id = ar.camp_id
        WHERE aa.candidate_id = c.id AND aa.status IN ('allocated','checked_in') LIMIT 1) AS accommodation
    FROM airport_pickups ap JOIN candidates c ON c.id = ap.candidate_id JOIN flight_bookings b ON b.id = ap.flight_booking_id
    JOIN projects p ON p.id = c.project_id LEFT JOIN users u ON u.id = ap.coordinator_id
    ${where} ORDER BY ap.arrival_at LIMIT 500`, params));
}));

mobilityRouter.put('/pickups/:id/assign', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({
    vehicle_id: { type: 'ref', label: 'Vehicle', required: true },
    driver_name: { type: 'text', label: 'Driver name', required: true },
    driver_phone: { type: 'phone', label: 'Driver contact number', required: true },
    coordinator_id: { type: 'ref', label: 'Coordinator', required: true },
    terminal: { type: 'text', label: 'Terminal', max: 20 },
    remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
  }, req.body || {});
  await db.tx(async (q) => {
    const p = await one(q, 'SELECT * FROM airport_pickups WHERE id = $1 FOR UPDATE', [id]);
    if (!p) throw notFound('Pickup not found.');
    if (!['pending', 'assigned'].includes(p.status)) throw badRequest('This pickup is already closed.');
    const v = await one(q, 'SELECT registration_no, is_active FROM vehicles WHERE id = $1', [data.vehicle_id]);
    if (!v || !v.is_active) throw badRequest('Select an active vehicle.', { vehicle_id: 'Inactive or missing.' });
    const row = (await q.query(`UPDATE airport_pickups SET vehicle_id = $2, vehicle_registration = $3, driver_name = $4, driver_phone = $5, coordinator_id = $6,
        terminal = coalesce($7, terminal), remarks = $8, status = 'assigned', updated_at = now(), updated_by = $9 WHERE id = $1 RETURNING *`,
      [id, data.vehicle_id, v.registration_no, data.driver_name, data.driver_phone, data.coordinator_id, data.terminal, data.remarks, req.user!.id])).rows[0];
    const d = diff(p, row);
    await audit(q, req, 'assign', 'airport_pickups', id, d.old, { ...(d.new as object), candidate_id: p.candidate_id });
    await resync(q, req, p.candidate_id);
  });
  res.json({ ok: true });
}));

mobilityRouter.post('/pickups/:id/complete', requirePerm('mobility.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const noShow = req.body?.no_show === true;
  const data = validate({
    actual_pickup_at: { type: 'datetime', label: 'Actual pickup time', required: !noShow },
    remarks: { type: 'longtext', label: 'Arrival remarks', max: 1000, required: noShow },
  }, req.body || {});
  await db.tx(async (q) => {
    const p = await one(q, 'SELECT * FROM airport_pickups WHERE id = $1 FOR UPDATE', [id]);
    if (!p) throw notFound('Pickup not found.');
    if (p.status !== 'assigned' && !(noShow && p.status === 'pending')) throw badRequest(p.status === 'pending' ? 'Assign a vehicle and driver first.' : 'This pickup is already closed.');
    if (!noShow && String(data.actual_pickup_at) < String(p.arrival_at).slice(0, 10)) throw badRequest('Pickup time cannot be before the arrival date.', { actual_pickup_at: 'Before arrival.' });
    const row = (await q.query(`UPDATE airport_pickups SET status = $2, actual_pickup_at = $3, remarks = coalesce($4, remarks), confirmed_by = $5,
        updated_at = now(), updated_by = $5 WHERE id = $1 RETURNING *`, [id, noShow ? 'no_show' : 'completed', data.actual_pickup_at, data.remarks, req.user!.id])).rows[0];
    await audit(q, req, noShow ? 'no_show' : 'complete', 'airport_pickups', id, { status: p.status }, { status: row.status, actual_pickup_at: row.actual_pickup_at, candidate_id: p.candidate_id });
    if (!noShow) {
      const b = await lockBooking(q, p.flight_booking_id);
      await completeTravel(q, req, b, `Picked up at ${p.airport} (${row.vehicle_registration}, ${row.driver_name})`);
    }
    await resync(q, req, p.candidate_id);
  });
  res.json({ ok: true });
}));
