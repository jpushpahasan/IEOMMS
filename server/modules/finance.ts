// Module 7 — Financial cost tracking: mobilisation expenses per employee, verification, summaries.
import express, { type Request } from 'express';
import { db, one, type Q } from '../db/index.ts';
import { asyncH, badRequest, forbidden, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { can } from '../lib/rbac.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate, type Schema } from '../lib/validate.ts';
import { label } from '../lib/enums.ts';
import { recordApproval } from '../lib/approvals.ts';
import { uaeToday } from '../lib/onboarding.ts';
import { sendXlsx } from '../lib/xlsx.ts';
import { getSettings } from '../lib/settings.ts';
import { recordDocument, upload } from './documents.ts';
import { withFile } from './medical.ts';

export const financeRouter = express.Router();

const SCHEMA: Schema = {
  category: { type: 'enum', label: 'Cost category', required: true, options: 'expense_category' },
  description: { type: 'text', label: 'Description', max: 200 },
  estimated_cost: { type: 'money', label: 'Estimated cost (AED)' },
  actual_cost: { type: 'money', label: 'Actual cost (AED)' },
  supplier: { type: 'text', label: 'Supplier / service provider', max: 150 },
  invoice_no: { type: 'text', label: 'Invoice number', max: 60 },
  invoice_date: { type: 'date', label: 'Invoice date' },
  payment_status: { type: 'enum', label: 'Payment status', options: 'payment_status' },
  payment_date: { type: 'date', label: 'Payment date' },
  remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
};

/** Flight ticket cost is recorded automatically from the booking (issued → actual cost; cancelled → zero). */
export async function syncTicketExpense(q: Q, req: Request, bookingId: number) {
  const b = await one(q, `SELECT b.*, ta.name AS agency FROM flight_bookings b LEFT JOIN travel_agencies ta ON ta.id = b.travel_agency_id WHERE b.id = $1`, [bookingId]);
  if (!b) return;
  const ex = await one(q, `SELECT * FROM mobilisation_expenses WHERE source = 'flight_booking' AND source_id = $1`, [bookingId]);
  const issued = ['ticket_issued', 'travel_completed'].includes(b.status);
  if (!issued && !ex) return;
  if (ex?.verification_status === 'verified') return; // finance already signed it off
  const cost = issued ? b.ticket_cost : '0';
  if (ex) {
    await q.query(`UPDATE mobilisation_expenses SET actual_cost = $2, supplier = $3, description = $4, verification_status = 'pending', verified_by = NULL, verified_at = NULL,
      updated_at = now(), updated_by = $5 WHERE id = $1`, [ex.id, cost, b.agency, `${b.booking_no} ${b.flight_number || ''}${issued ? '' : ' (cancelled)'}`.trim(), req.user!.id]);
  } else {
    const r = await one(q, `INSERT INTO mobilisation_expenses(candidate_id, category, description, estimated_cost, actual_cost, supplier, invoice_no, source, source_id, created_by)
      VALUES ($1,'flight_ticket',$2,$3,$3,$4,$5,'flight_booking',$6,$7) RETURNING id`,
    [b.candidate_id, `${b.booking_no} ${b.flight_number || ''}`.trim(), cost, b.agency, b.booking_reference, bookingId, req.user!.id]);
    await audit(q, req, 'create', 'mobilisation_expenses', r!.id, null, { candidate_id: b.candidate_id, category: 'flight_ticket', actual_cost: cost, source: 'flight_booking' });
  }
}

function filters(req: Request, params: unknown[]) {
  const w: string[] = ['TRUE'];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.query.candidate_id) add('e.candidate_id = ?', Number(req.query.candidate_id));
  if (req.query.category) add('e.category = ?', String(req.query.category));
  if (req.query.payment_status) add('e.payment_status = ?', String(req.query.payment_status));
  if (req.query.verification_status) add('e.verification_status = ?', String(req.query.verification_status));
  if (req.query.project_id) add('c.project_id = ?', Number(req.query.project_id));
  if (req.query.client_id) add('p.client_id = ?', Number(req.query.client_id));
  if (req.query.agency_id) add('c.recruitment_agency_id = ?', Number(req.query.agency_id));
  if (req.query.nationality) add('c.nationality = ?', String(req.query.nationality));
  if (req.query.from) add('coalesce(e.invoice_date, e.created_at::date) >= ?', String(req.query.from));
  if (req.query.to) add('coalesce(e.invoice_date, e.created_at::date) <= ?', String(req.query.to));
  if (req.query.q) add('(c.full_name ILIKE ? OR c.reference_no ILIKE ? OR e.supplier ILIKE ? OR e.invoice_no ILIKE ?)', `%${req.query.q}%`);
  return w.join(' AND ');
}
const BASE = `FROM mobilisation_expenses e JOIN candidates c ON c.id = e.candidate_id JOIN projects p ON p.id = c.project_id
  LEFT JOIN clients cl ON cl.id = p.client_id LEFT JOIN recruitment_agencies ra ON ra.id = c.recruitment_agency_id`;

