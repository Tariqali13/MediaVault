-- MediaVault schema.
--
-- Tenant isolation is enforced by Postgres row-level security, not just by
-- WHERE clauses in application code. Every request runs inside a transaction
-- that sets `app.workspace_id` (and `app.user_id`); policies compare against it.
-- A forgotten filter in a query therefore returns *nothing* from other tenants
-- instead of leaking their data. FORCE ROW LEVEL SECURITY makes the policies
-- apply to the table owner too, so the app can connect as the owning role.
--
-- The app must NOT connect as a superuser (superusers bypass RLS entirely).

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Helpers: read the request context, NULL when unset.
CREATE FUNCTION app_workspace_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid $$;
-- array_to_string is only STABLE; tags are plain text so this wrapper is safe to mark IMMUTABLE
-- (needed for use in a generated column).
CREATE FUNCTION tags_text(text[]) RETURNS text LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
  $$ SELECT array_to_string($1, ' ') $$;
CREATE FUNCTION app_user_id() RETURNS uuid LANGUAGE sql STABLE AS
  $$ SELECT NULLIF(current_setting('app.user_id', true), '')::uuid $$;

-- ---------------------------------------------------------------- identity
-- Users and sessions are global (not tenant data) and are only ever looked up
-- by primary key, unique email, or a hashed session token.

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE,
  name           text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sessions (
  token_hash     text PRIMARY KEY,           -- sha256 of the cookie value; the raw token is never stored
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id   uuid,                        -- the workspace this session is currently "in"
  expires_at     timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_user_idx ON sessions(user_id);

-- ---------------------------------------------------------------- tenants

CREATE TABLE workspaces (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL,
  storage_bytes  bigint NOT NULL DEFAULT 0 CHECK (storage_bytes >= 0),
  quota_bytes    bigint NOT NULL DEFAULT 1073741824,
  is_demo        boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TYPE member_role AS ENUM ('viewer', 'editor', 'admin', 'owner');

CREATE TABLE memberships (
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id        uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role           member_role NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);
CREATE INDEX memberships_user_idx ON memberships(user_id);

CREATE TABLE invites (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email          text NOT NULL,
  role           member_role NOT NULL CHECK (role <> 'owner'),
  token_hash     text NOT NULL UNIQUE,
  invited_by     uuid NOT NULL REFERENCES users(id),
  expires_at     timestamptz NOT NULL,
  accepted_at    timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------- assets

CREATE TYPE asset_status AS ENUM ('uploading', 'processing', 'ready', 'failed');
CREATE TYPE asset_kind AS ENUM ('image', 'video', 'document');

CREATE TABLE assets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  title           text NOT NULL,
  description     text NOT NULL DEFAULT '',
  file_name       text NOT NULL,
  kind            asset_kind NOT NULL,
  content_type    text NOT NULL,
  size_bytes      bigint NOT NULL CHECK (size_bytes > 0),
  -- Not unique: demo workspaces reference shared, read-only seed objects (never deleted).
  storage_key     text NOT NULL,
  status          asset_status NOT NULL DEFAULT 'uploading',
  width           int,
  height          int,
  dominant_color  text,
  metadata        jsonb NOT NULL DEFAULT '{}',
  thumb_key       text,
  preview_key     text,
  tags            text[] NOT NULL DEFAULT '{}',
  failure_reason  text,
  trashed_at      timestamptz,
  -- Millisecond precision so keyset-pagination cursors round-trip exactly through JavaScript Dates.
  created_at      timestamptz(3) NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  search          tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', tags_text(tags)), 'B') ||
    setweight(to_tsvector('simple', coalesce(description, '')), 'C')
  ) STORED
);
-- Keyset pagination: newest first within a workspace.
CREATE INDEX assets_page_idx ON assets(workspace_id, created_at DESC, id DESC) WHERE trashed_at IS NULL;
CREATE INDEX assets_trash_idx ON assets(workspace_id, trashed_at DESC) WHERE trashed_at IS NOT NULL;
CREATE INDEX assets_search_idx ON assets USING gin(search);
CREATE INDEX assets_title_trgm_idx ON assets USING gin(title gin_trgm_ops);
CREATE INDEX assets_tags_idx ON assets USING gin(tags);

CREATE TABLE collections (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name           text NOT NULL,
  created_by     uuid NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, name)
);

