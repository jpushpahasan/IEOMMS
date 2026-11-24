// Onboarding checklist engine: generation from templates, and state-based synchronisation of workflow-linked
// activities with the modules that own the facts (mobility, accommodation, medical, visa, training, uniform, HR).
// `resync` is idempotent: it can be called after any change and always converges to the same result.
import type { Request } from 'express';
import { one, type Q, type Row } from '../db/index.ts';
import { audit } from './audit.ts';
import { advanceCandidate } from './lifecycle.ts';
import { CLEARANCE_KEYS } from './catalogue.ts';
import { label } from './enums.ts';

export const uaeToday = () => new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
const toUaeDate = (v: unknown) => {
  if (!v) return null;
  if (v instanceof Date) return new Date(v.getTime() + 4 * 3600_000).toISOString().slice(0, 10);
  return String(v).slice(0, 10);
};
export const addDays = (d: string, n: number) => new Date(new Date(`${d}T00:00:00Z`).getTime() + n * 864e5).toISOString().slice(0, 10);
/** SQL condition on alias `c`: the person is (or was, if now on hold) in the UAE. */
export const ARRIVED_SQL = `(c.status IN ('arrived','onboarding','awaiting_clearance','ready_for_deployment','deployed')
  OR (c.status = 'on_hold' AND EXISTS (SELECT 1 FROM candidate_status_history hh WHERE hh.candidate_id = c.id AND hh.to_status = 'arrived')))`;
/** Arrived, or travelling with a confirmed ticket (medical appointments are booked ahead of arrival). */
export const TRAVELLING_SQL = `(${ARRIVED_SQL} OR c.status = 'travel_confirmed')`;
const OPEN_STATUSES =['not_started', 'pending', 'in_progress', 'awaiting_documents', 'awaiting_approval', 'rejected', 'on_hold'];

export async function resolveTemplate(q: Q, tradeId: number, projectId: number) {
  return one(q, `SELECT * FROM onboarding_templates WHERE is_active AND (trade_id IS NULL OR trade_id = $1) AND (project_id IS NULL OR project_id = $2)
    ORDER BY (trade_id IS NOT NULL AND project_id IS NOT NULL) DESC, (trade_id IS NOT NULL) DESC, (project_id IS NOT NULL) DESC, id LIMIT 1`, [tradeId, projectId]);
}

/** Department manager, else the first active user in the department, else the fallback user. */
async function responsibleFor(q: Q, deptId: number, fallback: number, cache: Map<number, number>) {
  if (cache.has(deptId)) return cache.get(deptId)!;
  const r = await one(q, `SELECT coalesce(
      (SELECT u.id FROM departments d JOIN users u ON u.id = d.manager_user_id AND u.is_active WHERE d.id = $1),
      (SELECT u.id FROM users u WHERE u.department_id = $1 AND u.is_active ORDER BY u.id LIMIT 1)) AS id`, [deptId]);
  const id = r?.id || fallback;
  cache.set(deptId, id);
  return id;
}

async function arrivalDate(q: Q, c: Row) {
  const a = await one(q, `SELECT coalesce(
      (SELECT (ap.actual_pickup_at)::date FROM airport_pickups ap WHERE ap.candidate_id = $1 AND ap.status = 'completed' ORDER BY ap.id DESC LIMIT 1),
      (SELECT (b.arrival_at)::date FROM flight_bookings b WHERE b.candidate_id = $1 AND b.status IN ('ticket_issued','travel_completed') ORDER BY b.id DESC LIMIT 1)) AS d`, [c.id]);
  const actual = await one(q, `SELECT changed_at FROM candidate_status_history WHERE candidate_id = $1 AND to_status = 'arrived' ORDER BY changed_at LIMIT 1`, [c.id]);
  return {
    planned: a?.d ? String(a.d) : c.expected_joining_date || addDays(c.selection_date, 30),
    actual: actual ? (a?.d ? String(a.d) : toUaeDate(actual.changed_at)) : null,
  };
}

/** Creates training records for every course the candidate's trade and project require. */
export async function ensureTrainingRecords(q: Q, req: Request, c: Row) {
  const r = await q.query(`INSERT INTO training_records(candidate_id, course_id, is_mandatory, requires_assessment, created_by)
    SELECT $1, x.course_id, bool_or(x.is_mandatory), bool_or(x.requires_assessment), $4 FROM (
      SELECT course_id, is_mandatory, requires_assessment FROM trade_training_requirements WHERE trade_id = $2
      UNION ALL SELECT course_id, is_mandatory, requires_assessment FROM project_training_requirements WHERE project_id = $3) x
    JOIN training_courses tc ON tc.id = x.course_id AND tc.is_active
    GROUP BY x.course_id ON CONFLICT (candidate_id, course_id) DO NOTHING RETURNING id`, [c.id, c.trade_id, c.project_id, req.user!.id]);
  return r.rows.length;
}

