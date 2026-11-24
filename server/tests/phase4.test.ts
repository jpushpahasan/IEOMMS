// Phase 4 integration tests: finance, ticket cost sync, document repository, notifications, clearance, deployment, approvals.
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { db, login, pdf, validCandidate } from './harness.ts';

const status = async (id: number) => (await db.one('SELECT status FROM candidates WHERE id = $1', [id]))!.status;
const act = async (cid: number, key: string) => (await db.one('SELECT * FROM onboarding_activities WHERE candidate_id = $1 AND workflow_key = $2', [cid, key]))!;
const onboardingCandidate = async (offset = 0) => (await db.one(`SELECT id FROM candidates WHERE status = 'onboarding' ORDER BY id OFFSET $1 LIMIT 1`, [offset]))!.id;

/** Completes every mandatory activity except the clearance & deployment ones, as if the departments had done their work. */
async function finishOnboarding(cid: number) {
  await db.query(`UPDATE onboarding_activities SET status = 'completed', actual_completion_date = coalesce(actual_completion_date, '2026-11-20'), auto_completed = FALSE
    WHERE candidate_id = $1 AND status <> 'not_applicable' AND (workflow_key IS NULL OR workflow_key NOT IN ('clearance','deployment_approval','deployed'))`, [cid]);
  await db.query(`UPDATE candidates SET status = 'awaiting_clearance' WHERE id = $1`, [cid]);
}

describe('financial tracking', () => {
  test('record, verify by another finance user, lock, and summarise', async () => {
    const fin = await login('finance');
    const admin = await login('admin', 'Admin@2026x');
    const cid = (await (await login('hr.manager')).req('POST', '/api/candidates', validCandidate())).body.id; // fresh employee: no seeded costs
    assert.equal((await fin.req('POST', '/api/finance/expenses', { candidate_id: cid, category: 'recruitment_fee', payment_status: 'paid' })).status, 400); // no amount, no date
    const fd = new FormData();
    for (const [k, v] of Object.entries({ candidate_id: String(cid), category: 'recruitment_fee', estimated_cost: '1500', actual_cost: '1650.50', supplier: 'Agency X', invoice_no: 'INV-77' })) fd.append(k, v);
    fd.append('file', new Blob([pdf()]), 'invoice.pdf');
    const e = await fin.req('POST', '/api/finance/expenses', undefined, fd);
    assert.equal(e.status, 201, JSON.stringify(e.body));
    assert.ok(e.body.invoice_document_id);
    assert.equal((await fin.req('POST', `/api/finance/expenses/${e.body.id}/verify`, { decision: 'verify' })).status, 403); // own entry
    assert.equal((await admin.req('POST', `/api/finance/expenses/${e.body.id}/verify`, { decision: 'verify' })).status, 200);
    assert.equal((await fin.req('PUT', `/api/finance/expenses/${e.body.id}`, { actual_cost: '999' })).status, 400); // locked
    assert.equal((await fin.req('PUT', `/api/finance/expenses/${e.body.id}`, { payment_status: 'paid' })).status, 400); // date needed
    assert.equal((await fin.req('PUT', `/api/finance/expenses/${e.body.id}`, { payment_status: 'paid', payment_date: '2026-11-21' })).status, 200);
    const s = (await fin.req('GET', `/api/finance/summary?candidate_id=${cid}`)).body;
    assert.equal(s.totals.estimated, '1500.00');
    assert.equal(s.totals.actual, '1650.50');
    assert.equal(s.totals.variance, '150.50');
    assert.equal(s.totals.variance_pct, 10);
    assert.ok(s.byProject.length && s.byAgency.length && s.byNationality.length);
    assert.equal((await (await login('mobility')).req('GET', '/api/finance/summary')).status, 403);
    const hist = (await fin.req('GET', `/api/approvals/history?candidate_id=${cid}&type=expense_verification`)).body;
    assert.equal(hist[0].decision, 'approved');
  });

  test('issuing a ticket records its cost automatically; cancelling zeroes it', async () => {
    const mob = await login('mobility');
    const b = await db.one(`SELECT id, candidate_id, ticket_cost FROM flight_bookings WHERE status = 'ticket_booked' LIMIT 1`);
    const fd = new FormData();
    fd.append('flight_number', 'EK 501'); fd.append('departure_at', '2026-12-28T03:00'); fd.append('arrival_at', '2026-12-28T06:00');
    fd.append('file', new Blob([pdf()]), 'e.pdf');
    assert.equal((await mob.req('POST', `/api/bookings/${b!.id}/issue`, undefined, fd)).status, 200);
    let ex = await db.one(`SELECT * FROM mobilisation_expenses WHERE source = 'flight_booking' AND source_id = $1`, [b!.id]);
    assert.equal(ex!.actual_cost, b!.ticket_cost);
    assert.equal(ex!.category, 'flight_ticket');
    assert.equal((await mob.req('POST', `/api/bookings/${b!.id}/cancel`, { reason: 'Change of plan' })).status, 200);
    ex = await db.one(`SELECT * FROM mobilisation_expenses WHERE source = 'flight_booking' AND source_id = $1`, [b!.id]);
    assert.equal(ex!.actual_cost, '0.00');
  });
});