financeRouter.get('/finance/expenses', requirePerm('finance.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const where = filters(req, params);
  const rows = await db.many(`SELECT e.*, c.full_name, c.reference_no, c.nationality, p.name AS project, ra.name AS agency,
      cu.full_name AS created_by_name, vu.full_name AS verified_by_name, (coalesce(e.actual_cost, 0) - e.estimated_cost) AS variance
    ${BASE} LEFT JOIN users cu ON cu.id = e.created_by LEFT JOIN users vu ON vu.id = e.verified_by
    WHERE ${where} ORDER BY e.created_at DESC, e.id DESC LIMIT 2000`, params);
  if (req.query.export === 'xlsx') {
    await audit(db, req, 'export', 'mobilisation_expenses', null, null, { rows: rows.length });
    return sendXlsx(res, 'Mobilisation Expenses', [['reference_no', 'Ref', 14], ['full_name', 'Employee', 24], ['project', 'Project', 22], ['nationality', 'Nationality', 13],
      ['agency', 'Agency', 20], ['category', 'Category', 24], ['description', 'Description', 26], ['supplier', 'Supplier', 22], ['invoice_no', 'Invoice', 14],
      ['estimated_cost', 'Estimated (AED)', 14], ['actual_cost', 'Actual (AED)', 14], ['variance', 'Variance (AED)', 14], ['payment_status', 'Payment', 12],
      ['payment_date', 'Paid on', 12], ['verification_status', 'Verification', 14]],
    rows.map((r) => ({ ...r, category: label('expense_category', r.category), payment_status: label('payment_status', r.payment_status), verification_status: label('verification_status', r.verification_status) })),
    (await getSettings()).company_name);
  }
  res.json(rows);
}));

financeRouter.get('/finance/summary', requirePerm('finance.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const where = filters(req, params);
  const agg = `coalesce(sum(e.estimated_cost), 0) AS estimated, coalesce(sum(e.actual_cost), 0) AS actual,
    coalesce(sum(e.actual_cost), 0) - coalesce(sum(e.estimated_cost) FILTER (WHERE e.actual_cost IS NOT NULL), 0) AS variance,
    coalesce(sum(e.estimated_cost) FILTER (WHERE e.actual_cost IS NOT NULL), 0) AS invoiced_estimate, count(DISTINCT e.candidate_id)::int AS employees`;  // variance only over invoiced lines
  const by = (key: string, name: string) => db.many(`SELECT ${key} AS name, ${agg} ${BASE} WHERE ${where} GROUP BY 1 ORDER BY actual DESC NULLS LAST`, params).then((r) => r.map((x) => ({ ...x, name: name === 'category' ? label('expense_category', x.name) : x.name ?? 'Direct hire' })));
  const [totals, byProject, byAgency, byNationality, byCategory, byClient, pay] = await Promise.all([
    db.one(`SELECT ${agg}, count(*)::int AS lines, count(*) FILTER (WHERE e.verification_status = 'pending')::int AS pending_verification,
        coalesce(sum(e.actual_cost) FILTER (WHERE e.payment_status <> 'paid'), 0) AS outstanding ${BASE} WHERE ${where}`, params),
    by('p.name', 'project'), by('ra.name', 'agency'), by('c.nationality', 'nationality'), by('e.category', 'category'), by('cl.name', 'client'),
    db.many(`SELECT e.payment_status AS name, coalesce(sum(e.actual_cost), 0) AS amount, count(*)::int AS n ${BASE} WHERE ${where} GROUP BY 1`, params),
  ]);
  const t = totals!;
  res.json({
    totals: { ...t, average_per_employee: t.employees ? (Number(t.actual) / t.employees).toFixed(2) : '0.00',
      variance_pct: Number(t.invoiced_estimate) ? Math.round((Number(t.variance) / Number(t.invoiced_estimate)) * 1000) / 10 : null },
    byProject, byAgency, byNationality, byCategory, byClient, payments: pay,
  });
}));

