import type { Tx } from '../db/client.js';
import { schema } from '../db/client.js';

export interface AuditInput {
  workspaceId: string;
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Written inside the same transaction as the change it describes, so the audit
 * trail can't disagree with the data: either both happened or neither did.
 */
export async function audit(tx: Tx, e: AuditInput): Promise<void> {
  await tx.insert(schema.auditEvents).values({
    workspaceId: e.workspaceId,
    actorId: e.actorId,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId,
    details: e.details ?? {},
    ip: e.ip ?? null,
  });
}
