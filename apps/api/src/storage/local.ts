import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { StorageDriver, UploadTicket } from './driver.js';

export interface UploadPolicy {
  key: string;
  contentType: string;
  maxBytes: number;
  exp: number;
}

/**
 * Disk-backed storage that mimics S3's signed POST and signed GET semantics, so the
 * browser flow and the security properties are identical in development and tests.
 */
export class LocalStorage implements StorageDriver {
  readonly name = 'local';

  constructor(
    private readonly root: string,
    private readonly publicBaseUrl: string,
    private readonly secret: string,
  ) {}

  private file(key: string) {
    const resolved = path.resolve(this.root, key);
    if (!resolved.startsWith(path.resolve(this.root) + path.sep)) throw new Error('Invalid storage key');
    return resolved;
  }

  private sign(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  private verify(payload: string, signature: string): boolean {
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(signature);
    return expected.length === given.length && timingSafeEqual(expected, given);
  }

  async createUpload(key: string, contentType: string, maxBytes: number, ttlSec: number): Promise<UploadTicket> {
    const policy: UploadPolicy = { key, contentType, maxBytes, exp: Date.now() + ttlSec * 1000 };
    const encoded = Buffer.from(JSON.stringify(policy)).toString('base64url');
    return {
      url: `${this.publicBaseUrl}/storage/upload`,
      fields: { policy: encoded, signature: this.sign(encoded) },
      expiresAt: policy.exp,
    };
  }

  /** Validates a signed upload policy. Returns null if forged or expired. */
  readPolicy(encoded: string, signature: string): UploadPolicy | null {
    if (!this.verify(encoded, signature)) return null;
    const policy = JSON.parse(Buffer.from(encoded, 'base64url').toString()) as UploadPolicy;
    return policy.exp > Date.now() ? policy : null;
  }

  async signedUrl(key: string, expiresAt: number, downloadName?: string): Promise<string> {
    const exp = expiresAt;
    const dl = downloadName ? encodeURIComponent(downloadName) : '';
    const sig = this.sign(`${key}|${exp}|${dl}`);
    return `${this.publicBaseUrl}/storage/object/${key}?exp=${exp}&sig=${sig}${dl ? `&dl=${dl}` : ''}`;
  }

  /** Validates a signed GET. */
  checkUrl(key: string, exp: number, sig: string, dl = ''): boolean {
    return exp > Date.now() && this.verify(`${key}|${exp}|${dl ? encodeURIComponent(dl) : ''}`, sig);
  }

  async head(key: string) {
    try {
      const s = await stat(this.file(key));
      return { size: s.size, contentType: undefined };
    } catch {
      return null;
    }
  }

  async get(key: string): Promise<Buffer> {
    return readFile(this.file(key));
  }

  async put(key: string, body: Buffer): Promise<void> {
    const file = this.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
  }

  async delete(keys: string[]): Promise<void> {
    await Promise.all(keys.map((k) => rm(this.file(k), { force: true })));
  }
}
