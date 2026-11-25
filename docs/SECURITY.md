# IEOMMS — Security Controls and Validation

Automated checks live in `server/tests/security.test.ts` and run with `npm test` against a real HTTP server and database.
Result at the end of Phase 5: **all security tests pass** (55/55 tests in the full suite) and `npm audit --omit=dev` reports **0 vulnerabilities**.

## Controls

| Area | Control | Verified by |
|---|---|---|
| Authentication | Server-side sessions; only a SHA-256 of the token is stored; 10-hour sliding expiry; logout deletes the session | session test |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` in production | cookie test |
| Passwords | bcrypt (cost 12); minimum 10 characters with upper, lower and digit; temporary passwords must be changed before any write (HTTP 428); resets and deactivation revoke all sessions | password tests |
| Brute force | Lock-out after 5 failed attempts for 15 minutes; login rate limit (20 per 15 min per client); usernames cannot be enumerated (constant-time failure path) | lock-out + rate-limit tests |
| Authorisation | Every route declares its permission; **every one of the 100+ API routes rejects anonymous calls** (enumerated automatically); role refusals sampled across all modules | route sweep + role matrix test |
| Data minimisation | Salary hidden without `candidates.salary`; ticket and mobilisation costs hidden without finance/mobility access; documents need `documents.view`; notifications are per-user | sensitive-field tests |
| Segregation of duties | Approvers cannot approve their own requests (flights, activity verification, expenses, deployment) unless granted `approvals.self` | phase 2–4 tests |
| Injection | All SQL is parameterised; sort columns, table names and report definitions come from fixed allow-lists; filters are validated | injection test (search, sort, filter, report params) |
| CSRF | SameSite=Strict cookie plus rejection of cross-origin state-changing requests | header test |
| Uploads | File type detected from content (PDF / JPG / PNG only), 4 MB limit, random stored names outside the web root, served only through permission-checked routes with `nosniff` | upload test |
| Headers | Content-Security-Policy, `X-Content-Type-Options: nosniff`, frame protection, no `X-Powered-By`, `Cache-Control: no-store` on API responses | header test |
| Error handling | Internal errors return a generic message; details are logged server-side only; malformed JSON → 400 | error test |
| Audit | Every change, status move, approval, upload, download, export, login and failed login is written to `audit_logs` with old/new values (secrets stripped) | audit tests (phase 1, 5) |
| Backups | Automatic daily backup of database + documents (keeps 30), manual backup for administrators | backup test |
| Dependencies | Express 4.22.3, nodemailer 10.6.1, `uuid` override for ExcelJS | `npm audit` |

## Operational recommendations
* Run behind HTTPS (reverse proxy) with `NODE_ENV=production`; set `ADMIN_PASSWORD` for the first start or change the generated one immediately.
* Use an external PostgreSQL server (`DATABASE_URL`) with encrypted storage for production, and copy `data/backups` (or `pg_dump` files) off the server.
* Configure `SMTP_URL` / `SMTP_FROM` with an authenticated, TLS-enabled mail relay.
* Review the role/permission matrix (User Management → Roles & permissions) before go-live; grant `approvals.self` to no one except the Super Administrator.
