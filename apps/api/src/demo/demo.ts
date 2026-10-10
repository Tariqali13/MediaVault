import { randomBytes, randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { eq, sql } from 'drizzle-orm';
import type { Services } from '../app.js';
import { withContext, schema, type Pool } from '../db/client.js';
import { hashPassword, newToken, sha256 } from '../auth/sessions.js';
import { processImage } from '../media/processor.js';
import { audit } from '../lib/audit.js';
import type { StorageDriver } from '../storage/driver.js';
import { SEED_PREFIX } from '../routes/assets.js';
import { seedItems, seedPdf } from './artwork.js';

/**
 * Every "Try the demo" click gets a brand-new, private workspace filled with a
 * sample library. Visitors can upload, delete and invite freely without seeing
 * each other's changes, and demo workspaces are deleted after 24 hours.
 *
 * Sample files are rendered and processed once, stored under a shared read-only
 * prefix, and referenced by every demo workspace.
 */

interface SeedAsset {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  collections: string[];
  daysAgo: number;
  fileName: string;
  contentType: string;
  kind: 'image' | 'document';
  size: number;
  storageKey: string;
  thumbKey: string | null;
  previewKey: string | null;
  width: number | null;
  height: number | null;
  dominantColor: string | null;
  metadata: Record<string, string | number>;
}

const MANIFEST_KEY = `${SEED_PREFIX}manifest-v1.json`;
let manifest: Promise<SeedAsset[]> | null = null;

export function ensureSeed(storage: StorageDriver): Promise<SeedAsset[]> {
  manifest ??= loadOrBuild(storage).catch((err) => {
    manifest = null;
    throw err;
  });
  return manifest;
}

async function loadOrBuild(storage: StorageDriver): Promise<SeedAsset[]> {
  if (await storage.head(MANIFEST_KEY)) return JSON.parse((await storage.get(MANIFEST_KEY)).toString()) as SeedAsset[];

  const assets: SeedAsset[] = [];
  for (const item of seedItems()) {
    const original = await sharp(Buffer.from(item.svg)).jpeg({ quality: 86 }).withExifMerge({ IFD0: { Make: 'Northwind', Model: 'Studio render' } }).toBuffer();
    const processed = await processImage(original);
    const base = `${SEED_PREFIX}${item.slug}`;
    await storage.put(`${base}/original`, original, 'image/jpeg');
    await storage.put(`${base}/thumb.webp`, processed.thumb, 'image/webp');
    await storage.put(`${base}/preview.webp`, processed.preview, 'image/webp');
    assets.push({
      slug: item.slug,
      title: item.title,
      description: item.description,
      tags: item.tags,
      collections: item.collections,
      daysAgo: item.daysAgo,
      fileName: `${item.slug}.jpg`,
      contentType: 'image/jpeg',
      kind: 'image',
      size: original.length,
      storageKey: `${base}/original`,
      thumbKey: `${base}/thumb.webp`,
      previewKey: `${base}/preview.webp`,
      width: processed.width,
      height: processed.height,
      dominantColor: processed.dominantColor,
      metadata: processed.metadata,
    });
  }
  const pdf = seedPdf();
  await storage.put(`${SEED_PREFIX}brand-guidelines/original`, pdf, 'application/pdf');
  assets.push({
    slug: 'brand-guidelines',
    title: 'Brand guidelines',
    description: 'Logo usage, colour and type rules.',
    tags: ['brand', 'approved'],
    collections: [],
    daysAgo: 14,
    fileName: 'brand-guidelines.pdf',
    contentType: 'application/pdf',
    kind: 'document',
    size: pdf.length,
    storageKey: `${SEED_PREFIX}brand-guidelines/original`,
    thumbKey: null,
    previewKey: null,
    width: null,
    height: null,
    dominantColor: null,
    metadata: { format: 'pdf' },
  });
  await storage.put(MANIFEST_KEY, Buffer.from(JSON.stringify(assets)), 'application/json');
  return assets;
}

const TEAMMATES = [
  { name: 'Maya Chen', role: 'admin' as const },
  { name: 'Samir Khan', role: 'editor' as const },
  { name: 'Olivia Reed', role: 'viewer' as const },
];

export async function createDemoWorkspace(s: Services): Promise<{ userId: string; workspaceId: string }> {
  const seed = await ensureSeed(s.storage);
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const suffix = randomBytes(4).toString('hex');
  // Demo accounts can't be signed into with a password: the hash is of a random secret nobody knows.
  const unusable = await hashPassword(newToken());

  const people = [{ id: userId, name: 'You (demo)', role: 'owner' as const }, ...TEAMMATES.map((t) => ({ ...t, id: randomUUID() }))];
  await withContext(s.pool, { userId }, async (tx) => {
    for (const p of people) {
      await tx.insert(schema.users).values({ id: p.id, name: p.name, email: `${p.name.split(' ')[0]!.toLowerCase().replace(/[^a-z]/g, '')}+${suffix}@demo.mediavault.dev`, passwordHash: unusable });
    }
    await tx.insert(schema.workspaces).values({ id: workspaceId, name: 'Northwind Studio', isDemo: true, quotaBytes: 100 * 1024 * 1024 });
  });

  await withContext(s.pool, { userId, workspaceId }, async (tx) => {
    await tx.insert(schema.memberships).values(people.map((p) => ({ workspaceId, userId: p.id, role: p.role })));
    const now = Date.now();
    const uploaders = people.slice(1, 3);
    const rows = seed.map((a, i) => ({
      id: randomUUID(),
      workspaceId,
      uploadedBy: uploaders[i % uploaders.length]!.id,
      title: a.title,
      description: a.description,
      fileName: a.fileName,
      kind: a.kind,
      contentType: a.contentType,
      sizeBytes: a.size,
      storageKey: a.storageKey,
      status: 'ready' as const,
      width: a.width,
      height: a.height,
      dominantColor: a.dominantColor,
      metadata: a.metadata,
      thumbKey: a.thumbKey,
      previewKey: a.previewKey,
      tags: a.tags,
      createdAt: new Date(now - a.daysAgo * 86_400_000 - i * 3_600_000),
    }));
    await tx.insert(schema.assets).values(rows);

    const collectionNames = [...new Set(seed.flatMap((a) => a.collections))];
    const collections = await tx
      .insert(schema.collections)
      .values(collectionNames.map((name) => ({ workspaceId, name, createdBy: people[1]!.id })))
      .returning();
    const byName = new Map(collections.map((c) => [c.name, c.id]));
    const links = seed.flatMap((a, i) => a.collections.map((c) => ({ workspaceId, collectionId: byName.get(c)!, assetId: rows[i]!.id })));
    if (links.length) await tx.insert(schema.collectionAssets).values(links);

    await tx.update(schema.workspaces).set({ storageBytes: rows.reduce((n, r) => n + r.sizeBytes, 0) }).where(eq(schema.workspaces.id, workspaceId));

    // A little history so the activity log isn't empty.
    await tx.insert(schema.shareLinks).values({
      workspaceId,
      tokenHash: sha256(newToken()),
      collectionId: byName.get('Spring campaign') ?? null,
      allowDownload: false,
      createdBy: people[1]!.id,
      expiresAt: new Date(now + 3 * 86_400_000),
      viewCount: 12,
    });
    await audit(tx, { workspaceId, actorId: people[1]!.id, action: 'collection.created', targetType: 'collection', details: { name: 'Spring campaign' } });
    await audit(tx, { workspaceId, actorId: people[2]!.id, action: 'asset.uploaded', targetType: 'asset', targetId: rows[0]!.id, details: { fileName: rows[0]!.fileName } });
    await audit(tx, { workspaceId, actorId: people[1]!.id, action: 'share.created', targetType: 'share', details: { allowDownload: false } });
  });
  return { userId, workspaceId };
}

/** Deletes demo workspaces older than 24 hours, their uploads, and their demo users. */
export async function purgeExpiredDemos(pool: Pool, storage: StorageDriver): Promise<number> {
  const expired = await withContext(pool, {}, (tx) => tx.select({ id: schema.workspaces.id }).from(schema.workspaces).where(sql`is_demo`));
  for (const { id } of expired) {
    const keys = await withContext(pool, { workspaceId: id }, async (tx) => {
      const assets = await tx.select({ k: schema.assets.storageKey, t: schema.assets.thumbKey, p: schema.assets.previewKey }).from(schema.assets);
      const members = await tx.select({ userId: schema.memberships.userId }).from(schema.memberships);
      await tx.delete(schema.workspaces).where(eq(schema.workspaces.id, id));
      // Demo users exist only for their demo workspace.
      if (members.length) await tx.execute(sql`DELETE FROM users WHERE email LIKE '%@demo.mediavault.dev' AND id IN (${sql.join(members.map((m) => sql`${m.userId}`), sql`, `)})`);
      return assets.flatMap((a) => [a.k, a.t, a.p]).filter((k): k is string => !!k && !k.startsWith(SEED_PREFIX));
    });
    await storage.delete(keys).catch(() => undefined);
  }
  return expired.length;
}
