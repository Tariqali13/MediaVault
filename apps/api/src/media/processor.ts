import sharp from 'sharp';
import exifReader from 'exif-reader';

/** Thumbnails and previews are WebP at fixed widths, never upscaled. */
export const THUMB_WIDTH = 480;
export const PREVIEW_WIDTH = 1600;

export interface ProcessedImage {
  width: number;
  height: number;
  dominantColor: string;
  thumb: Buffer;
  preview: Buffer;
  metadata: Record<string, string | number>;
}

/**
 * Checks the file's real type from its bytes. The browser-supplied Content-Type is
 * just a claim: without this, someone could upload an HTML file labelled image/png.
 */
export async function sniffMatches(body: Buffer, declared: string): Promise<boolean> {
  if (declared.startsWith('image/')) {
    try {
      const { format } = await sharp(body, { failOn: 'error' }).metadata();
      const expected: Record<string, string[]> = {
        'image/jpeg': ['jpeg'],
        'image/png': ['png'],
        'image/webp': ['webp'],
        'image/gif': ['gif'],
        'image/avif': ['heif'],
      };
      return !!format && (expected[declared] ?? []).includes(format);
    } catch {
      return false;
    }
  }
  if (declared === 'application/pdf') return body.subarray(0, 5).toString('latin1') === '%PDF-';
  if (declared === 'video/mp4' || declared === 'video/quicktime') return body.subarray(4, 8).toString('latin1') === 'ftyp';
  return false;
}

// The API runs on small instances (512 MB). libvips defaults to one thread per core
// and a large operation cache, which is fast on a big machine and an out-of-memory
// kill on a small one. One thread and no cache keep each image's memory predictable.
sharp.concurrency(1);
sharp.cache(false);

/**
 * Largest image we will decode: 50 megapixels covers full-frame camera files.
 * Decoded RGBA at that size is ~200 MB, so the cap is also a memory bound.
 */
export const MAX_INPUT_PIXELS = 50_000_000;

export async function processImage(body: Buffer): Promise<ProcessedImage> {
  const meta = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS }).metadata();

  // Decode the original ONCE, at reduced size: resizing straight from the input lets
  // libvips shrink JPEG/WebP while decoding, instead of holding the full-size image.
  // Everything else is derived from that small preview, one step at a time.
  const preview = await sharp(body, { limitInputPixels: MAX_INPUT_PIXELS, failOn: 'error', sequentialRead: true })
    .rotate() // respect EXIF orientation
    .resize({ width: PREVIEW_WIDTH, withoutEnlargement: true })
    .webp({ quality: 82 })
    .toBuffer();
  const thumb = await sharp(preview).resize({ width: THUMB_WIDTH, withoutEnlargement: true }).webp({ quality: 78 }).toBuffer();
  const stats = await sharp(thumb).stats();

  // EXIF orientations 5–8 swap width and height.
  const swapped = (meta.orientation ?? 1) >= 5;
  const width = (swapped ? meta.height : meta.width) ?? 0;
  const height = (swapped ? meta.width : meta.height) ?? 0;
  const { r, g, b } = stats.dominant;

  const metadata: Record<string, string | number> = { format: meta.format ?? 'unknown' };
  if (meta.space) metadata.colorSpace = meta.space;
  if (meta.density) metadata.dpi = meta.density;
  if (meta.exif) Object.assign(metadata, readExif(meta.exif));

  return {
    width,
    height,
    dominantColor: `#${[r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('')}`,
    thumb,
    preview,
    metadata,
  };
}

/** A handful of EXIF fields people actually look for. GPS is deliberately dropped. */
function readExif(raw: Buffer): Record<string, string | number> {
  try {
    const exif = exifReader(raw);
    const out: Record<string, string | number> = {};
    const make = exif.Image?.Make;
    const model = exif.Image?.Model;
    if (model) out.camera = [make, model].filter(Boolean).join(' ').trim();
    const taken = exif.Photo?.DateTimeOriginal;
    if (taken instanceof Date) out.takenAt = taken.toISOString();
    if (exif.Photo?.FNumber) out.aperture = `f/${exif.Photo.FNumber}`;
    if (exif.Photo?.ExposureTime) out.shutter = formatShutter(exif.Photo.ExposureTime);
    if (exif.Photo?.ISOSpeedRatings) out.iso = Number(exif.Photo.ISOSpeedRatings);
    if (exif.Photo?.FocalLength) out.focalLength = `${exif.Photo.FocalLength}mm`;
    return out;
  } catch {
    return {};
  }
}

function formatShutter(seconds: number): string {
  return seconds >= 1 ? `${seconds}s` : `1/${Math.round(1 / seconds)}s`;
}
