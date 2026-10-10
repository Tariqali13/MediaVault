/**
 * Object storage behind one small interface. Browsers upload and download
 * directly against storage using short-lived signed requests; file bytes never
 * pass through the API process.
 *
 *   s3     any S3-compatible service (AWS S3, Cloudflare R2, Backblaze B2, Supabase, MinIO)
 *   local  files on disk with HMAC-signed URLs, for development, tests and single-box demos
 */
export interface UploadTicket {
  /** POST target for a multipart/form-data upload. */
  url: string;
  /** Form fields to send before the file field (policy, signature...). */
  fields: Record<string, string>;
  expiresAt: number;
}

export interface StorageDriver {
  readonly name: string;
  /** A signed upload that the storage service itself enforces: exact key, content type and maximum size. */
  createUpload(key: string, contentType: string, maxBytes: number, ttlSec: number): Promise<UploadTicket>;
  /**
   * Signed read URL valid until `expiresAt` (epoch ms). Passing the same
   * `expiresAt` yields the same URL, which keeps browser caching effective.
   * `downloadName` forces a download with that file name.
   */
  signedUrl(key: string, expiresAt: number, downloadName?: string): Promise<string>;
  head(key: string): Promise<{ size: number; contentType: string | undefined } | null>;
  get(key: string): Promise<Buffer>;
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  delete(keys: string[]): Promise<void>;
}
