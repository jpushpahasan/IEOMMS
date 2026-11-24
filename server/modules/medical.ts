// Medical: UAE immigration (visa) medical fitness and occupational health examinations.
// The two are separate processes and are kept in separate tables, screens and checklist activities.
import express, { type Request } from 'express';
import { db, one, type Q, type Row } from '../db/index.ts';
import { asyncH, badRequest, conflict, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate, type Schema } from '../lib/validate.ts';
import { TRAVELLING_SQL, resync, uaeToday } from '../lib/onboarding.ts';
import { recordDocument, removeStored, storeUpload, upload, type StoredFile } from './documents.ts';

export const medicalRouter = express.Router();
const ELIGIBLE = `${TRAVELLING_SQL} AND NOT c.is_archived`;

medicalRouter.get('/medical', requirePerm('medical.manage', 'onboarding.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  let w = ELIGIBLE;
  if (req.query.q) { params.push(`%${req.query.q}%`); w += ` AND (c.full_name ILIKE $${params.length} OR c.reference_no ILIKE $${params.length})`; }
  const rows = await db.many(`SELECT c.id, c.full_name, c.reference_no, c.nationality, c.status, c.photo_document_id, t.name AS trade, p.name AS project,
      vm.id AS vm_id, vm.medical_centre, vm.application_no, vm.appointment_at AS vm_appointment, vm.attended_date AS vm_attended, vm.result AS vm_result,
      vm.result_date AS vm_result_date, vm.verified_at AS vm_verified_at, vm.certificate_document_id AS vm_doc,
      om.id AS om_id, om.clinic, om.appointment_at AS om_appointment, om.exam_date AS om_exam, om.fitness AS om_fitness, om.restrictions,
      om.report_date AS om_report_date, om.next_review_date, om.report_document_id AS om_doc,
      (SELECT min(b.arrival_at)::date FROM flight_bookings b WHERE b.candidate_id = c.id AND b.status IN ('ticket_issued','travel_completed')) AS arrival_date
    FROM candidates c JOIN trades t ON t.id = c.trade_id JOIN projects p ON p.id = c.project_id
    LEFT JOIN visa_medical_records vm ON vm.candidate_id = c.id AND vm.is_current
    LEFT JOIN occupational_medical_records om ON om.candidate_id = c.id AND om.is_current
    WHERE ${w} ORDER BY c.full_name`, params);
  const f = String(req.query.filter || '');
  const out = rows.filter((r) => {
    if (f === 'awaiting_visa') return !(r.vm_result === 'fit' && r.vm_verified_at);
    if (f === 'awaiting_occ') return !['fit', 'fit_with_restrictions'].includes(r.om_fitness);
    if (f === 'unfit') return r.vm_result === 'unfit' || ['unfit', 'temporarily_unfit'].includes(r.om_fitness);
    return true;
  });
  res.json(out);
}));

medicalRouter.get('/medical/candidates/:id', requirePerm('medical.manage', 'onboarding.view'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  res.json({
    visa: await db.many(`SELECT v.*, u.full_name AS verified_by_name FROM visa_medical_records v LEFT JOIN users u ON u.id = v.verified_by WHERE v.candidate_id = $1 ORDER BY v.id DESC`, [id]),
    occupational: await db.many('SELECT * FROM occupational_medical_records WHERE candidate_id = $1 ORDER BY id DESC', [id]),
  });
}));

