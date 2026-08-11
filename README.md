# MediaVault

MediaVault is a polished digital-asset workspace for creative teams. It is an independently built portfolio project that demonstrates product-focused frontend engineering, asset organisation workflows, accessible interaction design, and a foundation for secure multi-tenant media operations.

## Current product slice

- Responsive asset library with grid and list views
- Instant asset search and selection state
- Workspace navigation, storage usage, activity and team affordances
- Collection and upload interaction feedback
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

## Quality commands

```bash
npm run build
npm run lint
```

## Product roadmap

1. Workspace authentication and role-based access control
2. Collection, tag, and share-link workflows
3. Object storage uploads with background thumbnail processing
4. API, database, audit log, automated tests, and CI/CD

## Security

Never commit credentials, real media, client data, or production endpoints. Use synthetic data and `.env` files kept outside version control.

See [SECURITY.md](SECURITY.md) for the reporting policy.

## License

MIT
