import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler } from 'fastify-type-provider-zod';
import { and, eq } from 'drizzle-orm';
import { can, MAX_UPLOAD_BYTES, type Action, type Role } from '@mediavault/shared';
import type { Config } from './config.js';
import { withContext, schema, type Pool, type RequestContext, type Tx } from './db/client.js';
import { Sessions, SESSION_COOKIE, type SessionUser } from './auth/sessions.js';
import type { StorageDriver } from './storage/driver.js';
import { LocalStorage } from './storage/local.js';
import { S3Storage } from './storage/s3.js';
import { AppError } from './lib/errors.js';
import type { MediaQueue } from './media/pipeline.js';
import { authRoutes } from './routes/auth.js';
import { assetRoutes } from './routes/assets.js';
import { collectionRoutes } from './routes/collections.js';
import { shareRoutes } from './routes/shares.js';
import { memberRoutes } from './routes/members.js';
import { storageRoutes } from './routes/storage.js';

export interface Services {
  config: Config;
  pool: Pool;
  sessions: Sessions;
  storage: StorageDriver;
  queue: Pick<MediaQueue, 'enqueue'>;
}

export interface Member {
  userId: string;
  name: string;
  workspaceId: string;
  role: Role;
}

declare module 'fastify' {
  interface FastifyRequest {
    session: SessionUser | null;
    member: Member | null;
  }
}

export function createStorage(config: Config): StorageDriver {
  if (config.STORAGE_DRIVER === 's3') {
    return new S3Storage(config.S3_BUCKET!, {
      region: config.S3_REGION,
      endpoint: config.S3_ENDPOINT,
      accessKeyId: config.S3_ACCESS_KEY_ID!,
      secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
      forcePathStyle: config.S3_FORCE_PATH_STYLE,
    });
  }
  return new LocalStorage(config.LOCAL_STORAGE_DIR, config.PUBLIC_API_URL, config.SIGNING_SECRET);
}

export async function buildApp(s: Services): Promise<FastifyInstance> {
  const { config } = s;
  const app = Fastify({
    logger:
      config.NODE_ENV === 'test'
        ? false
        : {
            level: config.LOG_LEVEL,
            redact: ['req.headers.cookie', 'req.headers.authorization'],
            transport: config.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
          },
    trustProxy: true,
    bodyLimit: 1024 * 1024,
  });
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_BYTES, files: 1, fields: 4 } });
  if (config.RATE_LIMIT_ENABLED) await app.register(rateLimit, { global: true, max: 600, timeWindow: '1 minute' });
  await app.register(swagger, {
    openapi: { info: { title: 'MediaVault API', version: '2.0.0' } },
    transform: jsonSchemaTransform,
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  app.decorateRequest('session', null);
  app.decorateRequest('member', null);

  app.addHook('onRequest', async (req) => {
    // CSRF: the session cookie is SameSite=Lax, and state-changing requests must
    // also come from our own origin (browsers always send Origin on these).
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !req.url.startsWith('/storage/upload')) {
      const origin = req.headers.origin;
      if (origin && origin !== config.APP_ORIGIN) throw new AppError(403, 'bad_origin', 'Cross-site request blocked.');
    }
    req.session = await s.sessions.resolve(req.cookies[SESSION_COOKIE]);
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) {
      return reply.status(err.statusCode).send({ error: { code: err.code, message: err.message, ...err.details } });
    }
    if (hasZodFastifySchemaValidationErrors(err)) {
      const issues = err.validation.map((v) => `${v.instancePath.replace(/^\//, '') || 'request'}: ${v.message}`);
      return reply.status(400).send({ error: { code: 'validation_error', message: issues[0] ?? 'Invalid request', issues } });
    }
    const status = (err as { statusCode?: number }).statusCode;
    if (status === 429) return reply.status(429).send({ error: { code: 'rate_limited', message: 'Too many attempts. Wait a minute and try again.' } });
    if (status && status < 500) return reply.status(status).send({ error: { code: 'request_error', message: (err as Error).message } });
    req.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ error: { code: 'internal_error', message: 'Something went wrong.', requestId: req.id } });
  });

  app.get('/health', { schema: { hide: true } }, async () => {
    await s.pool.query('SELECT 1');
    return { ok: true };
  });

  await app.register(async (r) => authRoutes(r, s));
  await app.register(async (r) => assetRoutes(r, s));
  await app.register(async (r) => collectionRoutes(r, s));
  await app.register(async (r) => shareRoutes(r, s));
  await app.register(async (r) => memberRoutes(r, s));
  if (s.storage instanceof LocalStorage) {
    const local = s.storage;
    await app.register(async (r) => storageRoutes(r, local));
  }
  return app;
}

/* ------------------------------------------------------------- guards */

export function requireSession(req: FastifyRequest): SessionUser {
  if (!req.session) throw new AppError(401, 'signed_out', 'Please sign in.');
  return req.session;
}

/**
 * Loads the caller's role in their active workspace, inside the tenant context.
 * Use as a preHandler on every workspace-scoped route.
 */
export function memberGuard(s: Services) {
  return async (req: FastifyRequest) => {
    const session = requireSession(req);
    if (!session.workspaceId) throw new AppError(403, 'no_workspace', 'Choose a workspace first.');
    const role = await withContext(s.pool, { userId: session.userId, workspaceId: session.workspaceId }, async (tx) => {
      const [m] = await tx
        .select({ role: schema.memberships.role })
        .from(schema.memberships)
        .where(and(eq(schema.memberships.workspaceId, session.workspaceId!), eq(schema.memberships.userId, session.userId)));
      return m?.role;
    });
    if (!role) throw new AppError(403, 'not_a_member', 'You no longer have access to this workspace.');
    req.member = { userId: session.userId, name: session.name, workspaceId: session.workspaceId, role };
  };
}

export function authorize(req: FastifyRequest, action: Action): Member {
  const m = req.member;
  if (!m) throw new AppError(401, 'signed_out', 'Please sign in.');
  if (!can(m.role, action)) throw new AppError(403, 'forbidden', `Your role (${m.role}) can’t do that.`);
  return m;
}

/** Run a query scoped to the caller's workspace. */
export function inWorkspace<T>(s: Services, m: Member, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const ctx: RequestContext = { userId: m.userId, workspaceId: m.workspaceId };
  return withContext(s.pool, ctx, fn);
}

export function setSessionCookie(reply: FastifyReply, config: Config, token: string, expiresAt: Date) {
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: config.NODE_ENV === 'production',
    expires: expiresAt,
  });
}
