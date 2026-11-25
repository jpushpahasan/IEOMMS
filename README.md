# IEOMMS — International Employee Onboarding & Mobility Management System

Web application that tracks every selected international candidate from selection to deployment in the UAE.
See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design, and [docs/PHASE-1.md](docs/PHASE-1.md) / [PHASE-2](docs/PHASE-2.md) / [PHASE-3](docs/PHASE-3.md) / [PHASE-4](docs/PHASE-4.md) / [PHASE-5](docs/PHASE-5.md) for each phase's database changes and workflows.

**Status: all 5 phases complete.** Covers authentication, roles and permissions, candidate registration (with Excel import, documents and archive), the audit log, flight bookings with agency quotations and approval, airport pickups, accommodation (camps, rooms, beds, check-in), the 49-activity onboarding checklist with templates, departmental task lists and verification, medical (visa and occupational, kept separate), visa, health insurance card & Emirates ID, training templates per trade, uniform & PPE with acknowledgement, the employee master, the document repository with expiry alerts, mobilisation cost tracking with finance verification, in-app and e-mail notifications with configurable reminders, an approvals inbox, final clearance and deployment, the executive dashboard with an at-a-glance panel for management, 14 management reports with Excel/PDF export, automatic daily backups, and an automated security test suite (see docs/SECURITY.md).

## Requirements
* Node.js 22.18 or newer (runs the TypeScript server directly)
* Optional: PostgreSQL 14+ for production. Without `DATABASE_URL`, an embedded PostgreSQL (PGlite) is stored in `data/pgdata`.

## Run locally
```powershell
npm install
npm run db:demo      # fresh database with demo master data, 10 role users, 46 candidates, travel and accommodation
npm start            # API on http://localhost:4100
npm run dev:web      # UI on http://localhost:5180 (proxies /api)
```
Demo sign-ins (local demo data only — `server/scripts/seed-demo.ts`): `admin` / `Admin@2026x`, and every role user
(`ceo`, `hr.manager`, `recruiter`, `mobility`, `pro`, `medical`, `training`, `accommodation`, `finance`, `operations`) with `Welcome@2026`.

On a fresh, non-demo database the first start prints a generated administrator password; the administrator must change it at first sign-in.
Set `ADMIN_PASSWORD` to choose it instead.

## Production
```powershell
npm run build                     # builds the UI into dist/, served by the API
$env:NODE_ENV = "production"; $env:DATABASE_URL = "postgres://user:pass@host:5432/ieomms"; npm start
```
Run behind HTTPS (cookies are marked `Secure` in production). Settings: `PORT`, `DATABASE_URL`, `DATABASE_SSL`, `DATA_DIR`,
`SESSION_HOURS`, `MAX_UPLOAD_MB`, `ADMIN_USERNAME`, `ADMIN_PASSWORD`, `LOGIN_RATE_LIMIT`,
`SMTP_URL` / `SMTP_FROM` (e-mail notifications; without them e-mails are held in the outbox), `NOTIFICATIONS=off` (disable the hourly notification run).

## Deploying on Vercel
See [docs/DEPLOY-VERCEL.md](docs/DEPLOY-VERCEL.md): Neon Postgres for the database, private Vercel Blob for documents, Vercel Cron for daily reminders, and `npm run db:migrate-to-vercel` to copy existing data.

## Backups
The running server backs up the database and uploaded documents every day after 02:00 GST (`BACKUP_HOUR`) into `data/backups`, keeping the latest 30 (`BACKUP_KEEP`); administrators can also run a backup from Settings. `npm run backup` does the same while the server is stopped.
Schedule it daily (Windows Task Scheduler / cron). With an external PostgreSQL server, use `pg_dump` and back up `data/uploads`.

## Quality checks
```powershell
npm test             # 55 integration + security tests against a throw-away database
npm run typecheck    # TypeScript, server and client
```
