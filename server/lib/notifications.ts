// Notification engine (Module 9). State-based: each run computes every condition that should be notified,
// upserts one notification per (recipient, dedupe key), re-raises resolved ones that come back, and resolves the rest.
import { db } from '../db/index.ts';
import { getSettings } from './settings.ts';
import { ARRIVED_SQL } from './onboarding.ts';

type Want = { users: number[]; type: string; severity: 'info' | 'warning' | 'critical'; title: string; message: string; link: string; candidateId: number | null; key: string };

const TODAY = `(now() AT TIME ZONE 'Asia/Dubai')::date`;
const LIVE = `NOT c.is_archived AND c.status NOT IN ('cancelled')`;

/** Active users holding a permission (super administrators are excluded from broadcasts to avoid noise). */
async function holders(perm: string) {
  return (await db.many(`SELECT DISTINCT u.id FROM users u JOIN roles r ON r.id = u.role_id JOIN role_permissions rp ON rp.role_id = r.id
    JOIN permissions p ON p.id = rp.permission_id WHERE u.is_active AND p.code = $1 AND r.code <> 'super_admin'`, [perm])).map((r) => r.id as number);
}

let lastRun = 0;
let running: Promise<unknown> | null = null;

export function refreshIfStale(maxAgeMs = 5 * 60_000) {
  if (Date.now() - lastRun > maxAgeMs && !running) refreshNotifications().catch((e) => console.error('[notifications]', e.message));
}

export async function refreshNotifications() {
  if (running) return running;
  running = run().finally(() => { running = null; lastRun = Date.now(); });
  return running;
}

