# Security Policy

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Contact the repository owner privately with a clear reproduction path and impact summary.

## Development safeguards

- Keep secrets in local environment files only.
- Use synthetic assets and sample workspace data.
- Validate upload types and authorization server-side before adding production storage.
- Record security-sensitive actions in an audit trail once the API is implemented.
