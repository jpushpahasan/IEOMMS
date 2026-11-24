// Backup: embedded DB -> compressed data-directory dump + copy of uploads. External PostgreSQL -> use pg_dump (see README).
// Schedule daily with Windows Task Scheduler / cron:  npm run backup
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.ts';

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const dir = path.join(config.backupDir, stamp);
fs.mkdirSync(dir, { recursive: true });

if (config.databaseUrl) {
  console.log('External PostgreSQL detected. Run: pg_dump --format=custom --file="' + path.join(dir, 'ieomms.dump') + '" "$DATABASE_URL"');
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const pg = new PGlite(config.pgliteDir);
  await pg.waitReady;
  const blob = await pg.dumpDataDir('gzip');
  fs.writeFileSync(path.join(dir, 'pgdata.tar.gz'), Buffer.from(await blob.arrayBuffer()));
  await pg.close();
}
if (fs.existsSync(config.uploadDir)) fs.cpSync(config.uploadDir, path.join(dir, 'uploads'), { recursive: true });

// Retention: keep the 30 most recent backups.
const all = fs.readdirSync(config.backupDir).sort();
for (const old of all.slice(0, Math.max(0, all.length - 30))) fs.rmSync(path.join(config.backupDir, old), { recursive: true, force: true });
console.log(`Backup written to ${dir}`);
