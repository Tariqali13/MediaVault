import { and, eq, inArray, sql } from 'drizzle-orm';
import { withContext, schema, type Pool } from './db/client.js';
import type { Sessions } from './auth/sessions.js';
import type { StorageDriver } from './storage/driver.js';
import { purgeExpiredDemos } from './demo/demo.js';

/**
 * Periodic housekeeping. Idempotent and safe to run on several instances at once.
 *
 *  - expired sessions
 *  - expired demo workspaces (and their uploads)
 *  - uploads that were started but never completed: the row is removed and the
 *    reserved quota returned.
 */
export async function runMaintenance(deps: { pool: Pool; sessions: Sessions; storage: StorageDriver }) {
  const sessions = await deps.sessions.purgeExpired();
  const demos = await purgeExpiredDemos(deps.pool, deps.storage);
  const abandoned = await purgeAbandonedUploads(deps.pool, deps.storage);
  return { sessions, demos, abandoned };
}

async function purgeAbandonedUploads(pool: Pool, storage: StorageDriver): Promise<number> {
  // Without a tenant context the only assets visible are abandoned uploads (see the
  // abandoned_upload policy). Each is then removed inside its own workspace context.
  const stale = await withContext(pool, {}, (tx) =>
    tx.select({ id: schema.assets.id, workspaceId: schema.assets.workspaceId }).from(schema.assets).limit(500),
  );
  const byWorkspace = Map.groupBy(stale, (a) => a.workspaceId);
  for (const [workspaceId, assets] of byWorkspace) {
    const keys = await withContext(pool, { workspaceId }, async (tx) => {
      const gone = await tx
        .delete(schema.assets)
        .where(and(inArray(schema.assets.id, assets.map((a) => a.id)), eq(schema.assets.status, 'uploading')))
        .returning({ key: schema.assets.storageKey, size: schema.assets.sizeBytes });
      const total = gone.reduce((n, g) => n + g.size, 0);
      await tx
        .update(schema.workspaces)
        .set({ storageBytes: sql`greatest(0, ${schema.workspaces.storageBytes} - ${total})` })
        .where(eq(schema.workspaces.id, workspaceId));
      return gone.map((g) => g.key);
    });
    await storage.delete(keys).catch(() => undefined);
  }
  return stale.length;
}
