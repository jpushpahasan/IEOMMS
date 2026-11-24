import { db, type Q } from '../db/index.ts';

export const DEFAULT_SETTINGS: Record<string, unknown> = {
  company_name: 'Your Company LLC',
  reference_prefix: 'IEO',
  currency: 'AED',
  passport_min_validity_months: 6,
  min_age: 18,
  max_age: 65,
  // Phase 4 — notifications
  reminder_days_before: [3, 1],
  remind_on_due_date: true,
  overdue_daily_reminder: true,
  email_notifications: false,
  passport_expiry_alert_days: 180,
  document_expiry_alert_days: 60,
};

/** Pass `q` when called inside a transaction (the embedded DB serialises work, so using `db` there would deadlock). */
export async function getSettings(q?: Q): Promise<Record<string, any>> {
  const rows = q ? (await q.query('SELECT key, value FROM system_settings')).rows : await db.many('SELECT key, value FROM system_settings');
  const out: Record<string, any> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function saveSettings(q: Q, values: Record<string, unknown>, userId: number) {
  for (const [k, v] of Object.entries(values)) {
    if (!(k in DEFAULT_SETTINGS)) continue;
    await q.query(`INSERT INTO system_settings(key, value, updated_by, updated_at) VALUES ($1,$2,$3,now())
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`, [k, JSON.stringify(v), userId]);
  }
}
