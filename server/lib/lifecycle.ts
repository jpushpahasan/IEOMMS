// Automatic candidate status changes driven by workflows (travel, arrival, clearance…).
import type { Request } from 'express';
import { one, type Q } from '../db/index.ts';
import { audit } from './audit.ts';

/**
 * Moves the candidate to `to` only when their current status is in `from`; otherwise leaves it alone
 * (e.g. a candidate on hold is not silently resumed by a ticket being issued). Returns true when moved.
 */
export async function advanceCandidate(q: Q, req: Request, candidateId: number, to: string, from: string[], reason: string) {
  const c = await one(q, 'SELECT status FROM candidates WHERE id = $1 FOR UPDATE', [candidateId]);
  if (!c || !from.includes(c.status) || c.status === to) return false;
  await q.query(`UPDATE candidates SET status = $2, status_reason = $3, status_changed_at = now(), updated_at = now(), updated_by = $4 WHERE id = $1`,
    [candidateId, to, reason, req.user!.id]);
  await q.query('INSERT INTO candidate_status_history(candidate_id, from_status, to_status, reason, changed_by) VALUES ($1,$2,$3,$4,$5)',
    [candidateId, c.status, to, reason, req.user!.id]);
  await audit(q, req, 'status_change', 'candidates', candidateId, { status: c.status }, { status: to, reason, automatic: true });
  return true;
}

/** Cancelling a candidate releases resources that are still pending for them. */
export async function releaseCandidateResources(q: Q, req: Request, candidateId: number) {
  const allocs = (await q.query(`UPDATE accommodation_allocations SET status = 'cancelled', remarks = coalesce(remarks || ' · ', '') || 'Released: candidate cancelled',
      updated_at = now(), updated_by = $2 WHERE candidate_id = $1 AND status = 'allocated' RETURNING id`, [candidateId, req.user!.id])).rows;
  const pickups = (await q.query(`UPDATE airport_pickups SET status = 'cancelled', updated_at = now(), updated_by = $2
      WHERE candidate_id = $1 AND status IN ('pending','assigned') RETURNING id`, [candidateId, req.user!.id])).rows;
  for (const a of allocs) await audit(q, req, 'release', 'accommodation_allocations', a.id, null, { candidate_id: candidateId, reason: 'candidate cancelled' });
  for (const p of pickups) await audit(q, req, 'cancel', 'airport_pickups', p.id, null, { candidate_id: candidateId, reason: 'candidate cancelled' });
  return { allocations: allocs.length, pickups: pickups.length };
}
