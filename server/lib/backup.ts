// Automated backups: database + uploaded documents into data/backups/<timestamp>, keeping the most recent N.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config.ts';
import { db } from '../db/index.ts';

const KEEP = Number(process.env.BACKUP_KEEP || 30);
const HOUR = Number(process.env.BACKUP_HOUR ?? 2); // Gulf Standard Time
let running: Promise<unknown> | null = null;

function pgDump(file: string) {
  return new Promise<void>((resolve, reject) => {
    const p = spawn('pg_dump', ['--format=custom', `--file=${file}`, config.databaseUrl], { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    p.stderr.on('data', (d) => { err += d; });
    p.on('error', (e) => reject(new Error(`pg_dump not available: ${e.message}`)));
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(err.trim() || `pg_dump exited with ${code}`))));
  });
}

export async function runBackup(reason = 'scheduled') {
  if (running) return running;
  running = (async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dir = path.join(config.backupDir, stamp);
    fs.mkdirSync(dir, { recursive: true });
    const info: Record<string, unknown> = { started_at: new Date().toISOString(), reason, database: db.kind };
    try {
      if (db.kind === 'pglite') {
        const buf = await db.dump();
        if (buf) { fs.writeFileSync(path.join(dir, 'pgdata.tar.gz'), buf); info.database_bytes = buf.length; }
      } else {
        await pgDump(path.join(dir, 'ieomms.dump'));
        info.database_bytes = fs.statSync(path.join(dir, 'ieomms.dump')).size;
      }
      if (fs.existsSync(config.uploadDir)) {
        fs.cpSync(config.uploadDir, path.join(dir, 'uploads'), { recursive: true });
        info.documents = fs.readdirSync(config.uploadDir).length;
      }
      info.status = 'ok';
    } catch (e: any) {
      info.status = 'failed';
      info.error = String(e?.message || e);
      console.error('[backup]', info.error);
    }
    info.finished_at = new Date().toISOString();
    fs.writeFileSync(path.join(dir, 'backup.json'), JSON.stringify(info, null, 2));
    const all = fs.readdirSync(config.backupDir).filter((d) => fs.existsSync(path.join(config.backupDir, d, 'backup.json'))).sort();
    for (const old of all.slice(0, Math.max(0, all.length - KEEP))) fs.rmSync(path.join(config.backupDir, old), { recursive: true, force: true });
    return { name: stamp, ...info };
  })().finally(() => { running = null; });
  return running;
}

export function listBackups() {
  if (!fs.existsSync(config.backupDir)) return [];
  return fs.readdirSync(config.backupDir).sort().reverse().map((name) => {
    try { return { name, ...JSON.parse(fs.readFileSync(path.join(config.backupDir, name, 'backup.json'), 'utf8')) }; } catch { return { name, status: 'unknown' }; }
  });
}

/** Checks every 15 minutes; runs once per day after BACKUP_HOUR (GST) if today's backup is missing. */
export function scheduleBackups() {
  const tick = () => {
    const now = new Date(Date.now() + 4 * 3600_000);
    const today = now.toISOString().slice(0, 10);
    if (now.getUTCHours() < HOUR) return;
    const done = listBackups().some((b: any) => b.status === 'ok' && b.reason === 'scheduled' && String(b.started_at || '').length &&
      new Date(new Date(b.started_at).getTime() + 4 * 3600_000).toISOString().slice(0, 10) === today);
    if (!done) runBackup('scheduled').catch(() => {});
  };
  setTimeout(tick, 60_000).unref();
  setInterval(tick, 15 * 60_000).unref();
}
