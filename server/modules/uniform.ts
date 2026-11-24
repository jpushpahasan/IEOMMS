// Uniform, safety shoes, PPE and employee ID card distribution with employee acknowledgement.
import express from 'express';
import { db, one } from '../db/index.ts';
import { asyncH, badRequest, notFound, toId } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { audit } from '../lib/audit.ts';
import { validate } from '../lib/validate.ts';
import { ARRIVED_SQL, resync, uaeToday } from '../lib/onboarding.ts';
import { recordDocument, upload } from './documents.ts';
import { withFile } from './medical.ts';

export const uniformRouter = express.Router();
const ELIGIBLE = `${ARRIVED_SQL} AND NOT c.is_archived`;
const SIZE = /^[A-Za-z0-9 ./-]{1,10}$/;

uniformRouter.get('/uniform', requirePerm('uniform.manage', 'onboarding.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  let w = ELIGIBLE;
  if (req.query.q) { params.push(`%${req.query.q}%`); w += ` AND (c.full_name ILIKE $${params.length} OR c.reference_no ILIKE $${params.length})`; }
  const rows = await db.many(`SELECT c.id, c.full_name, c.reference_no, c.status, c.photo_document_id, t.name AS trade, p.name AS project,
      m.shirt_size, m.trouser_size, m.coverall_size, m.shoe_size, m.measured_date,
      (SELECT json_object_agg(x.category, json_build_object('issued', x.issued, 'ack', x.ack)) FROM (
         SELECT ui.category, count(*)::int AS issued, bool_and(u.acknowledged) AS ack FROM uniform_issues u JOIN uniform_items ui ON ui.id = u.item_id
          WHERE u.candidate_id = c.id GROUP BY 1) x) AS issues
    FROM candidates c JOIN trades t ON t.id = c.trade_id JOIN projects p ON p.id = c.project_id
    LEFT JOIN uniform_measurements m ON m.candidate_id = c.id
    WHERE ${w} ORDER BY c.full_name`, params);
  const f = String(req.query.filter || '');
  res.json(rows.filter((r) => {
    const i = r.issues || {};
    if (f === 'not_measured') return !r.measured_date;
    if (f === 'pending') return ['uniform', 'safety_shoes', 'ppe', 'id_card'].some((k) => !i[k]?.ack);
    if (f === 'unacknowledged') return Object.values(i).some((x: any) => !x.ack);
    return true;
  }));
}));

uniformRouter.get('/uniform/candidates/:id', requirePerm('uniform.manage', 'onboarding.view'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  res.json({
    measurement: await db.one(`SELECT m.*, u.full_name AS measured_by_name FROM uniform_measurements m LEFT JOIN users u ON u.id = m.measured_by WHERE m.candidate_id = $1`, [id]),
    issues: await db.many(`SELECT u.*, ui.name AS item, ui.category, us.full_name AS issued_by_name FROM uniform_issues u JOIN uniform_items ui ON ui.id = u.item_id
      LEFT JOIN users us ON us.id = u.issued_by WHERE u.candidate_id = $1 ORDER BY u.issue_date DESC, u.id DESC`, [id]),
  });
}));

async function eligible(q: any, id: number) {
  const c = await one(q, `SELECT c.id FROM candidates c WHERE c.id = $1 AND ${ELIGIBLE}`, [id]);
  if (!c) throw badRequest('Uniform and PPE are issued after the employee has arrived in the UAE.');
}

uniformRouter.put('/uniform/measurements/:candidateId', requirePerm('uniform.manage'), asyncH(async (req, res) => {
  const cid = toId(req.params.candidateId);
  const sz = (label: string) => ({ type: 'text' as const, label, max: 10, pattern: [SIZE, 'Use a size like M, XL, 42 or 9.'] as [RegExp, string] });
  const data = validate({ shirt_size: sz('Shirt size'), trouser_size: sz('Trouser size'), coverall_size: sz('Coverall size'), shoe_size: sz('Shoe size'),
    measured_date: { type: 'date', label: 'Measured on', required: true }, remarks: { type: 'longtext', label: 'Remarks', max: 500 } }, req.body || {});
  if (!data.shirt_size && !data.coverall_size && !data.shoe_size && !data.trouser_size) throw badRequest('Enter at least one size.');
  if (String(data.measured_date) > uaeToday()) throw badRequest('Measurement date cannot be in the future.', { measured_date: 'Future date.' });
  await db.tx(async (q) => {
    await eligible(q, cid);
    const old = await one(q, 'SELECT * FROM uniform_measurements WHERE candidate_id = $1', [cid]);
    await q.query(`INSERT INTO uniform_measurements(candidate_id, shirt_size, trouser_size, coverall_size, shoe_size, measured_date, measured_by, remarks)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (candidate_id) DO UPDATE SET shirt_size = EXCLUDED.shirt_size, trouser_size = EXCLUDED.trouser_size,
      coverall_size = EXCLUDED.coverall_size, shoe_size = EXCLUDED.shoe_size, measured_date = EXCLUDED.measured_date, measured_by = EXCLUDED.measured_by, remarks = EXCLUDED.remarks`,
    [cid, data.shirt_size, data.trouser_size, data.coverall_size, data.shoe_size, data.measured_date, req.user!.id, data.remarks]);
    await audit(q, req, old ? 'update' : 'create', 'uniform_measurements', cid, old, { ...data, candidate_id: cid });
    await resync(q, req, cid);
  });
  res.json({ ok: true });
}));

