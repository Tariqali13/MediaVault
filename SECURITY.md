# Security

## Reporting a vulnerability

Please don't open a public issue. Contact the repository owner privately with steps to
reproduce and the impact you observed.

## Controls in this codebase

| Area | Control |
| --- | --- |
| Tenant isolation | Postgres row-level security on every tenant table (`FORCE`), transaction-local context, non-superuser app role |
| Authorisation | Role/permission matrix enforced on every route; exhaustively tested |
| Passwords | argon2id (19 MiB, 2 iterations); constant-time-ish login for unknown emails |
| Sessions | Random 256-bit tokens, stored as SHA-256; httpOnly, SameSite=Lax, Secure in production |
| CSRF | SameSite cookies plus Origin check on all state-changing requests |
| Tokens in links | Invite and share tokens are stored hashed and shown once |
| Uploads | Signed POST policies (key, type, size) enforced by storage; type re-checked from file bytes; pixel limit against decompression bombs |
| Downloads | Short-lived signed URLs; `X-Content-Type-Options: nosniff` |
| Audit | Security-relevant actions recorded in the same transaction as the change |
| Abuse | Per-route rate limits on sign-in, sign-up, demo creation and public links |

Use synthetic data in development. Never commit credentials; configuration comes from
environment variables validated at startup.
