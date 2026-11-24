import express from 'express';
import { db } from '../db/index.ts';
import { asyncH } from '../lib/http.ts';
import { requirePerm } from '../lib/auth.ts';
import { processOutbox, refreshIfStale, refreshNotifications } from '../lib/notifications.ts';

export const notificationsRouter = express.Router();

notificationsRouter.get('/notifications', asyncH(async (req, res) => {
  const params: unknown[] = [req.user!.id];
  let w = 'n.user_id = $1';
  w += req.query.history === '1' ? ' AND n.resolved_at IS NOT NULL' : ' AND n.resolved_at IS NULL';
  if (req.query.unread === '1') w += ' AND n.read_at IS NULL';
  if (req.query.type) { params.push(String(req.query.type)); w += ` AND n.type = $${params.length}`; }
  const rows = await db.many(`SELECT n.*, c.reference_no FROM notifications n LEFT JOIN candidates c ON c.id = n.candidate_id WHERE ${w}
    ORDER BY n.read_at IS NULL DESC, CASE n.severity WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END, n.last_raised_at DESC LIMIT 300`, params);
  const counts = await db.many(`SELECT type, count(*)::int AS n, count(*) FILTER (WHERE read_at IS NULL)::int AS unread FROM notifications
    WHERE user_id = $1 AND resolved_at IS NULL GROUP BY 1`, [req.user!.id]);
  res.json({ rows, counts });
}));

notificationsRouter.get('/notifications/count', asyncH(async (req, res) => {
  refreshIfStale();
  res.json(await db.one(`SELECT count(*) FILTER (WHERE read_at IS NULL)::int AS unread,
      count(*) FILTER (WHERE read_at IS NULL AND severity = 'critical')::int AS critical FROM notifications WHERE user_id = $1 AND resolved_at IS NULL`, [req.user!.id]));
}));

notificationsRouter.post('/notifications/read', asyncH(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  if (ids?.length) await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND id = ANY($2::bigint[]) AND read_at IS NULL', [req.user!.id, ids]);
  else await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND resolved_at IS NULL AND read_at IS NULL', [req.user!.id]);
  res.json({ ok: true });
}));

notificationsRouter.post('/notifications/refresh', asyncH(async (_req, res) => {
  res.json(await refreshNotifications());
}));

notificationsRouter.get('/admin/outbox', requirePerm('settings.manage'), asyncH(async (_req, res) => {
  res.json({ rows: await db.many('SELECT * FROM email_outbox ORDER BY id DESC LIMIT 200'), smtp: !!process.env.SMTP_URL });
}));
notificationsRouter.post('/admin/outbox/retry', requirePerm('settings.manage'), asyncH(async (_req, res) => {
  await db.query(`UPDATE email_outbox SET status = 'queued', attempts = 0 WHERE status IN ('held','failed')`);
  res.json(await processOutbox());
}));
