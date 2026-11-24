// Module 10 — Final onboarding clearance, deployment approval and reporting-to-work confirmation; approvals inbox.
import express, { type Request } from 'express';
import { db, one, type Q } from '../db/index.ts';
import { asyncH, badRequest, conflict, forbidden, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { can } from '../lib/rbac.ts';
import { audit } from '../lib/audit.ts';
import { validate } from '../lib/validate.ts';
import { recordApproval } from '../lib/approvals.ts';
import { advanceCandidate } from '../lib/lifecycle.ts';
import { uaeToday } from '../lib/onboarding.ts';
import { refreshNotifications } from '../lib/notifications.ts';

export const clearanceRouter = express.Router();

export const CHECKS: [key: string, label: string, seqs: number[]][] = [
  ['employment', 'Employment documentation verified', [2, 3, 4, 5, 6, 14]],
  ['immigration', 'Required immigration formalities completed', [7, 21, 22, 23, 24]],
  ['medical', 'Required medical examinations completed', [17, 18, 19, 20]],
  ['training', 'Mandatory training completed', [25, 27, 28, 29, 30, 31, 32]],
  ['competency', 'Trade competency requirements satisfied', [26]],
  ['uniform', 'Uniform and PPE distributed', [33, 34, 35, 36, 37, 38]],
  ['induction', 'Company induction completed', [39, 40, 41, 42, 43, 44]],
  ['accommodation', 'Accommodation allocated', [10, 13]],
  ['employee_file', 'Employee file verified', [15, 16]],
  ['site_induction', 'Project / site induction completed', [45]],
];

export async function evaluateClearance(q: Q, cid: number) {
  const acts = (await q.query(`SELECT a.id, a.seq, a.name, a.status, a.is_mandatory, a.actual_completion_date, a.planned_date FROM onboarding_activities a WHERE a.candidate_id = $1 ORDER BY a.seq`, [cid])).rows;
  const checks = CHECKS.map(([key, lbl, seqs]) => {
    const rows = acts.filter((a) => seqs.includes(a.seq) && a.status !== 'not_applicable');
    const open = rows.filter((a) => a.is_mandatory && a.status !== 'completed');
    return { key, label: lbl, applicable: rows.length > 0, ok: open.length === 0,
      open: open.map((a) => ({ id: a.id, seq: a.seq, name: a.name, status: a.status })), completed: rows.filter((a) => a.status === 'completed').length, total: rows.length };
  });
  const custom = acts.filter((a) => a.seq >= 100 && a.status !== 'not_applicable');
  if (custom.length) {
    const open = custom.filter((a) => a.is_mandatory && a.status !== 'completed');
    checks.push({ key: 'other', label: 'Other mandatory company activities', applicable: true, ok: open.length === 0,
      open: open.map((a) => ({ id: a.id, seq: a.seq, name: a.name, status: a.status })), completed: custom.filter((a) => a.status === 'completed').length, total: custom.length });
  }
  return { checks, ready: acts.length > 0 && checks.every((c) => c.ok), hasChecklist: acts.length > 0 };
}

/** Completes (or resets) a clearance-workflow activity identified by its workflow key. */
async function setKeyActivity(q: Q, req: Request, cid: number, key: string, set: Record<string, unknown>, action: string) {
  const a = await one(q, 'SELECT * FROM onboarding_activities WHERE candidate_id = $1 AND workflow_key = $2 FOR UPDATE', [cid, key]);
  if (!a) return;
  set.updated_at = new Date().toISOString();
  set.updated_by = req.user!.id;
  const cols = Object.keys(set);
  await q.query(`UPDATE onboarding_activities SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [a.id, ...cols.map((c) => set[c])]);
  await audit(q, req, action, 'onboarding_activities', a.id, { status: a.status }, { status: set.status, candidate_id: cid, seq: a.seq });
}
const done = (req: Request, date: string, remarks: string | null) => ({ status: 'completed', actual_completion_date: date, completed_by: req.user!.id, verified_by: req.user!.id,
  verified_at: new Date().toISOString(), auto_completed: true, remarks, verification_remarks: null });

// ------------------------------------------------------------------ overview
clearanceRouter.get('/clearance', requirePerm('onboarding.view', 'deployment.manage', 'clearance.approve'), asyncH(async (_req, res) => {
  const rows = await db.many(`SELECT c.id, c.full_name, c.reference_no, c.status, c.position, c.photo_document_id, p.name AS project, cl.name AS client, c.work_location,
      e.employee_no, d.id AS deployment_id, d.status AS deployment_status, d.site, d.supervisor_name, d.planned_reporting_date, d.actual_reporting_date,
      ru.full_name AS requested_by_name, au.full_name AS approved_by_name,
      (SELECT a.actual_completion_date FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.workflow_key = 'clearance' AND a.status = 'completed') AS cleared_on,
      (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'completed') / nullif(count(*) FILTER (WHERE a.status <> 'not_applicable'), 0)) FROM onboarding_activities a WHERE a.candidate_id = c.id)::int AS pct
    FROM candidates c JOIN projects p ON p.id = c.project_id LEFT JOIN clients cl ON cl.id = p.client_id LEFT JOIN employees e ON e.candidate_id = c.id
    LEFT JOIN LATERAL (SELECT * FROM deployments x WHERE x.candidate_id = c.id AND x.status <> 'cancelled' ORDER BY x.id DESC LIMIT 1) d ON TRUE
    LEFT JOIN users ru ON ru.id = d.requested_by LEFT JOIN users au ON au.id = d.approved_by
    WHERE NOT c.is_archived AND c.status IN ('onboarding','awaiting_clearance','ready_for_deployment','deployed')
    ORDER BY CASE c.status WHEN 'awaiting_clearance' THEN 0 WHEN 'ready_for_deployment' THEN 1 WHEN 'onboarding' THEN 2 ELSE 3 END, c.full_name`);
  res.json(rows);
}));

clearanceRouter.get('/clearance/:id', requirePerm('onboarding.view', 'deployment.manage', 'clearance.approve'), asyncH(async (req, res) => {
  const cid = toId(req.params.id);
  const c = await db.one('SELECT id, full_name, status FROM candidates WHERE id = $1', [cid]);
  if (!c) throw notFound();
  const ev = await db.tx((q) => evaluateClearance(q, cid));
  const history = await db.many(`SELECT r.*, du.full_name AS decided_by_name, qu.full_name AS requested_by_name FROM approval_records r
    LEFT JOIN users du ON du.id = r.decided_by LEFT JOIN users qu ON qu.id = r.requested_by
    WHERE r.candidate_id = $1 AND r.approval_type IN ('final_clearance','deployment') ORDER BY r.decided_at DESC`, [cid]);
  const deployments = await db.many(`SELECT d.*, ru.full_name AS requested_by_name, au.full_name AS approved_by_name, cu.full_name AS confirmed_by_name FROM deployments d
    LEFT JOIN users ru ON ru.id = d.requested_by LEFT JOIN users au ON au.id = d.approved_by LEFT JOIN users cu ON cu.id = d.confirmed_by WHERE d.candidate_id = $1 ORDER BY d.id DESC`, [cid]);
  res.json({ candidate: c, ...ev, history, deployments });
}));

clearanceRouter.post('/clearance/:id/decide', requirePerm('clearance.approve'), asyncH(async (req, res) => {
  const cid = toId(req.params.id);
  const decision = req.body?.decision;
  const remarks = String(req.body?.remarks || '').trim().slice(0, 1000);
  if (!['approve', 'reject'].includes(decision)) throw badRequest('Decision must be approve or reject.');
  if (decision === 'reject' && !remarks) throw badRequest('Give the reason clearance is refused.', { remarks: 'Required.' });
  await db.tx(async (q) => {
    const c = await one(q, 'SELECT id, status FROM candidates WHERE id = $1 FOR UPDATE', [cid]);
    if (!c) throw notFound();
    if (c.status !== 'awaiting_clearance') throw badRequest('Final clearance is given to employees who are Awaiting Final Clearance.');
    if (decision === 'approve') {
      const ev = await evaluateClearance(q, cid);
      if (!ev.ready) throw badRequest(`Clearance cannot be approved: ${ev.checks.filter((x) => !x.ok).map((x) => x.label).join('; ')}.`);
      await setKeyActivity(q, req, cid, 'clearance', done(req, uaeToday(), remarks || 'Final clearance approved'), 'clearance_approve');
      await advanceCandidate(q, req, cid, 'ready_for_deployment', ['awaiting_clearance'], `Final clearance approved${remarks ? `: ${remarks}` : ''}`);
    } else {
      await setKeyActivity(q, req, cid, 'clearance', { status: 'rejected', verification_remarks: remarks, verified_by: req.user!.id, verified_at: new Date().toISOString() }, 'clearance_reject');
    }
    await recordApproval(q, req, { type: 'final_clearance', entity: 'candidates', entityId: cid, candidateId: cid, decision: decision === 'approve' ? 'approved' : 'rejected', remarks });
  });
  refreshNotifications().catch(() => {}); // Operations are told immediately
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ deployment
clearanceRouter.post('/deployments', requirePerm('deployment.manage'), asyncH(async (req, res) => {
  const data = validate({
    candidate_id: { type: 'ref', label: 'Employee', required: true },
    site: { type: 'text', label: 'Site / work location', required: true, max: 150 },
    supervisor_name: { type: 'text', label: 'Site supervisor', required: true },
    supervisor_phone: { type: 'phone', label: 'Supervisor contact' },
    planned_reporting_date: { type: 'date', label: 'Planned reporting date', required: true },
    remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
  }, req.body || {});
  try {
    const row = await db.tx(async (q) => {
      const c = await one(q, 'SELECT id, status FROM candidates WHERE id = $1 FOR UPDATE', [data.candidate_id]);
      if (!c || c.status !== 'ready_for_deployment') throw badRequest('Deployment can be requested only for employees who are Ready for Deployment (final clearance approved).');
      const r = (await q.query(`INSERT INTO deployments(candidate_id, site, supervisor_name, supervisor_phone, planned_reporting_date, remarks, requested_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [data.candidate_id, data.site, data.supervisor_name, data.supervisor_phone, data.planned_reporting_date, data.remarks, req.user!.id])).rows[0];
      await audit(q, req, 'create', 'deployments', r.id, null, r);
      return r;
    });
    refreshNotifications().catch(() => {});
    res.status(201).json(row);
  } catch (e: any) {
    if (e?.code === '23505') throw conflict('This employee already has an open deployment request.');
    throw e;
  }
}));

