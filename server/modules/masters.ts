// Reference data: departments, clients, projects, recruitment agencies, trades.
import express, { type NextFunction, type Request, type Response } from 'express';
import { db } from '../db/index.ts';
import { asyncH, conflict, forbidden, notFound, toId } from '../lib/http.ts';
import { can } from '../lib/rbac.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate, type Schema } from '../lib/validate.ts';
import { COUNTRIES, ENUMS } from '../lib/enums.ts';

interface Master { table: string; label: string; schema: Schema; select: string; order: string; usage: string; perm?: string; viewPerm?: string }

export const MASTERS: Record<string, Master> = {
  departments: {
    table: 'departments', label: 'Department',
    schema: {
      code: { type: 'text', label: 'Code', required: true, max: 20, pattern: [/^[A-Z0-9_-]+$/, 'Use capital letters, digits, - or _.'] },
      name: { type: 'text', label: 'Name', required: true, max: 100 },
      manager_user_id: { type: 'ref', label: 'Department manager' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: `SELECT d.*, u.full_name AS manager_name FROM departments d LEFT JOIN users u ON u.id = d.manager_user_id`,
    order: 'd.name', usage: 'SELECT count(*)::int AS n FROM candidates WHERE department_id = $1',
  },
  clients: {
    table: 'clients', label: 'Client',
    schema: {
      name: { type: 'text', label: 'Client name', required: true, max: 150 },
      contact_person: { type: 'text', label: 'Contact person' },
      phone: { type: 'phone', label: 'Phone' },
      email: { type: 'email', label: 'Email' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: 'SELECT c.* FROM clients c', order: 'c.name', usage: 'SELECT count(*)::int AS n FROM projects WHERE client_id = $1',
  },
  projects: {
    table: 'projects', label: 'Project',
    schema: {
      code: { type: 'text', label: 'Project code', required: true, max: 30, pattern: [/^[A-Za-z0-9_-]+$/, 'Letters, digits, - or _ only.'] },
      name: { type: 'text', label: 'Project name', required: true, max: 150 },
      client_id: { type: 'ref', label: 'Client', required: true },
      location: { type: 'text', label: 'Location' },
      emirate: { type: 'enum', label: 'Emirate', options: 'emirate' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: 'SELECT p.*, c.name AS client_name FROM projects p LEFT JOIN clients c ON c.id = p.client_id',
    order: 'p.name', usage: 'SELECT count(*)::int AS n FROM candidates WHERE project_id = $1',
  },
  recruitment_agencies: {
    table: 'recruitment_agencies', label: 'Recruitment agency',
    schema: {
      name: { type: 'text', label: 'Agency name', required: true, max: 150 },
      country: { type: 'country', label: 'Country', max: 80 },
      licence_no: { type: 'text', label: 'Licence number', max: 80 },
      contact_person: { type: 'text', label: 'Contact person' },
      phone: { type: 'phone', label: 'Phone' },
      email: { type: 'email', label: 'Email' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: 'SELECT a.* FROM recruitment_agencies a', order: 'a.name', usage: 'SELECT count(*)::int AS n FROM candidates WHERE recruitment_agency_id = $1',
  },
  trades: {
    table: 'trades', label: 'Trade',
    schema: {
      code: { type: 'text', label: 'Code', required: true, max: 30, pattern: [/^[A-Z0-9_-]+$/, 'Use capital letters, digits, - or _.'] },
      name: { type: 'text', label: 'Trade name', required: true, max: 100 },
      category: { type: 'enum', label: 'Trade category', required: true, options: 'trade_category' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: 'SELECT t.* FROM trades t', order: 't.name', usage: 'SELECT count(*)::int AS n FROM candidates WHERE trade_id = $1',
  },
  travel_agencies: {
    table: 'travel_agencies', label: 'Travel agency', perm: 'mobility.manage', viewPerm: 'mobility.view',
    schema: {
      name: { type: 'text', label: 'Agency name', required: true, max: 150 },
      contact_person: { type: 'text', label: 'Contact person' },
      phone: { type: 'phone', label: 'Contact number' },
      email: { type: 'email', label: 'Email' },
      office_location: { type: 'text', label: 'Office location', max: 200 },
      payment_terms: { type: 'text', label: 'Payment terms', max: 200 },
      is_approved: { type: 'bool', label: 'Approved agency' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: 'SELECT a.*, (SELECT count(*)::int FROM flight_quotations q WHERE q.travel_agency_id = a.id) AS quote_count FROM travel_agencies a',
    order: 'a.name',
    usage: 'SELECT (SELECT count(*) FROM flight_quotations WHERE travel_agency_id = $1) + (SELECT count(*) FROM flight_bookings WHERE travel_agency_id = $1) AS n',
  },
  vehicles: {
    table: 'vehicles', label: 'Vehicle', perm: 'mobility.manage', viewPerm: 'mobility.view',
    schema: {
      registration_no: { type: 'text', label: 'Registration number', required: true, max: 30 },
      name: { type: 'text', label: 'Vehicle', required: true, max: 100 },
      vehicle_type: { type: 'enum', label: 'Type', required: true, options: 'vehicle_type' },
      seats: { type: 'int', label: 'Seats', required: true },
      driver_name: { type: 'text', label: 'Default driver' },
      driver_phone: { type: 'phone', label: 'Driver contact' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: 'SELECT v.* FROM vehicles v', order: 'v.registration_no', usage: 'SELECT count(*)::int AS n FROM airport_pickups WHERE vehicle_id = $1',
  },
  training_courses: {
    table: 'training_courses', label: 'Training course', perm: 'training.manage', viewPerm: 'onboarding.view',
    schema: {
      code: { type: 'text', label: 'Code', required: true, max: 30, pattern: [/^[A-Z0-9_-]+$/, 'Capital letters, digits, - or _.'] },
      name: { type: 'text', label: 'Course name', required: true, max: 150 },
      category: { type: 'enum', label: 'Category', required: true, options: 'training_category' },
      duration_hours: { type: 'money', label: 'Duration (hours)', required: true },
      validity_months: { type: 'int', label: 'Validity (months)' },
      provider: { type: 'text', label: 'Provider' },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: `SELECT tc.*, (SELECT count(*)::int FROM training_records tr WHERE tr.course_id = tc.id) AS records FROM training_courses tc`,
    order: 'tc.category, tc.name', usage: 'SELECT count(*)::int AS n FROM training_records WHERE course_id = $1',
  },
  uniform_items: {
    table: 'uniform_items', label: 'Uniform / PPE item', perm: 'uniform.manage', viewPerm: 'onboarding.view',
    schema: {
      name: { type: 'text', label: 'Item', required: true, max: 100 },
      category: { type: 'enum', label: 'Category', required: true, options: 'uniform_category' },
      needs_size: { type: 'bool', label: 'Size required' },
      default_qty: { type: 'int', label: 'Default quantity', required: true },
      is_active: { type: 'bool', label: 'Active' },
    },
    select: 'SELECT ui.* FROM uniform_items ui', order: 'ui.category, ui.name', usage: 'SELECT count(*)::int AS n FROM uniform_issues WHERE item_id = $1',
  },
};

const permOf = (key: string, write: boolean) => {
  const m = get(key);
  return write ? m.perm || 'masters.manage' : m.viewPerm || 'candidates.view';
};
const guard = (write: boolean) => (req: Request, _res: Response, next: NextFunction) => {
  try {
    const p = permOf(String(req.params.key), write);
    if (!can(req.user, p) && !(write ? false : can(req.user, 'masters.manage'))) return next(forbidden());
    next();
  } catch (e) { next(e); }
};

const get = (key: string) => {
  const m = MASTERS[key];
  if (!m) throw notFound('Unknown list.');
  return m;
};

function uniqueError(e: any, label: string) {
  if (e?.code === '23505') return conflict(`A ${label.toLowerCase()} with this ${String(e.detail || e.message).includes('(code)') ? 'code' : 'name'} already exists.`);
  if (e?.code === '23503') return conflict('A referenced record does not exist.');
  return e;
}

export const mastersRouter = express.Router();

/** Dropdown options for every signed-in user (active records only unless ?all=1). */
mastersRouter.get('/options', asyncH(async (req, res) => {
  const all = req.query.all === '1';
  const act = (a: string) => (all ? '' : `WHERE ${a}.is_active`);
  const [departments, clients, projects, agencies, trades, users, travelAgencies, vehicles] = await Promise.all([
    db.many(`SELECT d.id, d.name AS label, d.is_active FROM departments d ${act('d')} ORDER BY d.name`),
    db.many(`SELECT c.id, c.name AS label, c.is_active FROM clients c ${act('c')} ORDER BY c.name`),
    db.many(`SELECT p.id, p.name || ' (' || p.code || ')' AS label, p.client_id, c.name AS client, p.location, p.is_active FROM projects p LEFT JOIN clients c ON c.id = p.client_id ${act('p')} ORDER BY p.name`),
    db.many(`SELECT a.id, a.name AS label, a.country, a.is_active FROM recruitment_agencies a ${act('a')} ORDER BY a.name`),
    db.many(`SELECT t.id, t.name AS label, t.category, t.is_active FROM trades t ${act('t')} ORDER BY t.name`),
    db.many(`SELECT u.id, u.full_name AS label, r.code AS role, u.is_active FROM users u JOIN roles r ON r.id = u.role_id ${act('u')} ORDER BY u.full_name`),
    db.many(`SELECT a.id, a.name AS label, a.is_approved, a.is_active FROM travel_agencies a ${act('a')} ORDER BY a.name`),
    db.many(`SELECT v.id, v.registration_no || ' — ' || v.name AS label, v.registration_no, v.driver_name, v.driver_phone, v.seats, v.is_active FROM vehicles v ${act('v')} ORDER BY v.registration_no`),
  ]);
  res.json({ departments, clients, projects, agencies, trades, users, travelAgencies, vehicles, countries: COUNTRIES, enums: ENUMS });
}));

mastersRouter.get('/masters/:key', guard(false), asyncH(async (req, res) => {
  const m = get(String(req.params.key));
  res.json(await db.many(`${m.select} ORDER BY ${m.order}`));
}));

mastersRouter.post('/masters/:key', guard(true), asyncH(async (req, res) => {
  const m = get(String(req.params.key));
  const data = validate(m.schema, { is_active: true, ...(req.body || {}) });
  const cols = Object.keys(data);
  try {
    const row = await db.tx(async (q) => {
      const r = (await q.query(`INSERT INTO ${m.table}(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => data[c]))).rows[0];
      await audit(q, req, 'create', m.table, r.id, null, r);
      return r;
    });
    res.status(201).json(row);
  } catch (e) { throw uniqueError(e, m.label); }
}));

mastersRouter.put('/masters/:key/:id', guard(true), asyncH(async (req, res) => {
  const m = get(String(req.params.key));
  const id = toId(req.params.id);
  const data = validate(m.schema, req.body || {}, true);
  const cols = Object.keys(data);
  if (!cols.length) return res.json({ ok: true });
  try {
    await db.tx(async (q) => {
      const old = (await q.query(`SELECT * FROM ${m.table} WHERE id = $1 FOR UPDATE`, [id])).rows[0];
      if (!old) throw notFound();
      const row = (await q.query(`UPDATE ${m.table} SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => data[c])])).rows[0];
      const d = diff(old, row);
      await audit(q, req, 'update', m.table, id, d.old, d.new);
    });
  } catch (e) { throw uniqueError(e, m.label); }
  res.json({ ok: true });
}));

/** Records in use are deactivated rather than deleted so history stays intact. */
mastersRouter.delete('/masters/:key/:id', guard(true), asyncH(async (req, res) => {
  const m = get(String(req.params.key));
  const id = toId(req.params.id);
  const used = (await db.one<{ n: number }>(m.usage, [id]))!.n;
  await db.tx(async (q) => {
    const old = (await q.query(`SELECT * FROM ${m.table} WHERE id = $1`, [id])).rows[0];
    if (!old) throw notFound();
    if (used) await q.query(`UPDATE ${m.table} SET is_active = FALSE WHERE id = $1`, [id]);
    else await q.query(`DELETE FROM ${m.table} WHERE id = $1`, [id]);
    await audit(q, req, used ? 'deactivate' : 'delete', m.table, id, old, null);
  });
  res.json({ ok: true, deactivated: used > 0, usage: used });
}));
