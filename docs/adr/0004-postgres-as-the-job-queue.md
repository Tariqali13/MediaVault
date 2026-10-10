# 4. Use Postgres (pg-boss) as the job queue

**Status:** accepted

## Context

Image processing has to happen off the request path, with retries. The usual choice is
Redis with BullMQ, which adds a second stateful service to run, secure and pay for.

## Decision

Use pg-boss, which stores jobs in Postgres using `SKIP LOCKED`. The queue lives next to
the data it describes.

## Consequences

- One stateful dependency (Postgres) plus object storage; the whole product runs on free
  tiers.
- Jobs and the rows they update share a database, so enqueue-on-commit patterns are
  straightforward later.
- Throughput is lower than Redis-backed queues, which is irrelevant at thumbnail-rendering
  rates. If it ever mattered, the `MediaQueue` wrapper is the only code that would change.
