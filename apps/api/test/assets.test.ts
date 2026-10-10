import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { harness, signUp, testJpeg, upload, type Harness } from './helpers.js';

let h: Harness;
let owner: Awaited<ReturnType<typeof signUp>>;

beforeAll(async () => {
  h = await harness({ WORKSPACE_QUOTA_BYTES: String(200_000) });
});
afterAll(() => h.close());
beforeEach(async () => {
  await h.reset();
  owner = await signUp(h.app, 'Owen', 'Quota Studio');
});

describe('upload pipeline', () => {
  it('uploads, processes and serves thumbnails through signed URLs', async () => {
    const jpeg = await testJpeg(1600, 900, '#cc3322');
    const res = await upload(h.app, owner.client, jpeg, { name: 'red_sunset-final.jpg' });
    expect(res.uploadStatus).toBe(204);
    expect(res.complete?.status).toBe(200);

    const asset = (await owner.client.get(`/assets/${res.assetId}`)).body;
    expect(asset).toMatchObject({ status: 'ready', title: 'Red sunset final', width: 1600, height: 900 });
    expect(asset.dominantColor).toMatch(/^#c[0-9a-f]3[0-9a-f]2[0-9a-f]$/);

    const thumbPath = new URL(asset.thumbUrl).pathname + new URL(asset.thumbUrl).search;
    const thumb = await h.app.inject({ url: thumbPath });
    expect(thumb.statusCode).toBe(200);
    expect(thumb.headers['content-type']).toBe('image/webp');

    const tampered = await h.app.inject({ url: thumbPath.replace(/sig=[^&]+/, 'sig=forged') });
    expect(tampered.statusCode).toBe(403);
  });

  it('signed URLs are stable within the hour, so browsers can cache thumbnails', async () => {
    const res = await upload(h.app, owner.client, await testJpeg());
    const first = (await owner.client.get(`/assets/${res.assetId}`)).body.thumbUrl;
    const second = (await owner.client.get(`/assets/${res.assetId}`)).body.thumbUrl;
    expect(second).toBe(first);
  });

  it('rejects a file whose bytes are not what it claims to be', async () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>');
    const res = await upload(h.app, owner.client, html, { name: 'cat.png', type: 'image/png' });
    const asset = (await owner.client.get(`/assets/${res.assetId}`)).body;
    expect(asset.status).toBe('failed');
    const usage = (await owner.client.get('/workspace/usage')).body;
    expect(usage.storageBytes).toBe(0); // the reservation was released
  });

  it('refuses uploads that don’t match the declared size', async () => {
    const jpeg = await testJpeg();
    const res = await upload(h.app, owner.client, jpeg, { declaredSize: jpeg.length + 100 });
    expect(res.uploadStatus).toBe(204);
    expect(res.complete?.status).toBe(400);
    expect(res.complete?.body.error.code).toBe('size_mismatch');
  });

  it('enforces the storage quota atomically, even for parallel uploads', async () => {
    // Quota is 200 kB; each declared upload is 60 kB, so at most 3 of 10 may be reserved.
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => owner.client.post('/assets/uploads', { fileName: `f${i}.jpg`, contentType: 'image/jpeg', size: 60_000 })),
    );
    expect(results.filter((r) => r.status === 201)).toHaveLength(3);
    expect(results.filter((r) => r.status === 413)).toHaveLength(7);
  });

  it('completing twice is harmless and processes once', async () => {
    const res = await upload(h.app, owner.client, await testJpeg());
    const again = await owner.client.post(`/assets/${res.assetId}/complete`);
    expect(again.status).toBe(200);
    expect(h.processed).toHaveLength(1);
  });
});