export async function generateChecklist(q: Q, req: Request, candidateId: number) {
  const c = await one(q, 'SELECT * FROM candidates WHERE id = $1', [candidateId]);
  if (!c || c.status === 'cancelled') return false;
  if (await one(q, 'SELECT 1 FROM employee_onboarding WHERE candidate_id = $1', [candidateId])) return false;
  const tpl = await resolveTemplate(q, c.trade_id, c.project_id);
  const items = new Map((tpl ? (await q.query('SELECT * FROM onboarding_template_items WHERE template_id = $1', [tpl.id])).rows : []).map((i) => [i.definition_id, i]));
  const defs = (await q.query('SELECT * FROM onboarding_activity_definitions WHERE is_active ORDER BY seq')).rows;
  await ensureTrainingRecords(q, req, c);
  const cats = new Set((await q.query(`SELECT DISTINCT tc.category FROM training_records tr JOIN training_courses tc ON tc.id = tr.course_id WHERE tr.candidate_id = $1`, [candidateId])).rows.map((r) => r.category));
  const { planned: arr } = await arrivalDate(q, c);
  const cache = new Map<number, number>();
  for (const d of defs) {
    const it = items.get(d.id);
    let na: string | null = it && it.is_applicable === false ? `Not applicable under template "${tpl!.name}"` : null;
    if (!na && d.workflow_key?.startsWith('training:')) {
      const cat = d.workflow_key.slice(9);
      if (cat === 'all' ? cats.size === 0 : !cats.has(cat)) na = `Auto: no ${cat === 'all' ? '' : `${label('training_category', cat).toLowerCase()} `}training required for this trade/project`;
    }
    const offset = it?.offset_days ?? d.offset_days;
    const planned = addDays(d.anchor === 'arrival' ? arr : c.selection_date, offset);
    await q.query(`INSERT INTO onboarding_activities(candidate_id, definition_id, seq, section, name, department_id, responsible_user_id, planned_date, status,
        is_mandatory, requires_document, document_category, requires_verification, workflow_key, anchor, offset_days, na_reason, auto_completed, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) ON CONFLICT (candidate_id, definition_id) DO NOTHING`,
    [candidateId, d.id, d.seq, d.section, d.name, d.department_id, await responsibleFor(q, d.department_id, req.user!.id, cache), planned,
      na ? 'not_applicable' : 'not_started', it?.is_mandatory ?? d.is_mandatory, d.requires_document, d.document_category, d.requires_verification,
      d.workflow_key, d.anchor, offset, na, !!na?.startsWith('Auto:'), req.user!.id]);
  }
  // Activity 1 is confirmed by the act of registering the selected candidate.
  await q.query(`UPDATE onboarding_activities SET status = 'completed', actual_completion_date = $2, completed_by = $3, auto_completed = TRUE,
      remarks = 'Auto: candidate registered as selected' WHERE candidate_id = $1 AND seq = 1 AND status = 'not_started'`, [candidateId, c.selection_date, req.user!.id]);
  await q.query('INSERT INTO employee_onboarding(candidate_id, template_id, generated_by) VALUES ($1,$2,$3)', [candidateId, tpl?.id ?? null, req.user!.id]);
  await audit(q, req, 'generate_checklist', 'candidates', candidateId, null, { template: tpl?.name ?? null, activities: defs.length });
  await resync(q, req, candidateId);
  return true;
}

type Fact = { done: boolean; date?: string | null; docId?: number | null; why?: string } | 'na' | undefined;

