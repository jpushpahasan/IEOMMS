// Module 8F — Management reports: catalogue, filtering, preview and Excel / PDF export.
import express from 'express';
import { db } from '../db/index.ts';
import { asyncH, badRequest, forbidden, notFound } from '../lib/http.ts';
import { can, type SessionUser } from '../lib/rbac.ts';
import { audit } from '../lib/audit.ts';
import { label } from '../lib/enums.ts';
import { validDate } from '../lib/validate.ts';
import { getSettings } from '../lib/settings.ts';
import { CHECKS } from './clearance.ts';
import { sendReportXlsx, sendReportPdf, type ReportCol } from '../lib/exporters.ts';

export const reportsRouter = express.Router();

type F = { from?: string; to?: string; project_id?: number; client_id?: number; department_id?: number; nationality?: string; agency_id?: number; trade_id?: number; status?: string[] };
interface ReportDef {
  key: string; no: number; title: string; group: string; description: string;
  perms: string[];                 // any of these grants access
  dateLabel?: string;              // what the date range filters
  filters: ('date' | 'project' | 'client' | 'department' | 'nationality' | 'agency' | 'trade' | 'status')[];
  columns: ReportCol[];
  build: (f: F, p: unknown[], u: SessionUser) => string;
  totals?: string[];
  orientation?: 'landscape' | 'portrait';
}

const ARR = (alias = 'c') => `(SELECT min(h.changed_at) FROM candidate_status_history h WHERE h.candidate_id = ${alias}.id AND h.to_status = 'arrived')`;
const today = `(now() AT TIME ZONE 'Asia/Dubai')::date`;

/** Candidate-level filters (alias c = candidates, p = projects). `dateExpr` is the column the date range applies to. */
function where(f: F, p: unknown[], opts: { dateExpr?: string; dept?: string; candidate?: boolean } = {}) {
  const w: string[] = [];
  const add = (sql: string, v: unknown) => { p.push(v); w.push(sql.replaceAll('?', `$${p.length}`)); };
  if (opts.candidate !== false) {
    if (f.project_id) add('c.project_id = ?', f.project_id);
    if (f.client_id) add('p.client_id = ?', f.client_id);
    if (f.nationality) add('c.nationality = ?', f.nationality);
    if (f.agency_id) add('c.recruitment_agency_id = ?', f.agency_id);
    if (f.trade_id) add('c.trade_id = ?', f.trade_id);
    if (f.status?.length) add('c.status = ANY(?::text[])', f.status);
    w.push('NOT c.is_archived');
  }
  if (f.department_id) add(`${opts.dept || 'c.department_id'} = ?`, f.department_id);
  if (opts.dateExpr && f.from) add(`(${opts.dateExpr})::date >= ?::date`, f.from);
  if (opts.dateExpr && f.to) add(`(${opts.dateExpr})::date <= ?::date`, f.to);
  return w.length ? `WHERE ${w.join(' AND ')}` : '';
}
const CJ = `JOIN projects p ON p.id = c.project_id LEFT JOIN clients cl ON cl.id = p.client_id JOIN trades t ON t.id = c.trade_id
  LEFT JOIN recruitment_agencies ra ON ra.id = c.recruitment_agency_id LEFT JOIN departments dd ON dd.id = c.department_id`;
const ALL_F = ['date', 'project', 'client', 'department', 'nationality', 'agency', 'trade', 'status'] as const;

/** Department users without management reporting rights only see their own department's activities. */
const deptScope = (u: SessionUser, f: F) => {
  if (!can(u, 'reports.view') && !can(u, 'onboarding.verify')) f.department_id = u.department_id ?? -1;
};

/** Compact column headings for the ten clearance checks (full wording is in the clearance screen). */
const CHECK_SHORT: Record<string, string> = {
  employment: 'Employment docs', immigration: 'Immigration', medical: 'Medical', training: 'Training', competency: 'Competency',
  uniform: 'Uniform & PPE', induction: 'Induction', accommodation: 'Accommodation', employee_file: 'Employee file', site_induction: 'Site induction',
};

