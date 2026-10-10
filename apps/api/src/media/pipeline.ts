import { and, eq, sql } from 'drizzle-orm';
import { PgBoss } from 'pg-boss';
import { withContext, schema, type Pool } from '../db/client.js';
import type { StorageDriver } from '../storage/driver.js';
import { processImage, sniffMatches } from './processor.js';

export const PROCESS_QUEUE = 'process-asset';
export const MAX_ATTEMPTS = 3;

export interface ProcessJob {
  workspaceId: string;
  assetId: string;
}

export interface PipelineDeps {
  pool: Pool;
  storage: StorageDriver;
  log: { info: (o: object, m: string) => void; warn: (o: object, m: string) => void; error: (o: object, m: string) => void };
}

/**
 * Turns an uploaded original into a ready asset: verify the bytes really are the
 * declared type, extract metadata, render thumbnail and preview, update the row.
 * Idempotent: a retried job for an asset that is already ready does nothing.
 */
export async function processAsset(deps: PipelineDeps, job: ProcessJob, attempt: number): Promise<'ready' | 'failed' | 'skipped'> {
  const { pool, storage } = deps;
  const ctx = { workspaceId: job.workspaceId };
  const asset = await withContext(pool, ctx, async (tx) => {
    const [row] = await tx.select().from(schema.assets).where(eq(schema.assets.id, job.assetId));
    return row;
  });
  if (!asset || asset.status !== 'processing') return 'skipped';

  try {
    const original = await storage.get(asset.storageKey);
    if (!(await sniffMatches(original, asset.contentType))) {
      await fail(deps, job, asset.storageKey, asset.sizeBytes, 'The file’s contents don’t match its type.');
      return 'failed';
    }

    if (asset.kind !== 'image') {
      await markReady(pool, job, { metadata: { format: asset.contentType.split('/')[1] ?? asset.contentType } });
      return 'ready';
    }

    const result = await processImage(original);
    const thumbKey = `${asset.storageKey.replace(/\/original$/, '')}/thumb.webp`;
    const previewKey = `${asset.storageKey.replace(/\/original$/, '')}/preview.webp`;
    await Promise.all([storage.put(thumbKey, result.thumb, 'image/webp'), storage.put(previewKey, result.preview, 'image/webp')]);
    await markReady(pool, job, {
      width: result.width,
      height: result.height,
      dominantColor: result.dominantColor,
      metadata: result.metadata,
      thumbKey,
      previewKey,
    });
    return 'ready';
  } catch (err) {
    if (attempt + 1 >= MAX_ATTEMPTS) {
      deps.log.error({ err, ...job }, 'asset processing failed permanently');
      await fail(deps, job, asset.storageKey, asset.sizeBytes, 'We couldn’t process this file.');
      return 'failed';
    }
    throw err; // let the queue retry with backoff
  }
}

async function markReady(pool: Pool, job: ProcessJob, patch: Partial<typeof schema.assets.$inferInsert>) {
  await withContext(pool, { workspaceId: job.workspaceId }, (tx) =>
    tx
      .update(schema.assets)
      .set({ ...patch, status: 'ready', updatedAt: new Date() })
      .where(and(eq(schema.assets.id, job.assetId), eq(schema.assets.status, 'processing'))),
  );
}

async function fail(deps: PipelineDeps, job: ProcessJob, storageKey: string, size: number, reason: string) {
  await withContext(deps.pool, { workspaceId: job.workspaceId }, async (tx) => {
    const updated = await tx
      .update(schema.assets)
      .set({ status: 'failed', failureReason: reason, updatedAt: new Date() })
      .where(and(eq(schema.assets.id, job.assetId), eq(schema.assets.status, 'processing')))
      .returning({ id: schema.assets.id });
    // A rejected file no longer counts against the workspace's storage.
    if (updated.length) {
      await tx
        .update(schema.workspaces)
        .set({ storageBytes: sql`greatest(0, ${schema.workspaces.storageBytes} - ${size})` })
        .where(eq(schema.workspaces.id, job.workspaceId));
    }
  });
  await deps.storage.delete([storageKey]).catch(() => undefined);
}

/* ----------------------------------------------------------- queue wiring */

export class MediaQueue {
  private constructor(private readonly boss: PgBoss) {}

  static async start(connectionString: string): Promise<MediaQueue> {
    const boss = new PgBoss({ connectionString, schema: 'pgboss' });
    boss.on('error', (err) => console.error('pg-boss error', err));
    await boss.start();
    await boss.createQueue(PROCESS_QUEUE, {
      retryLimit: MAX_ATTEMPTS - 1,
      retryDelay: 5,
      retryBackoff: true,
      expireInSeconds: 300,
    });
    return new MediaQueue(boss);
  }

  async enqueue(job: ProcessJob): Promise<void> {
    // singletonKey: a double "complete" request can't enqueue the same asset twice.
    await this.boss.send(PROCESS_QUEUE, job, { singletonKey: job.assetId });
  }

  async work(deps: PipelineDeps, concurrency = 2): Promise<void> {
    await this.boss.work<ProcessJob>(PROCESS_QUEUE, { localConcurrency: concurrency, pollingIntervalSeconds: 2 }, async ([job]) => {
      if (!job) return;
      const outcome = await processAsset(deps, job.data, job.retryCount);
      deps.log.info({ ...job.data, outcome, attempt: job.retryCount + 1 }, 'asset processed');
    });
  }

  async stop(): Promise<void> {
    await this.boss.stop({ graceful: true, timeout: 10_000 });
  }
}
