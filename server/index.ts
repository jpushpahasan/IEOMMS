// IEOMMS — API server
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type NextFunction, type Request, type Response } from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { config } from './config.ts';
import { db, initDb } from './db/index.ts';
import { bootstrap } from './db/bootstrap.ts';
import { AppError, asyncH, badRequest, forbidden, notFound } from './lib/http.ts';
import { authenticate, checkPasswordStrength, COOKIE, hashPassword, login, requireAuth, setSessionCookie, verifyPassword } from './lib/auth.ts';
import { audit } from './lib/audit.ts';
import { getSettings } from './lib/settings.ts';
import { candidatesRouter } from './modules/candidates.ts';
import { documentsRouter } from './modules/documents.ts';
import { mastersRouter } from './modules/masters.ts';
import { adminRouter } from './modules/admin.ts';
import { importsRouter } from './modules/imports.ts';
import { dashboardRouter } from './modules/dashboard.ts';
import { mobilityRouter } from './modules/mobility.ts';
import { accommodationRouter } from './modules/accommodation.ts';
import { onboardingRouter } from './modules/onboarding.ts';
import { medicalRouter } from './modules/medical.ts';
import { visaRouter } from './modules/visa.ts';
import { trainingRouter } from './modules/training.ts';
import { uniformRouter } from './modules/uniform.ts';
import { employeesRouter } from './modules/employees.ts';
import { financeRouter } from './modules/finance.ts';
import { notificationsRouter } from './modules/notifications.ts';
import { clearanceRouter } from './modules/clearance.ts';
import { reportsRouter } from './modules/reports.ts';
import { refreshNotifications } from './lib/notifications.ts';
import { listBackups, runBackup, scheduleBackups } from './lib/backup.ts';
import { requirePerm } from './lib/auth.ts';

export const app = express();
app.set('trust proxy', config.isProd ? 1 : false);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:'], connectSrc: ["'self'"],
      frameSrc: ["'self'"], objectSrc: ["'none'"], upgradeInsecureRequests: config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// CSRF defence in depth: SameSite=Strict cookie + reject cross-origin state-changing requests.
app.use('/api', (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  try {
    if (origin && new URL(origin).host !== req.headers.host) return next(forbidden('Cross-origin request rejected.'));
  } catch { return next(forbidden('Cross-origin request rejected.')); }
  next();
});
// API responses carry personal data: never store them in shared caches.
app.use('/api', (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
app.use('/api', authenticate);

// ------------------------------------------------------------------ authentication
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.LOGIN_RATE_LIMIT || 20), standardHeaders: true, legacyHeaders: false,
  message: { error: 'Too many sign-in attempts. Please wait 15 minutes.' } });

app.post('/api/auth/login', loginLimiter, asyncH(async (req, res) => {
  const { token, expires } = await login(req.body?.username, req.body?.password, req);
  setSessionCookie(res, token, expires);
  res.json({ ok: true });
}));

app.post('/api/auth/logout', asyncH(async (req, res) => {
  if (req.sessionHash) {
    await db.query('DELETE FROM sessions WHERE token_hash = $1', [req.sessionHash]);
    await audit(db, req, 'logout', 'users', req.user!.id);
  }
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
}));

app.get('/api/health', asyncH(async (_req, res) => { await db.query('SELECT 1'); res.json({ ok: true, db: db.kind }); }));

app.use('/api', requireAuth);

app.get('/api/auth/me', asyncH(async (req, res) => {
  const s = await getSettings();
  res.json({ user: req.user, company: s.company_name, currency: s.currency });
}));

app.post('/api/auth/password', asyncH(async (req, res) => {
  const u = await db.one('SELECT password_hash FROM users WHERE id = $1', [req.user!.id]);
  if (!(await verifyPassword(String(req.body?.current || ''), u!.password_hash))) throw badRequest('Current password is incorrect.', { current: 'Incorrect.' });
  const pw = checkPasswordStrength(req.body?.password);
  if (pw === req.body?.current) throw badRequest('The new password must be different.', { password: 'Must differ from the current password.' });
  await db.query('UPDATE users SET password_hash = $2, must_change_password = FALSE, updated_at = now() WHERE id = $1', [req.user!.id, await hashPassword(pw)]);
  await db.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2', [req.user!.id, req.sessionHash]);
  await audit(db, req, 'password_change', 'users', req.user!.id);
  res.json({ ok: true });
}));

// Users who must change their password can do nothing else until they have.
app.use('/api', (req, _res, next) => {
  if (req.user?.must_change_password && req.method !== 'GET') return next(new AppError(428, 'Please change your password before continuing.'));
  next();
});

// ------------------------------------------------------------------ modules
app.use('/api/candidates', candidatesRouter);
app.use('/api', documentsRouter);
app.use('/api', mastersRouter);
app.use('/api', importsRouter);
app.use('/api', dashboardRouter);
app.use('/api', mobilityRouter);
app.use('/api', accommodationRouter);
app.use('/api', onboardingRouter);
app.use('/api', medicalRouter);
app.use('/api', visaRouter);
app.use('/api', trainingRouter);
app.use('/api', uniformRouter);
app.use('/api', employeesRouter);
app.use('/api', financeRouter);
app.use('/api', notificationsRouter);
app.use('/api', clearanceRouter);
app.use('/api', reportsRouter);
app.get('/api/admin/backups', requirePerm('settings.manage'), asyncH(async (_req, res) => res.json({ backups: listBackups(), database: db.kind })));
app.post('/api/admin/backups', requirePerm('settings.manage'), asyncH(async (req, res) => {
  const r = await runBackup('manual');
  await audit(db, req, 'backup', 'system', null, null, r);
  res.json(r);
}));
app.use('/api/admin', adminRouter);

// ------------------------------------------------------------------ static frontend (production build)
const dist = path.join(config.root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: config.isProd ? '1h' : 0 }));
  app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}
app.use('/api', (_req, _res, next) => next(notFound('API endpoint not found.')));

// ------------------------------------------------------------------ errors
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  if (err?.code === 'LIMIT_FILE_SIZE') err = new AppError(413, `File is too large (maximum ${config.maxUploadMb} MB).`);
  if (err?.type === 'entity.parse.failed') err = new AppError(400, 'Malformed JSON request.');
  const status = err instanceof AppError ? err.status : 500;
  if (status >= 500) console.error(`[error] ${req.method} ${req.originalUrl}`, err);
  res.status(status).json({
    error: status >= 500 ? 'An unexpected error occurred. It has been logged for the administrator.' : err.message,
    details: status < 500 ? err.details : undefined,
  });
});

// ------------------------------------------------------------------ start
export async function start(port = config.port) {
  await initDb();
  await bootstrap();
  if (process.env.BACKUPS !== 'off') scheduleBackups();
  if (process.env.NOTIFICATIONS !== 'off') {
    refreshNotifications().catch((e) => console.error('[notifications]', e.message));
    setInterval(() => refreshNotifications().catch((e) => console.error('[notifications]', e.message)), 60 * 60_000).unref();
  }
  return new Promise<import('node:http').Server>((resolve) => {
    const server = app.listen(port, () => {
      console.log(`IEOMMS API running on http://localhost:${port} (database: ${db.kind})`);
      resolve(server);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  start().catch((e) => { console.error(e); process.exit(1); });
}
