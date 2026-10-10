import { z } from 'zod';
import { ROLES } from './permissions.js';

/** API contracts used by both the server (validation) and the client (types). */

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

export const ALLOWED_MIME = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'image/avif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'application/pdf': 'document',
} as const;
export type AllowedMime = keyof typeof ALLOWED_MIME;
export const AssetKind = z.enum(['image', 'video', 'document']);
export type AssetKind = z.infer<typeof AssetKind>;

export const RoleSchema = z.enum(ROLES);

export const SignUpBody = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.email().max(200).transform((e) => e.toLowerCase()),
  password: z.string().min(10, 'Use at least 10 characters').max(200),
  workspaceName: z.string().trim().min(1).max(80),
});

export const SignInBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
});

export const UploadIntentBody = z.object({
  fileName: z.string().trim().min(1).max(255),
  contentType: z.enum(Object.keys(ALLOWED_MIME) as [AllowedMime, ...AllowedMime[]]),
  size: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export const ListAssetsQuery = z.object({
  q: z.string().trim().max(200).optional(),
  kind: AssetKind.optional(),
  tag: z.string().trim().max(40).optional(),
  collectionId: z.uuid().optional(),
  trashed: z.coerce.boolean().optional(),
  cursor: z.string().max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(40),
});
export type ListAssetsQuery = z.infer<typeof ListAssetsQuery>;

export const UpdateAssetBody = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().trim().max(2000).optional(),
  tags: z.array(z.string().trim().toLowerCase().min(1).max(40)).max(30).optional(),
});

export const CreateCollectionBody = z.object({ name: z.string().trim().min(1).max(80) });

export const CreateShareBody = z
  .object({
    assetId: z.uuid().optional(),
    collectionId: z.uuid().optional(),
    expiresInHours: z.number().int().min(1).max(24 * 30).default(72),
    allowDownload: z.boolean().default(true),
  })
  .refine((b) => !!b.assetId !== !!b.collectionId, { message: 'Share exactly one asset or one collection' });

export const InviteBody = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  role: z.enum(['viewer', 'editor', 'admin']),
});

export const AcceptInviteBody = z.object({
  token: z.string().min(20).max(200),
  name: z.string().trim().min(1).max(80).optional(),
  password: z.string().min(10).max(200).optional(),
});

/* ---- response shapes (inferred on the client) ---- */

export interface AssetDto {
  id: string;
  title: string;
  description: string;
  fileName: string;
  kind: AssetKind;
  contentType: string;
  size: number;
  status: 'uploading' | 'processing' | 'ready' | 'failed';
  width: number | null;
  height: number | null;
  dominantColor: string | null;
  tags: string[];
  thumbUrl: string | null;
  previewUrl: string | null;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  trashedAt: string | null;
  metadata: Record<string, string | number>;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface MeDto {
  user: { id: string; name: string; email: string };
  workspaces: { id: string; name: string; role: z.infer<typeof RoleSchema> }[];
  activeWorkspaceId: string | null;
}
