// Reset the embedded development database. `--demo` loads demo reference data, users and candidates.
// Refuses to run against an external PostgreSQL server (DATABASE_URL) to protect production data.
import fs from 'node:fs';
import { config } from '../config.ts';
import { initDb, db } from '../db/index.ts';
import { bootstrap } from '../db/bootstrap.ts';
import { seedDemo } from './seed-demo.ts';

if (config.databaseUrl) {
  console.error('Refusing to reset: DATABASE_URL points at an external PostgreSQL server.');
  process.exit(1);
}
fs.rmSync(config.pgliteDir, { recursive: true, force: true });
fs.rmSync(config.uploadDir, { recursive: true, force: true });
await initDb();
const demo = process.argv.includes('--demo');
await bootstrap({ adminPassword: demo ? 'Admin@2026x' : undefined });
if (demo) await seedDemo();
await db.close();
console.log(demo ? 'Database reset with demo data.' : 'Database reset.');
