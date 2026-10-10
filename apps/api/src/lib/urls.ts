import type { StorageDriver } from '../storage/driver.js';

const HOUR = 60 * 60 * 1000;

/**
 * Signed URLs normally change on every request, which defeats the browser cache:
 * the same thumbnail is downloaded again each time the library opens. Signing
 * against a fixed hourly window yields an identical URL for the whole hour
 * (valid for at least one hour, at most two), so thumbnails cache properly.
 */
export function stableExpiry(now = Date.now()): number {
  return Math.floor(now / HOUR) * HOUR + 2 * HOUR;
}

export async function viewUrl(storage: StorageDriver, key: string | null, now = Date.now()): Promise<string | null> {
  return key ? storage.signedUrl(key, stableExpiry(now)) : null;
}

/** Download links are short-lived and single-purpose. */
export async function downloadUrl(storage: StorageDriver, key: string, fileName: string): Promise<string> {
  return storage.signedUrl(key, Date.now() + 5 * 60_000, fileName);
}
