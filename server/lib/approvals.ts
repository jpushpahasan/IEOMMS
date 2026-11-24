// Single history of approval decisions across modules (flight quotations, activity verification, expenses, clearance, deployment).
import type { Request } from 'express';
import type { Q } from '../db/index.ts';

export async function recordApproval(q: Q, req: Request, r: {
  type: 'flight_quotation' | 'activity_verification' | 'expense_verification' | 'final_clearance' | 'deployment';
  entity: string; entityId: number; candidateId: number | null; requestedBy?: number | null; requestedAt?: unknown;
  decision: 'approved' | 'rejected'; remarks?: string | null;
}) {
  await q.query(`INSERT INTO approval_records(approval_type, entity, entity_id, candidate_id, requested_by, requested_at, decided_by, decision, remarks)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
  [r.type, r.entity, r.entityId, r.candidateId, r.requestedBy ?? null, r.requestedAt ?? null, req.user!.id, r.decision, r.remarks || null]);
}
