import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const env = process.env;
const dataDir = path.resolve(root, env.DATA_DIR || 'data');

export const config = {
  root,
  isProd: env.NODE_ENV === 'production',
  port: Number(env.PORT || 4100),
  databaseUrl: env.DATABASE_URL || '',
  databaseSsl: env.DATABASE_SSL === 'true',
  dataDir,
  pgliteDir: path.join(dataDir, 'pgdata'),
  uploadDir: path.join(dataDir, 'uploads'),
  backupDir: path.join(dataDir, 'backups'),
  sessionHours: Number(env.SESSION_HOURS || 10),
  // 4 MB: Vercel functions accept request bodies up to 4.5 MB.
  maxUploadMb: Number(env.MAX_UPLOAD_MB || 4),
  // Initial super administrator (created only when the users table is empty).
  adminUsername: env.ADMIN_USERNAME || 'admin',
  adminPassword: env.ADMIN_PASSWORD || '',
};
