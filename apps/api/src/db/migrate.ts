import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { Pool } from './client.js';

// Works from source (src/db), from the bundled build (dist) and in the Docker image.
const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR =
  [path.resolve(here, '../../migrations'), path.resolve(here, '../migrations'), path.resolve(process.cwd(), 'migrations')].find(
    (p) => existsSync(p),
  ) ?? path.resolve(process.cwd(), 'migrations');

/**
 * Minimal forward-only migrator. Each .sql file runs once inside a transaction,
 * guarded by an advisory lock so two instances booting at once can't race.
 */
export async function migrate(db: Pool, log: (msg: string) => void = console.log): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock(727002)');
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const files = (await readdir(MIGRATIONS_DIR)).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations(name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        log(`migrated ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`, { cause: err });
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(727002)').catch(() => undefined);
    client.release();
  }
}