describe('library', () => {
  it('pages with keyset cursors without duplicates or gaps', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 7; i++) ids.push((await upload(h.app, owner.client, await testJpeg(32, 32), { name: `img-${i}.jpg` })).assetId!);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: { body: { items: { id: string }[]; nextCursor: string | null } } = await owner.client.get(`/assets?limit=3${cursor ? `&cursor=${cursor}` : ''}`);
      seen.push(...page.body.items.map((a) => a.id));
      cursor = page.body.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(7);
    expect(new Set(seen)).toEqual(new Set(ids));
  });

  it('searches titles, tags and descriptions', async () => {
    const one = await upload(h.app, owner.client, await testJpeg(32, 32), { name: 'harbour-dawn.jpg' });
    const two = await upload(h.app, owner.client, await testJpeg(32, 32), { name: 'forest.jpg' });
    await owner.client.patch(`/assets/${two.assetId}`, { tags: ['Campaign', 'campaign', 'print'], description: 'Shot near the harbour wall' });

    const byTitle = (await owner.client.get('/assets?q=dawn')).body.items.map((a: { id: string }) => a.id);
    expect(byTitle).toEqual([one.assetId]);
    const byWord = (await owner.client.get('/assets?q=harbour')).body.items.map((a: { id: string }) => a.id).sort();
    expect(byWord).toEqual([one.assetId, two.assetId].sort());
    const byTag = (await owner.client.get('/assets?tag=campaign')).body.items;
    expect(byTag).toHaveLength(1);
    expect(byTag[0].tags).toEqual(['campaign', 'print']); // normalised and de-duplicated
    expect((await owner.client.get('/assets?q=%25')).status).toBe(200); // LIKE wildcards are escaped
  });

  it('trash, restore and purge', async () => {
    const { assetId } = await upload(h.app, owner.client, await testJpeg());
    expect((await owner.client.del(`/assets/${assetId}`)).status).toBe(409); // must be trashed first
    await owner.client.post('/assets/trash', { ids: [assetId] });
    expect((await owner.client.get('/assets')).body.items).toHaveLength(0);
    expect((await owner.client.get('/assets?trashed=true')).body.items).toHaveLength(1);
    await owner.client.post(`/assets/${assetId}/restore`);
    await owner.client.post('/assets/trash', { ids: [assetId] });
    expect((await owner.client.del(`/assets/${assetId}`)).status).toBe(200);
    expect((await owner.client.get('/workspace/usage')).body.storageBytes).toBe(0);
  });

  it('records an audit trail in the same transaction as each change', async () => {
    const { assetId } = await upload(h.app, owner.client, await testJpeg());
    await owner.client.patch(`/assets/${assetId}`, { title: 'Renamed' });
    const actions = (await owner.client.get('/audit')).body.items.map((e: { action: string }) => e.action);
    expect(actions).toEqual(['asset.edited', 'asset.uploaded', 'workspace.created']);
  });
});

describe('security basics', () => {
  it('blocks state-changing requests from other origins', async () => {
    const res = await owner.client.req('POST', '/collections', { name: 'x' }, { origin: 'https://evil.example' });
    expect(res.status).toBe(403);
    const ok = await owner.client.req('POST', '/collections', { name: 'x' }, { origin: 'http://app.test' });
    expect(ok.status).toBe(201);
  });

  it('requires a session for workspace routes', async () => {
    const res = await h.app.inject({ url: '/assets' });
    expect(res.statusCode).toBe(401);
  });

  it('uses the same response for unknown emails and wrong passwords', async () => {
    const wrong = await h.app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email: owner.email, password: 'nope-nope-nope' } });
    const unknown = await h.app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email: 'ghost@example.com', password: 'nope-nope-nope' } });
    expect(wrong.statusCode).toBe(401);
    expect(unknown.body).toBe(wrong.body);
  });

  it('session cookies are httpOnly and SameSite=Lax', async () => {
    const res = await h.app.inject({ method: 'POST', url: '/auth/sign-in', payload: { email: owner.email, password: 'correct horse battery' } });
    const cookie = String(res.headers['set-cookie']);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
  });
});