async function run() {
  const s = await getSettings();
  const want: Want[] = [];
  const P: Record<string, number[]> = {};
  for (const p of ['mobility.manage', 'accommodation.manage', 'medical.manage', 'visa.manage', 'training.manage', 'uniform.manage', 'clearance.approve',
    'deployment.manage', 'candidates.edit', 'onboarding.verify', 'mobility.approve', 'finance.verify']) P[p] = await holders(p);
  const push = (w: Want) => { if (w.users.length) want.push(w); };

  // 1. Upcoming travel
  for (const r of await db.many(`SELECT b.id, b.flight_number, b.arrival_airport, b.arrival_at, c.id AS cid, c.full_name FROM flight_bookings b JOIN candidates c ON c.id = b.candidate_id
      WHERE b.status = 'ticket_issued' AND b.arrival_at::date BETWEEN ${TODAY} AND ${TODAY} + 3 AND ${LIVE}`)) {
    push({ users: [...P['mobility.manage'], ...P['accommodation.manage']], type: 'upcoming_travel', severity: 'info', title: `${r.full_name} arrives ${String(r.arrival_at).slice(0, 16)}`,
      message: `${r.flight_number} into ${r.arrival_airport}. Confirm pickup and accommodation.`, link: `/candidates/${r.cid}?tab=travel`, candidateId: r.cid, key: `travel:${r.id}` });
  }
  // 2. Flight booking pending
  for (const r of await db.many(`SELECT c.id, c.full_name, c.expected_joining_date, (c.expected_joining_date - ${TODAY}) AS days FROM candidates c
      WHERE ${LIVE} AND c.status IN ('selected','pre_arrival') AND c.expected_joining_date <= ${TODAY} + 21
        AND NOT EXISTS (SELECT 1 FROM flight_bookings b WHERE b.candidate_id = c.id AND b.status IN ('ticket_issued','travel_completed'))`)) {
    push({ users: P['mobility.manage'], type: 'booking_pending', severity: r.days <= 7 ? 'critical' : 'warning', title: `No ticket yet for ${r.full_name}`,
      message: `Expected joining ${r.expected_joining_date} (${r.days < 0 ? `${-r.days} days ago` : `in ${r.days} days`}).`, link: `/candidates/${r.id}?tab=travel`, candidateId: r.id, key: `booking:${r.id}` });
  }
  // 3. Pickup not assigned
  for (const r of await db.many(`SELECT ap.id, ap.arrival_at, ap.airport, c.id AS cid, c.full_name FROM airport_pickups ap JOIN candidates c ON c.id = ap.candidate_id
      WHERE ap.status = 'pending' AND ap.arrival_at < (now() AT TIME ZONE 'Asia/Dubai') + interval '72 hours' AND ${LIVE}`)) {
    push({ users: P['mobility.manage'], type: 'pickup_unassigned', severity: 'critical', title: `Airport pickup not assigned: ${r.full_name}`,
      message: `Arrives ${String(r.arrival_at).slice(0, 16)} at ${r.airport}. Assign a vehicle and driver.`, link: '/pickups', candidateId: r.cid, key: `pickup:${r.id}` });
  }
  // 4. Accommodation not allocated
  for (const r of await db.many(`SELECT c.id, c.full_name, c.status FROM candidates c WHERE ${LIVE}
      AND (${ARRIVED_SQL} OR (c.status = 'travel_confirmed' AND EXISTS (SELECT 1 FROM flight_bookings b WHERE b.candidate_id = c.id AND b.status = 'ticket_issued' AND b.arrival_at::date <= ${TODAY} + 7)))
      AND c.status NOT IN ('deployed')
      AND NOT EXISTS (SELECT 1 FROM accommodation_allocations a WHERE a.candidate_id = c.id AND a.status IN ('allocated','checked_in'))`)) {
    push({ users: P['accommodation.manage'], type: 'accommodation_missing', severity: r.status === 'travel_confirmed' ? 'warning' : 'critical',
      title: `No accommodation for ${r.full_name}`, message: r.status === 'travel_confirmed' ? 'Arriving within 7 days without a bed.' : 'In the UAE without an allocated bed.',
      link: '/accommodation', candidateId: r.id, key: `bed:${r.id}` });
  }
  // 5. Medical appointment pending
  for (const r of await db.many(`SELECT c.id, c.full_name FROM candidates c WHERE ${LIVE} AND c.status IN ('arrived','onboarding')
      AND NOT EXISTS (SELECT 1 FROM visa_medical_records v WHERE v.candidate_id = c.id AND v.is_current)`)) {
    push({ users: P['medical.manage'], type: 'medical_pending', severity: 'warning', title: `Visa medical not scheduled: ${r.full_name}`,
      message: 'Book the UAE visa medical fitness appointment.', link: '/medical', candidateId: r.id, key: `medpending:${r.id}` });
  }
  // 6. Section-level overdue alerts to the owning team
  const groups: [string, string, string, string][] = [
    ['medical_overdue', "a.workflow_key IN ('visa_medical_attended','visa_medical_fit','occ_exam','occ_report')", 'medical.manage', '/medical'], ['visa_delay', "a.workflow_key IN ('entry_permit','health_insurance','residence_applied','eid_biometrics','residence_issued','eid_collected')", 'visa.manage', '/visa'],
    ['training_overdue', `a.section = 'D'`, 'training.manage', '/training'], ['uniform_overdue', `a.section = 'E'`, 'uniform.manage', '/uniform'],
  ];
  for (const [type, cond, perm, link] of groups) {
    for (const r of await db.many(`SELECT c.id, c.full_name, count(*)::int AS n, string_agg(a.seq || '. ' || a.name, '; ' ORDER BY a.seq) AS names, max(${TODAY} - a.planned_date) AS late
        FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id
        WHERE ${LIVE} AND ${cond} AND a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${TODAY} GROUP BY c.id`)) {
      push({ users: P[perm], type, severity: r.late > 7 ? 'critical' : 'warning', title: `${r.n} overdue: ${r.full_name}`, message: `${r.names} (up to ${r.late} days late).`, link, candidateId: r.id, key: `${type}:${r.id}` });
    }
  }
  // 7. Activity reminders to the responsible person
  const days: number[] = Array.isArray(s.reminder_days_before) ? s.reminder_days_before : [];
  for (const r of await db.many(`SELECT a.id, a.seq, a.name, a.planned_date, a.responsible_user_id, (a.planned_date - ${TODAY}) AS d, c.id AS cid, c.full_name
      FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id
      WHERE ${LIVE} AND a.status NOT IN ('completed','not_applicable','awaiting_approval') AND a.planned_date IS NOT NULL
        AND (a.workflow_key IS NULL OR a.workflow_key NOT IN ('clearance','deployment_approval','deployed'))
        AND a.planned_date <= ${TODAY} + $1::int`, [Math.max(0, ...days)])) {
    const base = { users: [r.responsible_user_id], candidateId: r.cid, link: `/candidates/${r.cid}?tab=checklist` };
    if (r.d < 0) push({ ...base, type: 'activity_overdue', severity: r.d < -7 ? 'critical' : 'warning', title: `Overdue: ${r.seq}. ${r.name}`,
      message: `${r.full_name} — planned ${r.planned_date}, ${-r.d} day(s) late.`, key: s.overdue_daily_reminder ? `over:${r.id}:${new Date(Date.now() + 4 * 3600_000).toISOString().slice(0, 10)}` : `over:${r.id}` });
    else if (r.d === 0 && s.remind_on_due_date) push({ ...base, type: 'activity_reminder', severity: 'warning', title: `Due today: ${r.seq}. ${r.name}`, message: r.full_name, key: `due:${r.id}` });
    else if (days.includes(r.d)) push({ ...base, type: 'activity_reminder', severity: 'info', title: `Due in ${r.d} day(s): ${r.seq}. ${r.name}`, message: `${r.full_name} — planned ${r.planned_date}.`, key: `rem:${r.id}:${r.d}` });
  }
  // 8. Passport expiry
  for (const r of await db.many(`SELECT c.id, c.full_name, c.passport_number, c.passport_expiry_date, (c.passport_expiry_date - ${TODAY}) AS d FROM candidates c
      WHERE ${LIVE} AND c.passport_expiry_date <= ${TODAY} + $1::int`, [s.passport_expiry_alert_days])) {
    push({ users: [...P['candidates.edit'], ...P['visa.manage']], type: 'passport_expiry', severity: r.d < 90 ? 'critical' : 'warning', title: `Passport expiring: ${r.full_name}`,
      message: `${r.passport_number} expires ${r.passport_expiry_date} (${r.d < 0 ? 'expired' : `${r.d} days`}).`, link: `/candidates/${r.id}`, candidateId: r.id, key: `passport:${r.id}` });
  }
  // 9. Other documents expiring (permits, visas, Emirates ID, certificates)
  for (const r of await db.many(`SELECT d.id, d.category, d.expiry_date, (d.expiry_date - ${TODAY}) AS dd, c.id AS cid, c.full_name FROM employee_documents d JOIN candidates c ON c.id = d.candidate_id
      WHERE ${LIVE} AND d.is_current AND d.category <> 'passport' AND d.expiry_date IS NOT NULL AND d.expiry_date <= ${TODAY} + $1::int`, [s.document_expiry_alert_days])) {
    push({ users: P['visa.manage'], type: 'document_expiry', severity: r.dd < 14 ? 'critical' : 'warning', title: `${r.category.replaceAll('_', ' ')} expiring: ${r.full_name}`,
      message: `Expires ${r.expiry_date} (${r.dd < 0 ? 'expired' : `${r.dd} days`}).`, link: `/candidates/${r.cid}?tab=documents`, candidateId: r.cid, key: `doc:${r.id}` });
  }
  // 10–11. Clearance and deployment
  for (const r of await db.many(`SELECT c.id, c.full_name FROM candidates c WHERE ${LIVE} AND c.status = 'awaiting_clearance'`)) {
    push({ users: P['clearance.approve'], type: 'clearance_pending', severity: 'warning', title: `Final clearance waiting: ${r.full_name}`,
      message: 'All mandatory onboarding activities are complete. Review and approve the final clearance.', link: `/candidates/${r.id}?tab=clearance`, candidateId: r.id, key: `clear:${r.id}` });
  }
  for (const r of await db.many(`SELECT c.id, c.full_name, p.name AS project FROM candidates c JOIN projects p ON p.id = c.project_id WHERE ${LIVE} AND c.status = 'ready_for_deployment'
      AND NOT EXISTS (SELECT 1 FROM deployments d WHERE d.candidate_id = c.id AND d.status IN ('requested','approved','reported'))`)) {
    push({ users: P['deployment.manage'], type: 'ready_for_deployment', severity: 'info', title: `Ready for deployment: ${r.full_name}`,
      message: `Cleared by HR for ${r.project}. Request deployment with site and supervisor.`, link: '/deployment', candidateId: r.id, key: `ready:${r.id}` });
  }
  // 12. Approvals waiting (one summary per approver)
  const waiting = new Map<number, number>();
  const bump = (ids: number[], exclude: number | null) => { for (const u of ids) if (u !== exclude) waiting.set(u, (waiting.get(u) || 0) + 1); };
  for (const r of await db.many(`SELECT d.requested_by FROM deployments d WHERE d.status = 'requested'`)) bump(P['clearance.approve'], r.requested_by);
  for (const r of await db.many(`SELECT b.submitted_by FROM flight_bookings b WHERE b.status = 'approval_pending'`)) bump(P['mobility.approve'], r.submitted_by);
  for (const r of await db.many(`SELECT a.submitted_by FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id WHERE a.status = 'awaiting_approval' AND ${LIVE}`)) bump(P['onboarding.verify'], r.submitted_by);
  for (const r of await db.many(`SELECT coalesce(e.updated_by, e.created_by) AS by FROM mobilisation_expenses e WHERE e.verification_status = 'pending' AND e.actual_cost IS NOT NULL`)) bump(P['finance.verify'], r.by);
  for (const [u, n] of waiting) push({ users: [u], type: 'approval_pending', severity: 'info', title: `${n} item(s) waiting for your approval`, message: 'Open the approvals inbox.', link: '/approvals', candidateId: null, key: 'approvals' });

  // ---- persist
  const keep: string[] = [];
  let created = 0;
  const emails: { id: number; userId: number; title: string; message: string; link: string }[] = [];
  for (const w of want) {
    for (const u of new Set(w.users)) {
      keep.push(`${u}|${w.key}`);
      const r = await db.one(`INSERT INTO notifications(user_id, type, severity, title, message, link, candidate_id, dedupe_key)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (user_id, dedupe_key) DO UPDATE SET title = EXCLUDED.title, message = EXCLUDED.message, severity = EXCLUDED.severity, link = EXCLUDED.link,
          read_at = CASE WHEN notifications.resolved_at IS NOT NULL OR notifications.title <> EXCLUDED.title THEN NULL ELSE notifications.read_at END,
          last_raised_at = CASE WHEN notifications.resolved_at IS NOT NULL THEN now() ELSE notifications.last_raised_at END, resolved_at = NULL
        RETURNING id, (xmax = 0) AS inserted, emailed_at`, [u, w.type, w.severity, w.title.slice(0, 200), w.message, w.link, w.candidateId, w.key]);
      if (r!.inserted) created++;
      if (r!.inserted || !r!.emailed_at) emails.push({ id: r!.id, userId: u, title: w.title, message: w.message, link: w.link });
    }
  }
  const resolved = (await db.query(`UPDATE notifications SET resolved_at = now() WHERE resolved_at IS NULL AND (user_id::text || '|' || dedupe_key) <> ALL($1::text[]) RETURNING id`, [keep])).rows.length;
  // ---- e-mail copies (only critical / warning, once per notification)
  let queued = 0;
  if (s.email_notifications && emails.length) {
    const users = new Map((await db.many(`SELECT id, email, full_name FROM users WHERE is_active AND email IS NOT NULL`)).map((u) => [u.id, u]));
    for (const e of emails) {
      const u = users.get(e.userId);
      const n = await db.one('SELECT severity FROM notifications WHERE id = $1', [e.id]);
      if (!u || n?.severity === 'info') continue;
      await db.query(`INSERT INTO email_outbox(to_address, subject, body, notification_id) VALUES ($1,$2,$3,$4)`,
        [u.email, `[IEOMMS] ${e.title}`, `Dear ${u.full_name},\n\n${e.title}\n${e.message}\n\nOpen: ${e.link}\n\n— IEOMMS (automatic notification)`, e.id]);
      await db.query('UPDATE notifications SET emailed_at = now() WHERE id = $1', [e.id]);
      queued++;
    }
    await processOutbox();
  }
  return { active: keep.length, created, resolved, emailsQueued: queued };
}

