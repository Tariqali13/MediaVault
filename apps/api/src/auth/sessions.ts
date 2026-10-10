import { createHash, randomBytes } from 'node:crypto';
import { hash, verify } from '@node-rs/argon2';
import type { Pool } from '../db/client.js';

export const SESSION_COOKIE = 'mv_session';

export const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

/** argon2id with OWASP-recommended parameters (19 MiB, 2 iterations). */
export const hashPassword = (password: string) => hash(password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

// Verifying against a real hash for unknown emails keeps response time the same,
// so login timing doesn't reveal which emails have accounts.
const DUMMY_HASH = await hashPassword('timing-equaliser-not-a-real-password');

export async function checkPassword(storedHash: string | null, password: string): Promise<boolean> {
  try {
    const ok = await verify(storedHash ?? DUMMY_HASH, password);
    return storedHash !== null && ok;
  } catch {
    return false;
  }
}

export interface SessionUser {
  userId: string;
  name: string;
  email: string;
  workspaceId: string | null;
  tokenHash: string;
}

export class Sessions {
  constructor(
    private readonly pool: Pool,
    private readonly ttlDays: number,
  ) {}

  /** Creates a session and returns the raw token (only ever sent to the browser as a cookie). */
  async create(userId: string, workspaceId: string | null): Promise<{ token: string; expiresAt: Date }> {
    const token = newToken();
    const expiresAt = new Date(Date.now() + this.ttlDays * 86_400_000);
    await this.pool.query('INSERT INTO sessions (token_hash, user_id, workspace_id, expires_at) VALUES ($1, $2, $3, $4)', [
      sha256(token),
      userId,
      workspaceId,
      expiresAt,
    ]);
    return { token, expiresAt };
  }

  async resolve(token: string | undefined): Promise<SessionUser | null> {
    if (!token || token.length > 100) return null;
    const tokenHash = sha256(token);
    const { rows } = await this.pool.query(
      `SELECT s.user_id, s.workspace_id, u.name, u.email
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.expires_at > now()`,
      [tokenHash],
    );
    const r = rows[0];
    return r ? { userId: r.user_id, workspaceId: r.workspace_id, name: r.name, email: r.email, tokenHash } : null;
  }

  async switchWorkspace(tokenHash: string, workspaceId: string): Promise<void> {
    await this.pool.query('UPDATE sessions SET workspace_id = $2 WHERE token_hash = $1', [tokenHash, workspaceId]);
  }

  async destroy(tokenHash: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE token_hash = $1', [tokenHash]);
  }

  /** Sign out everywhere else, e.g. after a role change or password reset. */
  async destroyAllForUser(userId: string, exceptTokenHash?: string): Promise<void> {
    await this.pool.query('DELETE FROM sessions WHERE user_id = $1 AND token_hash <> coalesce($2, \'\')', [userId, exceptTokenHash ?? null]);
  }

  async purgeExpired(): Promise<number> {
    return (await this.pool.query('DELETE FROM sessions WHERE expires_at < now()')).rowCount ?? 0;
  }
}