async function lockDeployment(q: Q, id: number) {
  const d = await one(q, 'SELECT * FROM deployments WHERE id = $1 FOR UPDATE', [id]);
  if (!d) throw notFound('Deployment not found.');
  return d;
}

clearanceRouter.post('/deployments/:id/decide', requirePerm('clearance.approve'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const decision = req.body?.decision;
  const remarks = String(req.body?.remarks || '').trim().slice(0, 1000);
  if (!['approve', 'reject'].includes(decision)) throw badRequest('Decision must be approve or reject.');
  if (decision === 'reject' && !remarks) throw badRequest('Give the reason.', { remarks: 'Required.' });
  await db.tx(async (q) => {
    const d = await lockDeployment(q, id);
    if (d.status !== 'requested') throw badRequest('This deployment request is not awaiting approval.');
    if (d.requested_by === req.user!.id && !can(req.user, 'approvals.self')) throw forbidden('You requested this deployment, so another approver must decide it.');
    const now = new Date().toISOString();
    await q.query('UPDATE deployments SET status = $2, approved_by = $3, approved_at = $4, decision_remarks = $5 WHERE id = $1', [id, decision === 'approve' ? 'approved' : 'rejected', req.user!.id, now, remarks || null]);
    if (decision === 'approve') await setKeyActivity(q, req, d.candidate_id, 'deployment_approval', done(req, uaeToday(), `Approved for ${d.site}`), 'deployment_approve');
    await recordApproval(q, req, { type: 'deployment', entity: 'deployments', entityId: id, candidateId: d.candidate_id, requestedBy: d.requested_by, requestedAt: d.requested_at,
      decision: decision === 'approve' ? 'approved' : 'rejected', remarks });
    await audit(q, req, decision === 'approve' ? 'approve' : 'reject', 'deployments', id, { status: d.status }, { status: decision === 'approve' ? 'approved' : 'rejected', candidate_id: d.candidate_id });
  });
  res.json({ ok: true });
}));

