// Module 1 — Candidate registration & selection.
import express, { type Request } from 'express';
import { db, one, type Q, type Row } from '../db/index.ts';
import { asyncH, badRequest, conflict, forbidden, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { can, type SessionUser } from '../lib/rbac.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate, type Schema } from '../lib/validate.ts';
import { ENUMS, WORKFLOW_STATUSES, label } from '../lib/enums.ts';
import { getSettings } from '../lib/settings.ts';
import { sendXlsx } from '../lib/xlsx.ts';
import { releaseCandidateResources } from '../lib/lifecycle.ts';
import { generateChecklist, resync } from '../lib/onboarding.ts';

export const SALARY_FIELDS = ['basic_salary', 'housing_allowance', 'transport_allowance', 'food_allowance', 'other_allowance'];

export const CANDIDATE_SCHEMA: Schema = {
  full_name: { type: 'text', label: 'Full name as per passport', required: true, max: 150, pattern: [/^[\p{L} .'-]+$/u, 'Name may contain letters, spaces, apostrophes, dots and hyphens only.'] },
  gender: { type: 'enum', label: 'Gender', required: true, options: 'gender' },
  date_of_birth: { type: 'date', label: 'Date of birth', required: true },
  nationality: { type: 'country', label: 'Nationality', required: true, max: 80 },
  marital_status: { type: 'enum', label: 'Marital status', options: 'marital_status' },
  contact_number: { type: 'phone', label: 'Contact number' },
  email: { type: 'email', label: 'Email address' },
  current_address: { type: 'longtext', label: 'Current residential address', max: 500 },
  emergency_contact_name: { type: 'text', label: 'Emergency contact name' },
  emergency_contact_relation: { type: 'text', label: 'Emergency contact relationship', max: 60 },
  emergency_contact_phone: { type: 'phone', label: 'Emergency contact number' },
  passport_number: { type: 'text', label: 'Passport number', required: true, max: 20, pattern: [/^[A-Za-z0-9]{5,20}$/, 'Passport number must be 5–20 letters or digits, no spaces.'] },
  passport_issue_date: { type: 'date', label: 'Passport issue date', required: true },
  passport_expiry_date: { type: 'date', label: 'Passport expiry date', required: true },
  passport_issuing_country: { type: 'country', label: 'Passport issuing country', required: true, max: 80 },
  position: { type: 'text', label: 'Position / designation', required: true, max: 120 },
  trade_id: { type: 'ref', label: 'Trade', required: true },
  department_id: { type: 'ref', label: 'Department' },
  project_id: { type: 'ref', label: 'Project', required: true },
  work_location: { type: 'text', label: 'Work location' },
  employment_category: { type: 'enum', label: 'Employment category', required: true, options: 'employment_category' },
  basic_salary: { type: 'money', label: 'Monthly basic salary' },
  housing_allowance: { type: 'money', label: 'Housing allowance' },
  transport_allowance: { type: 'money', label: 'Transport allowance' },
  food_allowance: { type: 'money', label: 'Food allowance' },
  other_allowance: { type: 'money', label: 'Other allowances' },
  contract_status: { type: 'enum', label: 'Employment contract status', required: true, options: 'contract_status' },
  offer_letter_status: { type: 'enum', label: 'Offer letter status', required: true, options: 'offer_letter_status' },
  selection_date: { type: 'date', label: 'Selection date', required: true },
  expected_joining_date: { type: 'date', label: 'Expected joining date' },
  recruitment_agency_id: { type: 'ref', label: 'Recruitment agency' },
  source_country: { type: 'country', label: 'Source country', max: 80 },
  recruitment_coordinator_id: { type: 'ref', label: 'Recruitment coordinator' },
  educational_qualifications: { type: 'longtext', label: 'Educational qualifications' },
  professional_qualifications: { type: 'longtext', label: 'Professional qualifications' },
  work_experience: { type: 'longtext', label: 'Work experience' },
  licences_certifications: { type: 'longtext', label: 'Licences / certifications' },
  previous_uae_experience: { type: 'bool', label: 'Previous UAE employment' },
  previous_uae_details: { type: 'longtext', label: 'Previous UAE employment details', max: 1000 },
  remarks: { type: 'longtext', label: 'Special requirements / remarks' },
};

const today = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10); // Asia/Dubai
const addMonths = (d: string, m: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCMonth(x.getUTCMonth() + m); return x.toISOString().slice(0, 10); };
const ageOn = (dob: string, on: string) => {
  const a = new Date(`${dob}T00:00:00Z`), b = new Date(`${on}T00:00:00Z`);
  let y = b.getUTCFullYear() - a.getUTCFullYear();
  if (b.getUTCMonth() < a.getUTCMonth() || (b.getUTCMonth() === a.getUTCMonth() && b.getUTCDate() < a.getUTCDate())) y--;
  return y;
};

/** Cross-field rules and reference checks. Returns non-blocking warnings; throws on errors. */
export async function checkCandidate(q: Q, data: Record<string, any>, existing: Row | null) {
  const v = { ...(existing || {}), ...data };
  const s = await getSettings(q);
  const errors: Record<string, string> = {};
  const warnings: string[] = [];
  const t = today();

  if (v.passport_issue_date && v.passport_issue_date > t) errors.passport_issue_date = 'Passport issue date cannot be in the future.';
  if (v.passport_issue_date && v.passport_expiry_date && v.passport_expiry_date <= v.passport_issue_date) errors.passport_expiry_date = 'Expiry date must be after the issue date.';
  if (v.date_of_birth) {
    if (v.date_of_birth >= t) errors.date_of_birth = 'Date of birth must be in the past.';
    else {
      const age = ageOn(v.date_of_birth, v.selection_date || t);
      if (age < Number(s.min_age)) errors.date_of_birth = `Candidate must be at least ${s.min_age} years old (age ${age}).`;
      else if (age > Number(s.max_age)) warnings.push(`Candidate is ${age} years old — above the usual maximum of ${s.max_age}.`);
    }
  }
  if (v.selection_date && v.selection_date > t) errors.selection_date = 'Selection date cannot be in the future.';
  if (v.selection_date && v.expected_joining_date && v.expected_joining_date < v.selection_date) errors.expected_joining_date = 'Expected joining date cannot be before the selection date.';
  if (v.passport_expiry_date) {
    const from = v.expected_joining_date && v.expected_joining_date > t ? v.expected_joining_date : t;
    if (v.passport_expiry_date <= t) errors.passport_expiry_date = 'Passport has expired.';
    else if (v.passport_expiry_date < addMonths(from, Number(s.passport_min_validity_months))) {
      warnings.push(`Passport expires on ${v.passport_expiry_date}, less than ${s.passport_min_validity_months} months after ${from === t ? 'today' : 'the expected joining date'}. Renewal will be required for UAE entry/visa.`);
    }
  }
  if (!v.previous_uae_experience && data.previous_uae_details) data.previous_uae_details = null;

  const refs: [string, string, string][] = [
    ['trade_id', 'trades', 'Trade'], ['project_id', 'projects', 'Project'], ['department_id', 'departments', 'Department'],
    ['recruitment_agency_id', 'recruitment_agencies', 'Recruitment agency'], ['recruitment_coordinator_id', 'users', 'Recruitment coordinator'],
  ];
  for (const [col, table, lbl] of refs) {
    if (data[col] == null || data[col] === existing?.[col]) continue;
    const r = await one(q, `SELECT is_active FROM ${table} WHERE id = $1`, [data[col]]);
    if (!r) errors[col] = `${lbl} does not exist.`;
    else if (!r.is_active) errors[col] = `${lbl} is inactive.`;
  }
  if (data.passport_number) data.passport_number = String(data.passport_number).toUpperCase();
  if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
  return warnings;
}

export async function nextReference(q: Q) {
  const s = await getSettings(q);
  const year = Number(today().slice(0, 4));
  const r = await one(q, `INSERT INTO reference_counters(key, year, last_value) VALUES ('candidate', $1, 1)
    ON CONFLICT (key, year) DO UPDATE SET last_value = reference_counters.last_value + 1 RETURNING last_value`, [year]);
  return `${s.reference_prefix}-${year}-${String(r!.last_value).padStart(5, '0')}`;
}

function stripSalary(user: SessionUser | undefined, row: Row) {
  if (!can(user, 'candidates.salary')) for (const k of [...SALARY_FIELDS, 'total_salary']) delete row[k];
  return row;
}

const dupMessage = (e: any) => {
  if (e?.code === '23505' && String(e.constraint || e.message).includes('passport')) {
    return conflict('Another active candidate already has this passport number and issuing country.', { passport_number: 'Already registered to an active candidate.' });
  }
  return e;
};

export async function createCandidate(req: Request, q: Q, input: Record<string, unknown>) {
  const body = { ...input };
  if (!can(req.user, 'candidates.salary')) for (const k of SALARY_FIELDS) delete body[k];
  const data = validate(CANDIDATE_SCHEMA, body);
  const warnings = await checkCandidate(q, data, null);
  data.reference_no = await nextReference(q);
  data.status = 'selected';
  data.created_by = req.user!.id;
  const cols = Object.keys(data);
  let row: Row;
  try {
    row = (await q.query(`INSERT INTO candidates(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => data[c]))).rows[0];
  } catch (e) { throw dupMessage(e); }
  await q.query(`INSERT INTO candidate_status_history(candidate_id, from_status, to_status, reason, changed_by) VALUES ($1, NULL, 'selected', 'Candidate registered', $2)`, [row.id, req.user!.id]);
  await audit(q, req, 'create', 'candidates', row.id, null, row);
  await generateChecklist(q, req, row.id);
  return { row, warnings };
}

const LIST_SORT: Record<string, string> = {
  reference_no: 'c.reference_no', full_name: 'lower(c.full_name)', nationality: 'c.nationality', selection_date: 'c.selection_date',
  expected_joining_date: 'c.expected_joining_date', status: 'c.status', passport_expiry_date: 'c.passport_expiry_date', created_at: 'c.created_at',
  project: 'p.name', trade: 't.name',
};

function listWhere(query: Record<string, any>) {
  const params: unknown[] = [];
  const w: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
  const archived = String(query.archived || '0');
  if (archived === '0') w.push('NOT c.is_archived');
  else if (archived === '1') w.push('c.is_archived');
  if (query.q) {
    const like = `%${String(query.q).trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`;
    params.push(like);
    const p = `$${params.length}`;
    w.push(`(c.full_name ILIKE ${p} OR c.reference_no ILIKE ${p} OR c.passport_number ILIKE ${p} OR c.position ILIKE ${p} OR c.contact_number ILIKE ${p} OR c.email ILIKE ${p})`);
  }
  if (query.status) add('c.status = ANY(?::text[])', String(query.status).split(','));
  if (query.nationality) add('c.nationality = ?', String(query.nationality));
  if (query.project_id) add('c.project_id = ?', Number(query.project_id));
  if (query.client_id) add('p.client_id = ?', Number(query.client_id));
  if (query.trade_id) add('c.trade_id = ?', Number(query.trade_id));
  if (query.department_id) add('c.department_id = ?', Number(query.department_id));
  if (query.recruitment_agency_id) add('c.recruitment_agency_id = ?', Number(query.recruitment_agency_id));
  if (query.from) add('c.selection_date >= ?', String(query.from));
  if (query.to) add('c.selection_date <= ?', String(query.to));
  if (query.passport_expiring === '1') w.push(`c.passport_expiry_date < (current_date + interval '6 months') AND c.status NOT IN ('cancelled','deployed')`);
  return { where: w.length ? `WHERE ${w.join(' AND ')}` : '', params };
}

const LIST_SELECT = `SELECT c.id, c.reference_no, c.full_name, c.gender, c.date_of_birth, c.nationality, c.contact_number, c.email,
    c.passport_number, c.passport_expiry_date, c.passport_issuing_country, c.position, c.employment_category, c.selection_date,
    c.expected_joining_date, c.status, c.is_archived, c.contract_status, c.offer_letter_status, c.source_country, c.work_location,
    c.basic_salary, c.total_salary, c.photo_document_id, c.created_at,
    t.name AS trade, p.name AS project, p.code AS project_code, cl.name AS client, d.name AS department, a.name AS agency, u.full_name AS coordinator
  FROM candidates c
  JOIN trades t ON t.id = c.trade_id
  JOIN projects p ON p.id = c.project_id
  LEFT JOIN clients cl ON cl.id = p.client_id
  LEFT JOIN departments d ON d.id = c.department_id
  LEFT JOIN recruitment_agencies a ON a.id = c.recruitment_agency_id
  LEFT JOIN users u ON u.id = c.recruitment_coordinator_id`;

export async function listCandidates(user: SessionUser, query: Record<string, any>, all = false) {
  const { where, params } = listWhere(query);
  const sortKey = LIST_SORT[String(query.sort)] ? String(query.sort) : 'created_at';
  const dir = query.dir === 'asc' ? 'ASC' : 'DESC';
  const pageSize = Math.min(Math.max(Number(query.pageSize) || 25, 5), 200);
  const page = Math.max(Number(query.page) || 1, 1);
  const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM candidates c JOIN projects p ON p.id = c.project_id ${where}`, params))!.n;
  const limit = all ? '' : `LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`;
  const rows = await db.many(`${LIST_SELECT} ${where} ORDER BY ${LIST_SORT[sortKey]} ${dir} NULLS LAST, c.id DESC ${limit}`, params);
  return { rows: rows.map((r) => stripSalary(user, r)), total, page, pageSize };
}

export async function getCandidate(user: SessionUser, id: number) {
  const c = await db.one(`SELECT c.*, t.name AS trade, t.category AS trade_category, p.name AS project, p.code AS project_code, cl.name AS client,
      d.name AS department, a.name AS agency, u.full_name AS coordinator, cu.full_name AS created_by_name, uu.full_name AS updated_by_name,
      au.full_name AS archived_by_name
    FROM candidates c JOIN trades t ON t.id = c.trade_id JOIN projects p ON p.id = c.project_id
    LEFT JOIN clients cl ON cl.id = p.client_id LEFT JOIN departments d ON d.id = c.department_id
    LEFT JOIN recruitment_agencies a ON a.id = c.recruitment_agency_id LEFT JOIN users u ON u.id = c.recruitment_coordinator_id
    LEFT JOIN users cu ON cu.id = c.created_by LEFT JOIN users uu ON uu.id = c.updated_by LEFT JOIN users au ON au.id = c.archived_by
    WHERE c.id = $1`, [id]);
  if (!c) throw notFound('Candidate not found.');
  const history = await db.many(`SELECT h.*, u.full_name AS changed_by_name FROM candidate_status_history h
    LEFT JOIN users u ON u.id = h.changed_by WHERE h.candidate_id = $1 ORDER BY h.changed_at, h.id`, [id]);
  return { candidate: stripSalary(user, c), history };
}

/** Manual lifecycle actions available in Phase 1. Workflow statuses are driven by later modules. */
const ACTIONS: Record<string, { from: (s: string) => boolean; reasonRequired: boolean }> = {
  pre_arrival: { from: (s) => s === 'selected', reasonRequired: false },
  selected: { from: (s) => s === 'pre_arrival', reasonRequired: true },
  hold: { from: (s) => !['on_hold', 'cancelled', 'deployed'].includes(s), reasonRequired: true },
  resume: { from: (s) => s === 'on_hold', reasonRequired: false },
  cancel: { from: (s) => s !== 'cancelled' && s !== 'deployed', reasonRequired: true },
};

export async function changeStatus(req: Request, id: number, body: Record<string, any>) {
  const action = String(body.action || '');
  const def = ACTIONS[action];
  if (!def) throw badRequest('Unknown status action.');
  const reason = String(body.reason || '').trim().slice(0, 1000);
  return db.tx(async (q) => {
    const c = await one(q, 'SELECT * FROM candidates WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw notFound('Candidate not found.');
    if (c.is_archived) throw badRequest('Restore the candidate from the archive first.');
    if (!def.from(c.status)) throw badRequest(`This action is not available while the candidate is "${label('candidate_status', c.status)}".`);
    if (def.reasonRequired && !reason) throw badRequest('A reason is required.', { reason: 'Please give a reason.' });
    let to = action;
    const set: Record<string, unknown> = { status_reason: reason || null, status_changed_at: new Date().toISOString(), updated_by: req.user!.id, updated_at: new Date().toISOString() };
    if (action === 'hold') { to = 'on_hold'; set.status_before_hold = c.status; }
    if (action === 'resume') { to = c.status_before_hold && !['on_hold', 'cancelled'].includes(c.status_before_hold) ? c.status_before_hold : 'selected'; set.status_before_hold = null; }
    if (action === 'cancel') {
      to = 'cancelled';
      if (!ENUMS.cancel_category.some((o) => o.value === body.cancel_category)) throw badRequest('Select a cancellation category.', { cancel_category: 'Required.' });
      set.cancel_category = body.cancel_category;
    }
    if (WORKFLOW_STATUSES.includes(to) && action !== 'resume') throw forbidden('This status is set by the onboarding workflow.');
    set.status = to;
    const cols = Object.keys(set);
    await q.query(`UPDATE candidates SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((k) => set[k])]);
    await q.query('INSERT INTO candidate_status_history(candidate_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)',
      [id, c.status, to, reason || null, req.user!.id]);
    await audit(q, req, 'status_change', 'candidates', id, { status: c.status }, { status: to, reason, cancel_category: set.cancel_category });
    // Checked-in residents stay until checked out; reserved beds and open pickups are released.
    const released = to === 'cancelled' ? await releaseCandidateResources(q, req, id) : null;
    const openBooking = to === 'cancelled' ? await one(q, `SELECT booking_no, status FROM flight_bookings WHERE candidate_id = $1 AND status NOT IN ('cancelled','travel_completed')`, [id]) : null;
    return { ok: true, status: to, released, openBooking };
  });
}

// ------------------------------------------------------------------ routes
export const candidatesRouter = express.Router();

candidatesRouter.get('/', requirePerm('candidates.view'), asyncH(async (req, res) => {
  if (req.query.export === 'xlsx') {
    const data = await listCandidates(req.user!, req.query, true);
    const salary = can(req.user, 'candidates.salary');
    await audit(db, req, 'export', 'candidates', null, null, { rows: data.rows.length, filters: req.query });
    return sendXlsx(res, 'Candidate Register', [
      ['reference_no', 'Reference No', 14], ['full_name', 'Full Name', 28], ['gender', 'Gender', 8], ['date_of_birth', 'Date of Birth', 12],
      ['nationality', 'Nationality', 14], ['passport_number', 'Passport No', 14], ['passport_expiry_date', 'Passport Expiry', 13],
      ['position', 'Position', 22], ['trade', 'Trade', 18], ['project', 'Project', 22], ['client', 'Client', 20], ['department', 'Department', 18],
      ['agency', 'Recruitment Agency', 22], ['source_country', 'Source Country', 14], ['selection_date', 'Selection Date', 12],
      ['expected_joining_date', 'Expected Joining', 13], ['contract_status', 'Contract', 14], ['offer_letter_status', 'Offer Letter', 12],
      ...(salary ? [['basic_salary', 'Basic Salary (AED)', 14], ['total_salary', 'Total Salary (AED)', 14]] as [string, string, number][] : []),
      ['status', 'Status', 20], ['contact_number', 'Contact', 16],
    ], data.rows.map((r) => ({ ...r, status: label('candidate_status', r.status), gender: label('gender', r.gender),
      contract_status: label('contract_status', r.contract_status), offer_letter_status: label('offer_letter_status', r.offer_letter_status) })),
    (await getSettings()).company_name);
  }
  res.json(await listCandidates(req.user!, req.query));
}));

candidatesRouter.get('/:id', requirePerm('candidates.view'), asyncH(async (req, res) => {
  res.json(await getCandidate(req.user!, toId(req.params.id)));
}));

candidatesRouter.post('/', requirePerm('candidates.create'), asyncH(async (req, res) => {
  const out = await db.tx((q) => createCandidate(req, q, req.body || {}));
  res.status(201).json({ id: out.row.id, reference_no: out.row.reference_no, warnings: out.warnings });
}));

candidatesRouter.put('/:id', requirePerm('candidates.edit'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const body = { ...(req.body || {}) };
  if (!can(req.user, 'candidates.salary')) for (const k of SALARY_FIELDS) delete body[k];
  const out = await db.tx(async (q) => {
    const old = await one(q, 'SELECT * FROM candidates WHERE id = $1 FOR UPDATE', [id]);
    if (!old) throw notFound('Candidate not found.');
    if (old.is_archived) throw badRequest('Archived candidates cannot be edited. Restore it first.');
    const data = validate(CANDIDATE_SCHEMA, body, true);
    const warnings = await checkCandidate(q, data, old);
    if (!Object.keys(data).length) return { warnings };
    data.updated_by = req.user!.id;
    data.updated_at = new Date().toISOString();
    const cols = Object.keys(data);
    let row: Row;
    try {
      row = (await q.query(`UPDATE candidates SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => data[c])])).rows[0];
    } catch (e) { throw dupMessage(e); }
    const d = diff(old, row);
    if (Object.keys(d.new as object).length) await audit(q, req, 'update', 'candidates', id, d.old, d.new);
    await resync(q, req, id);
    return { warnings };
  });
  res.json({ ok: true, ...out });
}));

