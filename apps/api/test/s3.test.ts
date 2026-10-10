import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it } from 'vitest';
import { S3Storage } from '../src/storage/s3.js';
import { testJpeg } from './helpers.js';

/**
 * Exercises the real S3 driver against an S3-compatible server (MinIO in CI).
 * Skipped unless TEST_S3_ENDPOINT is set. Note: moto's S3 emulator does not
 * enforce POST policy conditions, so use MinIO for the size-limit test.
 */
const endpoint = process.env.TEST_S3_ENDPOINT;

describe.skipIf(!endpoint)('S3 storage driver', () => {
  const bucket = process.env.TEST_S3_BUCKET ?? 'mediavault-test';
  const credentials = {
    accessKeyId: process.env.TEST_S3_ACCESS_KEY ?? 'minioadmin',
    secretAccessKey: process.env.TEST_S3_SECRET_KEY ?? 'minioadmin',
  };
  const storage = new S3Storage(bucket, { region: 'us-east-1', endpoint, ...credentials, forcePathStyle: true });

  beforeAll(async () => {
    const admin = new S3Client({ region: 'us-east-1', endpoint, forcePathStyle: true, credentials });
    await admin.send(new CreateBucketCommand({ Bucket: bucket })).catch((err) => {
      if (!/BucketAlready/.test(String(err?.name))) throw err;
    });
  });

  async function postUpload(ticket: { url: string; fields: Record<string, string> }, body: Buffer, type: string) {
    const form = new FormData();
    for (const [k, v] of Object.entries(ticket.fields)) form.append(k, v);
    form.append('file', new Blob([new Uint8Array(body)], { type }));
    return fetch(ticket.url, { method: 'POST', body: form });
  }

  it('accepts an upload that matches its signed policy, then serves it via a signed URL', async () => {
    const key = `test/${crypto.randomUUID()}/original`;
    const jpeg = await testJpeg(64, 64);
    const ticket = await storage.createUpload(key, 'image/jpeg', jpeg.length, 60);
    const res = await postUpload(ticket, jpeg, 'image/jpeg');
    expect(res.status).toBeLessThan(300);
    expect((await storage.head(key))?.size).toBe(jpeg.length);

    const url = await storage.signedUrl(key, Date.now() + 60_000);
    const got = await fetch(url);
    expect(got.status).toBe(200);
    expect(Buffer.from(await got.arrayBuffer()).equals(jpeg)).toBe(true);

    await storage.delete([key]);
    expect(await storage.head(key)).toBeNull();
  });

  it('the bucket itself rejects files over the approved size', async () => {
    const key = `test/${crypto.randomUUID()}/original`;
    const jpeg = await testJpeg(64, 64);
    const ticket = await storage.createUpload(key, 'image/jpeg', jpeg.length - 10, 60);
    const res = await postUpload(ticket, jpeg, 'image/jpeg');
    expect(res.status).toBeGreaterThanOrEqual(400); // S3 and MinIO answer 400 EntityTooLarge
    expect(await storage.head(key)).toBeNull();
  });

  it('the same expiry produces the same URL, so browsers can cache it', async () => {
    const exp = Date.now() + 3_600_000;
    expect(await storage.signedUrl('a/b', exp)).toBe(await storage.signedUrl('a/b', exp));
  });
});
