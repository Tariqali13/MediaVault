import { randomUUID } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { SignInBody, SignUpBody, type MeDto } from '@mediavault/shared';
import { requireSession, setSessionCookie, type Services } from '../app.js';
import { withContext, schema } from '../db/client.js';
import { checkPassword, hashPassword, SESSION_COOKIE } from '../auth/sessions.js';
import { AppError, isUniqueViolation } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { createDemoWorkspace } from '../demo/demo.js';

export async function authRoutes(fastify: FastifyInstance, s: Services) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const strict = { rateLimit: { max: 10, timeWindow: '1 minute' } };

  app.post('/auth/sign-up', { config: strict, schema: { tags: ['auth'], body: SignUpBody } }, async (req, reply) => {
    const { name, email, password, workspaceName } = req.body;
    const passwordHash = await hashPassword(password);
    const userId = randomUUID();
    const workspaceId = randomUUID();
    try {
      // The workspace is created before any tenant context exists; the user id in the
      // context satisfies the narrow INSERT policy, then we step into the new workspace.
      await withContext(s.pool, { userId }, async (tx) => {
        await tx.insert(schema.users).values({ id: userId, email, name, passwordHash });
        await tx.insert(schema.workspaces).values({ id: workspaceId, name: workspaceName, quotaBytes: s.config.WORKSPACE_QUOTA_BYTES });
      });
      await withContext(s.pool, { userId, workspaceId }, async (tx) => {
        await tx.insert(schema.memberships).values({ workspaceId, userId, role: 'owner' });
        await audit(tx, { workspaceId, actorId: userId, action: 'workspace.created', details: { name: workspaceName }, ip: req.ip });
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new AppError(409, 'email_taken', 'An account with this email already exists. Sign in instead.');
      throw err;
    }
    const session = await s.sessions.create(userId, workspaceId);
    setSessionCookie(reply, s.config, session.token, session.expiresAt);
    return reply.status(201).send(await me(s, userId, workspaceId));
  });

  app.post('/auth/sign-in', { config: strict, schema: { tags: ['auth'], body: SignInBody } }, async (req, reply) => {
    const { rows } = await s.pool.query<{ id: string; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = $1', [
      req.body.email,
    ]);
    const user = rows[0];
    // Same error and same timing whether the email exists or not.
    if (!(await checkPassword(user?.password_hash ?? null, req.body.password)) || !user) {
      throw new AppError(401, 'bad_credentials', 'That email and password don’t match.');
    }
    const workspaces = await listWorkspaces(s, user.id);
    const session = await s.sessions.create(user.id, workspaces[0]?.id ?? null);
    setSessionCookie(reply, s.config, session.token, session.expiresAt);
    return me(s, user.id, workspaces[0]?.id ?? null);
  });

  app.post('/auth/sign-out', { schema: { tags: ['auth'] } }, async (req, reply) => {
    if (req.session) await s.sessions.destroy(req.session.tokenHash);
    reply.clearCookie(SESSION_COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/auth/me', { schema: { tags: ['auth'] } }, async (req) => {
    const session = requireSession(req);
    return me(s, session.userId, session.workspaceId);
  });

  app.post(
    '/workspaces/switch',
    { schema: { tags: ['auth'], body: z.object({ workspaceId: z.uuid() }) } },
    async (req: FastifyRequest<{ Body: { workspaceId: string } }>) => {
      const session = requireSession(req);
      const workspaces = await listWorkspaces(s, session.userId);
      if (!workspaces.some((w) => w.id === req.body.workspaceId)) throw new AppError(404, 'not_found', 'Workspace not found.');
      await s.sessions.switchWorkspace(session.tokenHash, req.body.workspaceId);
      return me(s, session.userId, req.body.workspaceId);
    },
  );

  app.post('/auth/demo', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } }, schema: { tags: ['auth'] } }, async (req, reply) => {
    if (!s.config.DEMO_MODE) throw new AppError(404, 'not_found', 'Demo mode is off.');
    const { userId, workspaceId } = await createDemoWorkspace(s);
    const session = await s.sessions.create(userId, workspaceId);
    setSessionCookie(reply, s.config, session.token, session.expiresAt);
    req.log.info({ workspaceId }, 'demo workspace created');
    return me(s, userId, workspaceId);
  });
}

export async function listWorkspaces(s: Services, userId: string) {
  return withContext(s.pool, { userId }, (tx) =>
    tx
      .select({ id: schema.workspaces.id, name: schema.workspaces.name, role: schema.memberships.role })
      .from(schema.memberships)
      .innerJoin(schema.workspaces, eq(schema.workspaces.id, schema.memberships.workspaceId))
      .where(eq(schema.memberships.userId, userId))
      .orderBy(schema.workspaces.createdAt),
  );
}

async function me(s: Services, userId: string, workspaceId: string | null): Promise<MeDto> {
  const { rows } = await s.pool.query('SELECT id, name, email FROM users WHERE id = $1', [userId]);
  const workspaces = await listWorkspaces(s, userId);
  return {
    user: rows[0],
    workspaces,
    activeWorkspaceId: workspaces.some((w) => w.id === workspaceId) ? workspaceId : (workspaces[0]?.id ?? null),
  };
}
