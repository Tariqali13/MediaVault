import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, inArray, isNotNull, isNull, lt, or, sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { ALLOWED_MIME, ListAssetsQuery, UpdateAssetBody, UploadIntentBody, type AssetDto, type Page } from '@mediavault/shared';
import { authorize, inWorkspace, memberGuard, type Services } from '../app.js';
import { schema, type Tx } from '../db/client.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { downloadUrl, viewUrl } from '../lib/urls.js';
import type { StorageDriver } from '../storage/driver.js';

const IdParams = z.object({ id: z.uuid() });
const UPLOAD_TTL_SEC = 15 * 60;
/** Objects under this prefix are shared seed files for demo workspaces and are never deleted. */
export const SEED_PREFIX = 'demo-seed/';

type AssetRow = typeof schema.assets.$inferSelect;

export async function assetRoutes(fastify: FastifyInstance, s: Services) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  app.addHook('preHandler', memberGuard(s));

  app.get('/assets', { schema: { tags: ['assets'], querystring: ListAssetsQuery } }, async (req): Promise<Page<AssetDto>> => {
    const m = authorize(req, 'asset.read');
    const q = req.query;
    const a = schema.assets;
    const where: SQL[] = [q.trashed ? isNotNull(a.trashedAt) : isNull(a.trashedAt)];
    if (q.kind) where.push(eq(a.kind, q.kind));
    if (q.tag) where.push(sql`${q.tag.toLowerCase()} = ANY(${a.tags})`);
    if (q.collectionId) {
      where.push(
        sql`EXISTS (SELECT 1 FROM collection_assets ca WHERE ca.asset_id = ${a.id} AND ca.collection_id = ${q.collectionId})`,
      );
    }
    if (q.q) {
      // Full-text match on title, tags and description, or a fuzzy title match (trigram index).
      where.push(or(sql`${a.search} @@ websearch_to_tsquery('simple', ${q.q})`, sql`${a.title} ILIKE ${'%' + escapeLike(q.q) + '%'}`)!);
    }
    const cursor = decodeCursor(q.cursor);
    if (cursor) {
      // Keyset pagination: stable under concurrent inserts, no OFFSET scans.
      where.push(or(lt(a.createdAt, cursor.createdAt), and(eq(a.createdAt, cursor.createdAt), lt(a.id, cursor.id)))!);
    }

    const rows = await inWorkspace(s, m, (tx) =>
      tx
        .select({ asset: a, uploaderName: schema.users.name })
        .from(a)
        .innerJoin(schema.users, eq(schema.users.id, a.uploadedBy))
        .where(and(...where))
        .orderBy(desc(a.createdAt), desc(a.id))
        .limit(q.limit + 1),
    );
    const page = rows.slice(0, q.limit);
    const last = page[page.length - 1];
    return {
      items: await Promise.all(page.map((r) => toDto(s.storage, r.asset, r.uploaderName))),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last.asset) : null,
    };
  });

  app.get('/assets/:id', { schema: { tags: ['assets'], params: IdParams } }, async (req) => {
    const m = authorize(req, 'asset.read');
    const row = await inWorkspace(s, m, (tx) => findAsset(tx, req.params.id));
    return toDto(s.storage, row.asset, row.uploaderName);
  });

  /* ---- upload: 1. reserve quota + signed upload, 2. browser uploads to storage, 3. complete ---- */

  app.post('/assets/uploads', { schema: { tags: ['assets'], body: UploadIntentBody } }, async (req, reply) => {
    const m = authorize(req, 'asset.upload');
    const { fileName, contentType, size } = req.body;
    const id = randomUUID();
    const storageKey = `ws/${m.workspaceId}/assets/${id}/original`;

    await inWorkspace(s, m, async (tx) => {
      // Atomic reservation: two parallel uploads can't both squeeze under the quota.
      const reserved = await tx
        .update(schema.workspaces)
        .set({ storageBytes: sql`${schema.workspaces.storageBytes} + ${size}` })
        .where(
          and(
            eq(schema.workspaces.id, m.workspaceId),
            sql`${schema.workspaces.storageBytes} + ${size} <= ${schema.workspaces.quotaBytes}`,
          ),
        )
        .returning({ id: schema.workspaces.id });
      if (!reserved.length) throw new AppError(413, 'quota_exceeded', 'This workspace is out of storage. Delete files from the trash to free space.');
      await tx.insert(schema.assets).values({
        id,
        workspaceId: m.workspaceId,
        uploadedBy: m.userId,
        title: titleFromFileName(fileName),
        fileName,
        kind: ALLOWED_MIME[contentType],
        contentType,
        sizeBytes: size,
        storageKey,
      });
    });

    const ticket = await s.storage.createUpload(storageKey, contentType, size, UPLOAD_TTL_SEC);
    return reply.status(201).send({ assetId: id, upload: ticket });
  });

  app.post('/assets/:id/complete', { schema: { tags: ['assets'], params: IdParams } }, async (req) => {
    const m = authorize(req, 'asset.upload');
    const { asset } = await inWorkspace(s, m, (tx) => findAsset(tx, req.params.id));
    if (asset.status !== 'uploading') {
      return toDto(s.storage, asset, m.name); // already completed: idempotent
    }
    const head = await s.storage.head(asset.storageKey);
    if (!head) throw new AppError(409, 'upload_missing', 'The file hasn’t finished uploading yet.');
    if (head.size !== asset.sizeBytes) {
      await s.storage.delete([asset.storageKey]);
      throw new AppError(400, 'size_mismatch', 'The uploaded file is not the size that was declared.');
    }
    const updated = await inWorkspace(s, m, async (tx) => {
      const [row] = await tx
        .update(schema.assets)
        .set({ status: 'processing', updatedAt: new Date() })
        .where(and(eq(schema.assets.id, asset.id), eq(schema.assets.status, 'uploading')))
        .returning();
      await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'asset.uploaded', targetType: 'asset', targetId: asset.id, details: { fileName: asset.fileName, size: asset.sizeBytes }, ip: req.ip });
      return row ?? asset;
    });
    await s.queue.enqueue({ workspaceId: m.workspaceId, assetId: asset.id });
    return toDto(s.storage, updated, m.name);
  });

  /* ---- edit, trash, restore, purge ---- */

  app.patch('/assets/:id', { schema: { tags: ['assets'], params: IdParams, body: UpdateAssetBody } }, async (req) => {
    const m = authorize(req, 'asset.edit');
    const patch = { ...req.body, tags: req.body.tags ? [...new Set(req.body.tags)] : undefined };
    const row = await inWorkspace(s, m, async (tx) => {
      const [updated] = await tx
        .update(schema.assets)
        .set({ ...patch, updatedAt: new Date() })
        .where(eq(schema.assets.id, req.params.id))
        .returning();
      if (!updated) throw notFound();
      await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'asset.edited', targetType: 'asset', targetId: updated.id, details: { fields: Object.keys(req.body) }, ip: req.ip });
      return findAsset(tx, updated.id);
    });
    return toDto(s.storage, row.asset, row.uploaderName);
  });

  app.post('/assets/trash', { schema: { tags: ['assets'], body: z.object({ ids: z.array(z.uuid()).min(1).max(100) }) } }, async (req) => {
    const m = authorize(req, 'asset.trash');
    const ids = await inWorkspace(s, m, async (tx) => {
      const rows = await tx
        .update(schema.assets)
        .set({ trashedAt: new Date() })
        .where(and(inArray(schema.assets.id, req.body.ids), isNull(schema.assets.trashedAt)))
        .returning({ id: schema.assets.id });
      await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'asset.trashed', targetType: 'asset', details: { ids: rows.map((r) => r.id) }, ip: req.ip });
      return rows.map((r) => r.id);
    });
    return { trashed: ids };
  });

  app.post('/assets/:id/restore', { schema: { tags: ['assets'], params: IdParams } }, async (req) => {
    const m = authorize(req, 'asset.restore');
    await inWorkspace(s, m, async (tx) => {
      const rows = await tx.update(schema.assets).set({ trashedAt: null }).where(eq(schema.assets.id, req.params.id)).returning({ id: schema.assets.id });
      if (!rows.length) throw notFound();
      await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'asset.restored', targetType: 'asset', targetId: req.params.id, ip: req.ip });
    });
    return { ok: true };
  });

  app.delete('/assets/:id', { schema: { tags: ['assets'], params: IdParams } }, async (req) => {
    const m = authorize(req, 'asset.purge');
    const keys = await inWorkspace(s, m, async (tx) => {
      const [row] = await tx
        .delete(schema.assets)
        .where(and(eq(schema.assets.id, req.params.id), isNotNull(schema.assets.trashedAt)))
        .returning();
      if (!row) throw new AppError(409, 'not_in_trash', 'Move the file to the trash before deleting it permanently.');
      await tx
        .update(schema.workspaces)
        .set({ storageBytes: sql`greatest(0, ${schema.workspaces.storageBytes} - ${row.sizeBytes})` })
        .where(eq(schema.workspaces.id, m.workspaceId));
      await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'asset.purged', targetType: 'asset', targetId: row.id, details: { fileName: row.fileName }, ip: req.ip });
      return [row.storageKey, row.thumbKey, row.previewKey].filter((k): k is string => !!k && !k.startsWith(SEED_PREFIX));
    });
    await s.storage.delete(keys); // after commit: a failed DB delete must never lose the file
    return { ok: true };
  });

  app.get('/assets/:id/download', { schema: { tags: ['assets'], params: IdParams } }, async (req) => {
    const m = authorize(req, 'asset.download');
    const { asset } = await inWorkspace(s, m, (tx) => findAsset(tx, req.params.id));
    if (asset.status !== 'ready') throw new AppError(409, 'not_ready', 'This file is still being processed.');
    return { url: await downloadUrl(s.storage, asset.storageKey, asset.fileName) };
  });

  app.get('/workspace/usage', { schema: { tags: ['assets'] } }, async (req) => {
    const m = authorize(req, 'asset.read');
    return inWorkspace(s, m, async (tx) => {
      const [ws] = await tx.select().from(schema.workspaces).where(eq(schema.workspaces.id, m.workspaceId));
      const counts = await tx
        .select({ kind: schema.assets.kind, count: sql<number>`count(*)::int` })
        .from(schema.assets)
        .where(isNull(schema.assets.trashedAt))
        .groupBy(schema.assets.kind);
      const [trash] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.assets).where(isNotNull(schema.assets.trashedAt));
      return {
        name: ws!.name,
        isDemo: ws!.isDemo,
        storageBytes: ws!.storageBytes,
        quotaBytes: ws!.quotaBytes,
        counts: Object.fromEntries(counts.map((c) => [c.kind, c.count])),
        trashed: trash?.count ?? 0,
        role: m.role,
      };
    });
  });
}

