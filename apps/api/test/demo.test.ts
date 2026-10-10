import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { Client, harness, type Harness } from './helpers.js';
import { purgeExpiredDemos } from '../src/demo/demo.js';
import { sniffMatches, processImage } from '../src/media/processor.js';

let h: Harness;

beforeAll(async () => {
  h = await harness();
});
afterAll(() => h.close());
beforeEach(() => h.reset());

describe('demo workspaces', () => {
  it('each visitor gets a private, pre-filled workspace', async () => {
    const first = new Client(h.app);
    const second = new Client(h.app);
    const a = await first.post('/auth/demo');
    const b = await second.post('/auth/demo');
    expect(a.body.activeWorkspaceId).not.toBe(b.body.activeWorkspaceId);

    const library = await first.get('/assets?limit=100');
    expect(library.body.items.length).toBe(17);
    expect(library.body.items.every((i: { status: string }) => i.status === 'ready')).toBe(true);

    // Changes in one demo never show up in another.
    await first.post('/assets/trash', { ids: [library.body.items[0].id] });
    expect((await second.get('/assets?limit=100')).body.items).toHaveLength(17);
  }, 60_000);

  it('purging a demo deletes the workspace but never the shared sample files', async () => {
    const c = new Client(h.app);
    await c.post('/auth/demo');
    const thumb = (await c.get('/assets')).body.items[0].thumbUrl as string;
    // Age the demo past its 24 hours (inside its own tenant context).
    const ws = (await c.get('/auth/me')).body.activeWorkspaceId;
    await h.pool.query('BEGIN');
    await h.pool.query(`SELECT set_config('app.workspace_id', $1, true)`, [ws]);
    await h.pool.query(`UPDATE workspaces SET created_at = now() - interval '25 hours'`);
    await h.pool.query('COMMIT');

    expect(await purgeExpiredDemos(h.pool, h.storage)).toBe(1);
    expect((await c.get('/assets')).status).toBe(401); // the demo user and its session are gone too
    const url = new URL(thumb);
    expect((await h.app.inject({ url: url.pathname + url.search })).statusCode).toBe(200);
  }, 60_000);
});

describe('media processing', () => {
  it('sniffs real file types from bytes', async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: '#fff' } }).png().toBuffer();
    expect(await sniffMatches(png, 'image/png')).toBe(true);
    expect(await sniffMatches(png, 'image/jpeg')).toBe(false);
    expect(await sniffMatches(Buffer.from('%PDF-1.4 ...'), 'application/pdf')).toBe(true);
    expect(await sniffMatches(Buffer.from('<svg onload=alert(1)>'), 'image/png')).toBe(false);
  });

  it('honours EXIF orientation and never upscales', async () => {
    const portraitPhoto = await sharp({ create: { width: 300, height: 200, channels: 3, background: '#123456' } })
      .jpeg()
      .withMetadata({ orientation: 6 }) // stored landscape, displayed rotated 90°
      .toBuffer();
    const out = await processImage(portraitPhoto);
    expect([out.width, out.height]).toEqual([200, 300]);
    const thumbMeta = await sharp(out.thumb).metadata();
    expect(thumbMeta.width).toBe(200); // smaller than THUMB_WIDTH, so not enlarged
    expect(thumbMeta.format).toBe('webp');
  });
});