financeRouter.post('/finance/expenses', requirePerm('finance.manage'), upload.single('file'), asyncH(async (req, res) => {
  const data = validate(SCHEMA, req.body || {});
  const cid = toId(req.body?.candidate_id);
  if (req.body?.actual_cost === undefined || req.body?.actual_cost === '') data.actual_cost = null; // not yet invoiced
  if (!data.payment_status) data.payment_status = 'unpaid';
  checkExpense(data);
  const row = await withFile(req, (f) => db.tx(async (q) => {
    const c = await one(q, 'SELECT id FROM candidates WHERE id = $1', [cid]);
    if (!c) throw badRequest('Employee not found.', { candidate_id: 'Not found.' });
    if (f) data.invoice_document_id = (await recordDocument(q, req, cid, f, { category: 'invoice', title: `Invoice ${data.invoice_no || ''} — ${label('expense_category', data.category)}`.trim(), document_number: data.invoice_no })).id;
    const cols = ['candidate_id', ...Object.keys(data), 'created_by'];
    const vals = [cid, ...Object.values(data), req.user!.id];
    const r = (await q.query(`INSERT INTO mobilisation_expenses(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals)).rows[0];
    await audit(q, req, 'create', 'mobilisation_expenses', r.id, null, r);
    return r;
  }));
  res.status(201).json(row);
}));

function checkExpense(v: Record<string, any>) {
  const errors: Record<string, string> = {};
  if (v.payment_status && v.payment_status !== 'unpaid' && !v.payment_date) errors.payment_date = 'Required once paid.';
  if (v.payment_status === 'unpaid') v.payment_date = null;
  if (v.payment_date && v.payment_date > uaeToday()) errors.payment_date = 'Cannot be in the future.';
  if (v.invoice_date && v.invoice_date > uaeToday()) errors.invoice_date = 'Cannot be in the future.';
  if (v.payment_status && v.payment_status !== 'unpaid' && (v.actual_cost === null || v.actual_cost === undefined)) errors.actual_cost = 'Enter the actual cost before recording payment.';
  if (Number(v.estimated_cost || 0) === 0 && (v.actual_cost === null || v.actual_cost === undefined || Number(v.actual_cost) === 0)) errors.estimated_cost = 'Enter an estimated or actual cost.';
  if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
}

financeRouter.put('/finance/expenses/:id', requirePerm('finance.manage'), upload.single('file'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(SCHEMA, req.body || {}, true);
  if (req.body?.actual_cost === '') data.actual_cost = null; // blank actual = not yet known
  if ('payment_status' in data && !data.payment_status) data.payment_status = 'unpaid';
  const row = await withFile(req, (f) => db.tx(async (q) => {
    const old = await one(q, 'SELECT * FROM mobilisation_expenses WHERE id = $1 FOR UPDATE', [id]);
    if (!old) throw notFound('Expense not found.');
    if (old.verification_status === 'verified') {
      const allowed = ['payment_status', 'payment_date', 'remarks'];
      if (Object.keys(data).some((k) => !allowed.includes(k) && String(data[k] ?? '') !== String(old[k] ?? ''))) throw badRequest('Verified expenses are locked; only payment details and remarks can change.');
    }
    if (old.source === 'flight_booking' && ['actual_cost', 'category'].some((k) => k in data && String(data[k] ?? '') !== String(old[k] ?? ''))) {
      throw badRequest('The flight ticket cost comes from the flight booking; change it there.');
    }
    checkExpense({ ...old, ...data });
    if (f) data.invoice_document_id = (await recordDocument(q, req, old.candidate_id, f, { category: 'invoice', title: `Invoice ${data.invoice_no || old.invoice_no || ''}`.trim(), document_number: data.invoice_no || old.invoice_no })).id;
    // Any change to a rejected line sends it back for verification
    if (old.verification_status === 'rejected') Object.assign(data, { verification_status: 'pending', verified_by: null, verified_at: null });
    data.updated_at = new Date().toISOString();
    data.updated_by = req.user!.id;
    const cols = Object.keys(data);
    const r = (await q.query(`UPDATE mobilisation_expenses SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => data[c])])).rows[0];
    const d = diff(old, r);
    await audit(q, req, 'update', 'mobilisation_expenses', id, d.old, { ...(d.new as object), candidate_id: old.candidate_id });
    return r;
  }));
  res.json(row);
}));

