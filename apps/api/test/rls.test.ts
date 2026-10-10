import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { withContext } from '../src/db/client.js';
import { harness, signUp, testJpeg, upload, type Harness } from './helpers.js';

/**
 * These tests talk to Postgres directly with deliberately careless queries — no
 * WHERE workspace_id filter at all — to prove isolation comes from the database,
 * not from remembering to filter in application code.
 */
let h: Harness;
let a: Awaited<ReturnType<typeof signUp>>;
let b: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  h = await harness();
});
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  a = await signUp(h.app, 'Ada', 'Studio A');
  b = await signUp(h.app, 'Bob', 'Studio B');
  await upload(h.app, a.client, await testJpeg(), { name: 'a-secret.jpg' });
  await upload(h.app, b.client, await testJpeg(), { name: 'b-secret.jpg' });
});

const count = (rows: unknown[]) => rows.length;

describe('row-level security', () => {
  it('an unfiltered SELECT only returns the current tenant’s rows', async () => {
    const seenByA = await withContext(h.pool, { userId: a.userId, workspaceId: a.workspaceId }, async (_tx, c) => (await c.query('SELECT file_name FROM assets')).rows);
    expect(seenByA.map((r) => r.file_name)).toEqual(['a-secret.jpg']);
  });

  it('with no tenant context, tenant data is invisible', async () => {
    for (const table of ['assets', 'collections', 'audit_events', 'share_links', 'invites']) {
      const rows = await withContext(h.pool, {}, async (_tx, c) => (await c.query(`SELECT * FROM ${table}`)).rows);
      expect(count(rows), table).toBe(0);
    }
  });

  it('cannot write rows into another tenant', async () => {
    await expect(
      withContext(h.pool, { userId: a.userId, workspaceId: a.workspaceId }, (_tx, c) =>
        c.query(`INSERT INTO collections (workspace_id, name, created_by) VALUES ($1, 'planted', $2)`, [b.workspaceId, a.userId]),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('updates and deletes silently skip other tenants’ rows', async () => {
    const result = await withContext(h.pool, { userId: a.userId, workspaceId: a.workspaceId }, async (_tx, c) => {
      const upd = await c.query(`UPDATE assets SET title = 'pwned' WHERE file_name = 'b-secret.jpg'`);
      const del = await c.query(`DELETE FROM assets WHERE file_name = 'b-secret.jpg'`);
      return [upd.rowCount, del.rowCount];
    });
    expect(result).toEqual([0, 0]);
    const bTitles = await withContext(h.pool, { workspaceId: b.workspaceId }, async (_tx, c) => (await c.query('SELECT title FROM assets')).rows);
    expect(bTitles[0].title).not.toBe('pwned');
  });

  it('cannot move a row to another tenant', async () => {
    await expect(
      withContext(h.pool, { workspaceId: a.workspaceId }, (_tx, c) => c.query('UPDATE assets SET workspace_id = $1', [b.workspaceId])),
    ).rejects.toThrow(/row-level security/);
  });

  it('context is transaction-local and never leaks to the next use of a pooled connection', async () => {
    await withContext(h.pool, { workspaceId: a.workspaceId }, async () => undefined);
    const client = await h.pool.connect();
    try {
      const { rows } = await client.query('SELECT count(*)::int AS n FROM assets');
      expect(rows[0].n).toBe(0);
    } finally {
      client.release();
    }
  });

  it('the API returns 404, not 403, for another tenant’s asset ids', async () => {
    const bAssets = await b.client.get('/assets');
    const bId = bAssets.body.items[0].id;
    for (const res of [
      await a.client.get(`/assets/${bId}`),
      await a.client.get(`/assets/${bId}/download`),
      await a.client.patch(`/assets/${bId}`, { title: 'x' }),
    ]) {
      expect(res.status).toBe(404);
    }
  });

  it('adding another tenant’s asset to your collection does nothing', async () => {
    const bId = (await b.client.get('/assets')).body.items[0].id;
    const col = await a.client.post('/collections', { name: 'Heist' });
    const res = await a.client.post(`/collections/${col.body.id}/assets`, { assetIds: [bId] });
    expect(res.body.added).toBe(0);
  });
});
