// Users, roles & permissions, system settings and audit log.
import express from 'express';
import { db } from '../db/index.ts';
import { asyncH, badRequest, conflict, notFound, toId } from '../lib/http.ts';
import { checkPasswordStrength, hashPassword, requirePerm } from '../lib/auth.ts';
import { audit, diff } from '../lib/audit.ts';
import { validate } from '../lib/validate.ts';
import { getSettings, saveSettings, DEFAULT_SETTINGS } from '../lib/settings.ts';

export const adminRouter = express.Router();

const USER_SCHEMA = {
  username: { type: 'text' as const, label: 'Username', required: true, max: 60, pattern: [/^[a-zA-Z0-9._-]{3,60}$/, 'Username must be 3–60 letters, digits, dots, dashes or underscores.'] as [RegExp, string] },
  full_name: { type: 'text' as const, label: 'Full name', required: true, max: 150 },
  email: { type: 'email' as const, label: 'Email' },
  phone: { type: 'phone' as const, label: 'Phone' },
  role_id: { type: 'ref' as const, label: 'Role', required: true },
  department_id: { type: 'ref' as const, label: 'Department' },
  is_active: { type: 'bool' as const, label: 'Active' },
};

adminRouter.get('/users', requirePerm('users.manage'), asyncH(async (_req, res) => {
  res.json(await db.many(`SELECT u.id, u.username, u.full_name, u.email, u.phone, u.role_id, u.department_id, u.is_active, u.must_change_password,
      u.locked_until, u.last_login_at, u.created_at, r.name AS role_name, r.code AS role, d.name AS department_name
    FROM users u JOIN roles r ON r.id = u.role_id LEFT JOIN departments d ON d.id = u.department_id ORDER BY u.full_name`));
}));

adminRouter.post('/users', requirePerm('users.manage'), asyncH(async (req, res) => {
  const data = validate(USER_SCHEMA, { is_active: true, ...(req.body || {}) });
  data.username = String(data.username).toLowerCase();
  const password = checkPasswordStrength(req.body?.password);
  if (await db.one('SELECT 1 FROM users WHERE lower(username) = $1', [data.username])) throw conflict('This username is already taken.', { username: 'Already taken.' });
  if (!(await db.one('SELECT 1 FROM roles WHERE id = $1', [data.role_id]))) throw badRequest('Select a valid role.', { role_id: 'Invalid role.' });
  data.password_hash = await hashPassword(password);
  data.must_change_password = req.body?.must_change_password !== false;
  data.created_by = req.user!.id;
  const cols = Object.keys(data);
  const row = await db.tx(async (q) => {
    const r = (await q.query(`INSERT INTO users(${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING id, username, full_name, role_id, department_id, is_active`, cols.map((c) => data[c]))).rows[0];
    await audit(q, req, 'create', 'users', r.id, null, r);
    return r;
  });
  res.status(201).json(row);
}));