async function collectFacts(q: Q, c: Row): Promise<{ facts: Record<string, Fact>; arrival: string | null }> {
  const id = c.id;
  const [vr, bk, pk, al, emp, vm, om, tr, meas, issues, arr] = await Promise.all([
    one(q, 'SELECT * FROM visa_records WHERE candidate_id = $1', [id]),
    one(q, `SELECT * FROM flight_bookings WHERE candidate_id = $1 AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`, [id]),
    one(q, `SELECT * FROM airport_pickups WHERE candidate_id = $1 AND status <> 'cancelled' ORDER BY id DESC LIMIT 1`, [id]),
    one(q, `SELECT * FROM accommodation_allocations WHERE candidate_id = $1 AND status IN ('allocated','checked_in','checked_out') ORDER BY id DESC LIMIT 1`, [id]),
    one(q, 'SELECT * FROM employees WHERE candidate_id = $1', [id]),
    one(q, 'SELECT * FROM visa_medical_records WHERE candidate_id = $1 AND is_current', [id]),
    one(q, 'SELECT * FROM occupational_medical_records WHERE candidate_id = $1 AND is_current', [id]),
    q.query(`SELECT tr.*, tc.category FROM training_records tr JOIN training_courses tc ON tc.id = tr.course_id WHERE tr.candidate_id = $1`, [id]).then((r) => r.rows),
    one(q, 'SELECT * FROM uniform_measurements WHERE candidate_id = $1', [id]),
    q.query(`SELECT ui.category, min(u.acknowledged_date) AS ack, bool_or(u.acknowledged) AS any_ack
      FROM uniform_issues u JOIN uniform_items ui ON ui.id = u.item_id WHERE u.candidate_id = $1 GROUP BY 1`, [id]).then((r) => r.rows),
    arrivalDate(q, c),
  ]);
  const today = uaeToday();
  const f: Record<string, Fact> = {};
  f.offer_accepted = { done: c.offer_letter_status === 'accepted', date: today };
  f.contract_prepared = { done: ['prepared', 'sent', 'signed'].includes(c.contract_status), date: today };
  f.contract_signed = { done: c.contract_status === 'signed', date: today };
  f.entry_permit = vr && !vr.entry_permit_required ? 'na' : { done: !!vr?.entry_permit_issue_date, date: vr?.entry_permit_issue_date };
  f.ticket_issued = { done: !!bk && ['ticket_issued', 'travel_completed'].includes(bk.status), date: bk?.booking_confirmation_date || today, docId: bk?.eticket_document_id };
  f.pickup_assigned = { done: !!pk && ['assigned', 'completed'].includes(pk.status), date: today };
  f.pickup_completed = { done: pk?.status === 'completed', date: toUaeDate(pk?.actual_pickup_at) };
  f.bed_allocated = { done: !!al, date: al?.allocation_date };
  f.checked_in = { done: !!al?.actual_checkin_date, date: al?.actual_checkin_date };
  f.arrived = { done: !!arr.actual, date: arr.actual };
  f.hr_registration = { done: !!emp, date: toUaeDate(emp?.created_at) };
  f.visa_medical_attended = { done: !!vm?.attended_date, date: vm?.attended_date };
  f.visa_medical_fit = { done: vm?.result === 'fit' && !!vm?.verified_at, date: vm?.result_date, docId: vm?.certificate_document_id };
  f.occ_exam = { done: !!om?.exam_date, date: om?.exam_date };
  f.occ_report = { done: !!om && ['fit', 'fit_with_restrictions'].includes(om.fitness), date: om?.report_date, docId: om?.report_document_id };
  f.residence_applied = { done: !!vr?.residence_application_date, date: vr?.residence_application_date };
  f.eid_biometrics = { done: !!vr?.eid_biometrics_date, date: vr?.eid_biometrics_date };
  f.residence_issued = { done: vr?.residence_status === 'issued', date: vr?.residence_issue_date };
  f.eid_collected = { done: !!vr?.eid_collected_date && !!vr?.eid_verified, date: vr?.eid_collected_date };
  const isDone = (r: Row) => r.status === 'passed' || r.status === 'exempted' || (r.status === 'attended' && !r.requires_assessment);
  const lastDate = (rs: Row[]) => rs.map((r) => r.completed_date || today).sort().pop() || today;
  for (const cat of ['technical', 'competency', 'hse', 'mohre', 'company_rules', 'emergency', 'client']) {
    const rs = tr.filter((r) => r.category === cat && r.is_mandatory);
    const all = tr.filter((r) => r.category === cat);
    f[`training:${cat}`] = all.length === 0 ? 'na' : { done: (rs.length ? rs : all).every(isDone), date: lastDate(rs.length ? rs : all),
      docId: cat === 'mohre' ? all.find((r) => r.certificate_document_id)?.certificate_document_id : undefined };
  }
  const mand = tr.filter((r) => r.is_mandatory);
  f['training:all'] = tr.length === 0 ? 'na' : { done: mand.length > 0 ? mand.every(isDone) : tr.every(isDone), date: lastDate(mand.length ? mand : tr) };
  f.measurement = { done: !!meas, date: meas?.measured_date };
  for (const cat of ['uniform', 'safety_shoes', 'ppe', 'id_card']) {
    const i = issues.find((x) => x.category === cat);
    f[`issue:${cat}`] = { done: !!i?.any_ack, date: i?.ack ? String(i.ack) : today };
  }
  return { facts: f, arrival: arr.actual };
}