clearanceRouter.post('/deployments/:id/confirm', requirePerm('deployment.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({ actual_reporting_date: { type: 'date', label: 'Actual reporting date', required: true }, remarks: { type: 'longtext', label: 'Remarks', max: 1000 } }, req.body || {});
  if (String(data.actual_reporting_date) > uaeToday()) throw badRequest('Reporting date cannot be in the future.', { actual_reporting_date: 'Future date.' });
  await db.tx(async (q) => {
    const d = await lockDeployment(q, id);
    if (d.status !== 'approved') throw badRequest(d.status === 'requested' ? 'The deployment must be approved first.' : 'This deployment is closed.');
    const approvedOn = new Date(new Date(d.approved_at).getTime() + 4 * 3600_000).toISOString().slice(0, 10);
    if (String(data.actual_reporting_date) < approvedOn) throw badRequest('Reporting date cannot be before the deployment approval.', { actual_reporting_date: 'Before approval.' });
    await q.query(`UPDATE deployments SET status = 'reported', actual_reporting_date = $2, confirmed_by = $3, confirmed_at = now(), remarks = coalesce($4, remarks) WHERE id = $1`,
      [id, data.actual_reporting_date, req.user!.id, data.remarks]);
    await q.query(`UPDATE candidates SET work_location = $2 WHERE id = $1`, [d.candidate_id, d.site]);
    await setKeyActivity(q, req, d.candidate_id, 'deployed', done(req, String(data.actual_reporting_date), `Reported to ${d.site} (supervisor ${d.supervisor_name})`), 'deployment_confirm');
    await advanceCandidate(q, req, d.candidate_id, 'deployed', ['ready_for_deployment'], `Reported to work at ${d.site} on ${data.actual_reporting_date}`);
    await audit(q, req, 'confirm', 'deployments', id, { status: d.status }, { status: 'reported', actual_reporting_date: data.actual_reporting_date, candidate_id: d.candidate_id });
  });
  res.json({ ok: true });
}));

