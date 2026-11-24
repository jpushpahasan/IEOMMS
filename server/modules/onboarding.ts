// Module 4 & 5 — Onboarding checklist, departmental tasks, verification, performance, templates.
import express, { type Request } from 'express';
import { db, one, type Q, type Row } from '../db/index.ts';
import { asyncH, badRequest, conflict, forbidden, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { can } from '../lib/rbac.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate } from '../lib/validate.ts';
import { label } from '../lib/enums.ts';
import { CLEARANCE_KEYS, MANUAL_WORKFLOW_KEYS, SECTIONS } from '../lib/catalogue.ts';
import { generateChecklist, resync, uaeToday } from '../lib/onboarding.ts';
import { recordDocument, removeStored, storeUpload, upload } from './documents.ts';
import { recordApproval } from '../lib/approvals.ts';

export const onboardingRouter = express.Router();

const MANUAL_STATUSES = ['not_started', 'pending', 'in_progress', 'awaiting_documents', 'on_hold'];
const ACTIVE_CANDIDATE = `c.status NOT IN ('cancelled') AND NOT c.is_archived`;

const ACT_SELECT = `SELECT a.*, d.name AS department, d.code AS department_code, u.full_name AS responsible_name,
    su.full_name AS submitted_by_name, vu.full_name AS verified_by_name, cu.full_name AS completed_by_name,
    ed.original_name AS document_name, ed.version AS document_version,
    (a.planned_date < (now() AT TIME ZONE 'Asia/Dubai')::date AND a.status NOT IN ('completed','not_applicable')) AS overdue
  FROM onboarding_activities a JOIN departments d ON d.id = a.department_id JOIN users u ON u.id = a.responsible_user_id
  LEFT JOIN users su ON su.id = a.submitted_by LEFT JOIN users vu ON vu.id = a.verified_by LEFT JOIN users cu ON cu.id = a.completed_by
  LEFT JOIN employee_documents ed ON ed.id = a.document_id`;

/** Locked = completed by a module workflow (or by the Phase 4 clearance), not through the generic activity form. */
const isLocked = (a: Row) => !!a.workflow_key && !MANUAL_WORKFLOW_KEYS.includes(a.workflow_key);
const lockReason = (a: Row) => (CLEARANCE_KEYS.includes(a.workflow_key) ? 'Completed through the final clearance & deployment workflow.' : 'Completed automatically from its module record.');
const decorate = (a: Row) => ({ ...a, locked: isLocked(a), lock_reason: isLocked(a) ? lockReason(a) : null });

/** Department staff, the responsible person and verifiers may work on an activity. */
function canWork(req: Request, a: Row) {
  const u = req.user!;
  return can(u, 'onboarding.verify') || a.responsible_user_id === u.id || (u.department_id !== null && a.department_id === u.department_id);
}
async function lockActivity(q: Q, id: number) {
  const a = await one(q, 'SELECT * FROM onboarding_activities WHERE id = $1 FOR UPDATE', [id]);
  if (!a) throw notFound('Activity not found.');
  return a;
}
async function setActivity(q: Q, req: Request, a: Row, set: Record<string, unknown>, action: string) {
  set.updated_at = new Date().toISOString();
  set.updated_by = req.user!.id;
  const cols = Object.keys(set);
  const row = (await q.query(`UPDATE onboarding_activities SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [a.id, ...cols.map((c) => set[c])])).rows[0];
  const d = diff(a, row);
  await audit(q, req, action, 'onboarding_activities', a.id, d.old, { ...(d.new as object), candidate_id: a.candidate_id, seq: a.seq });
  await resync(q, req, a.candidate_id);
  return row;
}

// ------------------------------------------------------------------ checklist per candidate
onboardingRouter.get('/onboarding/candidates/:id', requirePerm('onboarding.view', 'candidates.view'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const header = await db.one(`SELECT eo.*, t.name AS template_name, u.full_name AS generated_by_name FROM employee_onboarding eo
    LEFT JOIN onboarding_templates t ON t.id = eo.template_id LEFT JOIN users u ON u.id = eo.generated_by WHERE eo.candidate_id = $1`, [id]);
  const rows = await db.many(`${ACT_SELECT} WHERE a.candidate_id = $1 ORDER BY a.seq`, [id]);
  const employee = await db.one('SELECT * FROM employees WHERE candidate_id = $1', [id]);
  res.json({ header, sections: SECTIONS, employee, activities: rows.map((a) => ({ ...decorate(a), can_work: canWork(req, a) })) });
}));

onboardingRouter.post('/onboarding/candidates/:id/generate', requirePerm('onboarding.verify'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const made = await db.tx((q) => generateChecklist(q, req, id));
  if (!made) throw conflict('A checklist already exists for this candidate, or the candidate is cancelled.');
  res.status(201).json({ ok: true });
}));

onboardingRouter.post('/onboarding/generate-missing', requirePerm('onboarding.verify'), asyncH(async (req, res) => {
  const ids = (await db.many(`SELECT c.id FROM candidates c WHERE ${ACTIVE_CANDIDATE} AND NOT EXISTS (SELECT 1 FROM employee_onboarding e WHERE e.candidate_id = c.id) ORDER BY c.id`)).map((r) => r.id);
  for (const id of ids) await db.tx((q) => generateChecklist(q, req, id));
  res.json({ generated: ids.length });
}));

// ------------------------------------------------------------------ activity actions
onboardingRouter.put('/onboarding/activities/:id', requirePerm('onboarding.update'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({
    status: { type: 'enum', label: 'Status', options: 'activity_status' },
    remarks: { type: 'longtext', label: 'Remarks', max: 2000 },
    planned_date: { type: 'date', label: 'Planned completion date' },
    responsible_user_id: { type: 'ref', label: 'Responsible employee' },
  }, req.body || {}, true);
  await db.tx(async (q) => {
    const a = await lockActivity(q, id);
    if (!canWork(req, a)) throw forbidden('This activity belongs to another department.');
    if ((data.planned_date !== undefined || data.responsible_user_id !== undefined) && !can(req.user, 'onboarding.verify') && !(await isDeptManager(q, req, a.department_id))) {
      throw forbidden('Only HR or the department manager can re-plan or reassign activities.');
    }
    if (data.status !== undefined) {
      if (!MANUAL_STATUSES.includes(String(data.status))) throw badRequest('Use Complete / Submit, Verify or Not Applicable for that status.');
      if (isLocked(a)) throw badRequest(lockReason(a));
      if (['completed', 'not_applicable', 'awaiting_approval'].includes(a.status)) throw badRequest(`The activity is "${label('activity_status', a.status)}". Reopen it first.`);
    }
    if (data.responsible_user_id) {
      const u = await one(q, 'SELECT is_active FROM users WHERE id = $1', [data.responsible_user_id]);
      if (!u?.is_active) throw badRequest('Select an active user.', { responsible_user_id: 'Inactive user.' });
    }
    if (data.planned_date === null) throw badRequest('Planned date cannot be removed.', { planned_date: 'Required.' });
    if (Object.keys(data).length) await setActivity(q, req, a, data, 'update');
  });
  res.json({ ok: true });
}));

async function isDeptManager(q: Q, req: Request, deptId: number) {
  return !!(await one(q, 'SELECT 1 FROM departments WHERE id = $1 AND manager_user_id = $2', [deptId, req.user!.id]));
}

onboardingRouter.post('/onboarding/activities/:id/document', requirePerm('onboarding.update'), upload.single('file'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const f = storeUpload(req.file);
  try {
    await db.tx(async (q) => {
      const a = await lockActivity(q, id);
      if (!canWork(req, a)) throw forbidden('This activity belongs to another department.');
      if (['completed', 'not_applicable'].includes(a.status) && !a.auto_completed) throw badRequest('The activity is closed. Reopen it to change its document.');
      const doc = await recordDocument(q, req, a.candidate_id, f, { category: a.document_category || 'other', title: a.name, remarks: `Activity ${a.seq}: ${a.name}` });
      await setActivity(q, req, a, { document_id: doc.id, ...(a.status === 'awaiting_documents' && !a.auto_completed ? { status: 'in_progress' } : {}) }, 'document');
    });
  } catch (e) { removeStored(f); throw e; }
  res.status(201).json({ ok: true });
}));

/** Complete (or submit for verification when the activity requires it). */
onboardingRouter.post('/onboarding/activities/:id/complete', requirePerm('onboarding.update'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate({
    actual_completion_date: { type: 'date', label: 'Actual completion date', required: true },
    remarks: { type: 'longtext', label: 'Remarks', max: 2000 },
  }, req.body || {});
  if (String(data.actual_completion_date) > uaeToday()) throw badRequest('Completion date cannot be in the future.', { actual_completion_date: 'Future date.' });
  const out = await db.tx(async (q) => {
    const a = await lockActivity(q, id);
    if (!canWork(req, a)) throw forbidden('This activity belongs to another department.');
    if (isLocked(a)) throw badRequest(lockReason(a));
    if (!MANUAL_STATUSES.includes(a.status) && a.status !== 'rejected') throw badRequest(`The activity is "${label('activity_status', a.status)}".`);
    if (a.requires_document && !a.document_id) throw badRequest(`Upload the supporting document (${label('document_category', a.document_category || 'other')}) first.`, { document: 'Required for this activity.' });
    const base = { actual_completion_date: data.actual_completion_date, remarks: data.remarks ?? a.remarks, verification_remarks: null };
    if (a.requires_verification) {
      await setActivity(q, req, a, { ...base, status: 'awaiting_approval', submitted_by: req.user!.id, submitted_at: new Date().toISOString() }, 'submit');
      return 'awaiting_approval';
    }
    await setActivity(q, req, a, { ...base, status: 'completed', completed_by: req.user!.id, auto_completed: false }, 'complete');
    return 'completed';
  });
  res.json({ ok: true, status: out });
}));

onboardingRouter.post('/onboarding/activities/:id/verify', requirePerm('onboarding.verify'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const decision = req.body?.decision;
  const remarks = String(req.body?.remarks || '').trim().slice(0, 2000);
  if (!['approve', 'reject'].includes(decision)) throw badRequest('Decision must be approve or reject.');
  if (decision === 'reject' && !remarks) throw badRequest('Give a reason for rejecting.', { remarks: 'Required when rejecting.' });
  await db.tx(async (q) => {
    const a = await lockActivity(q, id);
    if (a.status !== 'awaiting_approval') throw badRequest('This activity is not awaiting approval.');
    if (a.submitted_by === req.user!.id && !can(req.user, 'approvals.self')) throw forbidden('You submitted this activity, so another verifier must approve it.');
    await recordApproval(q, req, { type: 'activity_verification', entity: 'onboarding_activities', entityId: a.id, candidateId: a.candidate_id,
      requestedBy: a.submitted_by, requestedAt: a.submitted_at, decision: decision === 'approve' ? 'approved' : 'rejected', remarks });
    const now = new Date().toISOString();
    if (decision === 'approve') await setActivity(q, req, a, { status: 'completed', verified_by: req.user!.id, verified_at: now, verification_remarks: remarks || null, completed_by: a.submitted_by, auto_completed: false }, 'verify');
    else await setActivity(q, req, a, { status: 'rejected', verified_by: req.user!.id, verified_at: now, verification_remarks: remarks, actual_completion_date: null }, 'reject');
  });
  res.json({ ok: true });
}));

onboardingRouter.post('/onboarding/activities/:id/not-applicable', requirePerm('onboarding.verify'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!reason) throw badRequest('Give the reason the activity does not apply.', { reason: 'Required.' });
  await db.tx(async (q) => {
    const a = await lockActivity(q, id);
    if (a.status === 'completed') throw badRequest('Completed activities cannot be marked Not Applicable.');
    if (a.workflow_key && CLEARANCE_KEYS.includes(a.workflow_key)) throw badRequest('Clearance and deployment always apply.');
    await setActivity(q, req, a, { status: 'not_applicable', na_reason: reason, auto_completed: false, actual_completion_date: null }, 'not_applicable');
  });
  res.json({ ok: true });
}));

onboardingRouter.post('/onboarding/activities/:id/reopen', requirePerm('onboarding.verify'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const reason = String(req.body?.reason || '').trim().slice(0, 1000);
  if (!reason) throw badRequest('Give a reason for reopening.', { reason: 'Required.' });
  await db.tx(async (q) => {
    const a = await lockActivity(q, id);
    if (!['completed', 'not_applicable', 'awaiting_approval'].includes(a.status)) throw badRequest('Only closed activities can be reopened.');
    if (isLocked(a) && a.status === 'completed') throw badRequest(`${lockReason(a)} Change the source record instead.`);
    await setActivity(q, req, a, { status: 'in_progress', actual_completion_date: null, na_reason: null, auto_completed: false, remarks: `Reopened: ${reason}` }, 'reopen');
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ task lists (Module 5)
function taskFilter(req: Request, params: unknown[]) {
  const w: string[] = [ACTIVE_CANDIDATE];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  const scope = String(req.query.scope || 'mine');
  const u = req.user!;
  if (scope === 'mine') add('a.responsible_user_id = ?', u.id);
  else if (scope === 'department') {
    if (req.query.department_id && (can(u, 'onboarding.verify') || can(u, 'dashboard.view'))) add('a.department_id = ?', Number(req.query.department_id));
    else add('a.department_id = ?', u.department_id ?? 0);
  } else if (scope === 'verification') w.push(`a.status = 'awaiting_approval'`);
  else if (scope === 'all') { if (!can(u, 'onboarding.verify') && !can(u, 'reports.view')) add('a.department_id = ?', u.department_id ?? 0); }
  const st = String(req.query.status || 'open');
  if (st === 'open') w.push(`a.status NOT IN ('completed','not_applicable')`);
  else if (st === 'overdue') w.push(`a.status NOT IN ('completed','not_applicable') AND a.planned_date < (now() AT TIME ZONE 'Asia/Dubai')::date`);
  else if (st === 'due_week') w.push(`a.status NOT IN ('completed','not_applicable') AND a.planned_date <= (now() AT TIME ZONE 'Asia/Dubai')::date + 7`);
  else if (st !== 'all') add('a.status = ?', st);
  if (req.query.section) add('a.section = ?', String(req.query.section));
  if (req.query.project_id) add('c.project_id = ?', Number(req.query.project_id));
  if (req.query.q) add('(c.full_name ILIKE ? OR c.reference_no ILIKE ? OR a.name ILIKE ?)', `%${req.query.q}%`);
  if (req.query.manual === '1') w.push(`(a.workflow_key IS NULL OR a.workflow_key = 'hr_registration')`);
  return `WHERE ${w.join(' AND ')}`;
}

onboardingRouter.get('/onboarding/tasks', requirePerm('onboarding.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const where = taskFilter(req, params);
  const rows = await db.many(`SELECT x.*, c.full_name, c.reference_no, c.status AS candidate_status, c.photo_document_id, p.name AS project
    FROM (${ACT_SELECT}) x JOIN candidates c ON c.id = x.candidate_id JOIN projects p ON p.id = c.project_id
    ${where.replaceAll('a.', 'x.')} ORDER BY x.overdue DESC, x.planned_date NULLS LAST, x.seq LIMIT 500`, params);
  res.json(rows.map((a) => ({ ...decorate(a), can_work: canWork(req, a), can_verify: can(req.user, 'onboarding.verify') && (a.submitted_by !== req.user!.id || can(req.user, 'approvals.self')) })));
}));

onboardingRouter.get('/onboarding/performance', requirePerm('onboarding.view'), asyncH(async (req, res) => {
  const today = `(now() AT TIME ZONE 'Asia/Dubai')::date`;
  const dept = await db.many(`SELECT d.id, d.name, d.code, mu.full_name AS manager,
      count(a.id) FILTER (WHERE a.status <> 'not_applicable')::int AS total,
      count(a.id) FILTER (WHERE a.status = 'completed')::int AS completed,
      count(a.id) FILTER (WHERE a.status NOT IN ('completed','not_applicable'))::int AS open,
      count(a.id) FILTER (WHERE a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${today})::int AS overdue,
      count(a.id) FILTER (WHERE a.status = 'awaiting_approval')::int AS awaiting_approval,
      count(a.id) FILTER (WHERE a.status = 'completed' AND a.actual_completion_date <= a.planned_date)::int AS on_time,
      round(avg(greatest(a.actual_completion_date - a.planned_date, 0)) FILTER (WHERE a.status = 'completed'), 1) AS avg_days_late
    FROM departments d LEFT JOIN onboarding_activities a ON a.department_id = d.id
      AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = a.candidate_id AND ${ACTIVE_CANDIDATE})
    LEFT JOIN users mu ON mu.id = d.manager_user_id
    GROUP BY d.id, mu.full_name ORDER BY d.name`);
  const people = await db.many(`SELECT u.id, u.full_name, d.name AS department,
      count(*) FILTER (WHERE a.status NOT IN ('completed','not_applicable'))::int AS open,
      count(*) FILTER (WHERE a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${today})::int AS overdue,
      count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
      count(*) FILTER (WHERE a.status = 'completed' AND a.actual_completion_date <= a.planned_date)::int AS on_time
    FROM onboarding_activities a JOIN users u ON u.id = a.responsible_user_id JOIN departments d ON d.id = a.department_id
    WHERE a.status <> 'not_applicable' AND EXISTS (SELECT 1 FROM candidates c WHERE c.id = a.candidate_id AND ${ACTIVE_CANDIDATE})
    GROUP BY u.id, d.name ORDER BY overdue DESC, open DESC`);
  const managed = can(req.user, 'onboarding.verify') || can(req.user, 'reports.view') ? null : req.user!.department_id;
  res.json({ departments: managed ? dept.filter((d) => d.id === managed) : dept, people: managed ? people.filter((p) => dept.find((d) => d.id === managed)?.name === p.department) : people });
}));

/** Every active candidate × section progress (onboarding overview). */
onboardingRouter.get('/onboarding/overview', requirePerm('onboarding.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = [ACTIVE_CANDIDATE];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.query.status) add('c.status = ANY(?::text[])', String(req.query.status).split(','));
  else w.push(`c.status IN ('selected','pre_arrival','travel_confirmed','arrived','onboarding','awaiting_clearance','ready_for_deployment','on_hold')`);
  if (req.query.project_id) add('c.project_id = ?', Number(req.query.project_id));
  if (req.query.trade_id) add('c.trade_id = ?', Number(req.query.trade_id));
  if (req.query.q) add('(c.full_name ILIKE ? OR c.reference_no ILIKE ?)', `%${req.query.q}%`);
  const rows = await db.many(`SELECT c.id, c.full_name, c.reference_no, c.status, c.photo_document_id, c.nationality, p.name AS project, t.name AS trade,
      json_object_agg(s.section, json_build_object('total', s.total, 'done', s.done, 'overdue', s.overdue)) FILTER (WHERE s.section IS NOT NULL) AS sections,
      coalesce(sum(s.total), 0)::int AS total, coalesce(sum(s.done), 0)::int AS done, coalesce(sum(s.overdue), 0)::int AS overdue,
      (SELECT a.seq || '. ' || a.name FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.status NOT IN ('completed','not_applicable') ORDER BY a.planned_date NULLS LAST, a.seq LIMIT 1) AS next_activity
    FROM candidates c JOIN projects p ON p.id = c.project_id JOIN trades t ON t.id = c.trade_id
    LEFT JOIN (SELECT candidate_id, section, count(*) FILTER (WHERE status <> 'not_applicable')::int AS total,
        count(*) FILTER (WHERE status = 'completed')::int AS done,
        count(*) FILTER (WHERE status NOT IN ('completed','not_applicable') AND planned_date < (now() AT TIME ZONE 'Asia/Dubai')::date)::int AS overdue
      FROM onboarding_activities GROUP BY 1, 2) s ON s.candidate_id = c.id
    WHERE ${w.join(' AND ')} GROUP BY c.id, p.name, t.name ORDER BY overdue DESC, c.full_name LIMIT 500`, params);
  const missing = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM candidates c WHERE ${ACTIVE_CANDIDATE} AND NOT EXISTS (SELECT 1 FROM employee_onboarding e WHERE e.candidate_id = c.id)`))!.n;
  res.json({ rows, missing });
}));

