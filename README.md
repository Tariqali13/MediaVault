# MediaVault

MediaVault is a polished digital-asset workspace for creative teams. It is an independently built portfolio project that demonstrates product-focused frontend engineering, asset organisation workflows, accessible interaction design, and a foundation for secure multi-tenant media operations.

## Current product slice

- Responsive asset library with grid and list views
- Instant asset search, file-type filters, and asset details
- Upload, collection creation, secure-share, notification, profile, and access-control workflows
- Workspace navigation, storage usage, activity and team affordances
- Local persistence for synthetic assets, collections, shares, and audit events through the Express API
- Synthetic asset metadata only; no customer data or credentials

## Planned production architecture

```text
React / TypeScript client
        |
        v
Node.js API + workspace RBAC
        |
        +--> PostgreSQL (assets, collections, audit records)
        +--> Redis / queue worker (thumbnails, metadata)
        +--> S3-compatible object storage (originals and derivatives)
```

The application will use tenant-scoped access checks, signed uploads, audit events, and background processing. These are planned engineering capabilities, not claims about the current frontend prototype.

## Local development

Requires Node.js 18 or later.

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

### API prototype

The API exposes tenant-scoped synthetic asset records and creates audit events for uploads.

```bash
npm run dev:api
curl -H 'x-workspace-id: northstar-studio' http://localhost:4000/api/v1/assets
```

Run its smoke check while the API is running:

```bash
npm run test:api
```

## Quality commands

```bash
npm run build
npm run lint
```

## Product roadmap

1. Production authentication and role-based access control
2. PostgreSQL persistence, tenant isolation, and server-side authorization
3. S3-compatible object storage with background thumbnail processing
4. Real deployment, end-to-end browser tests, and observability

## Security

Never commit credentials, real media, client data, or production endpoints. Use synthetic data and `.env` files kept outside version control.

See [SECURITY.md](SECURITY.md) for the reporting policy.

## License

MIT