async function applyFact(q: Q, req: Request, a: Row, fact: Fact) {
  if (fact === undefined) return;
  const set: Record<string, unknown> = {};
  if (fact === 'na') {
    if (['not_started', 'pending'].includes(a.status)) Object.assign(set, { status: 'not_applicable', na_reason: 'Auto: not required for this employee', auto_completed: true });
  } else if (fact.done) {
    if (a.status === 'completed' || (a.status === 'not_applicable' && !a.auto_completed)) return;
    let docId = fact.docId ?? a.document_id ?? null;
    if (a.requires_document && !docId && a.document_category) {
      docId = (await one(q, 'SELECT id FROM employee_documents WHERE candidate_id = $1 AND category = $2 AND is_current ORDER BY version DESC LIMIT 1', [a.candidate_id, a.document_category]))?.id ?? null;
    }
    if (a.requires_document && !docId) {
      if (a.status !== 'awaiting_documents') Object.assign(set, { status: 'awaiting_documents', auto_completed: true, remarks: `Auto: done in the source module; upload the ${label('document_category', a.document_category)} to complete.` });
    } else {
      Object.assign(set, { status: 'completed', actual_completion_date: fact.date || uaeToday(), completed_by: req.user!.id, auto_completed: true, document_id: docId,
        remarks: a.remarks && !String(a.remarks).startsWith('Auto:') ? a.remarks : 'Auto: completed from the source module', na_reason: null });
    }
  } else if (a.auto_completed && ['completed', 'not_applicable', 'awaiting_documents'].includes(a.status)) {
    Object.assign(set, { status: 'in_progress', actual_completion_date: null, auto_completed: false, na_reason: null, remarks: 'Auto: reopened — the source record no longer meets the requirement' });
  }
  if (!Object.keys(set).length) return;
  set.updated_at = new Date().toISOString();
  set.updated_by = req.user!.id;
  const cols = Object.keys(set);
  await q.query(`UPDATE onboarding_activities SET ${cols.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [a.id, ...cols.map((k) => set[k])]);
  await audit(q, req, 'auto_update', 'onboarding_activities', a.id, { status: a.status }, { status: set.status, candidate_id: a.candidate_id, seq: a.seq });
}

/** Re-evaluates every workflow-linked activity and the candidate's onboarding lifecycle status. */
export async function resync(q: Q, req: Request, candidateId: number) {
  const c = await one(q, 'SELECT * FROM candidates WHERE id = $1', [candidateId]);
  if (!c) return;
  const acts = (await q.query('SELECT * FROM onboarding_activities WHERE candidate_id = $1 ORDER BY seq', [candidateId])).rows;
  if (!acts.length) return;
  const { facts, arrival } = await collectFacts(q, c);
  for (const a of acts) {
    if (!a.workflow_key || CLEARANCE_KEYS.includes(a.workflow_key)) continue;
    await applyFact(q, req, a, facts[a.workflow_key]);
  }
  if (arrival) {
    await q.query(`UPDATE onboarding_activities SET planned_date = $2::date + offset_days
      WHERE candidate_id = $1 AND anchor = 'arrival' AND status NOT IN ('completed','not_applicable') AND planned_date IS DISTINCT FROM $2::date + offset_days`, [candidateId, arrival]);
  }
  await updateLifecycle(q, req, candidateId);
}

export async function updateLifecycle(q: Q, req: Request, candidateId: number) {
  const s = await one(q, `SELECT c.status,
      EXISTS (SELECT 1 FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.seq >= 13 AND a.status = 'completed') AS started,
      (SELECT count(*)::int FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.is_mandatory AND a.status <> 'completed' AND a.status <> 'not_applicable'
         AND (a.workflow_key IS NULL OR a.workflow_key NOT IN ('clearance','deployment_approval','deployed'))) AS open
    FROM candidates c WHERE c.id = $1`, [candidateId]);
  if (!s) return;
  if (s.status === 'arrived' && s.started) await advanceCandidate(q, req, candidateId, 'onboarding', ['arrived'], 'Onboarding activities started');
  const now = (await one(q, 'SELECT status FROM candidates WHERE id = $1', [candidateId]))!.status;
  if (s.open === 0 && ['arrived', 'onboarding'].includes(now)) {
    await advanceCandidate(q, req, candidateId, 'awaiting_clearance', ['arrived', 'onboarding'], 'All mandatory onboarding activities completed');
  } else if (s.open > 0 && now === 'awaiting_clearance') {
    await advanceCandidate(q, req, candidateId, 'onboarding', ['awaiting_clearance'], 'A mandatory onboarding activity was reopened');
  }
}

export { OPEN_STATUSES };