// ------------------------------------------------------------------ catalogue & templates
onboardingRouter.get('/onboarding/definitions', requirePerm('onboarding.view'), asyncH(async (_req, res) => {
  res.json(await db.many(`SELECT d.*, dp.name AS department FROM onboarding_activity_definitions d JOIN departments dp ON dp.id = d.department_id ORDER BY d.seq`));
}));

const DEF_SCHEMA = {
  name: { type: 'text' as const, label: 'Activity name', required: true, max: 150 },
  section: { type: 'enum' as const, label: 'Section', required: true, options: 'section' },
  department_id: { type: 'ref' as const, label: 'Department', required: true },
  is_mandatory: { type: 'bool' as const, label: 'Mandatory' },
  requires_document: { type: 'bool' as const, label: 'Requires document' },
  document_category: { type: 'enum' as const, label: 'Document category', options: 'document_category' },
  requires_verification: { type: 'bool' as const, label: 'Requires verification' },
  anchor: { type: 'text' as const, label: 'Anchor', pattern: [/^(selection|arrival)$/, 'Selection or arrival.'] as [RegExp, string] },
  offset_days: { type: 'text' as const, label: 'Offset (days)', pattern: [/^-?\d{1,3}$/, 'Whole number of days (may be negative).'] as [RegExp, string] },
  description: { type: 'longtext' as const, label: 'Description', max: 1000 },
  is_active: { type: 'bool' as const, label: 'Active' },
};