describe('document repository', () => {
  test('repository search and expiry alerts respect permissions', async () => {
    const hr = await login('hr.manager');
    const r = (await hr.req('GET', '/api/documents?category=visa_medical')).body;
    assert.ok(r.total > 0 && r.rows.every((d: any) => d.category === 'visa_medical'));
    const exp = (await hr.req('GET', '/api/documents/expiring')).body;
    assert.ok(Array.isArray(exp.passports) && exp.passports.length > 0); // demo has passports expiring within 6 months
    assert.equal((await (await login('accommodation')).req('GET', '/api/documents')).status, 403);
  });
});

describe('notifications', () => {
  test('conditions raise notifications for the right people and resolve when fixed', async () => {
    const mob = await login('mobility');
    await mob.req('POST', '/api/notifications/refresh');
    const list = (await mob.req('GET', '/api/notifications')).body.rows;
    const pickup = list.find((n: any) => n.type === 'pickup_unassigned');
    assert.ok(pickup, 'mobility is told about the unassigned pickup');
    assert.equal(pickup.severity, 'critical');
    // Not sent to unrelated departments
    const med = await login('medical');
    assert.ok(!(await med.req('GET', '/api/notifications')).body.rows.some((n: any) => n.type === 'pickup_unassigned'));
    // Fix the condition → resolved on the next run
    const p = await db.one(`SELECT id FROM airport_pickups WHERE status = 'pending' LIMIT 1`);
    const v = await db.one('SELECT id FROM vehicles LIMIT 1');
    const uid = (await db.one(`SELECT id FROM users WHERE username = 'mobility'`))!.id;
    await db.query(`UPDATE airport_pickups SET status = 'assigned', vehicle_id = $2, driver_name = 'X', driver_phone = '+971500000000', coordinator_id = $3 WHERE id = $1 OR status = 'pending'`, [p!.id, v!.id, uid]);
    await mob.req('POST', '/api/notifications/refresh');
    assert.ok(!(await mob.req('GET', '/api/notifications')).body.rows.some((n: any) => n.type === 'pickup_unassigned'));
    // Activity reminders reach the responsible person; marking read clears the badge
    const pro = await login('pro');
    const n = (await pro.req('GET', '/api/notifications')).body.rows;
    assert.ok(n.some((x: any) => ['activity_overdue', 'activity_reminder'].includes(x.type)));
    await pro.req('POST', '/api/notifications/read', {});
    assert.equal((await pro.req('GET', '/api/notifications/count')).body.unread, 0);
  });

  test('e-mail copies are queued (and held without SMTP) when enabled', async () => {
    const admin = await login('admin', 'Admin@2026x');
    assert.equal((await admin.req('PUT', '/api/admin/settings', { email_notifications: true, reminder_days_before: '5, 2' })).status, 200);
    await db.query(`UPDATE notifications SET emailed_at = NULL`);
    await admin.req('POST', '/api/notifications/refresh');
    const ob = (await admin.req('GET', '/api/admin/outbox')).body;
    assert.ok(ob.rows.length > 0);
    assert.ok(ob.rows.every((r: any) => r.status === 'held'));
    assert.equal((await admin.req('PUT', '/api/admin/settings', { reminder_days_before: '0' })).status, 400);
    await admin.req('PUT', '/api/admin/settings', { email_notifications: false, reminder_days_before: '3,1' });
  });
});