/** Send queued e-mail through SMTP when SMTP_URL is configured; otherwise hold it in the outbox. */
export async function processOutbox() {
  const url = process.env.SMTP_URL;
  if (!url) {
    const held = (await db.query(`UPDATE email_outbox SET status = 'held', last_error = 'SMTP is not configured (set SMTP_URL and SMTP_FROM).'
      WHERE status = 'queued' OR (status = 'failed' AND attempts < 5) RETURNING id`)).rows.length;
    return { sent: 0, held };
  }
  const nodemailer = (await import('nodemailer')).default;
  const transport = nodemailer.createTransport(url);
  let sent = 0, failed = 0;
  for (;;) {
    const rows = await db.many(`SELECT * FROM email_outbox WHERE status = 'queued' ORDER BY id LIMIT 100`);
    if (!rows.length) break;
    for (const r of rows) {
      try {
        await transport.sendMail({ from: process.env.SMTP_FROM || 'IEOMMS <no-reply@localhost>', to: r.to_address, subject: r.subject, text: r.body });
        await db.query(`UPDATE email_outbox SET status = 'sent', sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1`, [r.id]);
        sent++;
      } catch (e: any) {
        // failed rows are retried by the next run (up to 5 attempts) — not in this loop
        await db.query(`UPDATE email_outbox SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`, [r.id, String(e?.message || e).slice(0, 500)]);
        failed++;
      }
    }
  }
  await db.query(`UPDATE email_outbox SET status = 'queued' WHERE status = 'failed' AND attempts < 5`); // retried next run
  return { sent, failed };
}