onboardingRouter.put('/onboarding/definitions/:id', requirePerm('onboarding.templates'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(DEF_SCHEMA, req.body || {}, true);
  if (data.offset_days !== undefined) data.offset_days = Number(data.offset_days);
  await db.tx(async (q) => {
    const old = await one(q, 'SELECT * FROM onboarding_activity_definitions WHERE id = $1 FOR UPDATE', [id]);
    if (!old) throw notFound();
    if (old.is_system && (data.section !== undefined && data.section !== old.section)) throw badRequest('Core activities keep their section.');
    if (old.is_system && data.is_active === false) throw badRequest('Core activities cannot be deactivated; mark them Not Applicable in a template instead.');
    if ((data.requires_document ?? old.requires_document) && !(data.document_category ?? old.document_category)) throw badRequest('Choose the document category.', { document_category: 'Required when a document is needed.' });
    const cols = Object.keys(data);
    const row = (await q.query(`UPDATE onboarding_activity_definitions SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => data[c])])).rows[0];
    const d = diff(old, row);
    await audit(q, req, 'update', 'onboarding_activity_definitions', id, d.old, d.new);
  });
  res.json({ ok: true, note: 'Changes apply to checklists generated from now on.' });
}));

onboardingRouter.post('/onboarding/definitions', requirePerm('onboarding.templates'), asyncH(async (req, res) => {
  const data = validate(DEF_SCHEMA, { is_active: true, anchor: 'arrival', offset_days: '5', ...(req.body || {}) });
  data.offset_days = Number(data.offset_days);
  if (data.requires_document && !data.document_category) throw badRequest('Choose the document category.', { document_category: 'Required.' });
  const row = await db.tx(async (q) => {
    data.seq = (await one(q, 'SELECT greatest(100, coalesce(max(seq), 0) + 1) AS n FROM onboarding_activity_definitions'))!.n;
    const cols = Object.keys(data);
    const r = (await q.query(`INSERT INTO onboarding_activity_definitions(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, cols.map((c) => data[c]))).rows[0];
    await audit(q, req, 'create', 'onboarding_activity_definitions', r.id, null, r);
    return r;
  });
  res.status(201).json(row);
}));

