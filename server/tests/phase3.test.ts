// Phase 3 integration tests: checklist generation, templates, manual + verified activities, workflow sync,
// medical / visa / training / uniform rules, lifecycle to Awaiting Final Clearance, departmental views.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, login, pdf, validCandidate, type Client } from './harness.ts';

const act = async (cid: number, seq: number) => (await db.one('SELECT * FROM onboarding_activities WHERE candidate_id = $1 AND seq = $2', [cid, seq]))!;
const tradeId = async (code: string) => (await db.one('SELECT id FROM trades WHERE code = $1', [code]))!.id;
const projectId = async (code: string) => (await db.one('SELECT id FROM projects WHERE code = $1', [code]))!.id;
async function newCandidate(hr: Client, over: Record<string, unknown> = {}) {
  const r = await hr.req('POST', '/api/candidates', validCandidate(over));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body.id as number;
}
const upload = (c: Client, url: string, fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append('file', new Blob([pdf()]), 'doc.pdf');
  return c.req(url.startsWith('PUT ') ? 'PUT' : 'POST', `/api${url.replace(/^PUT /, '')}`, undefined, fd);
};
/** An arrived demo candidate (seeded through the full travel workflow). */
const arrivedCandidate = async (offset = 0) => (await db.one(`SELECT id FROM candidates WHERE status IN ('arrived','onboarding') ORDER BY id OFFSET $1 LIMIT 1`, [offset]))!.id;

describe('checklist generation', () => {
  test('every new candidate gets the 49-activity checklist with template and training rules applied', async () => {
    const hr = await login('hr.manager');
    const helper = await newCandidate(hr, { trade_id: await tradeId('HLP'), project_id: await projectId('CRK-11'), position: 'Helper' });
    const rows = await db.many('SELECT seq, status, responsible_user_id FROM onboarding_activities WHERE candidate_id = $1 ORDER BY seq', [helper]);
    assert.equal(rows.length, 49);
    assert.ok(rows.every((r) => r.responsible_user_id), 'every activity has a responsible person');
    assert.equal(rows.find((r) => r.seq === 1)!.status, 'completed');
    // Helpers have no trade technical / competency course and this project has no client course → not applicable
    for (const s of [26, 27, 32]) assert.equal(rows.find((r) => r.seq === s)!.status, 'not_applicable', `activity ${s}`);
    assert.equal(rows.find((r) => r.seq === 28)!.status, 'not_started');

    const nurse = await newCandidate(hr, { trade_id: await tradeId('NRS'), project_id: await projectId('DHA-07'), position: 'Staff Nurse', gender: 'female', full_name: 'Test Nurse' });
    assert.equal((await act(nurse, 36)).status, 'not_applicable'); // Nursing template: no safety shoes
    assert.equal((await act(nurse, 26)).status, 'not_started');   // BLS is a technical course for nurses
    const scaf = await newCandidate(hr, { project_id: await projectId('RUW-24') });
    assert.equal((await act(scaf, 32)).status, 'not_started');    // client course on the oil & gas project
    const tr = await db.many('SELECT tc.code FROM training_records tr JOIN training_courses tc ON tc.id = tr.course_id WHERE tr.candidate_id = $1 ORDER BY 1', [scaf]);
    assert.ok(tr.some((r) => r.code === 'SCAF-COMP') && tr.some((r) => r.code === 'CLIENT-ADNOC'));
  });
});

