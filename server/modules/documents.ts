// Employee document store (foundation of Module 6). Files live outside the web root and are
// only served through these permission-checked routes.
import crypto from 'node:crypto';
import express, { type Request } from 'express';
import multer from 'multer';
import { config } from '../config.ts';
import { db, one, type Q } from '../db/index.ts';
import { asyncH, badRequest, forbidden, notFound, sha256, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { can } from '../lib/rbac.ts';
import { audit } from '../lib/audit.ts';
import { validate } from '../lib/validate.ts';
import { resync } from '../lib/onboarding.ts';
import { getSettings } from '../lib/settings.ts';
import { deleteFile, openFile, putFile } from '../lib/storage.ts';

/** Categories where a person holds one document at a time: a new upload supersedes the old one (new version). */
export const SINGLE = new Set(['passport', 'photograph', 'offer_letter', 'employment_contract', 'work_permit', 'visa_medical',
  'occupational_medical', 'emirates_id', 'residence_visa', 'mohre_training', 'uniform_ppe_ack']);

const KINDS: { mime: string; ext: string; magic: number[] }[] = [
  { mime: 'application/pdf', ext: '.pdf', magic: [0x25, 0x50, 0x44, 0x46] },
  { mime: 'image/png', ext: '.png', magic: [0x89, 0x50, 0x4e, 0x47] },
  { mime: 'image/jpeg', ext: '.jpg', magic: [0xff, 0xd8, 0xff] },
];

export const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 1 } });

/** Identify the file by its content, not by the name or the browser-supplied type. */
function sniff(buf: Buffer) {
  return KINDS.find((k) => k.magic.every((b, i) => buf[i] === b)) || null;
}

export const documentsRouter = express.Router();

documentsRouter.get('/candidates/:id/documents', requirePerm('documents.view'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  res.json(await db.many(`SELECT d.id, d.category, d.title, d.version, d.is_current, d.document_number, d.issue_date, d.expiry_date,
      d.original_name, d.mime_type, d.size_bytes, d.remarks, d.uploaded_at, u.full_name AS uploaded_by_name
    FROM employee_documents d LEFT JOIN users u ON u.id = d.uploaded_by WHERE d.candidate_id = $1
    ORDER BY d.category, d.is_current DESC, d.version DESC, d.id DESC`, [id]));
}));

export interface StoredFile { stored: string; mime: string; ext: string; original: string; size: number; hash: string }

/** Validates the file by content and writes it to storage. Call removeStored() if the database step fails. */
export async function storeUpload(file: Express.Multer.File | undefined, opts: { imageOnly?: boolean } = {}): Promise<StoredFile> {
  if (!file) throw badRequest('Choose a file to upload.', { file: 'Required.' });
  const kind = sniff(file.buffer);
  if (!kind) throw badRequest('Only PDF, JPG and PNG files are accepted.', { file: 'Only PDF, JPG or PNG.' });
  if (opts.imageOnly && kind.mime === 'application/pdf') throw badRequest('This must be a JPG or PNG image.', { file: 'JPG or PNG only.' });
  const stored = `${crypto.randomUUID()}${kind.ext}`;
  await putFile(stored, file.buffer, kind.mime);
  return { stored, mime: kind.mime, ext: kind.ext, original: file.originalname.slice(0, 255), size: file.size, hash: sha256(file.buffer) };
}
/** Best-effort clean-up of a stored file whose database step failed. */
export const removeStored = (f: StoredFile) => { deleteFile(f.stored).catch((e) => console.error('[storage]', e.message)); };

