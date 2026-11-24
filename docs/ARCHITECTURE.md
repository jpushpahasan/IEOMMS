# IEOMMS — Application Architecture

International Employee Onboarding & Mobility Management System.

## Stack

| Layer | Technology | Notes |
|---|---|---|
| Frontend | React 18 + TypeScript, Vite, Tailwind CSS 4, lucide-react icons, Recharts | SPA served by the API in production (`dist/`) |
| Backend | Node.js (≥ 22.18, native TypeScript type-stripping), Express 4 REST API | No build step for the server; `npm run typecheck` runs `tsc` |
| Database | PostgreSQL | `DATABASE_URL` set → real PostgreSQL server via `pg` pool. Not set → embedded PostgreSQL (PGlite) persisted in `data/pgdata` for development / single-server pilots. Same SQL, same schema file. |
| Auth | Server-side sessions, bcrypt (cost 12) password hashes, HttpOnly + SameSite=Strict cookie, sliding expiry, lockout after 5 failed sign-ins, rate-limited login, same-origin check on state-changing requests | |
| Files | Stored outside the web root in `data/uploads` with random names; served only through `/api/documents/:id/file` after a permission check; SHA-256 recorded | |
| Exports | ExcelJS (xlsx) and PDFKit (PDF) | |

## Layout

```
ieomms/
  server/
    index.ts            app wiring, security middleware, error handler, startup
    config.ts           environment configuration
    db/schema.sql       idempotent schema (CREATE … IF NOT EXISTS) — single source of truth
    db/index.ts         pg / PGlite adapter: query, one, many, tx
    db/bootstrap.ts     roles, permissions, default admin, reference data
    lib/                http errors, auth, RBAC, audit, validation helpers
    modules/            one file per domain module (routes + service logic)
    scripts/            reset / demo data / backup
    tests/              node:test integration tests (run against a throw-away embedded DB)
  client/src/
    lib/                api client, auth context, formatting, enums
    components/         layout, UI kit (table, form fields, modal, badges)
    pages/              screens per module
  docs/                 architecture and per-phase design notes
```

## Cross-cutting rules

* **RBAC** — roles map to permission codes (`candidates.create`, `finance.verify`, …). Every API route declares the permission it needs; the UI hides what the user cannot do, but the server is the authority.
* **Audit** — every create / update / status change / archive / upload / login is written to `audit_logs` with old and new values (passwords and hashes stripped).
* **Validation** — every write goes through a field-level validator that returns all errors at once (`400 { error, details: { field: message } }`), shown inline on the form.
* **Money** — `NUMERIC(12,2)`; values travel as strings to avoid floating-point drift. Currency AED.
* **Time zone** — database session time zone `Asia/Dubai`; dates are `DATE` (no time-zone shift).
* **Soft lifecycle** — candidates are never hard-deleted. Cancelled candidates are kept and can be archived (hidden from working lists, still in reports).
* **Configurable regulation** — status lists, document categories, onboarding templates and reminder intervals live in tables/settings, not code, so UAE rule changes are configuration.

## Phase plan

| Phase | Scope | Status |
|---|---|---|
| 1 | Architecture, database, authentication, roles, candidate registration (+ import, documents, archive, audit) | **Built** — see `PHASE-1.md` |
| 2 | Travel agencies, flight bookings & quotations, airport pickups, accommodation | **Built** — see `PHASE-2.md` |
| 3 | Onboarding checklist & templates, departmental tasks, medical, visa, training, uniform/PPE, employee master | **Built** — see `PHASE-3.md` |
| 4 | Document repository, financial tracking, notifications, approval workflows, final clearance & deployment | **Built** — see `PHASE-4.md` |
| 5 | Executive dashboard, management reports, Excel/PDF exports, backups, security validation | **Built** — see `PHASE-5.md` and `SECURITY.md` |