/** Issue a kit: several items in one go. */
uniformRouter.post('/uniform/issues', requirePerm('uniform.manage'), asyncH(async (req, res) => {
  const head = validate({ candidate_id: { type: 'ref', label: 'Employee', required: true }, issue_date: { type: 'date', label: 'Issue date', required: true },
    remarks: { type: 'longtext', label: 'Remarks', max: 500 } }, req.body || {});
  const items: { item_id: number; size?: string; quantity?: number }[] = Array.isArray(req.body?.items) ? req.body.items : [];
  if (!items.length) throw badRequest('Select at least one item to issue.');
  if (String(head.issue_date) > uaeToday()) throw badRequest('Issue date cannot be in the future.', { issue_date: 'Future date.' });
  const out = await db.tx(async (q) => {
    await eligible(q, Number(head.candidate_id));
    const m = await one(q, 'SELECT * FROM uniform_measurements WHERE candidate_id = $1', [head.candidate_id]);
    const ids = [];
    for (const it of items) {
      const item = await one(q, 'SELECT * FROM uniform_items WHERE id = $1 AND is_active', [Number(it.item_id)]);
      if (!item) throw badRequest('One of the items is missing or inactive.');
      let size = String(it.size || '').trim() || null;
      if (item.needs_size && !size) {
        size = item.category === 'safety_shoes' ? m?.shoe_size : /coverall/i.test(item.name) ? m?.coverall_size : m?.shirt_size;
        if (!size) throw badRequest(`Enter a size for "${item.name}" (or record the employee's measurements first).`);
      }
      if (size && !SIZE.test(size)) throw badRequest(`Invalid size for "${item.name}".`);
      const qty = Number(it.quantity || item.default_qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > 20) throw badRequest(`Quantity for "${item.name}" must be 1–20.`);
      const r = (await q.query(`INSERT INTO uniform_issues(candidate_id, item_id, size, quantity, issue_date, issued_by, remarks) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [head.candidate_id, item.id, size, qty, head.issue_date, req.user!.id, head.remarks])).rows[0];
      await audit(q, req, 'issue', 'uniform_issues', r.id, null, { ...r, item: item.name });
      ids.push(r.id);
    }
    await resync(q, req, Number(head.candidate_id));
    return ids;
  });
  res.status(201).json({ ids: out });
}));

/** Employee acknowledgement (optionally with the signed acknowledgement form) — completes the checklist activity. */
uniformRouter.post('/uniform/acknowledge', requirePerm('uniform.manage'), upload.single('file'), asyncH(async (req, res) => {
  const ids: number[] = String(req.body?.ids || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
  if (!ids.length) throw badRequest('Select the issued items being acknowledged.');
  const data = validate({ acknowledged_date: { type: 'date', label: 'Acknowledged on', required: true } }, req.body || {});
  if (String(data.acknowledged_date) > uaeToday()) throw badRequest('Date cannot be in the future.', { acknowledged_date: 'Future date.' });
  await withFile(req, (f) => db.tx(async (q) => {
    const rows = (await q.query('SELECT * FROM uniform_issues WHERE id = ANY($1::int[]) FOR UPDATE', [ids])).rows;
    if (rows.length !== ids.length) throw notFound('Some issued items were not found.');
    const cid = rows[0].candidate_id;
    if (rows.some((r) => r.candidate_id !== cid)) throw badRequest('Acknowledge one employee at a time.');
    if (rows.some((r) => String(data.acknowledged_date) < String(r.issue_date))) throw badRequest('Acknowledgement cannot be before the issue date.');
    const doc = f ? await recordDocument(q, req, cid, f, { category: 'uniform_ppe_ack', title: 'Uniform / PPE acknowledgement' }) : null;
    await q.query(`UPDATE uniform_issues SET acknowledged = TRUE, acknowledged_date = $2, ack_document_id = coalesce($3, ack_document_id) WHERE id = ANY($1::int[])`,
      [ids, data.acknowledged_date, doc?.id ?? null]);
    await audit(q, req, 'acknowledge', 'uniform_issues', null, null, { ids, candidate_id: cid, acknowledged_date: data.acknowledged_date });
    await resync(q, req, cid);
  }));
  res.json({ ok: true });
}));

uniformRouter.delete('/uniform/issues/:id', requirePerm('uniform.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  await db.tx(async (q) => {
    const r = await one(q, 'SELECT * FROM uniform_issues WHERE id = $1 FOR UPDATE', [id]);
    if (!r) throw notFound();
    if (r.acknowledged) throw badRequest('Acknowledged issues cannot be removed.');
    await q.query('DELETE FROM uniform_issues WHERE id = $1', [id]);
    await audit(q, req, 'delete', 'uniform_issues', id, r, null);
    await resync(q, req, r.candidate_id);
  });
  res.json({ ok: true });
}));
