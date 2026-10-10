import { useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import type { AssetDto } from '@mediavault/shared';
import { api, formatDate, type PublicShare as Share } from '../lib/api';
import { Gallery } from '../components/Gallery';
import { Wordmark } from '../components/Wordmark';

export function PublicShare() {
  const { token = '' } = useParams();
  const { data, error, isLoading } = useQuery({ queryKey: ['public-share', token], queryFn: () => api.publicShare(token), retry: false });
  const [open, setOpen] = useState<Share['items'][number] | null>(null);

  if (isLoading) return <p className="center">Opening…</p>;
  if (error || !data) {
    return (
      <div className="center">
        <div>
          <Wordmark size={40} />
          <h1 style={{ fontSize: 'var(--fs-xl)' }}>This link isn’t working</h1>
          <p style={{ color: 'var(--graphite)' }}>It may have expired or been turned off. Ask the person who sent it for a new one.</p>
        </div>
      </div>
    );
  }

  // The gallery works with asset-shaped objects; adapt the public items.
  const assets = data.items.map(
    (i) =>
      ({
        ...i,
        status: 'ready',
        fileName: i.title,
        tags: [],
        description: '',
        contentType: '',
        size: 0,
        uploadedBy: { id: '', name: '' },
        createdAt: '',
        trashedAt: null,
        metadata: {},
      }) as unknown as AssetDto,
  );

  return (
    <div className="public">
      <header>
        <div>
          <p style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
            <Wordmark size={20} /> Shared by {data.sharedBy}
          </p>
          <h1>{data.title}</h1>
        </div>
        <p>
          {data.items.length} file{data.items.length === 1 ? '' : 's'}. Link works until {formatDate(data.expiresAt)}.
        </p>
      </header>
      <Gallery assets={assets} selected={new Set()} onOpen={(a) => setOpen(data.items.find((i) => i.id === a.id) ?? null)} targetHeight={260} />

      {open && (
        <div className="lightbox" role="dialog" aria-modal="true" aria-label={open.title} onKeyDown={(e) => e.key === 'Escape' && setOpen(null)}>
          <header>
            <strong>{open.title}</strong>
            <div className="actions">
              {open.downloadUrl && (
                <a className="btn" href={open.downloadUrl}>
                  Download original
                </a>
              )}
              <button className="btn" onClick={() => setOpen(null)} autoFocus>
                Close
              </button>
            </div>
          </header>
          {open.previewUrl ? <img src={open.previewUrl} alt={open.title} /> : <p className="center">No preview for this file.</p>}
        </div>
      )}
    </div>
  );
}
