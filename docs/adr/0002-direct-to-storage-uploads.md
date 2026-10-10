# 2. Browsers upload directly to object storage

**Status:** accepted

## Context

Proxying uploads through the API ties up API memory and bandwidth for the whole transfer,
and makes the API's request size limit the product's file size limit. On a free-tier host
it also competes with every other request.

## Decision

The API issues a **presigned POST** (not PUT) with conditions on the exact key, content
type and maximum size. The browser uploads straight to the bucket. The API is only
involved before (reserve quota, create the record) and after (verify size, enqueue
processing).

## Consequences

- Upload size and throughput are bounded by storage, not the API.
- The bucket enforces the size limit itself; the API re-checks the stored size on
  completion and the worker checks the real file type from its bytes.
- The bucket needs CORS for the web origin.
- A local driver reproduces the same signed-policy semantics so development and tests
  don't need S3.
