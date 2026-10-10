# 3. Signed URLs pinned to hourly windows

**Status:** accepted

## Context

Thumbnails are private, so they're served through signed URLs. Signing each URL with
"now + 1 hour" produces a different URL every time the library is loaded, so the browser
treats every thumbnail as new and downloads the whole grid again.

## Decision

Sign with an expiry at the end of the *next* hour boundary (and, for S3, a signing date
two hours earlier). Every request within the same hour produces byte-identical URLs.

## Consequences

- Thumbnails are cached by the browser for up to an hour; a library of hundreds of images
  reopens instantly.
- A URL is valid for between one and two hours, which is acceptable for previews of files
  the viewer is already allowed to see. Download links stay short-lived (five minutes)
  and are not pinned.
