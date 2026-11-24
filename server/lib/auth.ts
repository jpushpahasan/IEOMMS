import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import type { NextFunction, Request, Response } from 'express';
import { db } from '../db/index.ts';
import { config } from '../config.ts';
import { AppError, forbidden, sha256 } from './http.ts';
import type { SessionUser } from './rbac.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: SessionUser; sessionHash?: string } }
}

export const COOKIE = 'ieomms_session';
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
let dummyHash: string | null = null;

export const hashPassword = (pw: string) => bcrypt.hash(pw, 12);
export const verifyPassword = (pw: string, hash: string) => bcrypt.compare(pw, hash);

export function checkPasswordStrength(pw: unknown): string {
  if (typeof pw !== 'string' || pw.length < 10 || !/[A-Z]/.test(pw) || !/[a-z]/.test(pw) || !/\d/.test(pw)) {
    throw new AppError(400, 'Password must be at least 10 characters and include an upper-case letter, a lower-case letter and a number.',
      { password: 'At least 10 characters with upper-case, lower-case and a number.' });
  }
  return pw;
}

export async function loadUser(id: number): Promise<(SessionUser & { is_active: boolean }) | null> {
  return db.one(
    `SELECT u.id, u.username, u.full_name, u.email, u.department_id, u.is_active, u.must_change_password,
            r.code AS role, r.name AS role_name,
            COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions
       FROM users u JOIN roles r ON r.id = u.role_id
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       LEFT JOIN permissions p ON p.id = rp.permission_id
      WHERE u.id = $1 GROUP BY u.id, r.code, r.name`, [id]);
}

export async function login(username: unknown, password: unknown, req: Request) {
  const generic = new AppError(401, 'Invalid username or password.');
  const u = await db.one('SELECT * FROM users WHERE lower(username) = lower($1)', [String(username || '')]);
  if (!u) {
    // equalise timing so valid usernames cannot be discovered
    dummyHash ||= bcrypt.hashSync('not-a-real-password', 12);
    await bcrypt.compare(String(password || ''), dummyHash);
    throw generic;
  }
  if (!u.is_active) throw new AppError(403, 'This account is disabled. Contact your administrator.');
  if (u.locked_until && new Date(u.locked_until) > new Date()) {
    throw new AppError(423, `Account locked after repeated failed sign-ins. Try again in ${LOCK_MINUTES} minutes or ask an administrator to unlock it.`);
  }
  if (!(await verifyPassword(String(password || ''), u.password_hash))) {
    const attempts = u.failed_attempts + 1;
    await db.query(`UPDATE users SET failed_attempts = $2,
        locked_until = CASE WHEN $2 >= ${MAX_FAILED} THEN now() + interval '${LOCK_MINUTES} minutes' ELSE NULL END WHERE id = $1`, [u.id, attempts]);
    await db.query(`INSERT INTO audit_logs(user_id, username, action, entity, entity_id, ip) VALUES ($1,$2,'login_failed','users',$1,$3)`, [u.id, u.username, req.ip]);
    throw generic;
  }
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + config.sessionHours * 3600_000);
  await db.query('UPDATE users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1', [u.id]);
  await db.query('DELETE FROM sessions WHERE expires_at < now()');
  await db.query('INSERT INTO sessions(token_hash, user_id, expires_at, ip, user_agent) VALUES ($1,$2,$3,$4,$5)',
    [sha256(token), u.id, expires.toISOString(), req.ip, String(req.headers['user-agent'] || '').slice(0, 300)]);
  await db.query(`INSERT INTO audit_logs(user_id, username, action, entity, entity_id, ip) VALUES ($1,$2,'login','users',$1,$3)`, [u.id, u.username, req.ip]);
  return { token, expires };
}

export function setSessionCookie(res: Response, token: string, expires: Date) {
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: config.isProd, expires, path: '/' });
}

/** Resolves the session cookie into req.user (sliding expiry). */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (token) {
      const hash = sha256(String(token));
      const s = await db.one('SELECT user_id FROM sessions WHERE token_hash = $1 AND expires_at > now()', [hash]);
      if (s) {
        const user = await loadUser(s.user_id);
        if (user?.is_active) {
          const { is_active: _ignored, ...rest } = user;
          req.user = rest;
          req.sessionHash = hash;
          db.query(`UPDATE sessions SET last_seen_at = now(), expires_at = now() + interval '${config.sessionHours} hours' WHERE token_hash = $1`, [hash]).catch(() => {});
        }
      }
    }
    next();
  } catch (e) { next(e); }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new AppError(401, 'Your session has expired. Please sign in again.'));
  next();
}

/** Passes when the user holds ANY of the listed permissions. */
export const requirePerm = (...perms: string[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new AppError(401, 'Please sign in.'));
  if (!perms.some((p) => req.user!.permissions.includes(p))) return next(forbidden());
  next();
};
