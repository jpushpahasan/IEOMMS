// Training: trade / project training templates, per-employee records, sessions and results.
import express from 'express';
import { db, one, type Q } from '../db/index.ts';
import { asyncH, badRequest, conflict, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate } from '../lib/validate.ts';
import { ensureTrainingRecords, resync, TRAVELLING_SQL, uaeToday } from '../lib/onboarding.ts';
import { recordDocument, upload } from './documents.ts';
import { withFile } from './medical.ts';

export const trainingRouter = express.Router();
const ACTIVE = `c.status NOT IN ('cancelled') AND NOT c.is_archived`;

// ------------------------------------------------------------------ requirements (training templates)
trainingRouter.get('/training/requirements', requirePerm('onboarding.view', 'training.manage'), asyncH(async (_req, res) => {
  const [trades, projects] = await Promise.all([
    db.many(`SELECT r.*, tc.name AS course, tc.code, tc.category FROM trade_training_requirements r JOIN training_courses tc ON tc.id = r.course_id ORDER BY tc.category, tc.name`),
    db.many(`SELECT r.*, tc.name AS course, tc.code, tc.category FROM project_training_requirements r JOIN training_courses tc ON tc.id = r.course_id ORDER BY tc.category, tc.name`),
  ]);
  res.json({ trades, projects });
}));

/** Replace the course list of a trade or project and add missing records for its active candidates. */
trainingRouter.put('/training/requirements/:kind/:id', requirePerm('training.manage'), asyncH(async (req, res) => {
  const kind = req.params.kind === 'trade' ? 'trade' : req.params.kind === 'project' ? 'project' : null;
  if (!kind) throw notFound();
  const id = toId(req.params.id);
  const list: { course_id: number; is_mandatory?: boolean; requires_assessment?: boolean }[] = Array.isArray(req.body?.courses) ? req.body.courses : [];
  const out = await db.tx(async (q) => {
    if (!(await one(q, `SELECT 1 FROM ${kind}s WHERE id = $1`, [id]))) throw notFound();
    const before = (await q.query(`SELECT course_id FROM ${kind}_training_requirements WHERE ${kind}_id = $1`, [id])).rows.map((r) => r.course_id);
    await q.query(`DELETE FROM ${kind}_training_requirements WHERE ${kind}_id = $1`, [id]);
    for (const c of list) {
      const cid = Number(c.course_id);
      if (!(await one(q, 'SELECT 1 FROM training_courses WHERE id = $1 AND is_active', [cid]))) throw badRequest('One of the courses is missing or inactive.');
      await q.query(`INSERT INTO ${kind}_training_requirements(${kind}_id, course_id, is_mandatory, requires_assessment) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
        [id, cid, c.is_mandatory !== false, !!c.requires_assessment]);
    }
    await audit(q, req, 'update_training_template', `${kind}s`, id, { courses: before }, { courses: list.map((c) => Number(c.course_id)) });
    // Apply to active candidates that already have a checklist (new requirements only; existing records are kept).
    const cands = (await q.query(`SELECT c.* FROM candidates c WHERE c.${kind}_id = $1 AND ${ACTIVE}
      AND c.status NOT IN ('ready_for_deployment','deployed') AND EXISTS (SELECT 1 FROM employee_onboarding e WHERE e.candidate_id = c.id)`, [id])).rows;
    let added = 0;
    for (const c of cands) {
      added += await ensureTrainingRecords(q, req, c);
      await reapplyTrainingActivities(q, c.id);
      await resync(q, req, c.id);
    }
    return { candidates: cands.length, added };
  });
  res.json({ ok: true, ...out });
}));

/** A course category that becomes required re-opens its auto-"not applicable" activity. */
async function reapplyTrainingActivities(q: Q, candidateId: number) {
  await q.query(`UPDATE onboarding_activities a SET status = 'not_started', na_reason = NULL, auto_completed = FALSE
    WHERE a.candidate_id = $1 AND a.status = 'not_applicable' AND a.auto_completed AND a.workflow_key LIKE 'training:%'
      AND (a.workflow_key = 'training:all' OR EXISTS (SELECT 1 FROM training_records tr JOIN training_courses tc ON tc.id = tr.course_id
        WHERE tr.candidate_id = a.candidate_id AND 'training:' || tc.category = a.workflow_key))`, [candidateId]);
}

// ------------------------------------------------------------------ records
trainingRouter.get('/training/records', requirePerm('onboarding.view', 'training.manage'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = [ACTIVE];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.query.candidate_id) add('tr.candidate_id = ?', Number(req.query.candidate_id));
  if (req.query.course_id) add('tr.course_id = ?', Number(req.query.course_id));
  if (req.query.category) add('tc.category = ?', String(req.query.category));
  if (req.query.status === 'open') w.push(`tr.status IN ('required','scheduled','absent','failed')`);
  else if (req.query.status) add('tr.status = ?', String(req.query.status));
  if (req.query.trade_id) add('c.trade_id = ?', Number(req.query.trade_id));
  if (req.query.q) add('(c.full_name ILIKE ? OR c.reference_no ILIKE ?)', `%${req.query.q}%`);
  if (!req.query.candidate_id) w.push(TRAVELLING_SQL);
  res.json(await db.many(`SELECT tr.*, tc.name AS course, tc.code, tc.category, tc.duration_hours, c.full_name, c.reference_no, c.status AS candidate_status,
      t.name AS trade, p.name AS project
    FROM training_records tr JOIN training_courses tc ON tc.id = tr.course_id JOIN candidates c ON c.id = tr.candidate_id
    JOIN trades t ON t.id = c.trade_id JOIN projects p ON p.id = c.project_id
    WHERE ${w.join(' AND ')} ORDER BY CASE tr.status WHEN 'failed' THEN 0 WHEN 'absent' THEN 1 WHEN 'required' THEN 2 WHEN 'scheduled' THEN 3 ELSE 4 END,
      tr.scheduled_date NULLS LAST, c.full_name LIMIT 1000`, params));
}));

trainingRouter.post('/training/records', requirePerm('training.manage'), asyncH(async (req, res) => {
  const data = validate({ candidate_id: { type: 'ref', label: 'Employee', required: true }, course_id: { type: 'ref', label: 'Course', required: true },
    is_mandatory: { type: 'bool', label: 'Mandatory' }, requires_assessment: { type: 'bool', label: 'Assessment required' } }, req.body || {});
  try {
    const row = await db.tx(async (q) => {
      const c = await one(q, `SELECT id FROM candidates c WHERE id = $1 AND ${ACTIVE}`, [data.candidate_id]);
      if (!c) throw badRequest('Employee not found or not active.');
      const r = (await q.query(`INSERT INTO training_records(candidate_id, course_id, is_mandatory, requires_assessment, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [data.candidate_id, data.course_id, data.is_mandatory, data.requires_assessment, req.user!.id])).rows[0];
      await audit(q, req, 'create', 'training_records', r.id, null, r);
      await reapplyTrainingActivities(q, c.id);
      await resync(q, req, c.id);
      return r;
    });
    res.status(201).json(row);
  } catch (e: any) {
    if (e?.code === '23505') throw conflict('This course is already on the employee\'s training plan.');
    throw e;
  }
}));