async function candidateFor(q: Q, id: unknown) {
  const c = await one(q, `SELECT c.* FROM candidates c WHERE c.id = $1 AND ${ELIGIBLE} FOR UPDATE OF c`, [Number(id)]);
  if (!c) throw badRequest('Medical records can be created once travel is confirmed (and not for cancelled/archived candidates).', { candidate_id: 'Not eligible.' });
  return c;
}
async function withFile<T>(req: Request, fn: (f: StoredFile | null) => Promise<T>) {
  const f = req.file ? storeUpload(req.file) : null;
  try { return await fn(f); } catch (e) { if (f) removeStored(f); throw e; }
}
async function saveRow(q: Q, req: Request, table: string, old: Row | null, data: Record<string, unknown>) {
  const now = new Date().toISOString();
  const cols = Object.keys(data);
  let row: Row;
  if (old) {
    data.updated_at = now; data.updated_by = req.user!.id;
    const c2 = Object.keys(data);
    row = (await q.query(`UPDATE ${table} SET ${c2.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [old.id, ...c2.map((c) => data[c])])).rows[0];
    const d = diff(old, row);
    await audit(q, req, 'update', table, row.id, d.old, { ...(d.new as object), candidate_id: row.candidate_id });
  } else {
    data.created_by = req.user!.id;
    const c2 = Object.keys(data);
    row = (await q.query(`INSERT INTO ${table}(${c2.join(',')}) VALUES (${c2.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, c2.map((c) => data[c]))).rows[0];
    await audit(q, req, 'create', table, row.id, null, row);
  }
  void cols;
  await resync(q, req, row.candidate_id);
  return row;
}

// ------------------------------------------------------------------ visa (immigration) medical
const VM: Schema = {
  medical_centre: { type: 'text', label: 'Medical fitness centre', required: true, max: 150 },
  application_no: { type: 'text', label: 'Medical application no.', max: 40 },
  appointment_at: { type: 'datetime', label: 'Appointment' },
  attended_date: { type: 'date', label: 'Attended on' },
  result: { type: 'enum', label: 'Result', options: 'visa_medical_result' },
  result_date: { type: 'date', label: 'Result date' },
  remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
};
function checkVm(v: Row) {
  const t = uaeToday();
  if (v.attended_date && v.attended_date > t) throw badRequest('Attendance date cannot be in the future.', { attended_date: 'Future date.' });
  if (v.result && v.result !== 'pending') {
    if (!v.attended_date) throw badRequest('Record the attendance date before the result.', { attended_date: 'Required for a result.' });
    if (!v.result_date) throw badRequest('Result date is required.', { result_date: 'Required.' });
    if (v.result_date < v.attended_date) throw badRequest('Result date cannot be before attendance.', { result_date: 'Before attendance.' });
  }
}

medicalRouter.post('/medical/visa', requirePerm('medical.manage'), upload.single('file'), asyncH(async (req, res) => {
  const data = validate(VM, req.body || {});
  const row = await withFile(req, (f) => db.tx(async (q) => {
    const c = await candidateFor(q, req.body?.candidate_id);
    const cur = await one(q, 'SELECT * FROM visa_medical_records WHERE candidate_id = $1 AND is_current', [c.id]);
    if (cur && cur.result !== 'retest') throw conflict('A current visa medical record exists. Update it instead (a new record is only created for a re-test).');
    if (cur) await q.query('UPDATE visa_medical_records SET is_current = FALSE WHERE id = $1', [cur.id]);
    checkVm({ result: 'pending', ...data });
    if (f) data.certificate_document_id = (await recordDocument(q, req, c.id, f, { category: 'visa_medical', title: 'Visa medical fitness certificate' })).id;
    return saveRow(q, req, 'visa_medical_records', null, { ...data, result: data.result || 'pending', candidate_id: c.id });
  }));
  res.status(201).json(row);
}));

medicalRouter.put('/medical/visa/:id', requirePerm('medical.manage'), upload.single('file'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(VM, req.body || {}, true);
  const row = await withFile(req, (f) => db.tx(async (q) => {
    const old = await one(q, 'SELECT * FROM visa_medical_records WHERE id = $1 FOR UPDATE', [id]);
    if (!old) throw notFound();
    if (!old.is_current) throw badRequest('This is a superseded record.');
    if (old.verified_at && (data.result !== undefined && data.result !== old.result)) throw badRequest('The result was verified; record a re-test instead of changing it.');
    checkVm({ ...old, ...data });
    if (f) data.certificate_document_id = (await recordDocument(q, req, old.candidate_id, f, { category: 'visa_medical', title: 'Visa medical fitness certificate' })).id;
    if (data.result !== undefined && data.result !== old.result) { data.verified_by = null; data.verified_at = null; }
    return saveRow(q, req, 'visa_medical_records', old, data);
  }));
  res.json(row);
}));

/** Medical fitness result verification (activity 18): result must be Fit and the certificate attached. */
medicalRouter.post('/medical/visa/:id/verify', requirePerm('medical.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  await db.tx(async (q) => {
    const old = await one(q, 'SELECT * FROM visa_medical_records WHERE id = $1 FOR UPDATE', [id]);
    if (!old || !old.is_current) throw notFound();
    if (old.result !== 'fit') throw badRequest('Only a Fit result can be verified. Unfit results must be escalated to HR.');
    if (!old.certificate_document_id) throw badRequest('Attach the medical fitness certificate before verifying.');
    if (old.verified_at) throw badRequest('Already verified.');
    await saveRow(q, req, 'visa_medical_records', old, { verified_by: req.user!.id, verified_at: new Date().toISOString() });
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ occupational health
const OM: Schema = {
  clinic: { type: 'text', label: 'Occupational health clinic', required: true, max: 150 },
  appointment_at: { type: 'datetime', label: 'Appointment' },
  exam_date: { type: 'date', label: 'Examination date' },
  tests_performed: { type: 'longtext', label: 'Tests performed', max: 1000 },
  fitness: { type: 'enum', label: 'Fitness category', options: 'occ_fitness' },
  restrictions: { type: 'longtext', label: 'Restrictions', max: 1000 },
  report_date: { type: 'date', label: 'Report date' },
  next_review_date: { type: 'date', label: 'Next review date' },
  remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
};
function checkOm(v: Row) {
  if (v.exam_date && v.exam_date > uaeToday()) throw badRequest('Examination date cannot be in the future.', { exam_date: 'Future date.' });
  if (v.fitness && v.fitness !== 'pending') {
    if (!v.exam_date) throw badRequest('Record the examination date before the fitness result.', { exam_date: 'Required.' });
    if (!v.report_date) throw badRequest('Report date is required.', { report_date: 'Required.' });
    if (v.report_date < v.exam_date) throw badRequest('Report date cannot be before the examination.', { report_date: 'Before exam.' });
  }
  if (v.fitness === 'fit_with_restrictions' && !v.restrictions) throw badRequest('Describe the restrictions.', { restrictions: 'Required for "fit with restrictions".' });
  if (v.fitness === 'temporarily_unfit' && !v.next_review_date) throw badRequest('Set the next review date.', { next_review_date: 'Required when temporarily unfit.' });
}

medicalRouter.post('/medical/occupational', requirePerm('medical.manage'), upload.single('file'), asyncH(async (req, res) => {
  const data = validate(OM, req.body || {});
  const row = await withFile(req, (f) => db.tx(async (q) => {
    const c = await candidateFor(q, req.body?.candidate_id);
    const cur = await one(q, 'SELECT * FROM occupational_medical_records WHERE candidate_id = $1 AND is_current', [c.id]);
    if (cur && !['temporarily_unfit', 'unfit'].includes(cur.fitness)) throw conflict('A current occupational medical record exists. Update it instead.');
    if (cur) await q.query('UPDATE occupational_medical_records SET is_current = FALSE WHERE id = $1', [cur.id]);
    checkOm({ fitness: 'pending', ...data });
    if (f) data.report_document_id = (await recordDocument(q, req, c.id, f, { category: 'occupational_medical', title: 'Occupational medical fitness report' })).id;
    return saveRow(q, req, 'occupational_medical_records', null, { ...data, fitness: data.fitness || 'pending', candidate_id: c.id });
  }));
  res.status(201).json(row);
}));

medicalRouter.put('/medical/occupational/:id', requirePerm('medical.manage'), upload.single('file'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(OM, req.body || {}, true);
  const row = await withFile(req, (f) => db.tx(async (q) => {
    const old = await one(q, 'SELECT * FROM occupational_medical_records WHERE id = $1 FOR UPDATE', [id]);
    if (!old) throw notFound();
    if (!old.is_current) throw badRequest('This is a superseded record.');
    checkOm({ ...old, ...data });
    if (f) data.report_document_id = (await recordDocument(q, req, old.candidate_id, f, { category: 'occupational_medical', title: 'Occupational medical fitness report' })).id;
    return saveRow(q, req, 'occupational_medical_records', old, data);
  }));
  res.json(row);
}));

export { saveRow, withFile };