financeRouter.post('/finance/expenses/:id/verify', requirePerm('finance.verify'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const decision = req.body?.decision;
  const remarks = String(req.body?.remarks || '').trim().slice(0, 1000);
  if (!['verify', 'reject'].includes(decision)) throw badRequest('Decision must be verify or reject.');
  if (decision === 'reject' && !remarks) throw badRequest('Give the reason for rejecting.', { remarks: 'Required.' });
  await db.tx(async (q) => {
    const e = await one(q, 'SELECT * FROM mobilisation_expenses WHERE id = $1 FOR UPDATE', [id]);
    if (!e) throw notFound();
    if (e.verification_status !== 'pending') throw badRequest('Only pending expenses can be verified.');
    const recorder = e.updated_by || e.created_by;
    if (recorder === req.user!.id && !can(req.user, 'approvals.self')) throw forbidden('You recorded this expense, so another finance user must verify it.');
    if (decision === 'verify' && (e.actual_cost === null)) throw badRequest('Record the actual cost before verifying.');
    if (decision === 'verify' && Number(e.actual_cost) > 0 && !e.invoice_document_id && !e.invoice_no && e.source !== 'flight_booking') throw badRequest('Attach the invoice (or record its number) before verifying.');
    await q.query(`UPDATE mobilisation_expenses SET verification_status = $2, verified_by = $3, verified_at = now(), verification_remarks = $4 WHERE id = $1`,
      [id, decision === 'verify' ? 'verified' : 'rejected', req.user!.id, remarks || null]);
    await recordApproval(q, req, { type: 'expense_verification', entity: 'mobilisation_expenses', entityId: id, candidateId: e.candidate_id, requestedBy: recorder,
      decision: decision === 'verify' ? 'approved' : 'rejected', remarks });
    await audit(q, req, decision === 'verify' ? 'verify' : 'reject', 'mobilisation_expenses', id, { verification_status: e.verification_status }, { verification_status: decision === 'verify' ? 'verified' : 'rejected', candidate_id: e.candidate_id });
  });
  res.json({ ok: true });
}));

financeRouter.delete('/finance/expenses/:id', requirePerm('finance.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  await db.tx(async (q) => {
    const e = await one(q, 'SELECT * FROM mobilisation_expenses WHERE id = $1 FOR UPDATE', [id]);
    if (!e) throw notFound();
    if (e.verification_status === 'verified' || e.payment_status !== 'unpaid') throw badRequest('Verified or paid expenses cannot be deleted.');
    if (e.source) throw badRequest('Automatic lines follow their source record and cannot be deleted.');
    await q.query('DELETE FROM mobilisation_expenses WHERE id = $1', [id]);
    await audit(q, req, 'delete', 'mobilisation_expenses', id, e, null);
  });
  res.json({ ok: true });
}));
