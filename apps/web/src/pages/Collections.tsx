import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useCan } from '../lib/session';

export function Collections() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['collections'], queryFn: api.collections });
  const canManage = useCan('collection.manage');
  const [error, setError] = useState<string | null>(null);

  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const name = String(new FormData(form).get('name') ?? '').trim();
    if (!name) return;
    setError(null);
    try {
      await api.createCollection(name);
      form.reset();
      qc.invalidateQueries({ queryKey: ['collections'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the collection.');
    }
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Collections</h1>
          <p>Group files for a campaign, a client or a shoot. A file can be in any number of collections.</p>
        </div>
        {canManage && (
          <form onSubmit={create} className="actions">
            <input className="input" name="name" placeholder="New collection name" aria-label="New collection name" maxLength={80} style={{ width: 240 }} />
            <button className="btn primary">Create collection</button>
          </form>
        )}
      </div>
      {error && (
        <p className="notice" role="alert" style={{ marginBottom: 16 }}>
          {error}
        </p>
      )}
      {isLoading ? (
        <p aria-busy="true">Loading…</p>
      ) : !data?.length ? (
        <div className="empty">
          <h2>No collections yet</h2>
          <p>Create one, then select files in the library and add them to it.</p>
        </div>
      ) : (
        <div className="cards">
          {data.map((c) => (
            <Link key={c.id} to={`/library?collection=${c.id}`} className="collection-card">
              <div className="cover">{c.coverUrl && <img src={c.coverUrl} alt="" loading="lazy" />}</div>
              <b>{c.name}</b>
              <small>
                {c.count} file{c.count === 1 ? '' : 's'}
              </small>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