adminRouter.put('/users/:id', requirePerm('users.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const data = validate(USER_SCHEMA, req.body || {}, true);
  if (data.username) data.username = String(data.username).toLowerCase();
  await db.tx(async (q) => {
    const old = (await q.query('SELECT id, username, full_name, email, phone, role_id, department_id, is_active FROM users WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!old) throw notFound('User not found.');
    if (id === req.user!.id && (data.is_active === false || (data.role_id && data.role_id !== old.role_id))) {
      throw badRequest('You cannot deactivate your own account or change your own role.');
    }
    if (req.body?.unlock) { data.failed_attempts = 0; data.locked_until = null; }
    data.updated_by = req.user!.id;
    data.updated_at = new Date().toISOString();
    const cols = Object.keys(data);
    try {
      const row = (await q.query(`UPDATE users SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')} WHERE id = $1
        RETURNING id, username, full_name, email, phone, role_id, department_id, is_active`, [id, ...cols.map((c) => data[c])])).rows[0];
      if (data.is_active === false || (data.role_id && data.role_id !== old.role_id)) await q.query('DELETE FROM sessions WHERE user_id = $1', [id]);
      const d = diff(old, row);
      await audit(q, req, req.body?.unlock ? 'unlock' : 'update', 'users', id, d.old, d.new);
    } catch (e: any) {
      if (e?.code === '23505') throw conflict('This username is already taken.', { username: 'Already taken.' });
      throw e;
    }
  });
  res.json({ ok: true });
}));

adminRouter.post('/users/:id/reset-password', requirePerm('users.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const password = checkPasswordStrength(req.body?.password);
  const r = await db.query(`UPDATE users SET password_hash = $2, must_change_password = TRUE, failed_attempts = 0, locked_until = NULL,
    updated_at = now(), updated_by = $3 WHERE id = $1 RETURNING id`, [id, await hashPassword(password), req.user!.id]);
  if (!r.rows.length) throw notFound('User not found.');
  await db.query('DELETE FROM sessions WHERE user_id = $1', [id]);
  await audit(db, req, 'password_reset', 'users', id);
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ roles & permissions
adminRouter.get('/roles', requirePerm('users.manage'), asyncH(async (_req, res) => {
  const roles = await db.many(`SELECT r.id, r.code, r.name, r.description,
      COALESCE(array_agg(p.code ORDER BY p.code) FILTER (WHERE p.code IS NOT NULL), '{}') AS permissions,
      (SELECT count(*)::int FROM users u WHERE u.role_id = r.id) AS user_count
    FROM roles r LEFT JOIN role_permissions rp ON rp.role_id = r.id LEFT JOIN permissions p ON p.id = rp.permission_id
    GROUP BY r.id ORDER BY r.id`);
  res.json({ roles, permissions: await db.many('SELECT code, module, description FROM permissions ORDER BY module, code') });
}));

adminRouter.put('/roles/:id/permissions', requirePerm('users.manage'), asyncH(async (req, res) => {
  const id = toId(req.params.id);
  const perms: string[] = Array.isArray(req.body?.permissions) ? req.body.permissions.map(String) : [];
  await db.tx(async (q) => {
    const role = (await q.query('SELECT * FROM roles WHERE id = $1', [id])).rows[0];
    if (!role) throw notFound('Role not found.');
    if (role.code === 'super_admin') throw badRequest('The Super Administrator role always has every permission.');
    const before = (await q.query('SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id WHERE rp.role_id = $1 ORDER BY 1', [id])).rows.map((r) => r.code);
    await q.query('DELETE FROM role_permissions WHERE role_id = $1', [id]);
    await q.query('INSERT INTO role_permissions(role_id, permission_id) SELECT $1, id FROM permissions WHERE code = ANY($2::text[])', [id, perms]);
    await audit(q, req, 'update_permissions', 'roles', id, { permissions: before }, { permissions: [...perms].sort() });
  });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ settings
adminRouter.get('/settings', requirePerm('settings.manage'), asyncH(async (_req, res) => {
  res.json({ settings: await getSettings(), defaults: DEFAULT_SETTINGS });
}));

adminRouter.put('/settings', requirePerm('settings.manage'), asyncH(async (req, res) => {
  const b = req.body || {};
  const errors: Record<string, string> = {};
  const out: Record<string, unknown> = {};
  if (b.company_name !== undefined) { if (!String(b.company_name).trim()) errors.company_name = 'Required.'; else out.company_name = String(b.company_name).trim().slice(0, 150); }
  if (b.reference_prefix !== undefined) { if (!/^[A-Z]{2,6}$/.test(String(b.reference_prefix))) errors.reference_prefix = '2–6 capital letters.'; else out.reference_prefix = b.reference_prefix; }
  if (b.reminder_days_before !== undefined) {
    const arr = Array.isArray(b.reminder_days_before) ? b.reminder_days_before.map(Number) : String(b.reminder_days_before).split(',').map((x) => Number(x.trim()));
    if (arr.length > 5 || arr.some((n: number) => !Number.isInteger(n) || n < 1 || n > 30)) errors.reminder_days_before = 'Up to 5 whole numbers between 1 and 30, e.g. 3, 1.';
    else out.reminder_days_before = [...new Set(arr as number[])].sort((x, y) => y - x);
  }
  for (const k of ['remind_on_due_date', 'overdue_daily_reminder', 'email_notifications']) if (b[k] !== undefined) out[k] = b[k] === true || b[k] === 'true';
  for (const [k, lo, hi] of [['passport_min_validity_months', 0, 24], ['min_age', 16, 30], ['max_age', 40, 80], ['passport_expiry_alert_days', 30, 365], ['document_expiry_alert_days', 7, 180]] as [string, number, number][]) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < lo || n > hi) errors[k] = `Whole number between ${lo} and ${hi}.`; else out[k] = n;
  }
  if (Object.keys(errors).length) throw badRequest('Please correct the highlighted fields.', errors);
  const old = await getSettings();
  await db.tx((q) => saveSettings(q, out, req.user!.id));
  await audit(db, req, 'update', 'system_settings', null, old, await getSettings());
  res.json({ settings: await getSettings() });
}));

// ------------------------------------------------------------------ audit log
adminRouter.get('/audit', requirePerm('audit.view'), asyncH(async (req, res) => {
  const params: unknown[] = [];
  const w: string[] = [];
  const add = (sql: string, v: unknown) => { params.push(v); w.push(sql.replace('?', `$${params.length}`)); };
  if (req.query.entity) add('entity = ?', String(req.query.entity));
  if (req.query.action) add('action = ?', String(req.query.action));
  if (req.query.user) add('username ILIKE ?', `%${String(req.query.user)}%`);
  if (req.query.from) add('created_at >= ?::date', String(req.query.from));
  if (req.query.to) add(`created_at < (?::date + 1)`, String(req.query.to));
  const where = w.length ? `WHERE ${w.join(' AND ')}` : '';
  const page = Math.max(Number(req.query.page) || 1, 1);
  const total = (await db.one<{ n: number }>(`SELECT count(*)::int AS n FROM audit_logs ${where}`, params))!.n;
  const rows = await db.many(`SELECT * FROM audit_logs ${where} ORDER BY created_at DESC, id DESC LIMIT 50 OFFSET ${(page - 1) * 50}`, params);
  res.json({ rows, total, page, pageSize: 50 });
}));
