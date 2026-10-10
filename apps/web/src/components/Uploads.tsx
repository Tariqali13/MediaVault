import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ALLOWED_MIME, MAX_UPLOAD_BYTES, type AllowedMime } from '@mediavault/shared';
import { api, ApiError, formatBytes, uploadToStorage } from '../lib/api';

interface Item {
  key: string;
  name: string;
  progress: number;
  state: 'uploading' | 'processing' | 'done' | 'error';
  error?: string;
}

const Ctx = createContext<{ add: (files: FileList | File[]) => void } | null>(null);

export const useUploads = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useUploads outside UploadProvider');
  return ctx;
};

const CONCURRENCY = 3;

export function UploadProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [items, setItems] = useState<Item[]>([]);
  const patch = (key: string, p: Partial<Item>) => setItems((cur) => cur.map((i) => (i.key === key ? { ...i, ...p } : i)));

  const uploadOne = useCallback(
    async (file: File, key: string) => {
      try {
        const type = file.type as AllowedMime;
        if (!(type in ALLOWED_MIME)) throw new ApiError(400, 'type', 'Only images, MP4/MOV video and PDFs are supported.');
        if (file.size > MAX_UPLOAD_BYTES) throw new ApiError(400, 'size', `Files can be up to ${formatBytes(MAX_UPLOAD_BYTES)}.`);
        const { assetId, upload } = await api.startUpload(file.name, type, file.size);
        await uploadToStorage(upload, file, (f) => patch(key, { progress: f }));
        patch(key, { state: 'processing', progress: 1 });
        await api.completeUpload(assetId);
        patch(key, { state: 'done' });
        qc.invalidateQueries({ queryKey: ['assets'] });
        qc.invalidateQueries({ queryKey: ['usage'] });
      } catch (err) {
        patch(key, { state: 'error', error: err instanceof ApiError ? err.message : 'Upload failed.' });
        qc.invalidateQueries({ queryKey: ['usage'] });
      }
    },
    [qc],
  );

  const add = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list);
      const queued = files.map((f) => ({ file: f, key: `${f.name}-${f.size}-${crypto.randomUUID()}` }));
      setItems((cur) => [...queued.map(({ file, key }) => ({ key, name: file.name, progress: 0, state: 'uploading' as const })), ...cur]);
      // A small worker pool: a few uploads at a time, so one huge batch doesn't saturate the connection.
      let next = 0;
      const worker = async () => {
        while (next < queued.length) {
          const { file, key } = queued[next++]!;
          await uploadOne(file, key);
        }
      };
      void Promise.all(Array.from({ length: Math.min(CONCURRENCY, queued.length) }, worker));
    },
    [uploadOne],
  );

  const active = items.filter((i) => i.state === 'uploading' || i.state === 'processing').length;

  return (
    <Ctx.Provider value={{ add }}>
      {children}
      {items.length > 0 && (
        <section className="tray" aria-label="Uploads" aria-live="polite">
          <header>
            <span>{active ? `Uploading ${active} of ${items.length}` : `${items.length} upload${items.length > 1 ? 's' : ''} finished`}</span>
            {!active && (
              <button className="btn ghost" onClick={() => setItems([])}>
                Close
              </button>
            )}
          </header>
          <ul>
            {items.map((i) => (
              <li key={i.key}>
                <div>
                  <span>{i.name}</span>
                  <small className={i.state === 'error' ? 'err' : undefined}>
                    {i.state === 'uploading' ? `${Math.round(i.progress * 100)}%` : i.state === 'processing' ? 'Processing' : i.state === 'done' ? 'Added' : 'Failed'}
                  </small>
                </div>
                {i.state === 'uploading' && (
                  <div className="meter">
                    <i style={{ width: `${i.progress * 100}%` }} />
                  </div>
                )}
                {i.error && <small className="err">{i.error}</small>}
              </li>
            ))}
          </ul>
        </section>
      )}
    </Ctx.Provider>
  );
}
