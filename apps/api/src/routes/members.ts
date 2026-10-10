import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { and, desc, eq, gt, isNull, lt, sql } from 'drizzle-orm';
import { z } from 'zod';
import { AcceptInviteBody, InviteBody, RoleSchema, canAssignRole } from '@mediavault/shared';
import { authorize, inWorkspace, memberGuard, setSessionCookie, type Services } from '../app.js';
import { withContext, schema } from '../db/client.js';
import { hashPassword, newToken, sha256 } from '../auth/sessions.js';
import { AppError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';

const INVITE_TTL_DAYS = 7;

export async function memberRoutes(fastify: FastifyInstance, s: Services) {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  await app.register(async (scoped) => {
    const r = scoped.withTypeProvider<ZodTypeProvider>();
    r.addHook('preHandler', memberGuard(s));

    r.get('/members', { schema: { tags: ['members'] } }, async (req) => {
      const m = authorize(req, 'member.read');
      return inWorkspace(s, m, (tx) =>
        tx
          .select({ userId: schema.users.id, name: schema.users.name, email: schema.users.email, role: schema.memberships.role, joinedAt: schema.memberships.createdAt })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(eq(schema.memberships.workspaceId, m.workspaceId))
          .orderBy(schema.memberships.createdAt),
      );
    });

    r.post('/invites', { schema: { tags: ['members'], body: InviteBody } }, async (req, reply) => {
      const m = authorize(req, 'member.invite');
      if (!canAssignRole(m.role, 'viewer', req.body.role)) throw new AppError(403, 'forbidden', `Your role can’t invite ${req.body.role}s.`);
      const token = newToken();
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
      await inWorkspace(s, m, async (tx) => {
        const already = await tx
          .select({ id: schema.users.id })
          .from(schema.memberships)
          .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
          .where(and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.users.email, req.body.email)));
        if (already.length) throw new AppError(409, 'already_member', 'That person is already in this workspace.');
        const [inv] = await tx
          .insert(schema.invites)
          .values({ workspaceId: m.workspaceId, email: req.body.email, role: req.body.role, tokenHash: sha256(token), invitedBy: m.userId, expiresAt })
          .returning({ id: schema.invites.id });
        await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'member.invited', targetType: 'invite', targetId: inv!.id, details: { email: req.body.email, role: req.body.role }, ip: req.ip });
      });
      // No email service in this demo: the admin copies the link. Only its hash is stored.
      return reply.status(201).send({ url: `${s.config.APP_ORIGIN}/invite/${token}`, expiresAt: expiresAt.toISOString() });
    });

    r.get('/invites', { schema: { tags: ['members'] } }, async (req) => {
      const m = authorize(req, 'member.invite');
      return inWorkspace(s, m, (tx) =>
        tx
          .select({ id: schema.invites.id, email: schema.invites.email, role: schema.invites.role, expiresAt: schema.invites.expiresAt })
          .from(schema.invites)
          .where(and(isNull(schema.invites.acceptedAt), gt(schema.invites.expiresAt, new Date())))
          .orderBy(desc(schema.invites.createdAt)),
      );
    });

    r.delete('/invites/:id', { schema: { tags: ['members'], params: z.object({ id: z.uuid() }) } }, async (req) => {
      const m = authorize(req, 'member.invite');
      await inWorkspace(s, m, (tx) => tx.delete(schema.invites).where(eq(schema.invites.id, req.params.id)));
      return { ok: true };
    });

    r.patch(
      '/members/:userId',
      { schema: { tags: ['members'], params: z.object({ userId: z.uuid() }), body: z.object({ role: RoleSchema }) } },
      async (req) => {
        const m = authorize(req, 'member.changeRole');
        await inWorkspace(s, m, async (tx) => {
          const target = await membership(tx, m.workspaceId, req.params.userId);
          if (!canAssignRole(m.role, target.role, req.body.role)) throw new AppError(403, 'forbidden', 'You can’t give or change that role.');
          if (target.role === 'owner' && req.body.role !== 'owner') await assertAnotherOwner(tx, m.workspaceId, req.params.userId);
          await tx
            .update(schema.memberships)
            .set({ role: req.body.role })
            .where(and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, req.params.userId)));
          await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'member.role_changed', targetType: 'user', targetId: req.params.userId, details: { from: target.role, to: req.body.role }, ip: req.ip });
        });
        return { ok: true };
      },
    );

    r.delete('/members/:userId', { schema: { tags: ['members'], params: z.object({ userId: z.uuid() }) } }, async (req) => {
      const m = authorize(req, 'member.remove');
      await inWorkspace(s, m, async (tx) => {
        const target = await membership(tx, m.workspaceId, req.params.userId);
        if (target.role === 'owner' && m.role !== 'owner') throw new AppError(403, 'forbidden', 'Only an owner can remove an owner.');
        if (target.role === 'admin' && m.role === 'admin' && req.params.userId !== m.userId) {
          throw new AppError(403, 'forbidden', 'Admins can’t remove other admins.');
        }
        if (target.role === 'owner') await assertAnotherOwner(tx, m.workspaceId, req.params.userId);
        await tx.delete(schema.memberships).where(and(eq(schema.memberships.workspaceId, m.workspaceId), eq(schema.memberships.userId, req.params.userId)));
        await audit(tx, { workspaceId: m.workspaceId, actorId: m.userId, action: 'member.removed', targetType: 'user', targetId: req.params.userId, details: { role: target.role }, ip: req.ip });
      });
      return { ok: true };
    });

    r.get(
      '/audit',
      { schema: { tags: ['members'], querystring: z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(100).default(50) }) } },
      async (req) => {
        const m = authorize(req, 'audit.read');
        const rows = await inWorkspace(s, m, (tx) =>
          tx
            .select({
              id: schema.auditEvents.id,
              action: schema.auditEvents.action,
              targetType: schema.auditEvents.targetType,
              targetId: schema.auditEvents.targetId,
              details: schema.auditEvents.details,
              createdAt: schema.auditEvents.createdAt,
              actor: sql<string | null>`(SELECT name FROM users WHERE id = ${schema.auditEvents.actorId})`,
            })
            .from(schema.auditEvents)
            .where(req.query.before ? lt(schema.auditEvents.id, req.query.before) : undefined)
            .orderBy(desc(schema.auditEvents.id))
            .limit(req.query.limit),
        );
        return { items: rows, nextBefore: rows.length === req.query.limit ? rows[rows.length - 1]!.id : null };
      },
    );
  });

  /* ---- accepting an invite (may not be signed in yet) ---- */

  app.get('/public/invites/:token', { schema: { tags: ['members'], params: z.object({ token: z.string().min(20).max(100) }) } }, async (req) => {
    const invite = await findInvite(s, req.params.token);
    const { rows } = await s.pool.query('SELECT 1 FROM users WHERE email = $1', [invite.email]);
    return { workspaceName: invite.workspaceName, email: invite.email, role: invite.role, hasAccount: rows.length > 0 };
  });

  app.post(
    '/public/invites/accept',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } }, schema: { tags: ['members'], body: AcceptInviteBody } },
    async (req, reply) => {
      const invite = await findInvite(s, req.body.token);
      let userId: string;
      if (req.session) {
        if (req.session.email !== invite.email) {
          throw new AppError(403, 'wrong_account', `This invite is for ${invite.email}. Sign out and open the link again.`);
        }
        userId = req.session.userId;
      } else {
        const { rows } = await s.pool.query<{ id: string }>('SELECT id FROM users WHERE email = $1', [invite.email]);
        if (rows[0]) throw new AppError(409, 'sign_in_first', 'You already have an account. Sign in, then open the invite link again.');
        if (!req.body.name || !req.body.password) throw new AppError(400, 'details_required', 'Choose a name and password to create your account.');
        userId = randomUUID();
        await s.pool.query('INSERT INTO users (id, email, name, password_hash) VALUES ($1, $2, $3, $4)', [
          userId,
          invite.email,
          req.body.name,
          await hashPassword(req.body.password),
        ]);
      }

      await withContext(s.pool, { userId, workspaceId: invite.workspaceId }, async (tx) => {
        const accepted = await tx
          .update(schema.invites)
          .set({ acceptedAt: new Date() })
          .where(and(eq(schema.invites.id, invite.id), isNull(schema.invites.acceptedAt)))
          .returning();
        if (!accepted.length) throw new AppError(409, 'invite_used', 'This invite has already been used.');
        await tx.insert(schema.memberships).values({ workspaceId: invite.workspaceId, userId, role: invite.role }).onConflictDoNothing();
        await audit(tx, { workspaceId: invite.workspaceId, actorId: userId, action: 'member.joined', targetType: 'user', targetId: userId, details: { role: invite.role }, ip: req.ip });
      });

      if (req.session) {
        await s.sessions.switchWorkspace(req.session.tokenHash, invite.workspaceId);
      } else {
        const session = await s.sessions.create(userId, invite.workspaceId);
        setSessionCookie(reply, s.config, session.token, session.expiresAt);
      }
      return { workspaceId: invite.workspaceId };
    },
  );
}

