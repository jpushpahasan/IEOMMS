// Visa & immigration: entry / work permit, residence visa, Emirates ID.
import express from 'express';
import { db, one } from '../db/index.ts';
import { asyncH, badRequest, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { validate, type Schema } from '../lib/validate.ts';
import { uaeToday } from '../lib/onboarding.ts';
import { recordDocument, upload } from './documents.ts';
import { saveRow, withFile } from './medical.ts';

export const visaRouter = express.Router();

const SCHEMA: Schema = {
  entry_permit_required: { type: 'bool', label: 'Entry permit required' },
  work_permit_no: { type: 'text', label: 'MOHRE work permit no.', max: 40 },
  entry_permit_no: { type: 'text', label: 'Entry permit no.', max: 40 },
  entry_permit_applied_date: { type: 'date', label: 'Entry permit applied' },
  entry_permit_issue_date: { type: 'date', label: 'Entry permit issued' },
  entry_permit_expiry_date: { type: 'date', label: 'Entry permit expiry' },
  residence_application_no: { type: 'text', label: 'Residence visa application no.', max: 40 },
  residence_application_date: { type: 'date', label: 'Residence visa applied' },
  residence_status: { type: 'enum', label: 'Residence visa status', options: 'residence_status' },
  residence_file_no: { type: 'text', label: 'Residence file no.', max: 40 },
  uid_no: { type: 'text', label: 'UID no.', max: 20, pattern: [/^\d{6,15}$/, 'UID is 6–15 digits.'] },
  residence_issue_date: { type: 'date', label: 'Residence visa issue date' },
  residence_expiry_date: { type: 'date', label: 'Residence visa expiry date' },
  eid_application_no: { type: 'text', label: 'Emirates ID application no.', max: 40 },
  eid_biometrics_date: { type: 'date', label: 'Biometrics date' },
  eid_number: { type: 'text', label: 'Emirates ID number', max: 20, pattern: [/^784-\d{4}-\d{7}-\d$/, 'Format 784-YYYY-NNNNNNN-N.'] },
  eid_expiry_date: { type: 'date', label: 'Emirates ID expiry' },
  eid_collected_date: { type: 'date', label: 'Emirates ID collected' },
  eid_verified: { type: 'bool', label: 'Emirates ID verified' },
  remarks: { type: 'longtext', label: 'Remarks', max: 2000 },
};
const DOC_FOR: Record<string, string> = { work_permit: 'Work / entry permit', residence_visa: 'Residence visa', emirates_id: 'Emirates ID' };

visaRouter.get('/visa', requirePerm('visa.manage', 'onboarding.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  let w = `c.status IN ('selected','pre_arrival','travel_confirmed','arrived','onboarding','awaiting_clearance','ready_for_deployment','deployed','on_hold') AND NOT c.is_archived`;
  if (req.query.q) { params.push(`%${req.query.q}%`); w += ` AND (c.full_name ILIKE $${params.length} OR c.reference_no ILIKE $${params.length} OR v.eid_number ILIKE $${params.length})`; }
  const rows = await db.many(`SELECT c.id, c.full_name, c.reference_no, c.nationality, c.status, c.passport_number, c.passport_expiry_date, c.photo_document_id,
      p.name AS project, v.*, v.id AS visa_id, c.id AS candidate_id,
      (SELECT vm.result FROM visa_medical_records vm WHERE vm.candidate_id = c.id AND vm.is_current) AS vm_result
    FROM candidates c JOIN projects p ON p.id = c.project_id LEFT JOIN visa_records v ON v.candidate_id = c.id
    WHERE ${w} ORDER BY c.full_name`, params);
  const stage = (r: any) => (r.eid_verified ? 'complete' : r.residence_status === 'issued' ? 'eid' : r.residence_application_date ? 'residence'
    : r.entry_permit_issue_date || r.entry_permit_required === false ? 'arrival' : 'entry_permit');
  const f = String(req.query.stage || '');
  res.json(rows.map((r) => ({ ...r, stage: stage(r) })).filter((r) => !f || r.stage === f));
}));

visaRouter.get('/visa/:candidateId', requirePerm('visa.manage', 'onboarding.view'), asyncH(async (req, res) => {
  res.json(await db.one('SELECT * FROM visa_records WHERE candidate_id = $1', [toId(req.params.candidateId)]));
}));

