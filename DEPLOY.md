# Deploying the demo on free tiers

| Piece | Service |
| --- | --- |
| Postgres | [Neon](https://neon.tech) |
| API + media worker | [Render](https://render.com) web service (Docker), worker in-process |
| Web | [Vercel](https://vercel.com) or [Netlify](https://netlify.com), proxying `/api` to Render |
| Files | Local disk on Render (fine for 24-hour demo workspaces), or any S3-compatible bucket |

## 1. Postgres on Neon, with a non-superuser role

Row-level security only protects you if the app connects as a role that isn't a superuser
and doesn't have `BYPASSRLS`. Neon's default role qualifies, but a dedicated role is
cleaner:

1. Create a project and database `mediavault`.
2. In **Roles**, add a role `mediavault_app` and make it the owner of the database (or
   run the app as the default role).
3. Copy the connection string for that role. It ends with `?sslmode=require`.

The API runs migrations on start.

## 2. API on Render

1. **New → Blueprint**, pick this repository (`render.yaml`).
2. Name the service `mediavault-api` so the URL matches the web proxy config, or update
   `apps/web/vercel.json` / `netlify.toml` with your actual URL.
3. Set the prompted values:
   - `DATABASE_URL`: the Neon URL from step 1
   - `APP_ORIGIN`: your web URL, e.g. `https://mediavault.vercel.app`
   - `PUBLIC_API_URL`: the same origin plus `/api`, e.g. `https://mediavault.vercel.app/api`
4. Check `https://mediavault-api.onrender.com/health`.

On the free plan the service sleeps when idle (the first request takes up to a minute),
and its disk is wiped on redeploy. With `STORAGE_DRIVER=local` that only affects files
uploaded into demo workspaces, which expire after 24 hours anyway; the sample library is
regenerated at boot.

### Optional: persistent storage

Any S3-compatible bucket works (Backblaze B2 and Supabase Storage both have free tiers).
Set `STORAGE_DRIVER=s3`, `S3_BUCKET`, `S3_ENDPOINT`, `S3_REGION`, `S3_ACCESS_KEY_ID`,
`S3_SECRET_ACCESS_KEY`, and allow CORS `POST` and `GET` from your web origin on the bucket.

## 3. Web on Vercel (or Netlify)

1. Import the repository with root directory `apps/web` (framework: Vite).
2. Deploy. `vercel.json` proxies `/api/*` to the Render service, so the browser talks to
   one origin and the session cookie stays first-party.

## Why the API sits behind the web host's proxy

Browsers increasingly block third-party cookies. Serving the API under the web app's own
origin keeps the `SameSite=Lax` session cookie first-party, avoids CORS preflights on
every request, and lets the Origin check reject cross-site requests.
