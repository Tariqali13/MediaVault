import { bigint, boolean, customType, inet, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

/**
 * Drizzle mirror of migrations/*.sql, used as a typed query builder.
 * The SQL migrations are the source of truth (row-level security policies
 * and generated columns are written by hand there).
 */

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const memberRole = pgEnum('member_role', ['viewer', 'editor', 'admin', 'owner']);
export const assetStatus = pgEnum('asset_status', ['uploading', 'processing', 'ready', 'failed']);
export const assetKind = pgEnum('asset_kind', ['image', 'video', 'document']);

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull().unique(),
  name: text('name').notNull(),
  passwordHash: text('password_hash').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const sessions = pgTable('sessions', {
  tokenHash: text('token_hash').primaryKey(),
  userId: uuid('user_id').notNull(),
  workspaceId: uuid('workspace_id'),
  expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const workspaces = pgTable('workspaces', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  storageBytes: bigint('storage_bytes', { mode: 'number' }).notNull().default(0),
  quotaBytes: bigint('quota_bytes', { mode: 'number' }).notNull().default(1073741824),
  isDemo: boolean('is_demo').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const memberships = pgTable(
  'memberships',
  {
    workspaceId: uuid('workspace_id').notNull(),
    userId: uuid('user_id').notNull(),
    role: memberRole('role').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] })],
);

export const invites = pgTable('invites', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  email: text('email').notNull(),
  role: memberRole('role').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  invitedBy: uuid('invited_by').notNull(),
  expiresAt: ts('expires_at').notNull(),
  acceptedAt: ts('accepted_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const assets = pgTable('assets', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  uploadedBy: uuid('uploaded_by').notNull(),
  title: text('title').notNull(),
  description: text('description').notNull().default(''),
  fileName: text('file_name').notNull(),
  kind: assetKind('kind').notNull(),
  contentType: text('content_type').notNull(),
  sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull(),
  storageKey: text('storage_key').notNull(),
  status: assetStatus('status').notNull().default('uploading'),
  width: integer('width'),
  height: integer('height'),
  dominantColor: text('dominant_color'),
  metadata: jsonb('metadata').$type<Record<string, string | number>>().notNull().default({}),
  thumbKey: text('thumb_key'),
  previewKey: text('preview_key'),
  tags: text('tags').array().notNull().default([]),
  failureReason: text('failure_reason'),
  trashedAt: ts('trashed_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  search: tsvector('search'),
});

export const collections = pgTable('collections', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  name: text('name').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const collectionAssets = pgTable(
  'collection_assets',
  {
    workspaceId: uuid('workspace_id').notNull(),
    collectionId: uuid('collection_id').notNull(),
    assetId: uuid('asset_id').notNull(),
    addedAt: ts('added_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.collectionId, t.assetId] })],
);

export const shareLinks = pgTable('share_links', {
  id: uuid('id').primaryKey().defaultRandom(),
  workspaceId: uuid('workspace_id').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  assetId: uuid('asset_id'),
  collectionId: uuid('collection_id'),
  allowDownload: boolean('allow_download').notNull().default(true),
  createdBy: uuid('created_by').notNull(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
  viewCount: integer('view_count').notNull().default(0),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const auditEvents = pgTable('audit_events', {
  id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
  workspaceId: uuid('workspace_id').notNull(),
  actorId: uuid('actor_id'),
  action: text('action').notNull(),
  targetType: text('target_type'),
  targetId: text('target_id'),
  details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  ip: inet('ip'),
  createdAt: ts('created_at').notNull().defaultNow(),
});