export const REPORTS: ReportDef[] = [
  {
    key: 'onboarding_register', no: 1, title: 'Complete employee onboarding register', group: 'Onboarding', dateLabel: 'Selection date',
    description: 'Every candidate and employee with stage, travel, accommodation, visa, onboarding progress and deployment.',
    perms: ['reports.view'], filters: [...ALL_F],
    columns: [['reference_no', 'Ref', 'text', 14], ['employee_no', 'Emp. no', 'text', 10], ['full_name', 'Name', 'text', 24], ['nationality', 'Nationality', 'text', 12],
      ['trade', 'Trade', 'text', 18], ['project', 'Project', 'text', 22], ['selection_date', 'Selected', 'date', 11], ['arrival', 'Arrived', 'date', 11],
      ['status', 'Stage', 'enum:candidate_status', 18], ['onboarding_pct', 'Onboarding %', 'pct', 10], ['overdue', 'Overdue', 'int', 8],
      ['accommodation', 'Accommodation', 'text', 26], ['residence_status', 'Residence visa', 'enum:residence_status', 13], ['deployed_on', 'Deployed', 'date', 11]],
    build: (f, p) => `SELECT c.reference_no, e.employee_no, c.full_name, c.nationality, t.name AS trade, p.name AS project, c.selection_date, ${ARR()}::date AS arrival, c.status,
        (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'completed') / nullif(count(*) FILTER (WHERE a.status <> 'not_applicable'), 0)) FROM onboarding_activities a WHERE a.candidate_id = c.id)::int AS onboarding_pct,
        (SELECT count(*) FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${today})::int AS overdue,
        (SELECT ac.name || ' · ' || ar.room_number || '/' || aa.bed_number FROM accommodation_allocations aa JOIN accommodation_rooms ar ON ar.id = aa.room_id JOIN accommodation_camps ac ON ac.id = ar.camp_id
          WHERE aa.candidate_id = c.id AND aa.status IN ('allocated','checked_in') LIMIT 1) AS accommodation,
        coalesce(v.residence_status, 'not_started') AS residence_status,
        (SELECT d.actual_reporting_date FROM deployments d WHERE d.candidate_id = c.id AND d.status = 'reported' ORDER BY d.id DESC LIMIT 1) AS deployed_on
      FROM candidates c ${CJ} LEFT JOIN employees e ON e.candidate_id = c.id LEFT JOIN visa_records v ON v.candidate_id = c.id
      ${where(f, p, { dateExpr: 'c.selection_date' })} ORDER BY c.reference_no`,
  },
  {
    key: 'candidate_selection', no: 2, title: 'Candidate selection report', group: 'Recruitment', dateLabel: 'Selection date',
    description: 'Candidates selected in the period with agency, offer and contract status and expected joining.',
    perms: ['reports.view', 'candidates.create'], filters: [...ALL_F],
    columns: [['reference_no', 'Ref', 'text', 14], ['full_name', 'Name', 'text', 24], ['gender', 'Gender', 'enum:gender', 8], ['nationality', 'Nationality', 'text', 12],
      ['position', 'Position', 'text', 20], ['trade', 'Trade', 'text', 18], ['project', 'Project', 'text', 22], ['client', 'Client', 'text', 18], ['agency', 'Agency', 'text', 20],
      ['selection_date', 'Selected', 'date', 11], ['expected_joining_date', 'Exp. joining', 'date', 11], ['offer_letter_status', 'Offer', 'enum:offer_letter_status', 11],
      ['contract_status', 'Contract', 'enum:contract_status', 12], ['status', 'Stage', 'enum:candidate_status', 18]],
    build: (f, p) => `SELECT c.reference_no, c.full_name, c.gender, c.nationality, c.position, t.name AS trade, p.name AS project, cl.name AS client, coalesce(ra.name, 'Direct hire') AS agency,
        c.selection_date, c.expected_joining_date, c.offer_letter_status, c.contract_status, c.status
      FROM candidates c ${CJ} ${where(f, p, { dateExpr: 'c.selection_date' })} ORDER BY c.selection_date DESC, c.reference_no`,
  },
  {
    key: 'international_travel', no: 3, title: 'International travel report', group: 'Mobility', dateLabel: 'Travel date',
    description: 'Flight bookings with route, agency, airline, flight, times, ticket cost and status.',
    perms: ['reports.view', 'mobility.view'], filters: [...ALL_F],
    columns: [['booking_no', 'Booking', 'text', 14], ['full_name', 'Name', 'text', 22], ['nationality', 'Nationality', 'text', 12], ['route', 'Route', 'text', 26],
      ['agency_name', 'Travel agency', 'text', 20], ['flight', 'Flight', 'text', 16], ['departure_at', 'Departs (local)', 'datetime', 15], ['arrival_at', 'Arrives (UAE)', 'datetime', 15],
      ['booking_reference', 'PNR', 'text', 10], ['ticket_cost', 'Ticket (AED)', 'money', 12], ['status', 'Status', 'enum:booking_status', 15]],
    totals: ['ticket_cost'],
    build: (f, p) => `SELECT b.booking_no, c.full_name, c.nationality, b.departure_city || ', ' || b.departure_country || ' → ' || b.arrival_airport AS route,
        ta.name AS agency_name, trim(coalesce(b.airline, '') || ' ' || coalesce(b.flight_number, '')) AS flight, b.departure_at, b.arrival_at, b.booking_reference,
        CASE WHEN b.status IN ('ticket_issued','travel_completed') THEN b.ticket_cost END AS ticket_cost, b.status
      FROM flight_bookings b JOIN candidates c ON c.id = b.candidate_id ${CJ} LEFT JOIN travel_agencies ta ON ta.id = b.travel_agency_id
      ${where(f, p, { dateExpr: 'coalesce(b.arrival_at::date, b.confirmed_travel_date, b.preferred_travel_date)' })} ORDER BY coalesce(b.arrival_at::date, b.confirmed_travel_date, b.preferred_travel_date), b.booking_no`,
  },
  {
    key: 'airport_pickup', no: 4, title: 'Airport pickup schedule', group: 'Mobility', dateLabel: 'Arrival date',
    description: 'Incoming employees by arrival time with airport, flight, vehicle, driver, coordinator and status.',
    perms: ['reports.view', 'mobility.view'], filters: [...ALL_F],
    columns: [['arrival_at', 'Arrival (UAE)', 'datetime', 15], ['full_name', 'Name', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['airport', 'Airport', 'text', 8],
      ['terminal', 'Terminal', 'text', 8], ['flight_number', 'Flight', 'text', 10], ['vehicle_registration', 'Vehicle', 'text', 14], ['driver', 'Driver', 'text', 24],
      ['coordinator', 'Coordinator', 'text', 18], ['accommodation', 'Destination', 'text', 26], ['status', 'Status', 'enum:pickup_status', 12], ['actual_pickup_at', 'Picked up', 'datetime', 15]],
    build: (f, p) => `SELECT ap.arrival_at, c.full_name, c.reference_no, ap.airport, ap.terminal, ap.flight_number, ap.vehicle_registration,
        CASE WHEN ap.driver_name IS NOT NULL THEN ap.driver_name || ' ' || coalesce(ap.driver_phone, '') END AS driver, u.full_name AS coordinator,
        (SELECT ac.name || ' · ' || ar.room_number FROM accommodation_allocations aa JOIN accommodation_rooms ar ON ar.id = aa.room_id JOIN accommodation_camps ac ON ac.id = ar.camp_id
          WHERE aa.candidate_id = c.id AND aa.status IN ('allocated','checked_in') LIMIT 1) AS accommodation, ap.status, ap.actual_pickup_at
      FROM airport_pickups ap JOIN candidates c ON c.id = ap.candidate_id ${CJ} LEFT JOIN users u ON u.id = ap.coordinator_id
      ${where(f, p, { dateExpr: 'ap.arrival_at' })} ORDER BY ap.arrival_at`,
  },
  {
    key: 'accommodation_allocation', no: 5, title: 'Accommodation allocation report', group: 'Accommodation', dateLabel: 'Allocation date',
    description: 'Bed allocations with camp, room, bed, expected and actual check-in, supervisor and status.',
    perms: ['reports.view', 'accommodation.view'], filters: [...ALL_F],
    columns: [['full_name', 'Name', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['camp', 'Camp', 'text', 22], ['room', 'Room / bed', 'text', 16], ['room_type', 'Type', 'text', 10],
      ['allocation_date', 'Allocated', 'date', 11], ['expected_checkin_date', 'Exp. check-in', 'date', 11], ['actual_checkin_date', 'Checked in', 'date', 11],
      ['checkout_date', 'Checked out', 'date', 11], ['supervisor', 'Supervisor', 'text', 18], ['status', 'Status', 'enum:allocation_status', 12]],
    build: (f, p) => `SELECT c.full_name, c.reference_no, ac.name AS camp, coalesce(ar.block || ' ', '') || ar.room_number || ' / bed ' || aa.bed_number AS room, ar.room_type,
        aa.allocation_date, aa.expected_checkin_date, aa.actual_checkin_date, aa.checkout_date, ac.supervisor_name AS supervisor, aa.status
      FROM accommodation_allocations aa JOIN candidates c ON c.id = aa.candidate_id ${CJ} JOIN accommodation_rooms ar ON ar.id = aa.room_id JOIN accommodation_camps ac ON ac.id = ar.camp_id
      ${where(f, p, { dateExpr: 'aa.allocation_date' })} ORDER BY ac.name, ar.room_number, aa.bed_number`,
  },
  {
    key: 'medical_status', no: 6, title: 'Medical examination status report', group: 'Medical & visa', dateLabel: 'Arrival date',
    description: 'UAE visa medical and occupational health status side by side (kept as separate processes).',
    perms: ['reports.view', 'medical.manage'], filters: [...ALL_F],
    columns: [['full_name', 'Name', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['status', 'Stage', 'enum:candidate_status', 18], ['arrival', 'Arrived', 'date', 11],
      ['vm_centre', 'Visa medical centre', 'text', 22], ['vm_attended', 'Attended', 'date', 11], ['vm_result', 'Visa medical result', 'enum:visa_medical_result', 13],
      ['vm_verified', 'Verified', 'text', 9], ['om_clinic', 'Occupational clinic', 'text', 22], ['om_exam', 'Examined', 'date', 11], ['om_fitness', 'Occupational fitness', 'enum:occ_fitness', 16],
      ['restrictions', 'Restrictions', 'text', 22]],
    build: (f, p) => `SELECT c.full_name, c.reference_no, c.status, ${ARR()}::date AS arrival, vm.medical_centre AS vm_centre, vm.attended_date AS vm_attended, coalesce(vm.result, 'pending') AS vm_result,
        CASE WHEN vm.verified_at IS NOT NULL THEN 'Yes' ELSE 'No' END AS vm_verified, om.clinic AS om_clinic, om.exam_date AS om_exam, coalesce(om.fitness, 'pending') AS om_fitness, om.restrictions
      FROM candidates c ${CJ} LEFT JOIN visa_medical_records vm ON vm.candidate_id = c.id AND vm.is_current LEFT JOIN occupational_medical_records om ON om.candidate_id = c.id AND om.is_current
      ${where(f, p, { dateExpr: ARR() })} ${f.status?.length ? '' : `AND c.status IN ('travel_confirmed','arrived','onboarding','awaiting_clearance','ready_for_deployment','deployed')`}
      ORDER BY c.full_name`,
  },
  {
    key: 'visa_processing', no: 7, title: 'Visa processing status report', group: 'Medical & visa', dateLabel: 'Residence visa application date',
    description: 'Entry permit, health insurance card, residence visa and Emirates ID progress per employee, with expiry dates.',
    perms: ['reports.view', 'visa.manage'], filters: [...ALL_F],
    columns: [['full_name', 'Name', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['status', 'Stage', 'enum:candidate_status', 18], ['entry_permit_no', 'Entry permit', 'text', 16],
      ['entry_permit_expiry_date', 'EP expiry', 'date', 11], ['insurance_card_no', 'Insurance card', 'text', 16], ['insurance_expiry_date', 'Insurance expiry', 'date', 11],
      ['residence_application_date', 'Visa applied', 'date', 11], ['residence_status', 'Residence visa', 'enum:residence_status', 13],
      ['residence_expiry_date', 'Visa expiry', 'date', 11], ['eid_number', 'Emirates ID', 'text', 20], ['eid_biometrics_date', 'Biometrics', 'date', 11], ['eid_state', 'EID status', 'text', 14]],
    build: (f, p) => `SELECT c.full_name, c.reference_no, c.status, v.entry_permit_no, v.entry_permit_expiry_date, v.insurance_card_no, v.insurance_expiry_date, v.residence_application_date, coalesce(v.residence_status, 'not_started') AS residence_status,
        v.residence_expiry_date, v.eid_number, v.eid_biometrics_date,
        CASE WHEN v.eid_verified THEN 'Verified' WHEN v.eid_collected_date IS NOT NULL THEN 'Collected' WHEN v.eid_biometrics_date IS NOT NULL THEN 'Biometrics done' ELSE 'Not started' END AS eid_state
      FROM candidates c ${CJ} LEFT JOIN visa_records v ON v.candidate_id = c.id
      ${where(f, p, { dateExpr: 'v.residence_application_date' })} ${f.status?.length ? '' : `AND c.status NOT IN ('cancelled')`} ORDER BY c.full_name`,
  },
  {
    key: 'training_completion', no: 8, title: 'Training completion report', group: 'Training', dateLabel: 'Completion date',
    description: 'Every required course per employee with schedule, result, score, certificate and expiry.',
    perms: ['reports.view', 'training.manage'], filters: [...ALL_F],
    columns: [['full_name', 'Name', 'text', 22], ['trade', 'Trade', 'text', 16], ['course', 'Course', 'text', 30], ['category', 'Category', 'enum:training_category', 16],
      ['mandatory', 'Mandatory', 'text', 9], ['scheduled_date', 'Scheduled', 'date', 11], ['completed_date', 'Completed', 'date', 11], ['score', 'Score', 'int', 7],
      ['status', 'Result', 'enum:training_status', 11], ['certificate', 'Certificate', 'text', 10], ['expiry_date', 'Expiry', 'date', 11]],
    build: (f, p) => `SELECT c.full_name, t.name AS trade, tc.name AS course, tc.category, CASE WHEN tr.is_mandatory THEN 'Yes' ELSE 'No' END AS mandatory, tr.scheduled_date, tr.completed_date,
        tr.score, tr.status, CASE WHEN tr.certificate_document_id IS NOT NULL THEN 'On file' ELSE '' END AS certificate, tr.expiry_date
      FROM training_records tr JOIN candidates c ON c.id = tr.candidate_id ${CJ} JOIN training_courses tc ON tc.id = tr.course_id
      ${where(f, p, { dateExpr: 'tr.completed_date' })} ORDER BY c.full_name, tc.category, tc.name`,
  },
  {
    key: 'uniform_ppe', no: 9, title: 'Uniform and PPE distribution report', group: 'Training', dateLabel: 'Issue date',
    description: 'Items issued per employee with size, quantity, issue date and acknowledgement.',
    perms: ['reports.view', 'uniform.manage'], filters: [...ALL_F],
    columns: [['full_name', 'Name', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['item', 'Item', 'text', 22], ['category', 'Category', 'enum:uniform_category', 12],
      ['size', 'Size', 'text', 7], ['quantity', 'Qty', 'int', 6], ['issue_date', 'Issued', 'date', 11], ['issued_by', 'Issued by', 'text', 18],
      ['acknowledged', 'Acknowledged', 'text', 12], ['acknowledged_date', 'Ack. date', 'date', 11]],
    totals: ['quantity'],
    build: (f, p) => `SELECT c.full_name, c.reference_no, ui.name AS item, ui.category, u.size, u.quantity, u.issue_date, us.full_name AS issued_by,
        CASE WHEN u.acknowledged THEN 'Yes' ELSE 'Pending' END AS acknowledged, u.acknowledged_date
      FROM uniform_issues u JOIN candidates c ON c.id = u.candidate_id ${CJ} JOIN uniform_items ui ON ui.id = u.item_id LEFT JOIN users us ON us.id = u.issued_by
      ${where(f, p, { dateExpr: 'u.issue_date' })} ORDER BY u.issue_date DESC, c.full_name`,
  },
  {
    key: 'department_pending', no: 10, title: 'Department-wise pending activity report', group: 'Onboarding', dateLabel: 'Planned date',
    description: 'Open onboarding activities grouped by department and responsible person.',
    perms: ['reports.view', 'onboarding.view'], filters: [...ALL_F],
    columns: [['department', 'Department', 'text', 20], ['responsible', 'Responsible', 'text', 18], ['seq', '#', 'int', 5], ['activity', 'Activity', 'text', 32],
      ['full_name', 'Employee', 'text', 22], ['planned_date', 'Planned', 'date', 11], ['days', 'Days to due', 'int', 9], ['status', 'Status', 'enum:activity_status', 15]],
    build: (f, p, u) => { deptScope(u, f); return `SELECT d.name AS department, ru.full_name AS responsible, a.seq, a.name AS activity, c.full_name, a.planned_date, (a.planned_date - ${today}) AS days, a.status
      FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id ${CJ} JOIN departments d ON d.id = a.department_id JOIN users ru ON ru.id = a.responsible_user_id
      ${where(f, p, { dateExpr: 'a.planned_date', dept: 'a.department_id' })} AND a.status NOT IN ('completed','not_applicable') AND c.status <> 'cancelled'
      ORDER BY d.name, ru.full_name, a.planned_date NULLS LAST, a.seq`; },
  },
  {
    key: 'overdue_activities', no: 11, title: 'Overdue onboarding activities', group: 'Onboarding', dateLabel: 'Planned date',
    description: 'Activities past their planned date and not completed, most overdue first.',
    perms: ['reports.view', 'onboarding.view'], filters: [...ALL_F],
    columns: [['days_late', 'Days late', 'int', 9], ['full_name', 'Employee', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['seq', '#', 'int', 5], ['activity', 'Activity', 'text', 32],
      ['department', 'Department', 'text', 20], ['responsible', 'Responsible', 'text', 18], ['planned_date', 'Planned', 'date', 11], ['status', 'Status', 'enum:activity_status', 15]],
    build: (f, p, u) => { deptScope(u, f); return `SELECT (${today} - a.planned_date) AS days_late, c.full_name, c.reference_no, a.seq, a.name AS activity, d.name AS department, ru.full_name AS responsible, a.planned_date, a.status
      FROM onboarding_activities a JOIN candidates c ON c.id = a.candidate_id ${CJ} JOIN departments d ON d.id = a.department_id JOIN users ru ON ru.id = a.responsible_user_id
      ${where(f, p, { dateExpr: 'a.planned_date', dept: 'a.department_id' })} AND a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${today} AND c.status <> 'cancelled'
      ORDER BY days_late DESC, c.full_name`; },
  },
  {
    key: 'deployment_readiness', no: 12, title: 'Employee deployment readiness report', group: 'Deployment',
    description: 'The ten final-clearance checks per employee in the UAE, with clearance and deployment status.',
    perms: ['reports.view', 'clearance.approve', 'deployment.manage'], filters: ['project', 'client', 'department', 'nationality', 'agency', 'trade', 'status'],
    columns: [['full_name', 'Employee', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['status', 'Stage', 'enum:candidate_status', 18],
      ...CHECKS.map(([k]): ReportCol => [`chk_${k}`, CHECK_SHORT[k] || k, 'text', 10]),
      ['open_items', 'Open items', 'int', 8], ['deployment', 'Deployment', 'text', 22]],
    orientation: 'landscape',
    build: (f, p) => `SELECT c.full_name, c.reference_no, c.status,
        ${CHECKS.map(([k, , seqs]) => `CASE WHEN NOT EXISTS (SELECT 1 FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.seq = ANY('{${seqs.join(',')}}'::int[]) AND a.status <> 'not_applicable') THEN 'n/a'
          WHEN EXISTS (SELECT 1 FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.seq = ANY('{${seqs.join(',')}}'::int[]) AND a.is_mandatory AND a.status NOT IN ('completed','not_applicable')) THEN 'OPEN' ELSE 'OK' END AS chk_${k}`).join(',\n')},
        (SELECT count(*) FROM onboarding_activities a WHERE a.candidate_id = c.id AND a.is_mandatory AND a.status NOT IN ('completed','not_applicable') AND (a.workflow_key IS NULL OR a.workflow_key NOT IN ('clearance','deployment_approval','deployed')))::int AS open_items,
        (SELECT d.site || ' (' || d.status || ')' FROM deployments d WHERE d.candidate_id = c.id AND d.status <> 'cancelled' ORDER BY d.id DESC LIMIT 1) AS deployment
      FROM candidates c ${CJ} ${where(f, p)} ${f.status?.length ? '' : `AND c.status IN ('arrived','onboarding','awaiting_clearance','ready_for_deployment','deployed')`}
      ORDER BY CASE c.status WHEN 'ready_for_deployment' THEN 0 WHEN 'awaiting_clearance' THEN 1 WHEN 'onboarding' THEN 2 WHEN 'arrived' THEN 3 ELSE 4 END, open_items, c.full_name`,
  },
  {
    key: 'mobilisation_cost', no: 13, title: 'Mobilisation cost report', group: 'Finance', dateLabel: 'Invoice / entry date',
    description: 'Estimated and actual mobilisation cost per employee by category, with variance and payment position.',
    perms: ['finance.view'], filters: [...ALL_F],
    columns: [['full_name', 'Employee', 'text', 22], ['reference_no', 'Ref', 'text', 14], ['nationality', 'Nationality', 'text', 12], ['project', 'Project', 'text', 20], ['agency', 'Agency', 'text', 18],
      ['recruitment', 'Recruitment', 'money', 11], ['travel', 'Flight & transport', 'money', 11], ['government', 'Visa / EID / medical', 'money', 12], ['training', 'Training', 'money', 10],
      ['housing', 'Accommodation', 'money', 11], ['ppe', 'Uniform & PPE', 'money', 10], ['other', 'Other', 'money', 9], ['estimated', 'Estimated', 'money', 11],
      ['actual', 'Actual', 'money', 11], ['variance', 'Variance (invoiced)', 'money', 11], ['unpaid', 'Unpaid', 'money', 10]],
    totals: ['recruitment', 'travel', 'government', 'training', 'housing', 'ppe', 'other', 'estimated', 'actual', 'variance', 'unpaid'],
    build: (f, p) => `SELECT c.full_name, c.reference_no, c.nationality, p.name AS project, coalesce(ra.name, 'Direct hire') AS agency,
        sum(e.actual_cost) FILTER (WHERE e.category = 'recruitment_fee') AS recruitment,
        sum(e.actual_cost) FILTER (WHERE e.category IN ('flight_ticket','airport_transport')) AS travel,
        sum(e.actual_cost) FILTER (WHERE e.category IN ('visa_processing','medical_exam','emirates_id','occupational_medical')) AS government,
        sum(e.actual_cost) FILTER (WHERE e.category = 'training') AS training, sum(e.actual_cost) FILTER (WHERE e.category = 'accommodation') AS housing,
        sum(e.actual_cost) FILTER (WHERE e.category = 'uniform_ppe') AS ppe, sum(e.actual_cost) FILTER (WHERE e.category = 'other') AS other,
        sum(e.estimated_cost) AS estimated, coalesce(sum(e.actual_cost), 0) AS actual,
        coalesce(sum(e.actual_cost), 0) - coalesce(sum(e.estimated_cost) FILTER (WHERE e.actual_cost IS NOT NULL), 0) AS variance,
        coalesce(sum(e.actual_cost) FILTER (WHERE e.payment_status <> 'paid'), 0) AS unpaid
      FROM mobilisation_expenses e JOIN candidates c ON c.id = e.candidate_id ${CJ}
      ${where(f, p, { dateExpr: 'coalesce(e.invoice_date, e.created_at::date)' })} GROUP BY c.id, p.name, ra.name ORDER BY actual DESC, c.full_name`,
  },
  {
    key: 'project_onboarding', no: 14, title: 'Project-wise onboarding report', group: 'Onboarding', dateLabel: 'Selection date',
    description: 'Per project: headcount at each stage, onboarding completion, overdue activities and (finance users) mobilisation cost.',
    perms: ['reports.view'], filters: ['date', 'project', 'client', 'nationality', 'agency', 'trade'],
    columns: [['project', 'Project', 'text', 24], ['client', 'Client', 'text', 18], ['total', 'Total', 'int', 7], ['pre_travel', 'Pre-travel', 'int', 9], ['travel', 'Travel confirmed', 'int', 9],
      ['onboarding', 'In onboarding', 'int', 10], ['awaiting', 'Awaiting clearance', 'int', 10], ['ready', 'Ready', 'int', 7], ['deployed', 'Deployed', 'int', 8], ['on_hold', 'On hold', 'int', 7],
      ['cancelled', 'Cancelled', 'int', 8], ['completion', 'Completion %', 'pct', 10], ['overdue', 'Overdue acts', 'int', 9], ['cost', 'Actual cost (AED)', 'money', 13]],
    totals: ['total', 'pre_travel', 'travel', 'onboarding', 'awaiting', 'ready', 'deployed', 'on_hold', 'cancelled', 'overdue', 'cost'],
    build: (f, p, u) => `SELECT p.name AS project, cl.name AS client, count(*)::int AS total,
        count(*) FILTER (WHERE c.status IN ('selected','pre_arrival'))::int AS pre_travel, count(*) FILTER (WHERE c.status = 'travel_confirmed')::int AS travel,
        count(*) FILTER (WHERE c.status IN ('arrived','onboarding'))::int AS onboarding, count(*) FILTER (WHERE c.status = 'awaiting_clearance')::int AS awaiting,
        count(*) FILTER (WHERE c.status = 'ready_for_deployment')::int AS ready, count(*) FILTER (WHERE c.status = 'deployed')::int AS deployed,
        count(*) FILTER (WHERE c.status = 'on_hold')::int AS on_hold, count(*) FILTER (WHERE c.status = 'cancelled')::int AS cancelled,
        (SELECT round(100.0 * count(*) FILTER (WHERE a.status = 'completed') / nullif(count(*) FILTER (WHERE a.status <> 'not_applicable'), 0))
           FROM onboarding_activities a JOIN candidates c2 ON c2.id = a.candidate_id WHERE c2.project_id = p.id AND c2.status <> 'cancelled')::int AS completion,
        (SELECT count(*) FROM onboarding_activities a JOIN candidates c2 ON c2.id = a.candidate_id WHERE c2.project_id = p.id AND c2.status <> 'cancelled'
           AND a.status NOT IN ('completed','not_applicable') AND a.planned_date < ${today})::int AS overdue,
        ${can(u, 'finance.view') ? `(SELECT coalesce(sum(e.actual_cost), 0) FROM mobilisation_expenses e JOIN candidates c2 ON c2.id = e.candidate_id WHERE c2.project_id = p.id)` : 'NULL'} AS cost
      FROM candidates c ${CJ} ${where(f, p, { dateExpr: 'c.selection_date' })} GROUP BY p.id, cl.name ORDER BY total DESC, p.name`,
  },
];

function parseFilters(q: Record<string, any>): F {
  const n = (v: unknown) => { const x = Number(v); return Number.isInteger(x) && x > 0 ? x : undefined; };
  const f: F = {};
  for (const k of ['from', 'to'] as const) {
    if (q[k]) { if (!validDate(String(q[k]))) throw badRequest(`"${k}" must be a date (YYYY-MM-DD).`); f[k] = String(q[k]); }
  }
  if (f.from && f.to && f.from > f.to) throw badRequest('The start date is after the end date.');
  f.project_id = n(q.project_id); f.client_id = n(q.client_id); f.department_id = n(q.department_id); f.agency_id = n(q.agency_id); f.trade_id = n(q.trade_id);
  if (q.nationality) f.nationality = String(q.nationality).slice(0, 80);
  if (q.status) f.status = String(q.status).split(',').filter((s) => /^[a-z_]{3,30}$/.test(s));
  return f;
}

async function describe(f: F) {
  const parts: string[] = [];
  const name = async (table: string, id?: number, col = 'name') => (id ? (await db.one(`SELECT ${col} AS n FROM ${table} WHERE id = $1`, [id]))?.n : null);
  if (f.from || f.to) parts.push(`Period: ${f.from || '…'} to ${f.to || '…'}`);
  const pairs: [string, string | null][] = [['Project', await name('projects', f.project_id)], ['Client', await name('clients', f.client_id)],
    ['Department', await name('departments', f.department_id)], ['Agency', await name('recruitment_agencies', f.agency_id)], ['Trade', await name('trades', f.trade_id)],
    ['Nationality', f.nationality || null], ['Stage', f.status?.map((s) => label('candidate_status', s)).join(', ') || null]];
  for (const [k, v] of pairs) if (v) parts.push(`${k}: ${v}`);
  return parts.join(' · ') || 'No filters (all records)';
}

const allowed = (u: SessionUser, r: ReportDef) => r.perms.some((p) => can(u, p));

reportsRouter.get('/reports', asyncH(async (req, res) => {
  res.json(REPORTS.filter((r) => allowed(req.user!, r)).map(({ build: _b, ...r }) => r));
}));

reportsRouter.get('/reports/:key', asyncH(async (req, res) => {
  const r = REPORTS.find((x) => x.key === req.params.key);
  if (!r) throw notFound('Report not found.');
  if (!allowed(req.user!, r)) throw forbidden();
  const f = parseFilters(req.query);
  const params: unknown[] = [];
  const sql = r.build(f, params, req.user!);
  const rows = await db.many(sql, params);
  const columns = r.columns.filter(([k]) => !(k === 'cost' && !can(req.user, 'finance.view')));
  const totals = r.totals ? Object.fromEntries(r.totals.filter((k) => columns.some(([c]) => c === k)).map((k) => [k, rows.reduce((s, x) => s + Number(x[k] || 0), 0)])) : null;
  const format = String(req.query.format || 'json');
  if (format === 'json') return res.json({ report: { key: r.key, no: r.no, title: r.title, description: r.description, dateLabel: r.dateLabel }, columns, rows: rows.slice(0, 1000), total: rows.length, totals, filters: await describe(f) });
  if (!['xlsx', 'pdf'].includes(format)) throw badRequest('Format must be xlsx or pdf.');
  const s = await getSettings();
  const meta = { title: `${r.no}. ${r.title}`, company: s.company_name, filters: await describe(f), user: req.user!.full_name, count: rows.length, orientation: r.orientation };
  await audit(db, req, 'export', 'reports', r.no, null, { report: r.key, format, rows: rows.length, filters: f });
  if (format === 'xlsx') return sendReportXlsx(res, meta, columns, rows, totals);
  return sendReportPdf(res, meta, columns, rows, totals);
}));

export { parseFilters };
