# Phase 1 — Foundation & Candidate Registration

## 1. Database changes

All tables are in `server/db/schema.sql`.

### Security & access
| Table | Purpose |
|---|---|
| `roles` | The 11 roles in the specification (Super Administrator … Operations/Project Team). |
| `permissions` | Permission codes grouped by module. Codes for later phases are seeded now so the role matrix is complete from day one. |
| `role_permissions` | Many-to-many role ↔ permission. Editable by Super Administrator. |
| `users` | Login accounts: bcrypt hash, role, department, lockout counters, forced password change. |
| `sessions` | Server-side sessions (only a SHA-256 of the cookie token is stored). |
| `audit_logs` | Who did what, when, from where, with old/new JSON values. |
| `system_settings` | Key/value JSON settings (company name, reference prefix, passport validity rule…). |

### Reference (master) data
| Table | Purpose |
|---|---|
| `departments` | The 10 onboarding departments (Recruitment, HR, International Mobility, PRO, Medical Coordination, Training, Accommodation, Administration, Operations, Finance). |
| `clients`, `projects` | Project belongs to a client; candidate is assigned to a project, so "project/client" comes from one choice. |
| `recruitment_agencies` | Agency master (country, licence, contacts). |
| `trades` | Trade/category master (Driver, Scaffolder, Rigger, Helper, Technician, Nurse…). Phase 3 attaches training templates to trades. |
| `reference_counters` | Year-scoped counters used to issue the unique candidate reference number under a row lock (`IEO-2026-00001`). |

### Candidates
| Table | Purpose |
|---|---|
| `candidates` | One row per selected person for the whole lifecycle. Personal (A), employment (B) and additional (C) sections of Module 1. Total salary is a generated column (basic + housing + transport + food + other allowances). Lifecycle `status` uses the 10 statuses of Module 10. |
| `candidate_status_history` | Every status change with reason, user and time (feeds the profile timeline). |
| `employee_documents` | Document store (built for Module 6): category, version number, `is_current`, document number, issue/expiry dates, file metadata and SHA-256. Re-uploading the same category creates a new version and keeps the old one. |

Constraints: unique reference number; one active (not archived, not cancelled) candidate per passport number + issuing country; salary components ≥ 0; passport expiry after issue date; foreign keys to every master.

## 2. Workflows

### Candidate registration
1. Recruitment / HR opens **Candidates → New candidate**, completes sections A–C (required: name, gender, DOB, nationality, passport number/country/dates, position, trade, project, selection date).
2. Server validates every field and returns all errors at once. Warnings (not blockers): passport valid for less than 6 months from expected joining date; candidate under 18 or over 65.
3. On save, a reference number is issued inside the same transaction, status = **Selected**, history and audit rows written.
4. Passport copy, photograph and other documents (PDF/JPG/PNG ≤ 4 MB) are uploaded from the profile; the photograph becomes the profile picture.

### Excel import
1. Download the template (columns + a "Lists" sheet with valid trades, projects, agencies, departments).
2. Upload → **dry run** shows each row as OK or with errors; nothing is saved.
3. Confirm → valid rows are created in one transaction, each with its own reference number. Rows with errors are skipped and reported.

### Status changes (Phase 1 scope)
Manual changes allowed now: Selected ⇄ Pre-arrival Processing, any active status → **On Hold** (with reason; resumes to the status it was in), any status → **Cancelled** (reason + category: rejected by company, candidate withdrew, medical unfit, visa rejected, other). Travel, arrival, onboarding, clearance and deployment statuses are set by the workflows of later phases — they cannot be typed in by hand, so "Ready for Deployment" and "Deployed" can never be reached without the final clearance and deployment confirmation.

### Archive
Only cancelled candidates can be archived. Archived records disappear from working lists (a filter shows them) and are retained for history and reports. Restore is available to HR Manager / Super Administrator.

## 3. Roles in Phase 1

| Capability | Roles |
|---|---|
| View candidates | All roles |
| Create / edit / import candidates | Super Admin, HR Manager, Recruitment |
| See salary fields | Super Admin, Management, HR Manager, Recruitment, Finance |
| Cancel / hold / archive / restore | Super Admin, HR Manager (cancel & hold also Recruitment) |
| Upload documents | Super Admin, HR Manager, Recruitment, Mobility, PRO, Medical, Training |
| Manage master data | Super Admin, HR Manager |
| Users, roles, settings, audit log | Super Admin (audit log also Management, HR Manager) |