onboardingRouter.get('/onboarding/templates', requirePerm('onboarding.view'), asyncH(async (_req, res) => {
  const tpls = await db.many(`SELECT t.*, tr.name AS trade, p.name AS project,
      (SELECT count(*)::int FROM employee_onboarding e WHERE e.template_id = t.id) AS used_by
    FROM onboarding_templates t LEFT JOIN trades tr ON tr.id = t.trade_id LEFT JOIN projects p ON p.id = t.project_id ORDER BY t.trade_id NULLS FIRST, t.project_id NULLS FIRST, t.name`);
  const items = await db.many('SELECT * FROM onboarding_template_items');
  res.json(tpls.map((t) => ({ ...t, items: items.filter((i) => i.template_id === t.id) })));
}));

onboardingRouter.post('/onboarding/templates', requirePerm('onboarding.templates'), asyncH(async (req, res) => {
  const data = validate({ name: { type: 'text', label: 'Template name', required: true, max: 120 }, trade_id: { type: 'ref', label: 'Trade' },
    project_id: { type: 'ref', label: 'Project' }, description: { type: 'longtext', label: 'Description', max: 1000 } }, req.body || {});
  try {
    const row = await db.tx(async (q) => {
      const r = (await q.query('INSERT INTO onboarding_templates(name, trade_id, project_id, description) VALUES ($1,$2,$3,$4) RETURNING *', [data.name, data.trade_id, data.project_id, data.description])).rows[0];
      await audit(q, req, 'create', 'onboarding_templates', r.id, null, r);
      return r;
    });
    res.status(201).json(row);
  } catch (e: any) {
    if (e?.code === '23505') throw conflict('An active template already exists for this trade/project combination, or the name is taken.');
    throw e;
  }
}));

