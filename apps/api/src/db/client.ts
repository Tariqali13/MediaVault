import pg from 'pg';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import * as schema from './schema.js';

export type Pool = pg.Pool;
export type Tx = NodePgDatabase<typeof schema>;

export function createPool(connectionString: string): Pool {
  const needsTls = /sslmode=require|neon\.tech|supabase\.co/.test(connectionString);
  return new pg.Pool({ connectionString, max: 10, ssl: needsTls ? { rejectUnauthorized: true } : undefined });
}

/** Who is making the request. Becomes Postgres session settings that RLS policies read. */
export interface RequestContext {
  userId?: string | null;
  workspaceId?: string | null;
  /** Hash of an invite/share token, for the narrow by-token lookup policies. */
  tokenHash?: string | null;
}

/**
 * Run `fn` in a transaction scoped to a tenant. `set_config(..., true)` is
 * transaction-local, so the context can never leak to the next request that
 * reuses this pooled connection.
 */
export async function withContext<T>(pool: Pool, ctx: RequestContext, fn: (tx: Tx, client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `SELECT set_config('app.user_id', $1, true), set_config('app.workspace_id', $2, true), set_config('app.token_hash', $3, true)`,
      [ctx.userId ?? '', ctx.workspaceId ?? '', ctx.tokenHash ?? ''],
    );
    const result = await fn(drizzle(client, { schema }), client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export { schema };