clearanceRouter.post('/deployments/:id/cancel', requirePerm('deployment.manage', 'clearance.approve'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!reason) throw badRequest('Give a reason.', { reason: 'Required.' });
  await db.tx(async (q) => {
    const d = await lockDeployment(q, id);
    if (!['requested', 'approved'].includes(d.status)) throw badRequest('Only open deployment requests can be cancelled.');
    await q.query(`UPDATE deployments SET status = 'cancelled', decision_remarks = $2 WHERE id = $1`, [id, reason]);
    if (d.status === 'approved') await setKeyActivity(q, req, d.candidate_id, 'deployment_approval', { status: 'not_started', actual_completion_date: null, auto_completed: false, remarks: `Deployment cancelled: ${reason}` }, 'deployment_cancel');
    await audit(q, req, 'cancel', 'deployments', id, { status: d.status }, { status: 'cancelled', reason, candidate_id: d.candidate_id });
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ approvals inbox
clearanceRouter.get('/approvals/inbox', asyncH(async (req, res) => {
  const u = req.user!;
  const self = can(u, 'approvals.self');
  const notMine = (col: string) => (self ? 'TRUE' : `${col} IS DISTINCT FROM ${u.id}`);
  const live = `NOT c.is_archived AND c.status <> 'cancelled'`;
  const [flights, activities, expenses, clearances, deployments] = await Promise.all([
    can(u, 'mobility.approve') ? db.many(`SELECT b.id, b.booking_no, b.ticket_cost, c.id AS candidate_id, c.full_name, c.reference_no, su.full_name AS requested_by_name, b.updated_at AS requested_at,
        (SELECT q.fare FROM flight_quotations q WHERE q.id = b.selected_quotation_id) AS fare, (SELECT ta.name FROM flight_quotations q JOIN travel_agencies ta ON ta.id = q.travel_agency_id WHERE q.id = b.selected_quotation_id) AS agency
      FROM flight_bookings b JOIN candidates c ON c.id = b.candidate_id LEFT JOIN users su ON su.id = b.submitted_by
      WHERE b.status = 'approval_pending' AND ${notMine('b.submitted_by')} AND ${live} ORDER BY b.updated_at`) : [],
    can(u, 'onboarding.verify') ? db.many(`SELECT a.id, a.seq, a.name, a.submitted_at AS requested_at, a.actual_completion_date, c.id AS candidate_id, c.full_name, c.reference_no,
        su.full_name AS requested_by_name, d.name AS department FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id JOIN departments d ON d.id = a.department_id
        LEFT JOIN users su ON su.id = a.submitted_by WHERE a.status = 'awaiting_approval' AND ${notMine('a.submitted_by')} AND ${live} ORDER BY a.submitted_at`) : [],
    can(u, 'finance.verify') ? db.many(`SELECT e.id, e.category, e.actual_cost, e.supplier, e.invoice_no, coalesce(e.updated_at, e.created_at) AS requested_at, c.id AS candidate_id, c.full_name, c.reference_no,
        ru.full_name AS requested_by_name FROM mobilisation_expenses e JOIN candidates c ON c.id = e.candidate_id LEFT JOIN users ru ON ru.id = coalesce(e.updated_by, e.created_by)
        WHERE e.verification_status = 'pending' AND e.actual_cost IS NOT NULL AND ${notMine('coalesce(e.updated_by, e.created_by)')} ORDER BY requested_at`) : [],
    can(u, 'clearance.approve') ? db.many(`SELECT c.id AS candidate_id, c.full_name, c.reference_no, c.status_changed_at AS requested_at, p.name AS project FROM candidates c JOIN projects p ON p.id = c.project_id
        WHERE c.status = 'awaiting_clearance' AND ${live} ORDER BY c.status_changed_at`) : [],
    can(u, 'clearance.approve') ? db.many(`SELECT d.*, d.requested_at, c.full_name, c.reference_no, ru.full_name AS requested_by_name FROM deployments d JOIN candidates c ON c.id = d.candidate_id
        LEFT JOIN users ru ON ru.id = d.requested_by WHERE d.status = 'requested' AND ${notMine('d.requested_by')} ORDER BY d.requested_at`) : [],
  ]);
  res.json({ flights, activities, expenses, clearances, deployments, total: flights.length + activities.length + expenses.length + clearances.length + deployments.length });
}));

clearanceRouter.get('/approvals/history', requirePerm('onboarding.view', 'finance.view', 'mobility.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  let w = 'TRUE';
  if (req.query.candidate_id) { params.push(Number(req.query.candidate_id)); w += ` AND r.candidate_id = $${params.length}`; }
  if (req.query.type) { params.push(String(req.query.type)); w += ` AND r.approval_type = $${params.length}`; }
  res.json(await db.many(`SELECT r.*, du.full_name AS decided_by_name, qu.full_name AS requested_by_name, c.full_name, c.reference_no FROM approval_records r
    LEFT JOIN users du ON du.id = r.decided_by LEFT JOIN users qu ON qu.id = r.requested_by LEFT JOIN candidates c ON c.id = r.candidate_id
    WHERE ${w} ORDER BY r.decided_at DESC LIMIT 300`, params));
}));
