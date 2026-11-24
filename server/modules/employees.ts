// Employee Master: HR registration (activity 16) creates the employee number; the master list joins every module.
import express from 'express';
import { db, one } from '../db/index.ts';
import { asyncH, badRequest, conflict } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { audit } from '../lib/audit.ts';
import { validate } from '../lib/validate.ts';
import { label } from '../lib/enums.ts';
import { ARRIVED_SQL, resync, uaeToday } from '../lib/onboarding.ts';
import { sendXlsx } from '../lib/xlsx.ts';
import { getSettings } from '../lib/settings.ts';

export const employeesRouter = express.Router();

const SELECT = `SELECT e.id, e.employee_no, e.joining_date, e.file_no, c.id AS candidate_id, c.full_name, c.reference_no, c.nationality, c.gender, c.status,
    c.position, c.photo_document_id, c.passport_number, c.passport_expiry_date, t.name AS trade, p.name AS project, cl.name AS client,
    v.residence_status, v.residence_expiry_date, v.eid_number, v.eid_expiry_date,
    (SELECT ac.name || ' · ' || coalesce(ar.block || ' ', '') || 'Room ' || ar.room_number FROM accommodation_allocations aa
       JOIN accommodation_rooms ar ON ar.id = aa.room_id JOIN accommodation_camps ac ON ac.id = ar.camp_id
      WHERE aa.candidate_id = c.id AND aa.status IN ('allocated','checked_in') LIMIT 1) AS accommodation,
    (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'completed') / nullif(count(*) FILTER (WHERE a.status <> 'not_applicable'), 0))
       FROM onboarding_activities a WHERE a.candidate_id = c.id)::int AS onboarding_pct
  FROM employees e JOIN candidates c ON c.id = e.candidate_id JOIN trades t ON t.id = c.trade_id JOIN projects p ON p.id = c.project_id
  LEFT JOIN clients cl ON cl.id = p.client_id LEFT JOIN visa_records v ON v.candidate_id = c.id`;

employeesRouter.get('/employees', requirePerm('candidates.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = ['TRUE'];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.query.q) add('(c.full_name ILIKE ? OR e.employee_no ILIKE ? OR c.reference_no ILIKE ? OR v.eid_number ILIKE ?)', `%${req.query.q}%`);
  if (req.query.status) add('c.status = ?', String(req.query.status));
  if (req.query.project_id) add('c.project_id = ?', Number(req.query.project_id));
  const rows = await db.many(`${SELECT} WHERE ${w.join(' AND ')} ORDER BY e.employee_no`, params);
  if (req.query.export === 'xlsx') {
    await audit(db, req, 'export', 'employees', null, null, { rows: rows.length });
    return sendXlsx(res, 'Employee Master', [['employee_no', 'Employee No', 12], ['full_name', 'Name', 26], ['reference_no', 'Candidate Ref', 15], ['nationality', 'Nationality', 13],
      ['position', 'Position', 20], ['trade', 'Trade', 18], ['project', 'Project', 22], ['joining_date', 'Joining Date', 12], ['status', 'Status', 20],
      ['residence_status', 'Residence Visa', 14], ['residence_expiry_date', 'Visa Expiry', 12], ['eid_number', 'Emirates ID', 20], ['accommodation', 'Accommodation', 30],
      ['onboarding_pct', 'Onboarding %', 12]],
    rows.map((r) => ({ ...r, status: label('candidate_status', r.status), residence_status: label('residence_status', r.residence_status || 'not_started') })), (await getSettings()).company_name);
  }
  // Candidates who have arrived but are not yet registered (for the HR registration queue).
  const pending = await db.many(`SELECT c.id, c.full_name, c.reference_no, c.status, c.position, p.name AS project,
      (SELECT min(h.changed_at) FROM candidate_status_history h WHERE h.candidate_id = c.id AND h.to_status = 'arrived') AS arrived_at
    FROM candidates c JOIN projects p ON p.id = c.project_id
    WHERE ${ARRIVED_SQL} AND NOT c.is_archived AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.candidate_id = c.id) ORDER BY c.full_name`);
  res.json({ rows, pending });
}));

employeesRouter.post('/employees', requirePerm('employees.manage'), asyncH(async (req, res) => {
  const data = validate({ candidate_id: { type: 'ref', label: 'Candidate', required: true }, joining_date: { type: 'date', label: 'Joining date', required: true },
    file_no: { type: 'text', label: 'Employee file no.', max: 40 }, remarks: { type: 'longtext', label: 'Remarks', max: 500 } }, req.body || {});
  if (String(data.joining_date) > uaeToday()) throw badRequest('Joining date cannot be in the future.', { joining_date: 'Future date.' });
  const row = await db.tx(async (q) => {
    const c = await one(q, `SELECT c.id, c.is_archived FROM candidates c WHERE c.id = $1 AND ${ARRIVED_SQL} FOR UPDATE OF c`, [data.candidate_id]);
    if (!c || c.is_archived) throw badRequest('HR registration is done after the employee has arrived in the UAE.', { candidate_id: 'Not arrived.' });
    if (await one(q, 'SELECT 1 FROM employees WHERE candidate_id = $1', [c.id])) throw conflict('This person is already registered as an employee.');
    const n = await one(q, `INSERT INTO reference_counters(key, year, last_value) VALUES ('employee', 0, 1)
      ON CONFLICT (key, year) DO UPDATE SET last_value = reference_counters.last_value + 1 RETURNING last_value`, []);
    const r = (await q.query(`INSERT INTO employees(employee_no, candidate_id, joining_date, file_no, remarks, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [`EMP-${String(n!.last_value).padStart(5, '0')}`, c.id, data.joining_date, data.file_no, data.remarks, req.user!.id])).rows[0];
    await audit(q, req, 'create', 'employees', r.id, null, r);
    await resync(q, req, c.id);
    return r;
  });
  res.status(201).json(row);
}));
