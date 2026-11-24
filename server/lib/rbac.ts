// Role-based access control catalogue. Seeded into roles / permissions / role_permissions on start-up
// (only missing rows are inserted, so changes made by the administrator in the UI are preserved).

export const PERMISSIONS: Record<string, { module: string; description: string }> = {
  'dashboard.view':        { module: 'Dashboard', description: 'View dashboards' },
  'candidates.view':       { module: 'Candidates', description: 'View candidate register and profiles' },
  'candidates.create':     { module: 'Candidates', description: 'Register new candidates' },
  'candidates.edit':       { module: 'Candidates', description: 'Edit candidate information' },
  'candidates.import':     { module: 'Candidates', description: 'Import candidates from Excel' },
  'candidates.salary':     { module: 'Candidates', description: 'View and edit salary details' },
  'candidates.status':     { module: 'Candidates', description: 'Put candidates on hold / cancel / resume' },
  'candidates.archive':    { module: 'Candidates', description: 'Archive and restore cancelled candidates' },
  'documents.view':        { module: 'Documents', description: 'View and download employee documents' },
  'documents.upload':      { module: 'Documents', description: 'Upload employee documents' },
  'masters.manage':        { module: 'Settings', description: 'Manage projects, clients, trades, agencies, departments' },
  'users.manage':          { module: 'Administration', description: 'Manage users and role permissions' },
  'settings.manage':       { module: 'Administration', description: 'Change system settings' },
  'audit.view':            { module: 'Administration', description: 'View the audit log' },
  // Phase 2+
  'mobility.view':         { module: 'Mobility', description: 'View travel agencies, bookings and pickups' },
  'mobility.manage':       { module: 'Mobility', description: 'Manage travel agencies, flight bookings and airport pickups' },
  'mobility.approve':      { module: 'Mobility', description: 'Approve flight quotations' },
  'accommodation.view':    { module: 'Accommodation', description: 'View camps, rooms and allocations' },
  'accommodation.manage':  { module: 'Accommodation', description: 'Manage camps, rooms and bed allocations' },
  'onboarding.view':       { module: 'Onboarding', description: 'View onboarding checklists' },
  'onboarding.update':     { module: 'Onboarding', description: 'Update assigned onboarding activities' },
  'onboarding.verify':     { module: 'Onboarding', description: 'Verify / approve onboarding activities' },
  'onboarding.templates':  { module: 'Onboarding', description: 'Manage onboarding and training templates' },
  'medical.manage':        { module: 'Medical', description: 'Manage medical appointments and results' },
  'visa.manage':           { module: 'Visa & Immigration', description: 'Manage visa, Emirates ID and immigration records' },
  'training.manage':       { module: 'Training', description: 'Manage training schedules, attendance and competency' },
  'uniform.manage':        { module: 'Uniform & PPE', description: 'Manage uniform, PPE and ID card distribution' },
  'finance.view':          { module: 'Finance', description: 'View mobilisation costs' },
  'finance.manage':        { module: 'Finance', description: 'Record mobilisation expenses' },
  'finance.verify':        { module: 'Finance', description: 'Verify expenses and invoices' },
  'clearance.approve':     { module: 'Clearance', description: 'Approve final onboarding clearance' },
  'deployment.manage':     { module: 'Deployment', description: 'Confirm deployment and reporting to work' },
  'reports.view':          { module: 'Reports', description: 'View and export management reports' },
  'employees.manage':      { module: 'Employee Master', description: 'Register employees (HR registration) and maintain the employee master' },
  'approvals.self':        { module: 'Administration', description: 'Approve requests they submitted themselves (business rule 13)' },
};

const ALL = Object.keys(PERMISSIONS);
const COMMON = ['dashboard.view', 'candidates.view', 'onboarding.view', 'onboarding.update'];
const DOCS = ['documents.view', 'documents.upload'];

export const ROLES: Record<string, { name: string; description: string; permissions: string[] }> = {
  super_admin: { name: 'Super Administrator', description: 'Full system access and configuration', permissions: ALL },
  management: {
    name: 'CEO / Management', description: 'Executive dashboard, reports, financial overview and full visibility',
    permissions: ['dashboard.view', 'candidates.view', 'candidates.salary', 'documents.view', 'mobility.view', 'accommodation.view',
      'onboarding.view', 'finance.view', 'reports.view', 'audit.view', 'mobility.approve'],
  },
  hr_manager: {
    name: 'HR Manager', description: 'Candidate management, onboarding monitoring and final clearance approval',
    permissions: [...COMMON, 'candidates.create', 'candidates.edit', 'candidates.import', 'candidates.salary', 'candidates.status',
      'candidates.archive', ...DOCS, 'masters.manage', 'audit.view', 'mobility.view', 'accommodation.view',
      'onboarding.verify', 'onboarding.templates', 'clearance.approve', 'reports.view', 'finance.view', 'mobility.approve', 'employees.manage'],
  },
  recruitment: {
    name: 'Recruitment Team', description: 'Candidate registration and selection information',
    permissions: [...COMMON, 'candidates.create', 'candidates.edit', 'candidates.import', 'candidates.salary', 'candidates.status', ...DOCS],
  },
  mobility: {
    name: 'Mobility Coordinator', description: 'Travel agencies, flight bookings and airport pickups',
    permissions: [...COMMON, ...DOCS, 'mobility.view', 'mobility.manage', 'accommodation.view'],
  },
  pro: { name: 'PRO Team', description: 'Immigration, visa and government formalities', permissions: [...COMMON, ...DOCS, 'visa.manage'] },
  medical: { name: 'Medical Coordinator', description: 'Medical appointments and medical status', permissions: [...COMMON, ...DOCS, 'medical.manage'] },
  training: { name: 'Training Coordinator', description: 'Training schedules, attendance and competency', permissions: [...COMMON, ...DOCS, 'training.manage', 'uniform.manage'] },
  accommodation: { name: 'Accommodation Coordinator', description: 'Camp management and room allocation', permissions: [...COMMON, 'accommodation.view', 'accommodation.manage'] },
  finance: {
    name: 'Finance', description: 'Mobilisation expenditure and invoice verification',
    permissions: ['dashboard.view', 'candidates.view', 'candidates.salary', 'documents.view', 'finance.view', 'finance.manage', 'finance.verify', 'reports.view', 'mobility.view'],
  },
  operations: {
    name: 'Operations / Project Team', description: 'Employee deployment and reporting confirmation',
    permissions: [...COMMON, 'deployment.manage', 'reports.view', 'accommodation.view', 'mobility.view'],
  },
};

export const DEPARTMENTS: [string, string][] = [
  ['REC', 'Recruitment'], ['HR', 'Human Resources'], ['MOB', 'International Mobility'], ['PRO', 'PRO / Government Relations'],
  ['MED', 'Medical Coordination'], ['TRN', 'Training'], ['ACC', 'Accommodation'], ['ADM', 'Administration'],
  ['OPS', 'Operations / Project'], ['FIN', 'Finance'],
];

export interface SessionUser {
  id: number; username: string; full_name: string; email: string | null; role: string; role_name: string;
  department_id: number | null; must_change_password: boolean; permissions: string[];
}

export const can = (u: SessionUser | undefined, p: string) => !!u && u.permissions.includes(p);
