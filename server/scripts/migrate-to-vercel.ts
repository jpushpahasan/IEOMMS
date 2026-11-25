// One-time copy of a local IEOMMS backup into the hosted services used on Vercel:
//   database  -> PostgreSQL at DATABASE_URL (e.g. Neon)
//   documents -> Vercel Blob (private store) when BLOB_READ_WRITE_TOKEN is set
//
// Usage (PowerShell, in the project folder):
//   $env:DATABASE_URL = "<Neon connection string>"; $env:BLOB_READ_WRITE_TOKEN = "<Blob read-write token>"
//   npm.cmd run db:migrate-to-vercel                 # newest backup in data/backups
//   npm.cmd run db:migrate-to-vercel -- <backup dir>  # a specific backup
//   npm.cmd run db:migrate-to-vercel -- --documents-only   # only copy the documents (database already copied)
//
// Reads only the backup (safe while the local app runs). Refuses to write into a database that already has users.
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';
import { db, initDb } from '../db/index.ts';
import { bootstrap } from '../db/bootstrap.ts';
import crypto from 'node:crypto';
import { putFile, storageKind } from '../lib/storage.ts';

const SKIP = new Set(['sessions']); // everyone signs in again on the new server
const BATCH = 500;

if (!config.databaseUrl) { console.error('Set DATABASE_URL to the hosted PostgreSQL connection string first.'); process.exit(1); }

const documentsOnly = process.argv.includes('--documents-only');
const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
const backups = fs.existsSync(config.backupDir) ? fs.readdirSync(config.backupDir).filter((d) => fs.existsSync(path.join(config.backupDir, d, 'pgdata.tar.gz'))).sort() : [];
const src = arg ? path.resolve(arg) : backups.length ? path.join(config.backupDir, backups.at(-1)!) : '';
if (!src || !fs.existsSync(path.join(src, 'pgdata.tar.gz'))) { console.error('No backup found. In the app, use Settings → General → "Back up now", then run this again.'); process.exit(1); }
console.log(`Source backup: ${src}`);

// ---------------------------------------------------------------- source: the backup, opened in memory
const { PGlite } = await import('@electric-sql/pglite');
const source = new PGlite({ loadDataDir: new Blob([fs.readFileSync(path.join(src, 'pgdata.tar.gz'))]) });
await source.waitReady;

// ---------------------------------------------------------------- target: hosted PostgreSQL with the current schema
await initDb();
if (!documentsOnly) await copyDatabase();

async function copyDatabase() {
// Empty = no candidates and at most the administrator the app creates on its first start.
const existing = (await db.one<{ users: number; candidates: number }>('SELECT (SELECT count(*)::int FROM users) AS users, (SELECT count(*)::int FROM candidates) AS candidates'))!;
if (existing.users > 1 || existing.candidates > 0) {
  console.error(`The target database already holds data (${existing.users} users, ${existing.candidates} candidates). Nothing was copied, to avoid overwriting it.`);
  process.exit(1);
}
// Creates the helper tables the app adds at start-up; its default rows are replaced by the copy below.
await bootstrap({ quiet: true, adminPassword: `Tmp-${crypto.randomBytes(9).toString('base64url')}1a` });

const tables = (await source.query<{ t: string }>(`SELECT table_name AS t FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE' ORDER BY table_name`)).rows.map((r) => r.t).filter((t) => !SKIP.has(t));
const fks = (await source.query<{ child: string; parent: string }>(`SELECT c.conrelid::regclass::text AS child, c.confrelid::regclass::text AS parent
  FROM pg_constraint c WHERE c.contype = 'f' AND c.conrelid <> c.confrelid`)).rows;

// Parents before children.
const order: string[] = [];
const seen = new Set<string>();
const visit = (t: string, stack = new Set<string>()) => {
  if (seen.has(t) || stack.has(t)) return;
  stack.add(t);
  for (const f of fks) if (f.child === t && tables.includes(f.parent)) visit(f.parent, stack);
  seen.add(t);
  order.push(t);
};
tables.forEach((t) => visit(t));

await db.tx(async (q) => {
  // Some tables reference each other (e.g. departments <-> users): check foreign keys once, after all rows are in.
  const cons = (await q.query(`SELECT conrelid::regclass::text AS t, conname AS c FROM pg_constraint
    WHERE contype = 'f' AND connamespace = 'public'::regnamespace AND NOT condeferrable`)).rows;
  for (const k of cons) await q.query(`ALTER TABLE ${k.t} ALTER CONSTRAINT "${k.c}" DEFERRABLE INITIALLY IMMEDIATE`);
  await q.query('SET CONSTRAINTS ALL DEFERRED');
  // Bootstrap may not have run yet, but clear any rows it could have added so ids match the source exactly.
  for (const t of [...order].reverse()) await q.query(`DELETE FROM "${t}"`);
  for (const t of order) {
    const cols = (await q.query(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 AND is_generated = 'NEVER' ORDER BY ordinal_position`, [t])).rows.map((r) => `"${r.column_name}"`);
    const byId = cols.includes('"id"') ? ' ORDER BY x.id' : '';
    const rows = (await source.query<{ j: unknown }>(`SELECT to_jsonb(x) AS j FROM "${t}" x${byId}`)).rows.map((r) => r.j);
    for (let i = 0; i < rows.length; i += BATCH) {
      await q.query(`INSERT INTO "${t}" (${cols.join(', ')}) SELECT ${cols.join(', ')} FROM jsonb_populate_recordset(NULL::"${t}", $1::jsonb)`,
        [JSON.stringify(rows.slice(i, i + BATCH))]);
    }
    // Continue numbering after the copied ids.
    for (const r of (await q.query(`SELECT column_name AS c, pg_get_serial_sequence($1, column_name) AS s FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = $2`, [`"${t}"`, t])).rows) {
      if (r.s) await q.query(`SELECT setval($1, GREATEST(COALESCE((SELECT max("${r.c}") FROM "${t}"), 0), 1), (SELECT count(*) > 0 FROM "${t}"))`, [r.s]);
    }
    console.log(`  ${t.padEnd(36)} ${rows.length}`);
  }
  await q.query('SET CONSTRAINTS ALL IMMEDIATE'); // every link is verified here
  for (const k of cons) await q.query(`ALTER TABLE ${k.t} ALTER CONSTRAINT "${k.c}" NOT DEFERRABLE`);
});
console.log('Database copied.');
}

// ---------------------------------------------------------------- documents
const uploads = path.join(src, 'uploads');
const names = (await db.many<{ stored_name: string; mime_type: string }>('SELECT stored_name, mime_type FROM employee_documents'));
if (storageKind !== 'vercel-blob') {
  console.log('Documents not copied: set BLOB_READ_WRITE_TOKEN, then run "npm.cmd run db:migrate-to-vercel -- --documents-only".');
} else {
  let copied = 0, missing = 0;
  for (const d of names) {
    const file = path.join(uploads, d.stored_name);
    if (!fs.existsSync(file)) { missing++; continue; }
    try { await putFile(d.stored_name, fs.readFileSync(file), d.mime_type); copied++; } catch (e: any) {
      if (/already exists/i.test(e?.message || '')) copied++; else throw e;
    }
  }
  console.log(`Documents copied to Vercel Blob: ${copied}${missing ? ` (${missing} listed in the database but missing from the backup)` : ''}.`);
}
await source.close();
await db.close();
console.log('Done.');
