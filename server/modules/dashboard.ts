// Phase 1 dashboard: candidate pipeline overview. Expanded with mobility, onboarding and finance KPIs in later phases.
import express from 'express';
import { db } from '../db/index.ts';
import { asyncH } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { ENUMS } from '../lib/enums.ts';
import { can } from '../lib/rbac.ts';

export const dashboardRouter = express.Router();

dashboardRouter.get('/dashboard', requirePerm('dashboard.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  let w = 'WHERE NOT c.is_archived';
  if (req.query.project_id) { params.push(Number(req.query.project_id)); w += ` AND c.project_id = $${params.length}`; }
  const [byStatus, byNationality, byProject, byTrade, byAgency, monthly, passport, joining, recent, contracts] = await Promise.all([
    db.many(`SELECT c.status, count(*)::int AS n FROM candidates c ${w} GROUP BY 1`, params),
    db.many(`SELECT c.nationality AS name, count(*)::int AS n FROM candidates c ${w} AND c.status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, params),
    db.many(`SELECT p.name, count(*)::int AS n FROM candidates c JOIN projects p ON p.id = c.project_id ${w} AND c.status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, params),
    db.many(`SELECT t.name, count(*)::int AS n FROM candidates c JOIN trades t ON t.id = c.trade_id ${w} AND c.status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, params),
    db.many(`SELECT coalesce(a.name, 'Direct hire') AS name, count(*)::int AS n FROM candidates c LEFT JOIN recruitment_agencies a ON a.id = c.recruitment_agency_id ${w} AND c.status <> 'cancelled' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`, params),
    db.many(`SELECT to_char(date_trunc('month', c.selection_date), 'YYYY-MM') AS month, count(*)::int AS n FROM candidates c ${w}
      AND c.selection_date >= date_trunc('month', current_date) - interval '11 months' GROUP BY 1 ORDER BY 1`, params),
    db.many(`SELECT c.id, c.reference_no, c.full_name, c.nationality, c.passport_number, c.passport_expiry_date,
        (c.passport_expiry_date - current_date) AS days_left
      FROM candidates c ${w} AND c.status NOT IN ('cancelled','deployed') AND c.passport_expiry_date < current_date + interval '6 months'
      ORDER BY c.passport_expiry_date LIMIT 10`, params),
    db.many(`SELECT c.id, c.reference_no, c.full_name, c.position, c.expected_joining_date, c.status, p.name AS project
      FROM candidates c JOIN projects p ON p.id = c.project_id ${w} AND c.status IN ('selected','pre_arrival','travel_confirmed','on_hold')
      AND c.expected_joining_date BETWEEN current_date - 7 AND current_date + 30 ORDER BY c.expected_joining_date LIMIT 10`, params),
    db.many(`SELECT c.id, c.reference_no, c.full_name, c.position, c.nationality, c.status, c.created_at, t.name AS trade
      FROM candidates c JOIN trades t ON t.id = c.trade_id ${w} ORDER BY c.created_at DESC LIMIT 8`, params),
    db.one(`SELECT count(*) FILTER (WHERE c.contract_status = 'signed')::int AS signed,
        count(*) FILTER (WHERE c.contract_status <> 'signed')::int AS unsigned,
        count(*) FILTER (WHERE c.offer_letter_status = 'accepted')::int AS offers_accepted,
        count(*) FILTER (WHERE c.offer_letter_status IN ('not_issued','issued'))::int AS offers_pending
      FROM candidates c ${w} AND c.status NOT IN ('cancelled')`, params),
  ]);
  const pp: unknown[] = [];
  let pw = '';
  if (req.query.project_id) { pp.push(Number(req.query.project_id)); pw = ` AND c.project_id = $1`; }
  const today = `(now() AT TIME ZONE 'Asia/Dubai')::date`;
  const [mob, acc, arrivals] = await Promise.all([
    db.one(`SELECT
        count(*) FILTER (WHERE b.status IN ('ticket_issued','travel_completed') AND b.arrival_at::date = ${today})::int AS today,
        count(*) FILTER (WHERE b.status IN ('ticket_issued','travel_completed') AND b.arrival_at::date = ${today} + 1)::int AS tomorrow,
        count(*) FILTER (WHERE b.status = 'ticket_issued' AND b.arrival_at::date BETWEEN ${today} AND ${today} + 7)::int AS next7,
        count(*) FILTER (WHERE b.status IN ('pending_booking','quotation_received','approval_pending','approved','ticket_booked'))::int AS awaiting_ticket,
        count(*) FILTER (WHERE b.status = 'approval_pending')::int AS approvals,
        coalesce(sum(b.ticket_cost) FILTER (WHERE b.status IN ('ticket_issued','travel_completed')), 0) AS travel_spend,
        (SELECT count(*)::int FROM airport_pickups ap JOIN candidates c ON c.id = ap.candidate_id WHERE ap.status = 'pending'
           AND ap.arrival_at < (now() AT TIME ZONE 'Asia/Dubai') + interval '72 hours' ${pw}) AS pickups_unassigned,
        (SELECT count(*)::int FROM airport_pickups ap JOIN candidates c ON c.id = ap.candidate_id WHERE ap.status IN ('pending','assigned') ${pw}) AS pickups_open,
        (SELECT count(*)::int FROM candidates c WHERE NOT c.is_archived AND c.status IN ('selected','pre_arrival') ${pw}
           AND NOT EXISTS (SELECT 1 FROM flight_bookings x WHERE x.candidate_id = c.id AND x.status <> 'cancelled')) AS no_booking
      FROM flight_bookings b JOIN candidates c ON c.id = b.candidate_id WHERE TRUE ${pw}`, pp),
    db.one(`SELECT
        (SELECT coalesce(sum(ar.bed_capacity), 0)::int FROM accommodation_rooms ar JOIN accommodation_camps ac ON ac.id = ar.camp_id WHERE ar.status = 'active' AND ac.status = 'active') AS capacity,
        (SELECT count(*)::int FROM accommodation_allocations WHERE status = 'checked_in') AS occupied,
        (SELECT count(*)::int FROM accommodation_allocations WHERE status = 'allocated') AS reserved,
        (SELECT count(*)::int FROM candidates c WHERE NOT c.is_archived ${pw}
           AND c.status IN ('pre_arrival','travel_confirmed','arrived','onboarding','awaiting_clearance','ready_for_deployment')
           AND NOT EXISTS (SELECT 1 FROM accommodation_allocations a WHERE a.candidate_id = c.id AND a.status IN ('allocated','checked_in'))) AS awaiting`, pp),
    db.many(`SELECT b.id AS booking_id, b.arrival_at, b.flight_number, b.arrival_airport, c.id, c.full_name, c.reference_no, ap.status AS pickup_status,
        EXISTS (SELECT 1 FROM accommodation_allocations a WHERE a.candidate_id = c.id AND a.status IN ('allocated','checked_in')) AS has_room
      FROM flight_bookings b JOIN candidates c ON c.id = b.candidate_id LEFT JOIN airport_pickups ap ON ap.flight_booking_id = b.id
      WHERE b.status IN ('ticket_issued','travel_completed') AND b.arrival_at::date BETWEEN ${today} AND ${today} + 1 ${pw}
      ORDER BY b.arrival_at`, pp),
  ]);
  const live = `NOT c.is_archived AND c.status NOT IN ('cancelled')`;
  const [onb, deptProgress] = await Promise.all([
    db.one(`SELECT
        count(*) FILTER (WHERE a.status <> 'not_applicable')::int AS total,
        count(*) FILTER (WHERE a.status = 'completed')::int AS completed,
        count(*) FILTER (WHERE a.status NOT IN ('completed','not_applicable'))::int AS pending,
        count(*) FILTER (WHERE a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${today})::int AS overdue,
        count(*) FILTER (WHERE a.status = 'awaiting_approval')::int AS awaiting_approval,
        count(DISTINCT a.candidate_id) FILTER (WHERE a.workflow_key IN ('visa_medical_attended','visa_medical_fit','occ_exam','occ_report') AND a.status NOT IN ('completed','not_applicable')
          AND c.status IN ('arrived','onboarding','awaiting_clearance'))::int AS awaiting_medical,
        count(DISTINCT a.candidate_id) FILTER (WHERE a.workflow_key IN ('health_insurance','residence_applied','eid_biometrics','residence_issued','eid_collected') AND a.status NOT IN ('completed','not_applicable')
          AND c.status IN ('arrived','onboarding','awaiting_clearance'))::int AS awaiting_visa,
        count(DISTINCT a.candidate_id) FILTER (WHERE a.section = 'D' AND a.status NOT IN ('completed','not_applicable')
          AND c.status IN ('arrived','onboarding','awaiting_clearance'))::int AS awaiting_training,
        count(DISTINCT a.candidate_id) FILTER (WHERE a.section = 'E' AND a.status NOT IN ('completed','not_applicable')
          AND c.status IN ('arrived','onboarding','awaiting_clearance'))::int AS awaiting_uniform
      FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id WHERE ${live} ${pw}`, pp),
    db.many(`SELECT d.name, count(*) FILTER (WHERE a.status <> 'not_applicable')::int AS total, count(*) FILTER (WHERE a.status = 'completed')::int AS done,
        count(*) FILTER (WHERE a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${today})::int AS overdue
      FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id JOIN departments d ON d.id = a.department_id
      WHERE ${live} ${pw} GROUP BY d.name ORDER BY d.name`, pp),
  ]);
  let finance = null;
  if (can(req.user, 'finance.view')) {
    const base = `FROM mobilisation_expenses e JOIN candidates c ON c.id = e.candidate_id JOIN projects p ON p.id = c.project_id LEFT JOIN recruitment_agencies ra ON ra.id = c.recruitment_agency_id WHERE TRUE ${pw}`;
    const [t, byProject, byAgency] = await Promise.all([
      db.one(`SELECT coalesce(sum(e.estimated_cost),0) AS estimated, coalesce(sum(e.actual_cost),0) AS actual, count(DISTINCT e.candidate_id)::int AS employees,
          coalesce(sum(e.actual_cost),0) - coalesce(sum(e.estimated_cost) FILTER (WHERE e.actual_cost IS NOT NULL),0) AS variance,
          count(*) FILTER (WHERE e.verification_status = 'pending' AND e.actual_cost IS NOT NULL)::int AS pending_verification ${base}`, pp),
      db.many(`SELECT p.name, coalesce(sum(e.actual_cost),0) AS actual, coalesce(sum(e.estimated_cost),0) AS estimated ${base} GROUP BY 1 ORDER BY 2 DESC`, pp),
      db.many(`SELECT coalesce(ra.name, 'Direct hire') AS name, coalesce(sum(e.actual_cost),0) AS actual, coalesce(sum(e.estimated_cost),0) AS estimated ${base} GROUP BY 1 ORDER BY 2 DESC`, pp),
    ]);
    finance = { ...t!, average: t!.employees ? (Number(t!.actual) / t!.employees).toFixed(2) : '0.00', byProject, byAgency };
  }
  const onboarding = { ...onb!, pct: onb!.total ? Math.round((onb!.completed / onb!.total) * 1000) / 10 : 0, departments: deptProgress };
  const mobility = mob;
  const accommodation = { ...acc!, available: Math.max(0, acc!.capacity - acc!.occupied - acc!.reserved),
    occupancy: acc!.capacity ? Math.round(((acc!.occupied + acc!.reserved) / acc!.capacity) * 1000) / 10 : 0 };
  const counts: Record<string, number> = Object.fromEntries(ENUMS.candidate_status.map((s) => [s.value, 0]));
  for (const r of byStatus) counts[r.status] = r.n;
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  res.json({
    total, active: total - counts.cancelled, counts,
    byNationality, byProject, byTrade, byAgency, monthly, passportExpiring: passport, upcomingJoining: joining, recent, contracts,
    mobility, accommodation, arrivals, onboarding, finance,
  });
}));
