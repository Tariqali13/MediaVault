import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { FastifyInstance, InjectOptions } from 'fastify';
import sharp from 'sharp';
import { loadConfig, type Config } from '../src/config.js';
import { createPool, type Pool } from '../src/db/client.js';
import { migrate } from '../src/db/migrate.js';
import { Sessions } from '../src/auth/sessions.js';
import { buildApp, createStorage, type Services } from '../src/app.js';
import { processAsset, type ProcessJob } from '../src/media/pipeline.js';
import type { StorageDriver } from '../src/storage/driver.js';

/**
 * Integration tests run against a real Postgres, connected as a NON-superuser role,
 * because row-level security is exactly what they need to prove.
 */
export const TEST_DB_URL = process.env.TEST_DATABASE_URL || 'postgres://mediavault:mediavault@localhost:5432/mediavault_test';

export interface Harness {
  app: FastifyInstance;
  pool: Pool;
  storage: StorageDriver;
  config: Config;
  services: Services;
  processed: ProcessJob[];
  close: () => Promise<void>;
  reset: () => Promise<void>;
}

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined };

export async function harness(overrides: Record<string, string> = {}): Promise<Harness> {
  const dir = await mkdtemp(path.join(tmpdir(), 'mv-storage-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DB_URL,
    LOCAL_STORAGE_DIR: dir,
    PUBLIC_API_URL: 'http://api.test',
    APP_ORIGIN: 'http://app.test',
    RATE_LIMIT_ENABLED: 'false',
    ...overrides,
  });
  const pool = createPool(config.DATABASE_URL);
  const { rows } = await pool.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
    'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
  );
  if (rows[0]?.rolsuper || rows[0]?.rolbypassrls) {
    throw new Error('Tests must connect as a role without SUPERUSER/BYPASSRLS, or RLS is not being tested.');
  }
  await migrate(pool, () => undefined);
  const storage = createStorage(config);
  const processed: ProcessJob[] = [];
  // The queue is replaced by synchronous processing so tests are deterministic.
  const queue = {
    enqueue: async (job: ProcessJob) => {
      processed.push(job);
      await processAsset({ pool, storage, log: silentLog }, job, 0);
    },
  };
  const services: Services = { config, pool, sessions: new Sessions(pool, 1), storage, queue };
  const app = await buildApp(services);
  return {
    app,
    pool,
    storage,
    config,
    services,
    processed,
    reset: async () => {
      await pool.query('TRUNCATE users, sessions, workspaces, memberships, invites, assets, collections, collection_assets, share_links, audit_events CASCADE');
      processed.length = 0;
    },
    close: async () => {
      await app.close();
      await pool.end();
      await rm(dir, { recursive: true, force: true });
    },
  };
}

/** A tiny HTTP client that keeps one user's session cookie. */
export class Client {
  cookie = '';
  constructor(private readonly app: FastifyInstance) {}

  async req(method: InjectOptions['method'], url: string, payload?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: payload as InjectOptions['payload'],
      headers: { ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.headers['set-cookie'];
    const first = Array.isArray(set) ? set[0] : set;
    if (first?.startsWith('mv_session=')) this.cookie = first.split(';')[0]!;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- test convenience: responses are asserted on, not typed
    return { status: res.statusCode, body: res.body ? (safeJson(res.body) as any) : null, raw: res };
  }

  get = (url: string) => this.req('GET', url);
  post = (url: string, body: unknown = {}) => this.req('POST', url, body);
  patch = (url: string, body: unknown) => this.req('PATCH', url, body);
  del = (url: string) => this.req('DELETE', url);
}

function safeJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

let counter = 0;
export async function signUp(app: FastifyInstance, name = 'Ada', workspaceName = 'Studio A') {
  const c = new Client(app);
  const email = `${name.toLowerCase()}${++counter}@example.com`;
  const res = await c.post('/auth/sign-up', { name, email, password: 'correct horse battery', workspaceName });
  if (res.status !== 201) throw new Error(`sign-up failed: ${JSON.stringify(res.body)}`);
  return { client: c, email, userId: res.body.user.id as string, workspaceId: res.body.activeWorkspaceId as string };
}

export async function testJpeg(width = 640, height = 480, color = '#336699'): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: color } }).jpeg().toBuffer();
}

/** Runs the whole browser upload flow: intent → signed upload to storage → complete. */
export async function upload(app: FastifyInstance, client: Client, file: Buffer, opts: { name?: string; type?: string; declaredSize?: number } = {}) {
  const intent = await client.post('/assets/uploads', {
    fileName: opts.name ?? 'photo.jpg',
    contentType: opts.type ?? 'image/jpeg',
    size: opts.declaredSize ?? file.length,
  });
  if (intent.status !== 201) return { intent, complete: null };
  const { fields } = intent.body.upload;
  const boundary = '----mvtest';
  const parts = [
    ...Object.entries(fields).map(([k, v]) => `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${opts.name ?? 'photo.jpg'}"\r\nContent-Type: ${opts.type ?? 'image/jpeg'}\r\n\r\n`,
  ];
  const body = Buffer.concat([Buffer.from(parts.join('')), file, Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const put = await app.inject({ method: 'POST', url: '/storage/upload', payload: body, headers: { 'content-type': `multipart/form-data; boundary=${boundary}` } });
  const complete = await client.post(`/assets/${intent.body.assetId}/complete`);
  return { intent, uploadStatus: put.statusCode, complete, assetId: intent.body.assetId as string };
}
