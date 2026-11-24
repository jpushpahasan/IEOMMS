// Phase 4 demo data: mobilisation costs, and employees at awaiting clearance / ready for deployment / deployed.
import { db } from '../db/index.ts';
import { addDays, resync, uaeToday } from '../lib/onboarding.ts';
import { advanceCandidate } from '../lib/lifecycle.ts';
import { syncTicketExpense } from '../modules/finance.ts';

export async function seedPhase4(userIds: Record<string, number>) {
  const fin = { user: { id: userIds.finance, username: 'finance', permissions: [] }, ip: '127.0.0.1' } as any;
  const hr = { user: { id: userIds['hr.manager'], username: 'hr.manager', permissions: [] }, ip: '127.0.0.1' } as any;
  const today = uaeToday();

  // Ticket costs from issued bookings
  for (const b of await db.many(`SELECT id FROM flight_bookings WHERE status IN ('ticket_issued','travel_completed')`)) await db.tx((q) => syncTicketExpense(q, fin, b.id));

  // Recruitment agency fees (estimated for everyone recruited through an agency; invoiced once travel is confirmed)
  const cands = await db.many(`SELECT c.id, c.status, c.recruitment_agency_id, ra.name AS agency, c.selection_date FROM candidates c
    LEFT JOIN recruitment_agencies ra ON ra.id = c.recruitment_agency_id WHERE c.status <> 'cancelled' ORDER BY c.id`);
  const after = ['travel_confirmed', 'arrived', 'onboarding', 'awaiting_clearance', 'ready_for_deployment', 'deployed'];
  for (const [i, c] of cands.entries()) {
    if (!c.recruitment_agency_id) continue;
    const est = 1800 + (i % 5) * 300;
    const invoiced = after.includes(c.status);
    await db.query(`INSERT INTO mobilisation_expenses(candidate_id, category, description, estimated_cost, actual_cost, supplier, invoice_no, invoice_date, payment_status, payment_date,
        verification_status, verified_by, verified_at, created_by) VALUES ($1,'recruitment_fee','Placement fee',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [c.id, est, invoiced ? est + ((i % 3) - 1) * 150 : null, c.agency, invoiced ? `RA-${4100 + c.id}` : null, invoiced ? addDays(today, -10) : null,
      invoiced && i % 2 === 0 ? 'paid' : 'unpaid', invoiced && i % 2 === 0 ? addDays(today, -3) : null,
      invoiced && i % 3 !== 0 ? 'verified' : 'pending', invoiced && i % 3 !== 0 ? userIds['hr.manager'] : null, invoiced && i % 3 !== 0 ? new Date().toISOString() : null, userIds.finance]);
  }

  // In-country costs for everyone who has arrived
  const arrived = await db.many(`SELECT id FROM candidates WHERE status IN ('arrived','onboarding') ORDER BY id`);
  const lines: [string, string, number, number | null, string][] = [
    ['airport_transport', 'Airport pickup', 150, 150, 'Company transport'], ['visa_processing', 'Entry permit & residence visa fees', 3600, 3480, 'GDRFA / Amer centre'],
    ['medical_exam', 'Visa medical fitness test', 320, 320, 'Al Karama Medical Fitness Centre'], ['emirates_id', 'Emirates ID application', 370, 370, 'ICP'],
    ['occupational_medical', 'Pre-employment occupational medical', 250, 275, 'Prime Occupational Health Clinic'], ['training', 'Induction & trade training', 650, null, 'Technical training centre'],
    ['uniform_ppe', 'Uniform, safety shoes and PPE kit', 480, 455, 'Gulf Safety Supplies'], ['accommodation', 'Camp accommodation (first month)', 900, 900, 'Camp operator'],
  ];
  for (const [i, c] of arrived.entries()) {
    for (const [j, [cat, desc, est, act, sup]] of lines.entries()) {
      const actual = act === null ? null : act + (i % 2) * (j % 3) * 10;
      await db.query(`INSERT INTO mobilisation_expenses(candidate_id, category, description, estimated_cost, actual_cost, supplier, invoice_no, invoice_date, payment_status, payment_date,
          verification_status, verified_by, verified_at, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [c.id, cat, desc, est, actual, sup, actual === null ? null : `INV-${c.id}-${j + 1}`, actual === null ? null : addDays(today, -5), actual !== null && j % 2 === 0 ? 'paid' : 'unpaid',
        actual !== null && j % 2 === 0 ? addDays(today, -2) : null, actual !== null && (i + j) % 3 === 0 ? 'verified' : 'pending',
        actual !== null && (i + j) % 3 === 0 ? userIds['hr.manager'] : null, actual !== null && (i + j) % 3 === 0 ? new Date().toISOString() : null, userIds.finance]);
    }
  }

  // Lifecycle demo: the two employees furthest along finish onboarding — one is deployed, one awaits HR's final clearance.
  if (process.env.SEED_DEMO_LIFECYCLE === 'off') return; // integration tests drive the lifecycle themselves
  const best = await db.many(`SELECT c.id FROM candidates c WHERE c.status = 'onboarding'
    ORDER BY (SELECT count(*) FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.status = 'completed') DESC LIMIT 3`);
  for (const [i, c] of best.slice(0, 2).entries()) {
    await db.tx(async (q) => {
      await q.query(`UPDATE onboarding_activities SET status = 'completed', actual_completion_date = least(coalesce(actual_completion_date, planned_date, $2::date), $2::date),
          completed_by = coalesce(completed_by, $3), auto_completed = FALSE
        WHERE candidate_id = $1 AND status <> 'not_applicable' AND (workflow_key IS NULL OR workflow_key NOT IN ('clearance','deployment_approval','deployed'))`, [c.id, today, userIds['hr.manager']]);
      await resync(q, hr, c.id);
      if (i === 0) {
        const done = (key: string, date: string, remarks: string) => q.query(`UPDATE onboarding_activities SET status = 'completed', actual_completion_date = $3, completed_by = $4,
            verified_by = $4, verified_at = now(), auto_completed = TRUE, remarks = $5 WHERE candidate_id = $1 AND workflow_key = $2`, [c.id, key, date, userIds['hr.manager'], remarks]);
        await done('clearance', addDays(today, -2), 'Final clearance approved');
        await advanceCandidate(q, hr, c.id, 'ready_for_deployment', ['awaiting_clearance'], 'Final clearance approved');
        await q.query(`INSERT INTO approval_records(approval_type, entity, entity_id, candidate_id, decided_by, decided_at, decision, remarks) VALUES ('final_clearance','candidates',$1,$1,$2,now() - interval '2 days','approved','All checks passed')`, [c.id, userIds['hr.manager']]);
        const site = 'Ruwais Plant — Unit 4 maintenance';
        const d = (await q.query(`INSERT INTO deployments(candidate_id, site, supervisor_name, supervisor_phone, planned_reporting_date, status, requested_by, requested_at, approved_by, approved_at,
            actual_reporting_date, confirmed_by, confirmed_at) VALUES ($1,$2,'Eng. Saleh Al Marri','+971 50 990 1122',$3,'reported',$4,now() - interval '2 days',$5,now() - interval '1 day',$3,$4,now()) RETURNING id`,
        [c.id, site, today, userIds.operations, userIds['hr.manager']])).rows[0];
        await q.query(`INSERT INTO approval_records(approval_type, entity, entity_id, candidate_id, requested_by, requested_at, decided_by, decided_at, decision) VALUES ('deployment','deployments',$1,$2,$3,now() - interval '2 days',$4,now() - interval '1 day','approved')`,
          [d.id, c.id, userIds.operations, userIds['hr.manager']]);
        await done('deployment_approval', addDays(today, -1), `Approved for ${site}`);
        await done('deployed', today, `Reported to ${site}`);
        await q.query('UPDATE candidates SET work_location = $2 WHERE id = $1', [c.id, site]);
        await advanceCandidate(q, hr, c.id, 'deployed', ['ready_for_deployment'], `Reported to work at ${site}`);
      }
    });
  }
}
