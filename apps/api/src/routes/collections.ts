import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CreateCollectionBody } from '@mediavault/shared';
import { authorize, inWorkspace, memberGuard, type Services } from '../app.js';
import { schema } from '../db/client.js';
import { AppError, isUniqueViolation } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { viewUrl } from '../lib/urls.js';

const IdParams = z.object({ id: z.uuid() });

export async function collectionRoutes(fastify: FastifyInstance, s: Services) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', memberGuard(s));

  app.get('/collections', { schema: { tags: ['collections'] } }, async (req) => {
    const m = authorize(req, 'collection.read');
    const rows = await inWorkspace(s, m, (tx) =>
      tx
        .select({
          id: schema.collections.id,
          name: schema.collections.name,
          count: sql<number>`(SELECT count(*)::int FROM collection_assets ca JOIN assets a ON a.id = ca.asset_id
                             WHERE ca.collection_id = collections.id AND a.trashed_at IS NULL)`,
          coverKey: sql<string | null>`(SELECT a.thumb_key FROM collection_assets ca JOIN assets a ON a.id = ca.asset_id
                             WHERE ca.collection_id = collections.id AND a.trashed_at IS NULL AND a.thumb_key IS NOT NULL
                             ORDER BY ca.added_at DESC LIMIT 1)`,
        })
        .from(schema.collections)
        .orderBy(asc(schema.collections.name)),
    );
    return Promise.all(rows.map(async ({ coverKey, ...c }) => ({ ...c, coverUrl: await viewUrl(s.storage, coverKey) })));
  });

  app.post('/collections', { schema: { tags: ['collections'], body: CreateCollectionBody } }, async (req, reply) => {
    const m = authorize(req, 'collection.manage');
    try {
      const created = await inWorkspace(s, m, async (tx) => {
        const [c] = await tx.insert(schema.collections).values({ workspaceId: m.workspaceId, name: req.body.name, createdBy: m.userId }).returning();
        await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'collection.created', targetType: 'collection', targetId: c!.id, details: { name: c!.name }, ip: req.ip });
        return c!;
      });
      return reply.status(201).send({ id: created.id, name: created.name, count: 0, coverUrl: null });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, 'name_taken', 'A collection with that name already exists.');
      throw err;
    }
  });

  app.post(
    '/collections/:id/assets',
    { schema: { tags: ['collections'], params: IdParams, body: z.object({ assetIds: z.array(z.uuid()).min(1).max(100) }) } },
    async (req) => {
      const m = authorize(req, 'collection.manage');
      const added = await inWorkspace(s, m, async (tx) => {
        const [c] = await tx.select().from(schema.collections).where(eq(schema.collections.id, req.params.id));
        if (!c) throw new AppError(404, 'not_found', 'Collection not found.');
        // RLS means only this workspace's assets can be found, so foreign ids are silently ignored.
        const assets = await tx
          .select({ id: schema.assets.id })
          .from(schema.assets)
          .where(and(inArray(schema.assets.id, req.body.assetIds), isNull(schema.assets.trashedAt)));
        if (assets.length) {
          await tx
            .insert(schema.collectionAssets)
            .values(assets.map((a) => ({ workspaceId: m.workspaceId, collectionId: c.id, assetId: a.id })))
            .onConflictDoNothing();
        }
        await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'collection.assets_added', targetType: 'collection', targetId: c.id, details: { count: assets.length }, ip: req.ip });
        return assets.length;
      });
      return { added };
    },
  );

  app.delete(
    '/collections/:id/assets/:assetId',
    { schema: { tags: ['collections'], params: IdParams.extend({ assetId: z.uuid() }) } },
    async (req) => {
      const m = authorize(req, 'collection.manage');
      await inWorkspace(s, m, (tx) =>
        tx
          .delete(schema.collectionAssets)
          .where(and(eq(schema.collectionAssets.collectionId, req.params.id), eq(schema.collectionAssets.assetId, req.params.assetId))),
      );
      return { ok: true };
    },
  );

  app.delete('/collections/:id', { schema: { tags: ['collections'], params: IdParams } }, async (req) => {
    const m = authorize(req, 'collection.manage');
    await inWorkspace(s, m, async (tx) => {
      const rows = await tx.delete(schema.collections).where(eq(schema.collections.id, req.params.id)).returning();
      if (!rows.length) throw new AppError(404, 'not_found', 'Collection not found.');
      await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'collection.deleted', targetType: 'collection', targetId: req.params.id, details: { name: rows[0]!.name }, ip: req.ip });
    });
    return { ok: true };
  });
}
