# 1. Enforce tenant isolation with Postgres row-level security

**Status:** accepted

## Context

The usual multi-tenant pattern is a `workspace_id` column plus a `WHERE workspace_id = ?`
in every query. It works until someone forgets one, and then the bug is a data leak
between customers: the worst kind of incident for a product that stores clients'
unreleased work.

## Decision

Every tenant table has `FORCE ROW LEVEL SECURITY` with policies keyed on a
transaction-local setting, `app.workspace_id`. All tenant queries go through one helper
that opens a transaction and sets the context. The application role is not a superuser
and does not have `BYPASSRLS`.

## Consequences

- A missing filter returns no rows instead of another tenant's rows. Inserts and updates
  that would cross tenants fail.
- Lookups that legitimately happen before a tenant is known (share links, invites,
  housekeeping) need their own narrow policies, which are listed in ARCHITECTURE.md.
- Tests must run as a non-superuser; the harness refuses to start otherwise, because a
  superuser would make the isolation tests pass for the wrong reason.
- Slight overhead per transaction (`set_config`), negligible next to network latency.