/** Upsert the candidate's visa record; optional file + doc_category files the permit / visa / EID copy. */
visaRouter.put('/visa/:candidateId', requirePerm('visa.manage'), upload.single('file'), asyncH(async (req, res) => {
  const cid = toId(req.params.candidateId);
  const data = validate(SCHEMA, req.body || {}, true);
  const docCat = String(req.body?.doc_category || '');
  if (req.file && !DOC_FOR[docCat]) throw badRequest('Choose what the uploaded file is (work permit, residence visa or Emirates ID).');
  const row = await withFile(req, (f) => db.tx(async (q) => {
    const c = await one(q, `SELECT id, status, is_archived FROM candidates WHERE id = $1 FOR UPDATE`, [cid]);
    if (!c || c.is_archived || c.status === 'cancelled') throw badRequest('Candidate not found or not active.');
    const old = await one(q, 'SELECT * FROM visa_records WHERE candidate_id = $1 FOR UPDATE', [cid]);
    const v = { entry_permit_required: true, residence_status: 'not_started', eid_verified: false, ...(old || {}), ...data } as Record<string, any>;
    const errors: Record<string, string> = {};
    const t = uaeToday();
    for (const k of ['entry_permit_applied_date', 'entry_permit_issue_date', 'residence_application_date', 'residence_issue_date', 'eid_biometrics_date', 'eid_collected_date']) {
      if (v[k] && v[k] > t) errors[k] = 'Cannot be in the future.';
    }
    if (v.entry_permit_issue_date && v.entry_permit_applied_date && v.entry_permit_issue_date < v.entry_permit_applied_date) errors.entry_permit_issue_date = 'Before the application date.';
    if (v.entry_permit_expiry_date && v.entry_permit_issue_date && v.entry_permit_expiry_date <= v.entry_permit_issue_date) errors.entry_permit_expiry_date = 'Must be after issue.';
    if (v.entry_permit_issue_date && !v.entry_permit_no) errors.entry_permit_no = 'Required once issued.';
    if (v.residence_status !== 'not_started' && !v.residence_application_date) errors.residence_application_date = 'Required once applied.';
    if (['approved', 'issued'].includes(v.residence_status) && !['arrived', 'onboarding', 'awaiting_clearance', 'ready_for_deployment', 'deployed', 'on_hold'].includes(c.status)) {
      errors.residence_status = 'The candidate must have arrived in the UAE.';
    }
    if (v.residence_status === 'issued') {
      if (!v.residence_issue_date) errors.residence_issue_date = 'Required when issued.';
      if (!v.residence_expiry_date) errors.residence_expiry_date = 'Required when issued.';
      if (v.residence_issue_date && v.residence_expiry_date && v.residence_expiry_date <= v.residence_issue_date) errors.residence_expiry_date = 'Must be after issue.';
      if (v.residence_application_date && v.residence_issue_date && v.residence_issue_date < v.residence_application_date) errors.residence_issue_date = 'Before the application.';
    }
    if (v.eid_collected_date && !v.eid_number) errors.eid_number = 'Enter the Emirates ID number when collected.';
    if (v.eid_collected_date && v.eid_biometrics_date && v.eid_collected_date < v.eid_biometrics_date) errors.eid_collected_date = 'Before biometrics.';
    if (v.eid_verified && !v.eid_collected_date) errors.eid_verified = 'Collect the card before verifying it.';
    if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
    if (f) await recordDocument(q, req, cid, f, { category: docCat, title: DOC_FOR[docCat],
      document_number: docCat === 'emirates_id' ? v.eid_number : docCat === 'residence_visa' ? v.residence_file_no : v.entry_permit_no || v.work_permit_no,
      issue_date: docCat === 'residence_visa' ? v.residence_issue_date : docCat === 'work_permit' ? v.entry_permit_issue_date : null,
      expiry_date: docCat === 'residence_visa' ? v.residence_expiry_date : docCat === 'emirates_id' ? v.eid_expiry_date : v.entry_permit_expiry_date });
    if (v.eid_verified && !(old?.eid_verified)) {
      const doc = await one(q, `SELECT 1 FROM employee_documents WHERE candidate_id = $1 AND category = 'emirates_id' AND is_current`, [cid]);
      if (!doc) throw badRequest('Upload the Emirates ID copy before marking it verified.', { eid_verified: 'Emirates ID copy required.' });
    }
    return saveRow(q, req, 'visa_records', old, old ? data : { ...data, candidate_id: cid });
  }));
  res.json(row);
}));
