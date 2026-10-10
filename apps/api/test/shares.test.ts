import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Client, harness, signUp, testJpeg, upload, type Harness } from './helpers.js';

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;
let anon: Client;

beforeAll(async () => {
  h = await harness();
});
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  owner = await signUp(h.app, 'Sasha', 'Share Studio');
  anon = new Client(h.app);
});

const tokenOf = (url: string) => url.split('/s/')[1]!;

describe('share links', () => {
  it('lets anyone with the link view a collection, and only that collection', async () => {
    const a = await upload(h.app, owner.client, await testJpeg(), { name: 'in-collection.jpg' });
    await upload(h.app, owner.client, await testJpeg(), { name: 'not-shared.jpg' });
    const col = await owner.client.post('/collections', { name: 'Client review' });
    await owner.client.post(`/collections/${col.body.id}/assets`, { assetIds: [a.assetId] });

    const link = await owner.client.post('/shares', { collectionId: col.body.id, allowDownload: false });
    const view = await anon.get(`/public/shares/${tokenOf(link.body.url)}`);
    expect(view.status).toBe(200);
    expect(view.body.title).toBe('Client review');
    expect(view.body.items.map((i: { title: string }) => i.title)).toEqual(['In collection']);
    expect(view.body.items[0].downloadUrl).toBeNull();
    expect(view.body.items[0].previewUrl).toMatch(/^http:\/\/api\.test\/storage\/object\//);
  });

  it('stores only a hash of the token', async () => {
    const { assetId } = await upload(h.app, owner.client, await testJpeg());
    const link = await owner.client.post('/shares', { assetId });
    const { rows } = await h.pool.query('SELECT token_hash FROM share_links');
    expect(rows).toHaveLength(0); // RLS: invisible without a tenant context...
    const token = tokenOf(link.body.url);
    const dump = await h.pool.query(`SELECT set_config('app.workspace_id', $1, false)`, [owner.workspaceId]).then(() =>
      h.pool.query('SELECT token_hash FROM share_links'),
    );
    expect(JSON.stringify(dump.rows)).not.toContain(token); // ...and the raw token is never stored
    await h.pool.query(`SELECT set_config('app.workspace_id', '', false)`);
  });

  it('revoked and expired links stop working', async () => {
    const { assetId } = await upload(h.app, owner.client, await testJpeg());
    const link = await owner.client.post('/shares', { assetId, expiresInHours: 1 });
    const token = tokenOf(link.body.url);
    expect((await anon.get(`/public/shares/${token}`)).status).toBe(200);

    const [share] = (await owner.client.get('/shares')).body;
    expect(share.viewCount).toBe(1);
    await owner.client.del(`/shares/${share.id}`);
    expect((await anon.get(`/public/shares/${token}`)).status).toBe(404);

    const expiring = await owner.client.post('/shares', { assetId });
    await h.pool.query(`UPDATE share_links SET expires_at = now() - interval '1 minute'`).catch(() => undefined);
    // RLS blocks that blanket update without context; expire it the honest way, inside the workspace:
    await h.pool.query('BEGIN');
    await h.pool.query(`SELECT set_config('app.workspace_id', $1, true)`, [owner.workspaceId]);
    await h.pool.query(`UPDATE share_links SET expires_at = now() - interval '1 minute'`);
    await h.pool.query('COMMIT');
    expect((await anon.get(`/public/shares/${tokenOf(expiring.body.url)}`)).status).toBe(404);
  });

  it('a made-up token reveals nothing', async () => {
    const res = await anon.get('/public/shares/this-token-was-never-issued-0000000000');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('link_unavailable');
  });
});