CREATE TABLE collection_assets (
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  collection_id  uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  asset_id       uuid NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
  added_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (collection_id, asset_id)
);

-- Public share links. The raw token goes in the URL; only its hash is stored.
CREATE TABLE share_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id    uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash      text NOT NULL UNIQUE,
  asset_id        uuid REFERENCES assets(id) ON DELETE CASCADE,
  collection_id   uuid REFERENCES collections(id) ON DELETE CASCADE,
  allow_download  boolean NOT NULL DEFAULT true,
  created_by      uuid NOT NULL REFERENCES users(id),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  view_count      int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK ((asset_id IS NULL) <> (collection_id IS NULL))
);

CREATE TABLE audit_events (
  id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id   uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  actor_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  action         text NOT NULL,
  target_type    text,
  target_id      text,
  details        jsonb NOT NULL DEFAULT '{}',
  ip             inet,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_workspace_idx ON audit_events(workspace_id, id DESC);

-- ---------------------------------------------------------------- row-level security

ALTER TABLE workspaces        ENABLE ROW LEVEL SECURITY; ALTER TABLE workspaces        FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships       ENABLE ROW LEVEL SECURITY; ALTER TABLE memberships       FORCE ROW LEVEL SECURITY;
ALTER TABLE invites           ENABLE ROW LEVEL SECURITY; ALTER TABLE invites           FORCE ROW LEVEL SECURITY;
ALTER TABLE assets            ENABLE ROW LEVEL SECURITY; ALTER TABLE assets            FORCE ROW LEVEL SECURITY;
ALTER TABLE collections       ENABLE ROW LEVEL SECURITY; ALTER TABLE collections       FORCE ROW LEVEL SECURITY;
ALTER TABLE collection_assets ENABLE ROW LEVEL SECURITY; ALTER TABLE collection_assets FORCE ROW LEVEL SECURITY;
ALTER TABLE share_links       ENABLE ROW LEVEL SECURITY; ALTER TABLE share_links       FORCE ROW LEVEL SECURITY;
ALTER TABLE audit_events      ENABLE ROW LEVEL SECURITY; ALTER TABLE audit_events      FORCE ROW LEVEL SECURITY;

-- Tenant data: visible and writable only inside the current workspace.
CREATE POLICY tenant ON assets            USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant ON collections       USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant ON collection_assets USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant ON invites           USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant ON audit_events      USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());
CREATE POLICY tenant ON share_links       USING (workspace_id = app_workspace_id()) WITH CHECK (workspace_id = app_workspace_id());

-- A workspace is visible when you're inside it or a member of it (for the workspace switcher).
CREATE POLICY tenant ON workspaces USING (
  id = app_workspace_id()
  OR EXISTS (SELECT 1 FROM memberships m WHERE m.workspace_id = workspaces.id AND m.user_id = app_user_id())
);
-- Creating a workspace happens before any workspace context exists.
CREATE POLICY create_workspace ON workspaces FOR INSERT WITH CHECK (app_user_id() IS NOT NULL);

-- Memberships: everyone in the current workspace, plus your own memberships elsewhere.
CREATE POLICY tenant ON memberships
  USING (workspace_id = app_workspace_id() OR user_id = app_user_id())
  WITH CHECK (workspace_id = app_workspace_id());

-- Housekeeping can find (only) expired demo workspaces in order to delete them.
CREATE POLICY expired_demo ON workspaces FOR SELECT
  USING (is_demo AND created_at < now() - interval '24 hours');

-- Housekeeping can find (only) uploads abandoned for over an hour, to release their quota.
CREATE POLICY abandoned_upload ON assets FOR SELECT
  USING (status = 'uploading' AND created_at < now() - interval '1 hour');

-- Invites and share links are looked up by token before any workspace is known.
-- These policies allow exactly that lookup (token hash supplied in the context), nothing else.
CREATE POLICY by_token ON invites FOR SELECT
  USING (token_hash = NULLIF(current_setting('app.token_hash', true), ''));
CREATE POLICY by_token ON share_links FOR SELECT
  USING (token_hash = NULLIF(current_setting('app.token_hash', true), ''));
