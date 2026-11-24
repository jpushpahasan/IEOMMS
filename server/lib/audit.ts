import type { Request } from 'express';
import type { Q } from '../db/index.ts';

const SECRET = new Set(['password', 'password_hash', 'token', 'token_hash']);

function clean(v: unknown) {
  if (!v || typeof v !== 'object') return v ?? null;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) if (!SECRET.has(k)) out[k] = val;
  return out;
}

/** Only keep keys whose value changed, so the audit trail shows the actual edit. */
export function diff(oldRow: Record<string, any> | null, newRow: Record<string, any> | null) {
  if (!oldRow || !newRow) return { old: clean(oldRow), new: clean(newRow) };
  const o: Record<string, unknown> = {};
  const n: Record<string, unknown> = {};
  for (const k of Object.keys(newRow)) {
    if (SECRET.has(k) || k === 'updated_at') continue;
    if (JSON.stringify(oldRow[k] ?? null) !== JSON.stringify(newRow[k] ?? null)) { o[k] = oldRow[k] ?? null; n[k] = newRow[k] ?? null; }
  }
  return { old: o, new: n };
}

export async function audit(q: Q, req: Request, action: string, entity: string, entityId: number | null,
  oldValues: unknown = null, newValues: unknown = null) {
  await q.query(
    `INSERT INTO audit_logs(user_id, username, action, entity, entity_id, old_values, new_values, ip)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [req.user?.id ?? null, req.user?.username ?? null, action, entity, entityId,
      oldValues == null ? null : JSON.stringify(clean(oldValues)), newValues == null ? null : JSON.stringify(clean(newValues)), req.ip ?? null]);
}