candidatesRouter.post('/:id/status', requirePerm('candidates.status'), asyncH(async (req, res) => {
  res.json(await changeStatus(req, toId(req.params.id), req.body || {}));
}));

candidatesRouter.post('/:id/archive', requirePerm('candidates.archive'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const restore = req.body?.restore === true;
  await db.tx(async (q) => {
    const c = await one(q, 'SELECT id, status, is_archived FROM candidates WHERE id = $1 FOR UPDATE', [id]);
    if (!c) throw notFound('Candidate not found.');
    if (!restore && c.status !== 'cancelled') throw badRequest('Only cancelled candidates can be archived.');
    if (restore && !c.is_archived) throw badRequest('Candidate is not archived.');
    if (!restore && c.is_archived) throw badRequest('Candidate is already archived.');
    await q.query(`UPDATE candidates SET is_archived = $2, archived_at = CASE WHEN $2 THEN now() END, archived_by = CASE WHEN $2 THEN $3::int END,
      updated_at = now(), updated_by = $3 WHERE id = $1`, [id, !restore, req.user!.id]);
    await audit(q, req, restore ? 'restore' : 'archive', 'candidates', id, { is_archived: c.is_archived }, { is_archived: !restore });
  });
  res.json({ ok: true });
}));

/** Travel, pickup and accommodation summary for the profile and timeline (visible to anyone who can see the candidate). */
candidatesRouter.get('/:id/journey', requirePerm('candidates.view'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const [bookings, pickup, allocations] = await Promise.all([
    db.many(`SELECT b.id, b.booking_no, b.status, b.departure_city, b.departure_country, b.arrival_airport, b.arrival_terminal, b.preferred_travel_date,
        b.confirmed_travel_date, b.airline, b.flight_number, b.departure_at, b.arrival_at, b.booking_reference, b.baggage_allowance,
        b.ticket_cost, b.eticket_document_id, b.cancel_reason, b.created_at, b.approved_at, ta.name AS agency_name,
        (SELECT max(a.created_at) FROM audit_logs a WHERE a.entity = 'flight_bookings' AND a.entity_id = b.id AND a.action = 'issue') AS issued_at
      FROM flight_bookings b LEFT JOIN travel_agencies ta ON ta.id = b.travel_agency_id WHERE b.candidate_id = $1 ORDER BY b.id DESC`, [id]),
    db.one(`SELECT ap.*, u.full_name AS coordinator_name FROM airport_pickups ap LEFT JOIN users u ON u.id = ap.coordinator_id
      WHERE ap.candidate_id = $1 AND ap.status <> 'cancelled' ORDER BY ap.id DESC LIMIT 1`, [id]),
    db.many(`SELECT aa.*, ar.room_number, ar.block, ar.room_type, ac.name AS camp_name, ac.location, ac.supervisor_name, ac.supervisor_phone
      FROM accommodation_allocations aa JOIN accommodation_rooms ar ON ar.id = aa.room_id JOIN accommodation_camps ac ON ac.id = ar.camp_id
      WHERE aa.candidate_id = $1 ORDER BY aa.id DESC`, [id]),
  ]);
  if (!can(req.user, 'mobility.view') && !can(req.user, 'finance.view')) for (const b of bookings) delete b.ticket_cost;
  res.json({ bookings, pickup, allocations });
}));

candidatesRouter.get('/:id/audit', requirePerm('candidates.view'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const salary = can(req.user, 'candidates.salary');
  const rows = await db.many(`SELECT id, action, username, old_values, new_values, created_at FROM audit_logs
    WHERE (entity = 'candidates' AND entity_id = $1)
       OR (entity = 'employee_documents' AND (new_values->>'candidate_id')::int = $1)
    ORDER BY created_at DESC, id DESC LIMIT 200`, [id]);
  if (!salary) {
    for (const r of rows) for (const k of [...SALARY_FIELDS, 'total_salary']) { if (r.old_values) delete r.old_values[k]; if (r.new_values) delete r.new_values[k]; }
  }
  res.json(rows);
}));
