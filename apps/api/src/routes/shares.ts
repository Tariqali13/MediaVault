import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';
import { CreateShareBody } from '@mediavault/shared';
import { authorize, inWorkspace, memberGuard, type Services } from '../app.js';
import { withContext, schema } from '../db/client.js';
import { newToken, sha256 } from '../auth/sessions.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { downloadUrl, viewUrl } from '../lib/urls.js';

export async function shareRoutes(fastify: FastifyInstance, s: Services) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /* ---- managing links (members) ---- */
  await app.register(async (scoped) => {
    const r = scoped.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', memberGuard(s));

    r.post('/shares', { schema: { tags: ['shares'], body: CreateShareBody } }, async (req, reply) => {
      const m = authorize(req, 'share.create');
      const token = newToken();
      const expiresAt = new Date(Date.now() + req.body.expiresInHours * 3600_000);
      await inWorkspace(s, m, async (tx) => {
        // Make sure the target exists in this workspace (RLS hides everyone else's).
        const target = req.body.assetId
          ? await tx.select({ id: schema.assets.id }).from(schema.assets).where(and(eq(schema.assets.id, req.body.assetId), eq(schema.assets.status, 'ready')))
          : await tx.select({ id: schema.collections.id }).from(schema.collections).where(eq(schema.collections.id, req.body.collectionId!));
        if (!target.length) throw new AppError(404, 'not_found', 'There’s nothing ready to share there yet.');
        const [link] = await tx
          .insert(schema.shareLinks)
          .values({
            workspaceId: m.workspaceId,
            tokenHash: sha256(token),
            assetId: req.body.assetId ?? null,
            collectionId: req.body.collectionId ?? null,
            allowDownload: req.body.allowDownload,
            createdBy: m.userId,
            expiresAt,
          })
          .returning({ id: schema.shareLinks.id });
        await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'share.created', targetType: 'share', targetId: link!.id, details: { expiresAt, allowDownload: req.body.allowDownload }, ip: req.ip });
      });
      // The token is shown exactly once; only its hash is stored.
      return reply.status(201).send({ url: `${s.config.APP_ORIGIN}/s/${token}`, expiresAt: expiresAt.toISOString() });
    });

    r.get('/shares', { schema: { tags: ['shares'] } }, async (req) => {
      const m = authorize(req, 'share.create');
      return inWorkspace(s, m, (tx) =>
        tx
          .select({
            id: schema.shareLinks.id,
            assetId: schema.shareLinks.assetId,
            collectionId: schema.shareLinks.collectionId,
            target: sql<string>`coalesce((SELECT title FROM assets WHERE id = ${schema.shareLinks.assetId}),
                                         (SELECT name FROM collections WHERE id = ${schema.shareLinks.collectionId}))`,
            allowDownload: schema.shareLinks.allowDownload,
            expiresAt: schema.shareLinks.expiresAt,
            viewCount: schema.shareLinks.viewCount,
            createdAt: schema.shareLinks.createdAt,
          })
          .from(schema.shareLinks)
          .where(and(isNull(schema.shareLinks.revokedAt), gt(schema.shareLinks.expiresAt, new Date())))
          .orderBy(desc(schema.shareLinks.createdAt)),
      );
    });

    r.delete('/shares/:id', { schema: { tags: ['shares'], params: z.object({ id: z.uuid() }) } }, async (req) => {
      const m = authorize(req, 'share.revoke');
      await inWorkspace(s, m, async (tx) => {
        const rows = await tx.update(schema.shareLinks).set({ revokedAt: new Date() }).where(eq(schema.shareLinks.id, req.params.id)).returning();
        if (!rows.length) throw new AppError(404, 'not_found', 'Link not found.');
        await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'share.revoked', targetType: 'share', targetId: req.params.id, ip: req.ip });
      });
      return { ok: true };
    });
  });

  /* ---- opening a link (anyone with the URL) ---- */

  app.get(
    '/public/shares/:token',
    { config: { rateLimit: { max: 60, timeWindow: '1 minute' } }, schema: { tags: ['shares'], params: z.object({ token: z.string().min(20).max(100) }) } },
    async (req) => {
      const tokenHash = sha256(req.params.token);
      // Step 1: the only thing an anonymous caller may read is the link matching their token.
      const link = await withContext(s.pool, { tokenHash }, async (tx) => {
        const [l] = await tx.select().from(schema.shareLinks).where(eq(schema.shareLinks.tokenHash, tokenHash));
        return l;
      });
      if (!link || link.revokedAt || link.expiresAt < new Date()) {
        throw new AppError(404, 'link_unavailable', 'This link has expired or been turned off.');
      }
      // Step 2: read exactly what it points to, inside that workspace.
      return withContext(s.pool, { workspaceId: link.workspaceId }, async (tx) => {
        await tx.update(schema.shareLinks).set({ viewCount: sql`${schema.shareLinks.viewCount} + 1` }).where(eq(schema.shareLinks.id, link.id));
        const [ws] = await tx.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, link.workspaceId));
        const assets = link.assetId
          ? await tx.select().from(schema.assets).where(and(eq(schema.assets.id, link.assetId), isNull(schema.assets.trashedAt)))
          : await tx
              .select({ a: schema.assets })
              .from(schema.collectionAssets)
              .innerJoin(schema.assets, eq(schema.assets.id, schema.collectionAssets.assetId))
              .where(and(eq(schema.collectionAssets.collectionId, link.collectionId!), isNull(schema.assets.trashedAt), eq(schema.assets.status, 'ready')))
              .then((rows) => rows.map((r) => r.a));
        const collection = link.collectionId
          ? (await tx.select({ name: schema.collections.name }).from(schema.collections).where(eq(schema.collections.id, link.collectionId)))[0]
          : undefined;
        return {
          title: collection?.name ?? assets[0]?.title ?? 'Shared file',
          sharedBy: ws?.name ?? '',
          expiresAt: link.expiresAt.toISOString(),
          allowDownload: link.allowDownload,
          items: await Promise.all(
            assets.map(async (a) => ({
              id: a.id,
              title: a.title,
              kind: a.kind,
              width: a.width,
              height: a.height,
              dominantColor: a.dominantColor,
              thumbUrl: await viewUrl(s.storage, a.thumbKey),
              previewUrl: await viewUrl(s.storage, a.previewKey),
              downloadUrl: link.allowDownload ? await downloadUrl(s.storage, a.storageKey, a.fileName) : null,
            })),
          ),
        };
      });
    },
  );
}
