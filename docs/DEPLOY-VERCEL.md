# Deploying IEOMMS on Vercel

On Vercel the web pages are served from Vercel's CDN and every `/api/*` request runs the Express server as a Vercel Function (`api/index.ts`, routed by `vercel.json`).
Vercel Functions have no lasting disk, so the app uses hosted services instead of the local `data/` folder:

| Local (your PC) | On Vercel |
|---|---|
| Embedded database in `data/pgdata` | **Neon Postgres** (`DATABASE_URL`) |
| Documents in `data/uploads` | **Vercel Blob**, private store (`BLOB_READ_WRITE_TOKEN`) |
| Hourly reminder run | **Vercel Cron**, daily at 03:00 UTC (07:00 GST) → `/api/cron/daily`; reminders also refresh whenever someone opens their notifications |
| Daily backups in `data/backups` | **Neon** backups / point-in-time restore |

## One-time setup (Vercel dashboard → your project)
1. **Storage → Create → Neon (Postgres).** Connect it to the project. Vercel adds `DATABASE_URL`.
2. **Storage → Create → Blob**, choose **Private** access. Connect it to the project. Vercel adds `BLOB_READ_WRITE_TOKEN`.
3. **Settings → Environment Variables**, add:
   * `CRON_SECRET`: a long random value (at least 32 characters). Vercel sends it to the daily job; without it the job is refused.
   * `NODE_ENV` = `production`
   * Optional: `SMTP_URL` and `SMTP_FROM` for e-mail notifications.
4. **Copy your data** (from this PC, see below), then **Deployments → Redeploy**.

## Copying the current data
Run in PowerShell in the project folder. Paste the two values from the Vercel dashboard (Storage → each store → `.env.local` tab). Don't put them in any file.
```powershell
$env:DATABASE_URL = "<DATABASE_URL from the Neon store>"
$env:BLOB_READ_WRITE_TOKEN = "<BLOB_READ_WRITE_TOKEN from the Blob store>"
npm.cmd run db:migrate-to-vercel
```
The script reads the newest backup in `data/backups` (make a fresh one first: Settings → General → Back up now), copies every table, and uploads the documents.
It refuses to run if the hosted database already holds data. If only the documents failed, re-run with `-- --documents-only`.

## Limits on Vercel
* Uploads: 4 MB per file (Vercel's request limit is 4.5 MB).
* The sign-in rate limit is counted per function instance; account lock-out after 5 failed attempts still applies everywhere.
* Preview deployments are protected by Vercel Authentication; the production domain is public.
