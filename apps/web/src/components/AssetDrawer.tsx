import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssetDto } from '@mediavault/shared';
import { api, ApiError, formatBytes, formatDate } from '../lib/api';
import { useCan } from '../lib/session';
import { ShareBox } from './ShareDialog';

interface Props {
  assetId: string;
  initial: AssetDto;
  collectionId?: string;
  onClose: () => void;
  onTagClick: (tag: string) => void;
}

const META_LABELS: Record<string, string> = {
  camera: 'Camera',
  takenAt: 'Taken',
  aperture: 'Aperture',
  shutter: 'Shutter',
  iso: 'ISO',
  focalLength: 'Focal length',
  colorSpace: 'Colour space',
  dpi: 'Resolution',
  format: 'Format',
};

export function AssetDrawer({ assetId, initial, collectionId, onClose, onTagClick }: Props) {
  const qc = useQueryClient();
  const { data: asset = initial } = useQuery({
    queryKey: ['asset', assetId],
    queryFn: () => api.asset(assetId),
    initialData: initial,
    refetchInterval: (q) => (q.state.data?.status === 'processing' ? 2000 : false),
  });
  const canEdit = useCan('asset.edit');
  const canTrash = useCan('asset.trash');
  const canPurge = useCan('asset.purge');
  const canShare = useCan('share.create');
  const canCollect = useCan('collection.manage');
  const [title, setTitle] = useState(asset.title);
  const [tagDraft, setTagDraft] = useState('');
  const [sharing, setSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  async function save(patch: Parameters<typeof api.updateAsset>[1]) {
    setError(null);
    try {
      const updated = await api.updateAsset(asset.id, patch);
      qc.setQueryData(['asset', asset.id], updated);
      qc.invalidateQueries({ queryKey: ['assets'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save.');
    }
  }

  async function act(fn: () => Promise<unknown>, close = true) {
    setError(null);
    try {
      await fn();
      await Promise.all([qc.invalidateQueries({ queryKey: ['assets'] }), qc.invalidateQueries({ queryKey: ['usage'] }), qc.invalidateQueries({ queryKey: ['collections'] })]);
      if (close) onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That didn’t work.');
    }
  }

  async function download() {
    const { url } = await api.download(asset.id);
    window.location.assign(url);
  }

  function addTag() {
    const t = tagDraft.trim().toLowerCase();
    setTagDraft('');
    if (t && !asset.tags.includes(t)) void save({ tags: [...asset.tags, t] });
  }

  const trashed = !!asset.trashedAt;
  const meta = Object.entries(asset.metadata).filter(([k]) => META_LABELS[k]);

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div className="drawer" role="dialog" aria-modal="true" aria-label={asset.title}>
        <div className="drawer-preview">
          {asset.previewUrl ? (
            <img src={asset.previewUrl} alt={asset.title} />
          ) : (
            <div className="doc">
              <strong style={{ fontSize: 'var(--fs-xxl)' }}>{asset.kind === 'document' ? 'PDF' : asset.kind.toUpperCase()}</strong>
              <span>{asset.status === 'processing' ? 'Still processing…' : asset.status === 'failed' ? 'This file couldn’t be processed.' : 'No preview for this type. Download to open it.'}</span>
            </div>
          )}
        </div>
        <div className="drawer-side">
          <header>
            {canEdit && !trashed ? (
              <input
                className="input"
                style={{ fontWeight: 800, fontSize: 'var(--fs-l)', border: 'none', padding: 0 }}
                aria-label="Title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                onBlur={() => title.trim() && title !== asset.title && save({ title: title.trim() })}
                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
              />
            ) : (
              <h2>{asset.title}</h2>
            )}
            <button ref={closeRef} className="btn ghost" onClick={onClose}>
              Close
            </button>
          </header>

          {asset.status === 'failed' && <p className="notice">This file was rejected: the contents didn’t match its type, or it couldn’t be read.</p>}
          {error && (
            <p className="notice" role="alert">
              {error}
            </p>
          )}

          <div className="actions">
            {asset.status === 'ready' && (
              <button className="btn primary" onClick={download}>
                Download
              </button>
            )}
            {canShare && asset.status === 'ready' && !trashed && (
              <button className="btn" onClick={() => setSharing((s) => !s)} aria-expanded={sharing}>
                Share link
              </button>
            )}
            {collectionId && canCollect && !trashed && (
              <button className="btn" onClick={() => act(() => api.removeFromCollection(collectionId, asset.id))}>
                Remove from collection
              </button>
            )}
            {!trashed && canTrash && (
              <button className="btn danger" onClick={() => act(() => api.trash([asset.id]))}>
                Move to trash
              </button>
            )}
            {trashed && canTrash && (
              <button className="btn" onClick={() => act(() => api.restore(asset.id))}>
                Restore
              </button>
            )}
            {trashed && canPurge && (
              <button
                className="btn danger"
                onClick={() => window.confirm(`Delete “${asset.title}” for good? This can’t be undone.`) && act(() => api.purge(asset.id))}
              >
                Delete forever
              </button>
            )}
          </div>
          {sharing && <ShareBox target={{ assetId: asset.id }} />}

          <section>
            <h3 className="section-title">Tags</h3>
            <div className="tags">
              {asset.tags.map((t) => (
                <span key={t} className="chip">
                  <button className="chip" style={{ padding: 0 }} onClick={() => onTagClick(t)}>
                    #{t}
                  </button>
                  {canEdit && !trashed && (
                    <button
                      className="chip"
                      style={{ padding: 0, color: 'var(--graphite)' }}
                      aria-label={`Remove tag ${t}`}
                      onClick={() => save({ tags: asset.tags.filter((x) => x !== t) })}
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
              {canEdit && !trashed && (
                <input
                  aria-label="Add a tag"
                  placeholder={asset.tags.length ? 'Add tag' : 'Add a tag, press Enter'}
                  value={tagDraft}
                  maxLength={40}
                  onChange={(e) => setTagDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',') {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  onBlur={addTag}
                />
              )}
              {!canEdit && asset.tags.length === 0 && <span style={{ color: 'var(--graphite)', fontSize: 'var(--fs-s)' }}>No tags</span>}
            </div>
          </section>

          {(canEdit || asset.description) && (
            <section>
              <h3 className="section-title">Notes</h3>
              {canEdit && !trashed ? (
                <textarea
                  className="input"
                  rows={3}
                  defaultValue={asset.description}
                  placeholder="Usage rights, client feedback, where it ran…"
                  onBlur={(e) => e.target.value !== asset.description && save({ description: e.target.value })}
                />
              ) : (
                <p style={{ fontSize: 'var(--fs-s)' }}>{asset.description}</p>
              )}
            </section>
          )}

          <section>
            <h3 className="section-title">Details</h3>
            <dl className="meta">
              {asset.width && asset.height && (
                <>
                  <dt>Dimensions</dt>
                  <dd>
                    {asset.width} × {asset.height}
                  </dd>
                </>
              )}
              <dt>Size</dt>
              <dd>{formatBytes(asset.size)}</dd>
              <dt>File</dt>
              <dd>{asset.fileName}</dd>
              <dt>Added by</dt>
              <dd>{asset.uploadedBy.name}</dd>
              <dt>Added</dt>
              <dd>{formatDate(asset.createdAt)}</dd>
              {meta.map(([k, v]) => (
                <Row key={k} label={META_LABELS[k]!} value={k === 'takenAt' ? formatDate(String(v)) : k === 'dpi' ? `${v} dpi` : String(v)} />
              ))}
              {asset.dominantColor && (
                <>
                  <dt>Main colour</dt>
                  <dd style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 14, height: 14, borderRadius: 3, background: asset.dominantColor, display: 'inline-block' }} />
                    {asset.dominantColor}
                  </dd>
                </>
              )}
            </dl>
          </section>
        </div>
      </div>
    </>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}
