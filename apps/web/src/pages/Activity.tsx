import { useInfiniteQuery } from '@tanstack/react-query';
import { api, timeAgo, type AuditEvent } from '../lib/api';
import { useCan } from '../lib/session';

/** Turns audit records into sentences a person would say. */
export function describe(e: AuditEvent): string {
  const who = e.actor ?? 'Someone';
  const d = e.details as Record<string, unknown>;
  switch (e.action) {
    case 'workspace.created':
      return `${who} created the workspace`;
    case 'asset.uploaded':
      return `${who} uploaded ${d.fileName ?? 'a file'}`;
    case 'asset.edited':
      return `${who} edited a file’s ${(d.fields as string[] | undefined)?.join(' and ') ?? 'details'}`;
    case 'asset.trashed':
      return `${who} moved ${(d.ids as unknown[] | undefined)?.length ?? 'some'} file(s) to the trash`;
    case 'asset.restored':
      return `${who} restored a file from the trash`;
    case 'asset.purged':
      return `${who} permanently deleted ${d.fileName ?? 'a file'}`;
    case 'collection.created':
      return `${who} created the collection “${d.name}”`;
    case 'collection.deleted':
      return `${who} deleted the collection “${d.name}”`;
    case 'collection.assets_added':
      return `${who} added ${d.count} file(s) to a collection`;
    case 'share.created':
      return `${who} created a ${d.allowDownload ? '' : 'view-only '}share link`;
    case 'share.revoked':
      return `${who} turned off a share link`;
    case 'member.invited':
      return `${who} invited ${d.email} as ${d.role}`;
    case 'member.joined':
      return `${who} joined as ${d.role}`;
    case 'member.role_changed':
      return `${who} changed someone’s role from ${d.from} to ${d.to}`;
    case 'member.removed':
      return `${who} removed a ${d.role} from the workspace`;
    default:
      return `${who}: ${e.action}`;
  }
}

export function Activity() {
  const allowed = useCan('audit.read');
  const q = useInfiniteQuery({
    queryKey: ['audit'],
    queryFn: ({ pageParam }) => api.audit(pageParam ?? undefined),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBefore,
    enabled: allowed,
  });

  if (!allowed) {
    return (
      <div className="empty">
        <h2>Activity is visible to admins</h2>
      </div>
    );
  }
  const items = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Activity</h1>
          <p>Every change, recorded in the same database transaction as the change itself.</p>
        </div>
      </div>
      <ul className="feed">
        {items.map((e) => (
          <li key={e.id}>
            <span>{describe(e)}</span>
            <time dateTime={e.createdAt}>{timeAgo(e.createdAt)}</time>
          </li>
        ))}
      </ul>
      {q.hasNextPage && (
        <p style={{ marginTop: 16 }}>
          <button className="btn" onClick={() => q.fetchNextPage()} disabled={q.isFetchingNextPage}>
            Show older activity
          </button>
        </p>
      )}
    </>
  );
}