async function findInvite(s: Services, token: string) {
  const tokenHash = sha256(token);
  const invite = await withContext(s.pool, { tokenHash }, async (tx) => {
    const [i] = await tx.select().from(schema.invites).where(eq(schema.invites.tokenHash, tokenHash));
    return i;
  });
  if (!invite || invite.acceptedAt || invite.expiresAt < new Date()) {
    throw new AppError(404, 'invite_unavailable', 'This invite has expired or has already been used.');
  }
  const workspaceName = await withContext(s.pool, { workspaceId: invite.workspaceId }, async (tx) => {
    const [w] = await tx.select({ name: schema.workspaces.name }).from(schema.workspaces).where(eq(schema.workspaces.id, invite.workspaceId));
    return w?.name ?? '';
  });
  return { ...invite, workspaceName };
}

type InTx = Parameters<Parameters<typeof inWorkspace>[2]>[0];

async function membership(tx: InTx, workspaceId: string, userId: string) {
  const [row] = await tx
    .select({ role: schema.memberships.role })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)));
  if (!row) throw new AppError(404, 'not_found', 'That person isn’t in this workspace.');
  return row;
}

async function assertAnotherOwner(tx: InTx, workspaceId: string, exceptUserId: string) {
  const [{ n } = { n: 0 }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.role, 'owner'), sql`${schema.memberships.userId} <> ${exceptUserId}`));
  if (n === 0) throw new AppError(409, 'last_owner', 'A workspace needs at least one owner. Make someone else an owner first.');
}