describe('activity rules', () => {
  test('department ownership, required documents, and verification by someone else', async () => {
    const hr = await login('hr.manager');
    const rec = await login('recruiter');
    const admin = await login('admin', 'Admin@2026x');
    const cid = await newCandidate(hr);
    const a2 = await act(cid, 2);
    // Activity 2 belongs to HR: the recruiter is not in HR and not responsible
    assert.equal((await rec.req('POST', `/api/onboarding/activities/${a2.id}/complete`, { actual_completion_date: '2026-11-01' })).status, 403);
    const sub = await hr.req('POST', `/api/onboarding/activities/${a2.id}/complete`, { actual_completion_date: '2026-11-01' });
    assert.equal(sub.body.status, 'awaiting_approval');
    assert.equal((await hr.req('POST', `/api/onboarding/activities/${a2.id}/verify`, { decision: 'approve' })).status, 403); // own submission
    assert.equal((await admin.req('POST', `/api/onboarding/activities/${a2.id}/verify`, { decision: 'reject' })).status, 400); // reason needed
    assert.equal((await admin.req('POST', `/api/onboarding/activities/${a2.id}/verify`, { decision: 'approve' })).status, 200);
    const done = await act(cid, 2);
    assert.equal(done.status, 'completed');
    assert.equal(done.actual_completion_date, '2026-11-01');
    assert.equal(done.verified_by, (await db.one("SELECT id FROM users WHERE username = 'admin'"))!.id);

    // Passport verification (3, PRO) needs the supporting document first
    const pro = await login('pro');
    const a3 = await act(cid, 3);
    assert.equal((await pro.req('POST', `/api/onboarding/activities/${a3.id}/complete`, { actual_completion_date: '2026-11-02' })).status, 400);
    assert.equal((await upload(pro, `/onboarding/activities/${a3.id}/document`, {})).status, 201);
    assert.equal((await pro.req('POST', `/api/onboarding/activities/${a3.id}/complete`, { actual_completion_date: '2026-11-02' })).body.status, 'awaiting_approval');
    assert.equal((await db.one(`SELECT category FROM employee_documents WHERE id = $1`, [(await act(cid, 3)).document_id]))!.category, 'passport');

    // Workflow-linked activities cannot be completed by hand; future dates are refused
    const mob = await login('mobility');
    assert.equal((await mob.req('POST', `/api/onboarding/activities/${(await act(cid, 8)).id}/complete`, { actual_completion_date: '2026-11-02' })).status, 400);
    assert.equal((await hr.req('POST', `/api/onboarding/activities/${(await act(cid, 14)).id}/complete`, { actual_completion_date: '2099-01-01' })).status, 400);
    // Not applicable needs a reason and verifier rights
    const a7 = await act(cid, 7);
    assert.equal((await pro.req('POST', `/api/onboarding/activities/${a7.id}/not-applicable`, { reason: 'GCC national' })).status, 403);
    assert.equal((await hr.req('POST', `/api/onboarding/activities/${a7.id}/not-applicable`, {})).status, 400);
    assert.equal((await hr.req('POST', `/api/onboarding/activities/${a7.id}/not-applicable`, { reason: 'Already holds a UAE visa' })).status, 200);
  });

  test('candidate record changes complete offer / contract activities; contract signing waits for the contract', async () => {
    const hr = await login('hr.manager');
    const cid = await newCandidate(hr);
    await hr.req('PUT', `/api/candidates/${cid}`, { offer_letter_status: 'accepted', contract_status: 'signed' });
    assert.equal((await act(cid, 4)).status, 'completed');
    assert.equal((await act(cid, 5)).status, 'completed');
    assert.equal((await act(cid, 6)).status, 'awaiting_documents');
    const fd = new FormData(); fd.append('category', 'employment_contract'); fd.append('file', new Blob([pdf()]), 'contract.pdf');
    assert.equal((await hr.req('POST', `/api/candidates/${cid}/documents`, undefined, fd)).status, 201);
    assert.equal((await act(cid, 6)).status, 'completed');
    // Changing the contract back reopens the auto-completed activity
    await hr.req('PUT', `/api/candidates/${cid}`, { contract_status: 'sent' });
    assert.equal((await act(cid, 6)).status, 'in_progress');
  });
});

