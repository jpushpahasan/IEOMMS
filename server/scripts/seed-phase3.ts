// Phase 3 demo data: department managers, training templates, a trade template, checklists and realistic progress.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.ts';
import { db, type Q } from '../db/index.ts';
import { generateChecklist, resync, addDays, uaeToday } from '../lib/onboarding.ts';
import { recordDocument } from '../modules/documents.ts';

async function demoDoc(q: Q, req: any, cid: number, category: string, title: string) {
  const buf = Buffer.from(`%PDF-1.4\n% IEOMMS demonstration document: ${title}\n%%EOF\n`);
  const stored = `${crypto.randomUUID()}.pdf`;
  fs.mkdirSync(config.uploadDir, { recursive: true });
  fs.writeFileSync(path.join(config.uploadDir, stored), buf);
  const d = await recordDocument(q, req, cid, { stored, mime: 'application/pdf', ext: '.pdf', original: `${title.replace(/\W+/g, '_')}.pdf`, size: buf.length,
    hash: crypto.createHash('sha256').update(buf).digest('hex') }, { category, title });
  return d.id as number;
}

export async function seedPhase3(userIds: Record<string, number>) {
  const req = { user: { id: userIds['hr.manager'], username: 'hr.manager', permissions: [] }, ip: '127.0.0.1' } as any;
  const mgr: Record<string, string> = { REC: 'recruiter', HR: 'hr.manager', MOB: 'mobility', PRO: 'pro', MED: 'medical', TRN: 'training', ACC: 'accommodation', ADM: 'training', OPS: 'operations', FIN: 'finance' };
  for (const [code, u] of Object.entries(mgr)) await db.query('UPDATE departments SET manager_user_id = $2 WHERE code = $1', [code, userIds[u]]);

  // Training templates per trade (+ client-specific course for the oil & gas project)
  const course = async (code: string) => (await db.one('SELECT id FROM training_courses WHERE code = $1', [code]))!.id;
  const trade = async (code: string) => (await db.one('SELECT id FROM trades WHERE code = $1', [code]))!.id;
  const common = ['HSE-IND', 'MOHRE-AW', 'CO-RULES', 'EMERG'];
  const plan: Record<string, [string, boolean][]> = {
    DRV: [['DEF-DRV', false], ['VEH-SAFE', false]], SCF: [['SCAF-SAFE', false], ['SCAF-COMP', true]], RIG: [['RIG-LIFT', false], ['RIG-COMP', true]],
    HLP: [], ELT: [['ELEC-LOTO', false]], MCT: [['MECH-SAFE', false]], WLD: [['WELD-HOT', false], ['WELD-TEST', true]],
    NRS: [['NURSE-BLS', true], ['NURSE-DHA', true]], HSE: [],
  };
  for (const [t, extra] of Object.entries(plan)) {
    const tid = await trade(t);
    for (const c of common) await db.query('INSERT INTO trade_training_requirements(trade_id, course_id, requires_assessment) VALUES ($1,$2,$3)', [tid, await course(c), c === 'HSE-IND']);
    for (const [c, assess] of extra) await db.query('INSERT INTO trade_training_requirements(trade_id, course_id, requires_assessment) VALUES ($1,$2,$3)', [tid, await course(c), assess]);
  }
  const ruw = (await db.one(`SELECT id FROM projects WHERE code = 'RUW-24'`))!.id;
  await db.query('INSERT INTO project_training_requirements(project_id, course_id, requires_assessment) VALUES ($1,$2,TRUE)', [ruw, await course('CLIENT-ADNOC')]);

  // Trade template: nurses get a uniform but no safety shoes / PPE; hospital induction is mandatory earlier.
  const tpl = (await db.one(`INSERT INTO onboarding_templates(name, trade_id, description) VALUES ('Nursing staff', $1, 'Clinical staff: no safety shoes or site PPE; hospital induction within 7 days.') RETURNING id`, [await trade('NRS')]))!.id;
  for (const [seq, applicable, offset] of [[36, false, null], [37, false, null], [46, true, 7]] as [number, boolean, number | null][]) {
    await db.query(`INSERT INTO onboarding_template_items(template_id, definition_id, is_applicable, offset_days) SELECT $1, id, $2, $3 FROM onboarding_activity_definitions WHERE seq = $4`, [tpl, applicable, offset, seq]);
  }

  // Keep the not-yet-travelled demo pipeline current: recent selections and joining dates in the future.
  const pre = await db.many(`SELECT c.id FROM candidates c WHERE c.status IN ('selected','pre_arrival','on_hold')
    AND NOT EXISTS (SELECT 1 FROM flight_bookings b WHERE b.candidate_id = c.id AND b.status IN ('ticket_issued','travel_completed')) ORDER BY c.id`);
  for (const [i, c] of pre.entries()) {
    const sel = addDays(uaeToday(), -(4 + ((i * 7) % 50)));
    await db.query(`UPDATE candidates SET selection_date = $2, expected_joining_date = $3::date WHERE id = $1`, [c.id, sel, addDays(sel, 35 + ((i * 11) % 40))]);
    await db.query(`UPDATE candidate_status_history SET changed_at = $2::date + (CASE to_status WHEN 'selected' THEN 0 WHEN 'pre_arrival' THEN 2 ELSE 3 END) * interval '1 day' + interval '10 hours'
      WHERE candidate_id = $1`, [c.id, sel]);
  }
  await db.query(`UPDATE flight_bookings b SET preferred_travel_date = c.expected_joining_date FROM candidates c
    WHERE c.id = b.candidate_id AND b.status IN ('pending_booking','quotation_received','approval_pending','approved','ticket_booked') AND c.expected_joining_date > b.preferred_travel_date`);

  // Checklists for every live candidate
  const cands = await db.many(`SELECT id, status FROM candidates WHERE status <> 'cancelled' ORDER BY id`);
  for (const c of cands) await db.tx((q) => generateChecklist(q, req, c.id));

  // Pre-arrival progress: personal info verified for everyone in pre-arrival or later
  await db.query(`UPDATE onboarding_activities a SET status = 'completed', actual_completion_date = c.selection_date + 4, completed_by = $1,
      submitted_by = $2, submitted_at = now(), verified_by = $1, verified_at = now()
    FROM candidates c WHERE c.id = a.candidate_id AND a.seq = 2 AND c.status NOT IN ('selected','cancelled')`, [userIds['hr.manager'], userIds.recruiter]);

  // Post-arrival progress for people already in the UAE, proportional to days since arrival
  const arrived = await db.many(`SELECT c.id, c.trade_id, c.project_id, c.selection_date,
      (SELECT (ap.actual_pickup_at)::date FROM airport_pickups ap WHERE ap.candidate_id = c.id AND ap.status = 'completed' LIMIT 1) AS arr
    FROM candidates c WHERE c.status IN ('arrived','onboarding') ORDER BY c.id`);
  const today = uaeToday();
  for (const c of arrived) {
    const arr = String(c.arr || today);
    const days = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${arr}T00:00:00Z`).getTime()) / 864e5);
    const on = (n: number) => addDays(arr, Math.min(n, days));
    await db.tx(async (q) => {
      const manual = async (seqs: number[], at: number) => {
        await q.query(`UPDATE onboarding_activities SET status = 'completed', actual_completion_date = $3, completed_by = $4,
            submitted_by = CASE WHEN requires_verification THEN $5::int END, submitted_at = CASE WHEN requires_verification THEN now() END,
            verified_by = CASE WHEN requires_verification THEN $4::int END, verified_at = CASE WHEN requires_verification THEN now() END
          WHERE candidate_id = $1 AND seq = ANY($2::int[]) AND status NOT IN ('completed','not_applicable')`, [c.id, seqs, on(at), userIds['hr.manager'], userIds.recruiter]);
      };
      if (days >= 1) {
        await manual([14, 15], 1);
        await q.query(`INSERT INTO reference_counters(key, year, last_value) VALUES ('employee', 0, 1) ON CONFLICT (key, year) DO UPDATE SET last_value = reference_counters.last_value + 1`);
        const n = (await q.query(`SELECT last_value FROM reference_counters WHERE key = 'employee' AND year = 0`)).rows[0].last_value;
        await q.query('INSERT INTO employees(employee_no, candidate_id, joining_date, created_by) VALUES ($1,$2,$3,$4)', [`EMP-${String(n).padStart(5, '0')}`, c.id, arr, userIds['hr.manager']]);
        await q.query(`INSERT INTO uniform_measurements(candidate_id, shirt_size, trouser_size, coverall_size, shoe_size, measured_date, measured_by) VALUES ($1,'L','32','L','42',$2,$3)`, [c.id, on(1), userIds.training]);
        await q.query(`INSERT INTO visa_records(candidate_id, work_permit_no, entry_permit_no, entry_permit_applied_date, entry_permit_issue_date, entry_permit_expiry_date, created_by)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`, [c.id, `WP${100000 + c.id * 7}`, `EP-${201 + c.id}-${2026}-${3000 + c.id}`, addDays(arr, -30), addDays(arr, -21), addDays(arr, 39), userIds.pro]);
        await demoDoc(q, req, c.id, 'work_permit', 'Entry permit');
      }
      if (days >= 3) {
        const cert = await demoDoc(q, req, c.id, 'visa_medical', 'Visa medical fitness certificate');
        await q.query(`INSERT INTO visa_medical_records(candidate_id, medical_centre, application_no, appointment_at, attended_date, result, result_date, certificate_document_id, verified_by, verified_at, created_by)
          VALUES ($1,'Al Karama Medical Fitness Centre',$2,$3,$4,'fit',$5,$6,$7,now(),$7)`, [c.id, `MF-${880000 + c.id}`, `${on(2)} 09:30`, on(2), on(3), cert, userIds.medical]);
        await q.query(`INSERT INTO occupational_medical_records(candidate_id, clinic, appointment_at, exam_date, tests_performed, created_by)
          VALUES ($1,'Prime Occupational Health Clinic',$2,$3,'Audiometry, spirometry, vision, ECG, blood panel',$4)`, [c.id, `${on(3)} 08:00`, on(3), userIds.medical]);
        await q.query(`UPDATE training_records tr SET status = 'passed', completed_date = $2, score = CASE WHEN tr.requires_assessment THEN 86 END, trainer = 'In-house HSE team'
          FROM training_courses tc WHERE tc.id = tr.course_id AND tr.candidate_id = $1 AND tc.category IN ('hse','company_rules')`, [c.id, on(2)]);
        const items = await q.query(`SELECT id, category, default_qty FROM uniform_items WHERE category IN ('uniform','safety_shoes','ppe')`);
        for (const it of items.rows) {
          await q.query(`INSERT INTO uniform_issues(candidate_id, item_id, size, quantity, issue_date, issued_by, acknowledged, acknowledged_date) VALUES ($1,$2,$3,$4,$5,$6,TRUE,$5)`,
            [c.id, it.id, it.category === 'safety_shoes' ? '42' : it.category === 'uniform' ? 'L' : null, it.default_qty, on(3), userIds.training]);
        }
        await manual([40, 41, 42], 2);
      }
      if (days >= 6) {
        const rep = await demoDoc(q, req, c.id, 'occupational_medical', 'Occupational medical fitness report');
        await q.query(`UPDATE occupational_medical_records SET fitness = 'fit', report_date = $2, report_document_id = $3, next_review_date = $4 WHERE candidate_id = $1 AND is_current`,
          [c.id, on(5), rep, addDays(arr, 365)]);
        await q.query(`UPDATE visa_records SET insurance_provider = 'Daman National Health Insurance', insurance_applied_date = $2, insurance_policy_no = $3,
            insurance_card_no = $4, insurance_issue_date = $2, insurance_expiry_date = $5 WHERE candidate_id = $1`, [c.id, on(4), `POL-${330000 + c.id}`, `HIC-${440000 + c.id}`, addDays(arr, 365)]);
        await demoDoc(q, req, c.id, 'health_insurance', 'Health insurance card');
        await q.query(`UPDATE visa_records SET residence_application_no = $2, residence_application_date = $3, residence_status = 'applied',
            eid_application_no = $4, eid_biometrics_date = $5 WHERE candidate_id = $1`, [c.id, `RV-${770000 + c.id}`, on(5), `EIDA-${550000 + c.id}`, on(6)]);
        const mo = await demoDoc(q, req, c.id, 'mohre_training', 'MOHRE awareness training record');
        await q.query(`UPDATE training_records tr SET status = 'passed', completed_date = $2, certificate_document_id = $3, trainer = 'MOHRE accredited trainer'
          FROM training_courses tc WHERE tc.id = tr.course_id AND tr.candidate_id = $1 AND tc.category = 'mohre'`, [c.id, on(5), mo]);
        await manual([43, 44], 4);
      }
      if (days >= 12) {
        await q.query(`UPDATE training_records tr SET status = 'passed', completed_date = $2, score = CASE WHEN tr.requires_assessment THEN 78 END, trainer = 'Technical training centre'
          FROM training_courses tc WHERE tc.id = tr.course_id AND tr.candidate_id = $1 AND tc.category IN ('technical','emergency')`, [c.id, on(9)]);
        const idc = (await q.query(`SELECT id FROM uniform_items WHERE category = 'id_card' LIMIT 1`)).rows[0].id;
        await manual([38], 6);
        await q.query(`INSERT INTO uniform_issues(candidate_id, item_id, quantity, issue_date, issued_by, acknowledged, acknowledged_date) VALUES ($1,$2,1,$3,$4,TRUE,$3)`, [c.id, idc, on(8), userIds.training]);
        await manual([45], 5);
      }
      await resync(q, req, c.id);
    });
  }
}