describe('final clearance and deployment', () => {
  test('clearance requires every check; deployment needs a separate approval and reporting confirmation', async () => {
    const hr = await login('hr.manager');
    const ops = await login('operations');
    const cid = await onboardingCandidate(1);
    // Not awaiting clearance yet
    assert.equal((await hr.req('POST', `/api/clearance/${cid}/decide`, { decision: 'approve' })).status, 400);
    await finishOnboarding(cid);
    // One open mandatory activity blocks approval and is named in the error
    await db.query(`UPDATE onboarding_activities SET status = 'in_progress', actual_completion_date = NULL WHERE candidate_id = $1 AND seq = 45`, [cid]);
    const blocked = await hr.req('POST', `/api/clearance/${cid}/decide`, { decision: 'approve' });
    assert.equal(blocked.status, 400);
    assert.match(blocked.body.error, /site induction/i);
    await db.query(`UPDATE onboarding_activities SET status = 'completed', actual_completion_date = '2026-11-20' WHERE candidate_id = $1 AND seq = 45`, [cid]);
    const ev = (await hr.req('GET', `/api/clearance/${cid}`)).body;
    assert.equal(ev.ready, true);
    assert.equal(ev.checks.length, 10);
    // Inbox shows the clearance; operations cannot approve it
    assert.ok((await hr.req('GET', '/api/approvals/inbox')).body.clearances.some((c: any) => c.candidate_id === cid));
    assert.equal((await ops.req('POST', `/api/clearance/${cid}/decide`, { decision: 'approve' })).status, 403);
    assert.equal((await hr.req('POST', `/api/clearance/${cid}/decide`, { decision: 'approve' })).status, 200);
    assert.equal(await status(cid), 'ready_for_deployment');
    assert.equal((await act(cid, 'clearance')).status, 'completed');
    // Operations is notified
    await ops.req('POST', '/api/notifications/refresh');
    assert.ok((await ops.req('GET', '/api/notifications')).body.rows.some((n: any) => n.type === 'ready_for_deployment' && n.candidate_id === cid));
    // Deployment: request → approve (by someone else) → confirm reporting
    const dep = await ops.req('POST', '/api/deployments', { candidate_id: cid, site: 'Ruwais Unit 4', supervisor_name: 'Eng. Saleh', planned_reporting_date: '2026-11-25' });
    assert.equal(dep.status, 201, JSON.stringify(dep.body));
    assert.equal((await ops.req('POST', '/api/deployments', { candidate_id: cid, site: 'X', supervisor_name: 'Y', planned_reporting_date: '2026-11-25' })).status, 409);
    assert.equal((await ops.req('POST', `/api/deployments/${dep.body.id}/confirm`, { actual_reporting_date: '2026-11-23' })).status, 400); // not approved
    assert.equal((await ops.req('POST', `/api/deployments/${dep.body.id}/decide`, { decision: 'approve' })).status, 403);
    assert.equal((await hr.req('POST', `/api/deployments/${dep.body.id}/decide`, { decision: 'approve' })).status, 200);
    assert.equal(await status(cid), 'ready_for_deployment'); // approval alone does not deploy
    assert.equal((await ops.req('POST', `/api/deployments/${dep.body.id}/confirm`, { actual_reporting_date: '2099-01-01' })).status, 400);
    const today = new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10);
    assert.equal((await ops.req('POST', `/api/deployments/${dep.body.id}/confirm`, { actual_reporting_date: today })).status, 200);
    assert.equal(await status(cid), 'deployed');
    assert.equal((await act(cid, 'deployed')).status, 'completed');
    const hist = (await hr.req('GET', `/api/clearance/${cid}`)).body.history;
    assert.deepEqual(hist.map((h: any) => h.approval_type).sort(), ['deployment', 'final_clearance']);
  });

  test('a deployment requester cannot approve their own request (rule 13)', async () => {
    const hr = await login('hr.manager');
    const cid = await onboardingCandidate(0);
    await finishOnboarding(cid);
    assert.equal((await hr.req('POST', `/api/clearance/${cid}/decide`, { decision: 'approve' })).status, 200);
    await db.query(`INSERT INTO role_permissions(role_id, permission_id) SELECT r.id, p.id FROM roles r, permissions p WHERE r.code = 'hr_manager' AND p.code = 'deployment.manage' ON CONFLICT DO NOTHING`);
    const dep = await hr.req('POST', '/api/deployments', { candidate_id: cid, site: 'Tower C', supervisor_name: 'Site Eng.', planned_reporting_date: '2026-11-26' });
    assert.equal(dep.status, 201);
    const own = await hr.req('POST', `/api/deployments/${dep.body.id}/decide`, { decision: 'approve' });
    assert.equal(own.status, 403);
    assert.ok(!(await hr.req('GET', '/api/approvals/inbox')).body.deployments.some((d: any) => d.id === dep.body.id));
    assert.equal((await (await login('admin', 'Admin@2026x')).req('POST', `/api/deployments/${dep.body.id}/decide`, { decision: 'reject', remarks: 'Site not ready' })).status, 200);
    assert.equal((await db.one('SELECT status FROM deployments WHERE id = $1', [dep.body.id]))!.status, 'rejected');
  });
});