describe('medical, visa, training, uniform', () => {
  test('visa medical and occupational medical are separate; fit result needs certificate and verification', async () => {
    const med = await login('medical');
    const cid = await arrivedCandidate(0);
    await db.query('DELETE FROM visa_medical_records WHERE candidate_id = $1', [cid]);
    await db.query('DELETE FROM occupational_medical_records WHERE candidate_id = $1', [cid]);
    await db.query(`UPDATE onboarding_activities SET status = 'not_started', actual_completion_date = NULL, auto_completed = FALSE WHERE candidate_id = $1 AND seq IN (17, 18, 20, 21)`, [cid]);
    const vm = await med.req('POST', '/api/medical/visa', { candidate_id: cid, medical_centre: 'Test Centre', attended_date: '2026-11-15' });
    assert.equal(vm.status, 201, JSON.stringify(vm.body));
    assert.equal((await act(cid, 17)).status, 'completed');
    assert.equal((await med.req('PUT', `/api/medical/visa/${vm.body.id}`, { result: 'fit' })).status, 400); // result date required
    assert.equal((await med.req('PUT', `/api/medical/visa/${vm.body.id}`, { result: 'fit', result_date: '2026-11-17' })).status, 200);
    assert.equal((await med.req('POST', `/api/medical/visa/${vm.body.id}/verify`)).status, 400); // certificate missing
    assert.equal((await upload(med, `PUT /medical/visa/${vm.body.id}`, {})).status, 200);
    assert.equal((await med.req('POST', `/api/medical/visa/${vm.body.id}/verify`)).status, 200);
    assert.equal((await act(cid, 18)).status, 'completed');
    assert.equal((await act(cid, 20)).status, 'not_started'); // occupational is a different process
    assert.equal((await med.req('POST', '/api/medical/occupational', { candidate_id: cid, clinic: 'OH Clinic', exam_date: '2026-11-16', fitness: 'fit_with_restrictions', report_date: '2026-11-18' })).status, 400); // restrictions required
    const om = await med.req('POST', '/api/medical/occupational', { candidate_id: cid, clinic: 'OH Clinic', exam_date: '2026-11-16' });
    assert.equal((await act(cid, 20)).status, 'completed');
    await upload(med, `PUT /medical/occupational/${om.body.id}`, { fitness: 'fit', report_date: '2026-11-18' });
    assert.equal((await act(cid, 21)).status, 'completed');
  });

  test('visa: Emirates ID format and verified only with the card copy', async () => {
    const pro = await login('pro');
    const cid = await arrivedCandidate(1);
    // Health insurance card (step 19) is required before the residence visa application.
    await db.query(`UPDATE visa_records SET residence_application_date = NULL, residence_application_no = NULL, residence_status = 'not_started',
      insurance_provider = NULL, insurance_applied_date = NULL, insurance_policy_no = NULL, insurance_card_no = NULL, insurance_issue_date = NULL, insurance_expiry_date = NULL
      WHERE candidate_id = $1`, [cid]);
    await db.query(`DELETE FROM employee_documents WHERE candidate_id = $1 AND category = 'health_insurance'`, [cid]);
    const gate = await pro.req('PUT', `/api/visa/${cid}`, { residence_application_date: '2026-11-10' });
    assert.equal(gate.status, 400);
    assert.match(gate.body.details.residence_application_date, /health insurance card/i);
    assert.equal((await pro.req('PUT', `/api/visa/${cid}`, { insurance_issue_date: '2026-11-08' })).status, 400); // card no., provider, expiry required
    const ins = await pro.req('PUT', `/api/visa/${cid}`, { insurance_provider: 'Daman', insurance_applied_date: '2026-11-07', insurance_policy_no: 'POL-1',
      insurance_card_no: 'HIC-1', insurance_issue_date: '2026-11-08', insurance_expiry_date: '2027-11-07' });
    assert.equal(ins.status, 200, JSON.stringify(ins.body));
    assert.equal((await act(cid, 19)).status, 'awaiting_documents'); // card copy not uploaded yet
    assert.equal((await upload(pro, `PUT /visa/${cid}`, { doc_category: 'health_insurance' })).status, 200);
    assert.equal((await act(cid, 19)).status, 'completed');
    assert.equal((await pro.req('PUT', `/api/visa/${cid}`, { eid_number: '784-12-1' })).status, 400);
    assert.equal((await pro.req('PUT', `/api/visa/${cid}`, { residence_status: 'issued', residence_application_date: '2026-11-10' })).status, 400); // dates required
    const ok = await pro.req('PUT', `/api/visa/${cid}`, { residence_application_date: '2026-11-10', residence_status: 'issued', residence_issue_date: '2026-11-20', residence_expiry_date: '2028-11-19', uid_no: '201234567' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal((await act(cid, 24)).status, 'awaiting_documents'); // visa copy not uploaded yet
    await upload(pro, `PUT /visa/${cid}`, { doc_category: 'residence_visa' });
    assert.equal((await act(cid, 24)).status, 'completed');
    await db.query(`DELETE FROM employee_documents WHERE candidate_id = $1 AND category = 'emirates_id'`, [cid]);
    assert.equal((await pro.req('PUT', `/api/visa/${cid}`, { eid_number: '784-1990-1234567-1', eid_biometrics_date: '2026-11-12', eid_collected_date: '2026-11-21', eid_verified: true })).status, 400);
    assert.equal((await upload(pro, `PUT /visa/${cid}`, { doc_category: 'emirates_id', eid_number: '784-1990-1234567-1', eid_biometrics_date: '2026-11-12', eid_collected_date: '2026-11-21', eid_verified: 'true' })).status, 200);
    assert.equal((await act(cid, 25)).status, 'completed');
  });

  test('training results drive activities; assessed courses need a pass with score; template changes reach active staff', async () => {
    const trn = await login('training');
    const hr = await login('hr.manager');
    const cid = await newCandidate(hr, { trade_id: await tradeId('HLP'), project_id: await projectId('CRK-11'), position: 'Helper' });
    const recs = await db.many('SELECT tr.id, tc.category, tr.requires_assessment FROM training_records tr JOIN training_courses tc ON tc.id = tr.course_id WHERE tr.candidate_id = $1', [cid]);
    const hse = recs.find((r) => r.category === 'hse')!;
    assert.equal((await trn.req('PUT', `/api/training/records/${hse.id}`, { status: 'attended', completed_date: '2026-11-10' })).status, 400); // assessment required
    assert.equal((await trn.req('PUT', `/api/training/records/${hse.id}`, { status: 'passed', completed_date: '2026-11-10' })).status, 400); // score required
    assert.equal((await trn.req('PUT', `/api/training/records/${hse.id}`, { status: 'passed', completed_date: '2026-11-10', score: '82' })).status, 200);
    assert.equal((await act(cid, 28)).status, 'completed');
    assert.equal((await act(cid, 33)).status, 'not_started'); // other mandatory courses still open
    const others = recs.filter((r) => r.id !== hse.id).map((r) => r.id);
    const bulk = await trn.req('POST', '/api/training/records/bulk', { ids: others, status: 'attended', completed_date: '2026-11-11' });
    assert.equal(bulk.body.updated, others.length, JSON.stringify(bulk.body));
    assert.equal((await act(cid, 29)).status, 'awaiting_documents'); // MOHRE record certificate needed
    assert.equal((await act(cid, 33)).status, 'completed');
    // Adding a technical course to the Helper template creates the record and reopens activity 25 for active helpers
    const tradeH = await tradeId('HLP');
    const current = (await trn.req('GET', '/api/training/requirements')).body.trades.filter((r: any) => r.trade_id === tradeH);
    const add = (await db.one(`SELECT id FROM training_courses WHERE code = 'MECH-SAFE'`))!.id;
    const put = await trn.req('PUT', `/api/training/requirements/trade/${tradeH}`, { courses: [...current.map((r: any) => ({ course_id: r.course_id, requires_assessment: r.requires_assessment })), { course_id: add }] });
    assert.equal(put.status, 200);
    assert.equal((await act(cid, 26)).status, 'not_started');
    assert.equal((await act(cid, 33)).status, 'in_progress'); // a new mandatory course reopens the overall result
  });

  test('uniform and PPE complete only when the employee acknowledges', async () => {
    const trn = await login('training');
    const cid = await arrivedCandidate(2);
    await db.query('DELETE FROM uniform_issues WHERE candidate_id = $1', [cid]);
    await db.query(`UPDATE onboarding_activities SET status = 'not_started', actual_completion_date = NULL, auto_completed = FALSE WHERE candidate_id = $1 AND seq BETWEEN 35 AND 37`, [cid]);
    const items = await db.many(`SELECT id, category FROM uniform_items WHERE category IN ('uniform','safety_shoes')`);
    await db.query('DELETE FROM uniform_measurements WHERE candidate_id = $1', [cid]);
    assert.equal((await trn.req('POST', '/api/uniform/issues', { candidate_id: cid, issue_date: '2026-11-15', items: items.map((i) => ({ item_id: i.id })) })).status, 400); // size unknown
    const r = await trn.req('POST', '/api/uniform/issues', { candidate_id: cid, issue_date: '2026-11-15', items: items.map((i) => ({ item_id: i.id, size: i.category === 'safety_shoes' ? '42' : 'L' })) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await act(cid, 35)).status, 'not_started');
    assert.equal((await trn.req('POST', '/api/uniform/acknowledge', { ids: r.body.ids.join(','), acknowledged_date: '2026-11-14' })).status, 400); // before issue
    assert.equal((await trn.req('POST', '/api/uniform/acknowledge', { ids: r.body.ids.join(','), acknowledged_date: '2026-11-16' })).status, 200);
    assert.equal((await act(cid, 35)).status, 'completed');
    assert.equal((await act(cid, 36)).status, 'completed');
    assert.equal((await act(cid, 37)).status, 'not_started'); // PPE not issued yet
  });
});

describe('lifecycle and departmental views', () => {
  test('completing the last mandatory activity moves the employee to Awaiting Final Clearance', async () => {
    const hr = await login('hr.manager');
    const cid = await arrivedCandidate(3);
    // Close everything except one manual HR activity (44 reporting structure belongs to OPS; use 43 HR)
    await db.query(`UPDATE onboarding_activities SET status = 'completed', actual_completion_date = '2026-11-20', auto_completed = FALSE
      WHERE candidate_id = $1 AND seq <> 44 AND (workflow_key IS NULL OR workflow_key NOT IN ('clearance','deployment_approval','deployed')) AND status <> 'not_applicable'`, [cid]);
    await db.query(`UPDATE onboarding_activities SET status = 'in_progress' WHERE candidate_id = $1 AND seq = 44`, [cid]);
    const a = await act(cid, 44);
    assert.equal((await hr.req('POST', `/api/onboarding/activities/${a.id}/complete`, { actual_completion_date: '2026-11-21' })).status, 200);
    assert.equal((await db.one('SELECT status FROM candidates WHERE id = $1', [cid]))!.status, 'awaiting_clearance');
    // Reopening it sends the employee back to Onboarding In Progress; clearance activities stay locked
    assert.equal((await hr.req('POST', `/api/onboarding/activities/${a.id}/reopen`, { reason: 'Signature missing' })).status, 200);
    assert.equal((await db.one('SELECT status FROM candidates WHERE id = $1', [cid]))!.status, 'onboarding');
    assert.equal((await hr.req('POST', `/api/onboarding/activities/${(await act(cid, 47)).id}/complete`, { actual_completion_date: '2026-11-21' })).status, 400);
  });

  test('HR registration issues an employee number once, after arrival', async () => {
    const hr = await login('hr.manager');
    const fresh = await newCandidate(hr);
    assert.equal((await hr.req('POST', '/api/employees', { candidate_id: fresh, joining_date: '2026-11-20' })).status, 400); // not arrived
    const target = await arrivedCandidate(1);
    await db.query('DELETE FROM employees WHERE candidate_id = $1', [target]);
    const list = (await hr.req('GET', '/api/employees')).body;
    assert.ok(list.pending.some((p: any) => p.id === target));
    const e = await hr.req('POST', '/api/employees', { candidate_id: target, joining_date: '2026-11-20' });
    assert.equal(e.status, 201, JSON.stringify(e.body));
    assert.match(e.body.employee_no, /^EMP-\d{5}$/);
    assert.equal((await hr.req('POST', '/api/employees', { candidate_id: target, joining_date: '2026-11-20' })).status, 409);
    assert.equal((await act(target, 16)).status, 'completed');
  });

  test('my tasks, verification queue, overview and department performance', async () => {
    const pro = await login('pro');
    const mine = (await pro.req('GET', '/api/onboarding/tasks?scope=mine')).body;
    assert.ok(mine.length > 0 && mine.every((t: any) => t.department_code === 'PRO' || t.responsible_name));
    const hr = await login('hr.manager');
    const queue = (await hr.req('GET', '/api/onboarding/tasks?scope=verification&status=awaiting_approval')).body;
    assert.ok(Array.isArray(queue));
    const ov = (await hr.req('GET', '/api/onboarding/overview')).body;
    assert.ok(ov.rows.length > 0 && ov.rows[0].sections);
    const perf = (await hr.req('GET', '/api/onboarding/performance')).body;
    assert.equal(perf.departments.length, 10);
    const dash = (await hr.req('GET', '/api/dashboard')).body;
    assert.ok(dash.onboarding.total > 0 && dash.onboarding.departments.length > 0);
  });
});