/* ------------------------------------------------------------- helpers */

export async function findAsset(tx: Tx, id: string) {
  const [row] = await tx
    .select({ asset: schema.assets, uploaderName: schema.users.name })
    .from(schema.assets)
    .innerJoin(schema.users, eq(schema.users.id, schema.assets.uploadedBy))
    .where(eq(schema.assets.id, id));
  if (!row) throw notFound();
  return row;
}

export const notFound = () => new AppError(404, 'not_found', 'That file doesn’t exist or you don’t have access to it.');

export async function toDto(storage: StorageDriver, a: AssetRow, uploaderName: string): Promise<AssetDto> {
  const ready = a.status === 'ready';
  return {
    id: a.id,
    title: a.title,
    description: a.description,
    fileName: a.fileName,
    kind: a.kind,
    contentType: a.contentType,
    size: a.sizeBytes,
    status: a.status,
    width: a.width,
    height: a.height,
    dominantColor: a.dominantColor,
    tags: a.tags,
    thumbUrl: ready ? await viewUrl(storage, a.thumbKey) : null,
    previewUrl: ready ? await viewUrl(storage, a.previewKey) : null,
    uploadedBy: { id: a.uploadedBy, name: uploaderName },
    createdAt: a.createdAt.toISOString(),
    trashedAt: a.trashedAt?.toISOString() ?? null,
    metadata: a.metadata,
  };
}

function encodeCursor(a: AssetRow): string {
  return Buffer.from(`${a.createdAt.toISOString()}|${a.id}`).toString('base64url');
}

function decodeCursor(cursor?: string): { createdAt: Date; id: string } | null {
  if (!cursor) return null;
  const [iso, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(iso ?? '');
  if (!id || Number.isNaN(createdAt.getTime()) || !/^[0-9a-f-]{36}$/.test(id)) throw new AppError(400, 'bad_cursor', 'Invalid page cursor.');
  return { createdAt, id };
}

const escapeLike = (v: string) => v.replace(/[\\%_]/g, (c) => `\\${c}`);

export function titleFromFileName(fileName: string): string {
  const base = fileName.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ').trim();
  return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 200) || 'Untitled';
}