async function updateRecord(q: Q, req: any, id: number, data: Record<string, any>, file: any) {
  const old = await one(q, `SELECT tr.*, tc.validity_months, tc.category, tc.name AS course FROM training_records tr JOIN training_courses tc ON tc.id = tr.course_id WHERE tr.id = $1 FOR UPDATE OF tr`, [id]);
  if (!old) throw notFound('Training record not found.');
  const v = { ...old, ...data };
  const errors: Record<string, string> = {};
  if (['attended', 'passed', 'failed'].includes(v.status)) {
    if (!v.completed_date) errors.completed_date = 'Required for attended / passed / failed.';
    else if (v.completed_date > uaeToday()) errors.completed_date = 'Cannot be in the future.';
  }
  if (v.status === 'scheduled' && !v.scheduled_date) errors.scheduled_date = 'Required when scheduled.';
  if (v.status === 'passed' && old.requires_assessment && (v.score === null || v.score === undefined || v.score === '')) errors.score = 'Assessment score required.';
  if (v.status === 'attended' && old.requires_assessment) errors.status = 'This course needs an assessment result: record Passed or Failed.';
  if (v.status === 'exempted' && !v.remarks) errors.remarks = 'Give the exemption reason.';
  if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
  if (['passed', 'attended'].includes(v.status) && old.validity_months && v.completed_date) {
    const d = new Date(`${v.completed_date}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + old.validity_months);
    data.expiry_date = d.toISOString().slice(0, 10);
  }
  if (!['attended', 'passed', 'failed'].includes(v.status)) { data.completed_date = null; data.expiry_date = null; }
  if (file) data.certificate_document_id = (await recordDocument(q, req, old.candidate_id, file, {
    category: old.category === 'mohre' ? 'mohre_training' : 'training_certificate', title: old.course, issue_date: v.completed_date ?? null, expiry_date: data.expiry_date ?? null })).id;
  data.updated_at = new Date().toISOString();
  data.updated_by = req.user!.id;
  const cols = Object.keys(data);
  const row = (await q.query(`UPDATE training_records SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...cols.map((c) => data[c])])).rows[0];
  const d = diff(old, row);
  await audit(q, req, 'update', 'training_records', id, d.old, { ...(d.new as object), candidate_id: old.candidate_id });
  await resync(q, req, old.candidate_id);
  return row;
}

const REC = {
  status: { type: 'enum' as const, label: 'Status', options: 'training_status' },
  scheduled_date: { type: 'date' as const, label: 'Scheduled date' },
  completed_date: { type: 'date' as const, label: 'Completion date' },
  trainer: { type: 'text' as const, label: 'Trainer / provider' },
  score: { type: 'money' as const, label: 'Score (%)' },
  remarks: { type: 'longtext' as const, label: 'Remarks', max: 1000 },
};

trainingRouter.put('/training/records/:id', requirePerm('training.manage'), upload.single('file'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(REC, req.body || {}, true);
  if (data.score !== undefined && data.score !== null && Number(data.score) > 100) throw badRequest('Score must be 0–100.', { score: '0–100.' });
  if (req.body?.score === '' || req.body?.score === null) data.score = null; // blank = no score (money fields default to 0)
  const row = await withFile(req, (f) => db.tx((q) => updateRecord(q, req, id, data, f)));
  res.json(row);
}));

/** Bulk: schedule a session or record results for several employees at once. */
trainingRouter.post('/training/records/bulk', requirePerm('training.manage'), asyncH(async (req, res) => {
  const ids: number[] = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : [];
  if (!ids.length) throw badRequest('Select at least one record.');
  const data = validate(REC, req.body || {}, true);
  if (req.body?.score === '' || req.body?.score === null) data.score = null;
  const results: { id: number; ok: boolean; error?: string }[] = [];
  for (const id of ids) {
    try { await db.tx((q) => updateRecord(q, req, id, { ...data }, null)); results.push({ id, ok: true }); }
    catch (e: any) { results.push({ id, ok: false, error: e?.details ? Object.values(e.details).join(' ') : e?.message }); }
  }
  res.json({ updated: results.filter((r) => r.ok).length, results });
}));
