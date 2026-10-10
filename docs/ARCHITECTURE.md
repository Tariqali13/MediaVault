# Architecture

## Tenancy

A **workspace** is the tenant. Users can belong to several workspaces with a different
role in each; a session remembers which workspace you're "in".

### How isolation is enforced

1. Every tenant table has `workspace_id`, `ENABLE` and `FORCE ROW LEVEL SECURITY`, and a
   policy `workspace_id = app_workspace_id()`.
2. `app_workspace_id()` reads `current_setting('app.workspace_id')`.
3. The API never queries tenant tables outside `withContext()`, which opens a
   transaction and runs `set_config('app.workspace_id', $1, true)`. The `true` makes the
   setting transaction-local, so it disappears at `COMMIT`/`ROLLBACK` and can't leak to
   the next request that borrows the same pooled connection.
4. The app connects as a role **without** `SUPERUSER` or `BYPASSRLS`. `FORCE` makes the
   policies apply even though that role owns the tables.

The membership check (`memberGuard`) and the permission check (`authorize`) still run in
application code: RLS answers "which rows exist for you", roles answer "what may you do
with them". Both layers are tested.

### The few deliberate exceptions

Some lookups happen before any workspace is known. Each has its own narrow policy:

| Lookup | How it's allowed |
| --- | --- |
| Open a share link or invite | `token_hash = current_setting('app.token_hash')`. The caller must already hold the token. |
| List your workspaces | Memberships where `user_id = app.user_id`. |
| Create a workspace at sign-up | `INSERT` allowed when `app.user_id` is set. |
| Housekeeping | Can see only demo workspaces older than 24 h, and uploads stuck in `uploading` for over an hour, then deletes each inside its own tenant context. |

Users and sessions are global identity tables without RLS; they are only read by primary
key, unique email, or token hash.

## Upload flow

```
Browser                    API                              Storage           Worker
   | POST /assets/uploads   |                                   |                 |
   |----------------------->| reserve quota (atomic UPDATE)     |                 |
   |                        | insert asset (status=uploading)   |                 |
   |<-----------------------| signed POST policy                |                 |
   | POST file (policy: key, type, max size) ------------------>|                 |
   | POST /assets/:id/complete                                  |                 |
   |----------------------->| HEAD object, check size           |                 |
   |                        | status=processing, enqueue ------------------------>|
   |                        |                                   |<-- GET original |
   |                        |                                   |   sniff bytes   |
   |                        |                                   |   EXIF, rotate  |
   |                        |                                   |<-- PUT thumb,   |
   |                        |                                   |    preview      |
   |                        |<----------------------------------- status=ready ---|
```

- **Quota** is reserved before the upload with
  `UPDATE workspaces SET storage_bytes = storage_bytes + $size WHERE storage_bytes + $size <= quota_bytes`.
  Ten parallel uploads against a nearly full workspace can't overshoot; the test does
  exactly that.
- **Completion is idempotent**, and the job is enqueued with the asset id as a
  singleton key, so a double click can't process a file twice.
- **Failure handling:** a job is retried with exponential backoff; after the last attempt
  the asset is marked `failed`, the original is deleted and the quota is returned.
  Uploads that are started but never completed are cleaned up after an hour.
- **Decompression bombs** are limited with sharp's `limitInputPixels`. GPS EXIF is
  deliberately not extracted.

## Reading the library

- Listing uses keyset pagination on `(created_at, id)` with a partial index for
  non-trashed assets.
- Search combines a weighted `tsvector` (title > tags > description) generated column with
  a trigram index for substring matches on titles.
- Thumbnails are served by short-lived signed URLs pinned to hourly windows, so they are
  cacheable (see [ADR 3](adr/0003-cacheable-signed-urls.md)).

## Demo mode

"Try the demo" creates a new workspace, a demo owner and three teammates, and points the
sample assets at shared, read-only objects under `demo-seed/` (rendered once at boot from
procedural SVG art, then processed by the same pipeline as real uploads). Code that deletes
storage objects skips that prefix. Demo workspaces and their users are deleted after 24
hours.

## What I'd add next

- Video posters and HLS renditions via a transcoding worker (ffmpeg), behind the same queue.
- Resumable uploads (S3 multipart) for files over ~100 MB.
- Email delivery for invites through an outbox table.
- Per-workspace rate limits and abuse controls on public share links.
- Tenant-aware observability: request logs and metrics labelled by workspace.