/** Inserts a document row inside the caller's transaction, versioning single-instance categories. */
export async function recordDocument(q: Q, req: Request, candidateId: number, f: StoredFile, meta: Record<string, any>) {
  const cand = await one(q, 'SELECT id, is_archived FROM candidates WHERE id = $1 FOR UPDATE', [candidateId]);
  if (!cand) throw notFound('Candidate not found.');
  if (cand.is_archived) throw badRequest('Archived candidates cannot receive new documents.');
  let version = 1;
  let prev = null;
  if (meta.replaces_id) {
    prev = await one(q, 'SELECT * FROM employee_documents WHERE id = $1 AND candidate_id = $2 AND is_current', [meta.replaces_id, candidateId]);
    if (!prev) throw badRequest('The document being replaced no longer exists or is not the current version.');
    if (prev.category !== meta.category) throw badRequest('A new version must keep the same category.');
  } else if (SINGLE.has(String(meta.category))) {
    prev = await one(q, 'SELECT * FROM employee_documents WHERE candidate_id = $1 AND category = $2 AND is_current ORDER BY version DESC LIMIT 1', [candidateId, meta.category]);
  }
  if (prev) {
    version = prev.version + 1;
    await q.query('UPDATE employee_documents SET is_current = FALSE WHERE id = $1', [prev.id]);
  }
  const d = (await q.query(`INSERT INTO employee_documents(candidate_id, category, title, version, document_number, issue_date, expiry_date,
      original_name, stored_name, mime_type, size_bytes, sha256, remarks, uploaded_by)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
    [candidateId, meta.category, meta.title || prev?.title || null, version, meta.document_number ?? null, meta.issue_date ?? null, meta.expiry_date ?? null,
      f.original, f.stored, f.mime, f.size, f.hash, meta.remarks ?? null, req.user!.id])).rows[0];
  if (meta.category === 'photograph') await q.query('UPDATE candidates SET photo_document_id = $2 WHERE id = $1', [candidateId, d.id]);
  await audit(q, req, prev ? 'document_version' : 'document_upload', 'employee_documents', d.id, prev ? { id: prev.id, version: prev.version } : null,
    { candidate_id: candidateId, category: d.category, version, original_name: d.original_name, size_bytes: d.size_bytes });
  return d;
}

documentsRouter.post('/candidates/:id/documents', requirePerm('documents.upload'), upload.single('file'), asyncH(async (req, res) => {
  const candidateId = toId(req.params.id);
  const meta = validate({
    category: { type: 'enum', label: 'Category', required: true, options: 'document_category' },
    title: { type: 'text', label: 'Title', max: 200 },
    document_number: { type: 'text', label: 'Document number', max: 60 },
    issue_date: { type: 'date', label: 'Issue date' },
    expiry_date: { type: 'date', label: 'Expiry date' },
    remarks: { type: 'longtext', label: 'Remarks', max: 1000 },
    replaces_id: { type: 'ref', label: 'Document to replace' },
  }, req.body || {});
  if (meta.issue_date && meta.expiry_date && String(meta.expiry_date) <= String(meta.issue_date)) throw badRequest('Expiry date must be after the issue date.', { expiry_date: 'Must be after issue date.' });
  const f = await storeUpload(req.file, { imageOnly: meta.category === 'photograph' });
  try {
    const row = await db.tx(async (q) => {
      const d = await recordDocument(q, req, candidateId, f, meta);
      await resync(q, req, candidateId); // a newly filed document can complete a checklist activity waiting for it
      return d;
    });
    res.status(201).json({ id: row.id, version: row.version });
  } catch (e) {
    removeStored(f);
    throw e;
  }
}));

/** Central repository across all employees. */
documentsRouter.get('/documents', requirePerm('documents.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = ['NOT c.is_archived'];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replaceAll('?', `$${params.length}`)); };
  if (req.query.history !== '1') w.push('d.is_current');
  if (req.query.category) add('d.category = ?', String(req.query.category));
  if (req.query.project_id) add('c.project_id = ?', Number(req.query.project_id));
  if (req.query.candidate_id) add('d.candidate_id = ?', Number(req.query.candidate_id));
  if (req.query.q) add('(c.full_name ILIKE ? OR c.reference_no ILIKE ? OR d.original_name ILIKE ? OR d.document_number ILIKE ? OR d.title ILIKE ?)', `%${req.query.q}%`);
  if (req.query.expiring) add(`d.expiry_date IS NOT NULL AND d.expiry_date <= (now() AT TIME ZONE 'Asia/Dubai')::date + ?::int`, Number(req.query.expiring) || 60);
  const page = Math.max(Number(req.query.page) || 1, 1);
  const where = `WHERE ${w.join(' AND ')}`;
  const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM employee_documents d JOIN candidates c ON c.id = d.candidate_id ${where}`, params))!.n;
  const rows = await db.many(`SELECT d.id, d.candidate_id, d.category, d.title, d.version, d.is_current, d.document_number, d.issue_date, d.expiry_date,
      d.original_name, d.mime_type, d.size_bytes, d.uploaded_at, u.full_name AS uploaded_by_name, c.full_name, c.reference_no, c.status AS candidate_status, p.name AS project,
      (d.expiry_date - (now() AT TIME ZONE 'Asia/Dubai')::date) AS days_to_expiry
    FROM employee_documents d JOIN candidates c ON c.id = d.candidate_id JOIN projects p ON p.id = c.project_id LEFT JOIN users u ON u.id = d.uploaded_by
    ${where} ORDER BY ${req.query.expiring ? 'd.expiry_date' : 'd.uploaded_at DESC'}, d.id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, params);
  res.json({ rows, total, page, pageSize: 50 });
}));

/** Expiry alerts: document expiry dates plus passports from candidate records. */
documentsRouter.get('/documents/expiring', requirePerm('documents.view', 'candidates.view'), asyncH(async (req, res) => {
  const s = await getSettings();
  const docs = can(req.user, 'documents.view') ? await db.many(`SELECT d.id, d.candidate_id, d.category, d.document_number, d.expiry_date, c.full_name, c.reference_no,
      (d.expiry_date - (now() AT TIME ZONE 'Asia/Dubai')::date) AS days
    FROM employee_documents d JOIN candidates c ON c.id = d.candidate_id
    WHERE d.is_current AND d.expiry_date IS NOT NULL AND NOT c.is_archived AND c.status NOT IN ('cancelled')
      AND d.category <> 'passport' AND d.expiry_date <= (now() AT TIME ZONE 'Asia/Dubai')::date + $1::int ORDER BY d.expiry_date`, [s.document_expiry_alert_days]) : [];
  const passports = await db.many(`SELECT c.id AS candidate_id, c.full_name, c.reference_no, c.passport_number, c.passport_expiry_date AS expiry_date, c.status,
      (c.passport_expiry_date - (now() AT TIME ZONE 'Asia/Dubai')::date) AS days
    FROM candidates c WHERE NOT c.is_archived AND c.status NOT IN ('cancelled') AND c.passport_expiry_date <= (now() AT TIME ZONE 'Asia/Dubai')::date + $1::int
    ORDER BY c.passport_expiry_date`, [s.passport_expiry_alert_days]);
  res.json({ documents: docs, passports, windows: { documents: s.document_expiry_alert_days, passports: s.passport_expiry_alert_days } });
}));

documentsRouter.get('/documents/:id/file', asyncH(async (req, res) => {
  const d = await db.one('SELECT * FROM employee_documents WHERE id = $1', [toId(req.params.id)]);
  if (!d) throw notFound('Document not found.');
  // Profile photographs are visible to anyone who can see the candidate; everything else needs documents.view.
  const allowed = can(req.user, 'documents.view') || (d.category === 'photograph' && can(req.user, 'candidates.view'));
  if (!allowed) throw forbidden();
  const file = await openFile(d.stored_name);
  if (!file) throw notFound('The file is missing from storage. Please re-upload it.');
  const download = req.query.download === '1';
  if (download) await audit(db, req, 'document_download', 'employee_documents', d.id, null, { candidate_id: d.candidate_id, category: d.category });
  res.setHeader('Content-Type', d.mime_type);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('Content-Disposition', `${download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(d.original_name)}"`);
  file.on('error', (e) => { console.error('[storage]', e.message); res.destroy(e); }).pipe(res);
}));