onboardingRouter.put('/onboarding/templates/:id', requirePerm('onboarding.templates'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const body = req.body || {};
  await db.tx(async (q) => {
    const t = await one(q, 'SELECT * FROM onboarding_templates WHERE id = $1 FOR UPDATE', [id]);
    if (!t) throw notFound();
    if (body.is_active === false && !t.trade_id && !t.project_id) {
      const others = await one(q, 'SELECT count(*)::int AS n FROM onboarding_templates WHERE is_active AND trade_id IS NULL AND project_id IS NULL AND id <> $1', [id]);
      if (!others!.n) throw badRequest('Keep one active default template.');
    }
    if (body.name !== undefined || body.description !== undefined || body.is_active !== undefined) {
      const d = validate({ name: { type: 'text', label: 'Template name', max: 120 }, description: { type: 'longtext', label: 'Description', max: 1000 }, is_active: { type: 'bool', label: 'Active' } }, body, true);
      const cols = Object.keys(d);
      if (cols.length) await q.query(`UPDATE onboarding_templates SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...cols.map((c) => d[c])]);
    }
    if (Array.isArray(body.items)) {
      await q.query('DELETE FROM onboarding_template_items WHERE template_id = $1', [id]);
      for (const it of body.items) {
        const defId = Number(it.definition_id);
        if (!Number.isInteger(defId)) continue;
        const applicable = it.is_applicable !== false;
        const mand = it.is_mandatory === undefined || it.is_mandatory === null ? null : !!it.is_mandatory;
        const off = it.offset_days === undefined || it.offset_days === null || it.offset_days === '' ? null : Number(it.offset_days);
        if (off !== null && (!Number.isInteger(off) || Math.abs(off) > 365)) throw badRequest('Offsets must be whole numbers of days.');
        if (applicable && mand === null && off === null) continue; // no override
        const def = await one(q, 'SELECT workflow_key FROM onboarding_activity_definitions WHERE id = $1', [defId]);
        if (!applicable && def?.workflow_key && CLEARANCE_KEYS.includes(def.workflow_key)) throw badRequest('Clearance and deployment activities always apply.');
        await q.query('INSERT INTO onboarding_template_items(template_id, definition_id, is_applicable, is_mandatory, offset_days) VALUES ($1,$2,$3,$4,$5)', [id, defId, applicable, mand, off]);
      }
    }
    await audit(q, req, 'update', 'onboarding_templates', id, null, { ...body, items: Array.isArray(body.items) ? body.items.length : undefined });
  });
  res.json({ ok: true });
}));
