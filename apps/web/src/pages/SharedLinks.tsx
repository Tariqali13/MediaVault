import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, formatDate } from '../lib/api';
import { useCan } from '../lib/session';

export function SharedLinks() {
  const qc = useQueryClient();
  const canShare = useCan('share.create');
  const { data, isLoading } = useQuery({ queryKey: ['shares'], queryFn: api.shares, enabled: canShare });

  if (!canShare) {
    return (
      <div className="empty">
        <h2>Shared links are managed by editors</h2>
        <p>Ask an editor or admin if you need to send files to someone outside the workspace.</p>
      </div>
    );
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Shared links</h1>
          <p>Every public link that’s still working. Turning one off takes effect immediately.</p>
        </div>
      </div>
      {isLoading ? (
        <p aria-busy="true">Loading…</p>
      ) : !data?.length ? (
        <div className="empty">
          <h2>No active links</h2>
          <p>Open a file or a collection and choose Share to create an expiring link.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Shared</th>
              <th>Downloads</th>
              <th>Views</th>
              <th>Expires</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.map((s) => (
              <tr key={s.id}>
                <td>
                  <strong>{s.target}</strong>
                  <div style={{ color: 'var(--graphite)' }}>{s.collectionId ? 'Collection' : 'File'}</div>
                </td>
                <td>{s.allowDownload ? 'Allowed' : 'View only'}</td>
                <td className="num">{s.viewCount}</td>
                <td>{formatDate(s.expiresAt)}</td>
                <td style={{ textAlign: 'right' }}>
                  <button
                    className="btn danger"
                    onClick={async () => {
                      await api.revokeShare(s.id);
                      qc.invalidateQueries({ queryKey: ['shares'] });
                    }}
                  >
                    Turn off
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
