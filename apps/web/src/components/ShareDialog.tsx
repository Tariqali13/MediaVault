import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api, ApiError, formatDate } from '../lib/api';

const DURATIONS = [
  { hours: 24, label: '1 day' },
  { hours: 72, label: '3 days' },
  { hours: 24 * 7, label: '1 week' },
  { hours: 24 * 30, label: '30 days' },
];

/** Create an expiring public link. Used inline in the asset drawer and as a dialog for collections. */
export function ShareBox({ target }: { target: { assetId?: string; collectionId?: string } }) {
  const qc = useQueryClient();
  const [hours, setHours] = useState(72);
  const [allowDownload, setAllowDownload] = useState(true);
  const [link, setLink] = useState<{ url: string; expiresAt: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function create() {
    setError(null);
    try {
      setLink(await api.createShare({ ...target, expiresInHours: hours, allowDownload }));
      qc.invalidateQueries({ queryKey: ['shares'] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not create the link.');
    }
  }

  if (link) {
    return (
      <div className="share-box">
        <div className="copy">
          <input className="input" readOnly value={link.url} aria-label="Share link" onFocus={(e) => e.target.select()} />
          <button
            className="btn"
            onClick={async () => {
              await navigator.clipboard?.writeText(link.url).catch(() => undefined);
              setCopied(true);
            }}
          >
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <span style={{ color: 'var(--graphite)' }}>
          Anyone with this link can view{allowDownload ? ' and download' : ''} until {formatDate(link.expiresAt)}. This is the only time it’s shown.
        </span>
      </div>
    );
  }

  return (
    <div className="share-box">
      <label className="field">
        <span>Link works for</span>
        <select className="select" value={hours} onChange={(e) => setHours(Number(e.target.value))}>
          {DURATIONS.map((d) => (
            <option key={d.hours} value={d.hours}>
              {d.label}
            </option>
          ))}
        </select>
      </label>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <input type="checkbox" checked={allowDownload} onChange={(e) => setAllowDownload(e.target.checked)} />
        Allow downloading originals
      </label>
      {error && <p className="notice">{error}</p>}
      <button className="btn primary" onClick={create}>
        Create link
      </button>
    </div>
  );
}

export function ShareDialog({ target, onClose }: { target: { collectionId: string; name: string }; onClose: () => void }) {
  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Share ${target.name}`}
        className="panel"
        style={{ position: 'fixed', zIndex: 32, top: '15vh', left: '50%', transform: 'translateX(-50%)', width: 'min(440px, calc(100vw - 32px))' }}
        onKeyDown={(e) => e.key === 'Escape' && onClose()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 'var(--fs-l)' }}>Share “{target.name}”</h2>
          <button className="btn ghost" onClick={onClose} autoFocus>
            Close
          </button>
        </div>
        <ShareBox target={{ collectionId: target.collectionId }} />
      </div>
    </>
  );
}
