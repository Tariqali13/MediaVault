import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AssetDto } from '@mediavault/shared';
import { api, ApiError, type AssetQuery } from '../lib/api';
import { useCan } from '../lib/session';
import { Gallery, LoadMore } from '../components/Gallery';
import { AssetDrawer } from '../components/AssetDrawer';
import { useUploads } from '../components/Uploads';
import { ShareDialog } from '../components/ShareDialog';

const KINDS = [
  { id: '', label: 'All' },
  { id: 'image', label: 'Images' },
  { id: 'video', label: 'Video' },
  { id: 'document', label: 'Documents' },
];

export function Library({ trash = false }: { trash?: boolean }) {
  const [params, setParams] = useSearchParams();
  const qc = useQueryClient();
  const uploads = useUploads();
  const canUpload = useCan('asset.upload');
  const canTrash = useCan('asset.trash');
  const canCollect = useCan('collection.manage');
  const canShare = useCan('share.create');
  const fileInput = useRef<HTMLInputElement>(null);

  const query: AssetQuery = {
    q: params.get('q') ?? undefined,
    kind: params.get('kind') ?? undefined,
    tag: params.get('tag') ?? undefined,
    collectionId: params.get('collection') ?? undefined,
    trashed: trash || undefined,
  };
  const [search, setSearch] = useState(query.q ?? '');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<AssetDto | null>(null);
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const lastPicked = useRef<number | null>(null);

  // Debounced search → URL (so searches are shareable and survive refresh).
  useEffect(() => {
    const t = setTimeout(() => {
      if ((params.get('q') ?? '') === search) return;
      const next = new URLSearchParams(params);
      if (search) next.set('q', search);
      else next.delete('q');
      setParams(next, { replace: true });
    }, 250);
    return () => clearTimeout(t);
  }, [search, params, setParams]);

  const assets = useInfiniteQuery({
    queryKey: ['assets', query],
    queryFn: ({ pageParam }) => api.assets(query, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    // While anything is still processing, check back every two seconds.
    refetchInterval: (q) => (q.state.data?.pages.some((p) => p.items.some((a) => a.status === 'processing' || a.status === 'uploading')) ? 2000 : false),
  });
  const items = useMemo(() => assets.data?.pages.flatMap((p) => p.items) ?? [], [assets.data]);

  const { data: collections } = useQuery({ queryKey: ['collections'], queryFn: api.collections });
  const collection = collections?.find((c) => c.id === query.collectionId);

  useEffect(() => setSelected(new Set()), [trash, query.collectionId]);

  const toggle = useCallback(
    (asset: AssetDto, range: boolean) => {
      const index = items.findIndex((a) => a.id === asset.id);
      setSelected((cur) => {
        const next = new Set(cur);
        if (range && lastPicked.current !== null) {
          const [from, to] = [Math.min(lastPicked.current, index), Math.max(lastPicked.current, index)];
          for (let i = from; i <= to; i++) next.add(items[i]!.id);
        } else if (next.has(asset.id)) next.delete(asset.id);
        else next.add(asset.id);
        return next;
      });
      lastPicked.current = index;
    },
    [items],
  );

  function setParam(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  }

  async function bulk(action: () => Promise<unknown>, done: string) {
    setMessage(null);
    try {
      await action();
      setMessage(done);
      setSelected(new Set());
      await Promise.all([qc.invalidateQueries({ queryKey: ['assets'] }), qc.invalidateQueries({ queryKey: ['collections'] }), qc.invalidateQueries({ queryKey: ['usage'] })]);
    } catch (err) {
      setMessage(err instanceof ApiError ? err.message : 'That didn’t work.');
    }
  }

  const title = trash ? 'Trash' : collection ? collection.name : 'Library';
  const subtitle = trash
    ? 'Files here are hidden from the library. Admins can delete them for good.'
    : collection
      ? `${collection.count} file${collection.count === 1 ? '' : 's'} in this collection`
      : 'Everything your team has uploaded. Drop files anywhere on this page to add them.';

  return (
    <div
      onDragOver={(e) => {
        if (!canUpload || trash || !e.dataTransfer.types.includes('Files')) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => e.currentTarget === e.target && setDragging(false)}
      onDrop={(e) => {
        if (!canUpload || trash) return;
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) uploads.add(e.dataTransfer.files);
      }}
    >
      <div className="page-head">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="actions">
          {collection && canShare && (
            <button className="btn" onClick={() => setSharing(true)}>
              Share collection
            </button>
          )}
          {collection && <button className="btn ghost" onClick={() => setParam('collection', null)}>Back to library</button>}
          {canUpload && !trash && (
            <>
              <button className="btn primary" onClick={() => fileInput.current?.click()}>
                Upload files
              </button>
              <input
                ref={fileInput}
                type="file"
                multiple
                hidden
                accept="image/jpeg,image/png,image/webp,image/gif,image/avif,video/mp4,video/quicktime,application/pdf"
                onChange={(e) => {
                  if (e.target.files?.length) uploads.add(e.target.files);
                  e.target.value = '';
                }}
              />
            </>
          )}
        </div>
      </div>

      <div className="toolbar">
        <input
          className="input search"
          type="search"
          placeholder="Search titles, tags and descriptions"
          aria-label="Search the library"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="segmented" role="group" aria-label="File type">
          {KINDS.map((k) => (
            <button key={k.id} aria-pressed={(query.kind ?? '') === k.id} onClick={() => setParam('kind', k.id || null)}>
              {k.label}
            </button>
          ))}
        </div>
        {query.tag && (
          <button className="chip" onClick={() => setParam('tag', null)} aria-label={`Remove tag filter ${query.tag}`}>
            #{query.tag} ×
          </button>
        )}
      </div>

      {selected.size > 0 && (
        <div className="bulkbar" role="toolbar" aria-label="Selected files">
          <strong style={{ marginRight: 'auto' }}>{selected.size} selected</strong>
          {!trash && canCollect && collections && collections.length > 0 && (
            <select
              aria-label="Add selected to collection"
              value=""
              onChange={(e) => {
                const c = collections.find((x) => x.id === e.target.value);
                if (c) void bulk(() => api.addToCollection(c.id, [...selected]), `Added to ${c.name}.`);
              }}
            >
              <option value="">Add to collection…</option>
              {collections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          )}
          {!trash && canTrash && (
            <button className="btn" onClick={() => bulk(() => api.trash([...selected]), `Moved ${selected.size} to the trash.`)}>
              Move to trash
            </button>
          )}
          {trash && canTrash && (
            <button className="btn" onClick={() => bulk(() => Promise.all([...selected].map((id) => api.restore(id))), 'Restored.')}>
              Restore
            </button>
          )}
          <button className="btn" onClick={() => setSelected(new Set())}>
            Clear
          </button>
        </div>
      )}

      {message && (
        <p className="notice info" role="status" style={{ marginBottom: 14 }}>
          {message}
        </p>
      )}

      {assets.isError ? (
        <p className="notice" role="alert">
          {(assets.error as Error).message}
        </p>
      ) : assets.isLoading ? (
        <p aria-busy="true">Loading…</p>
      ) : items.length === 0 ? (
        <Empty trash={trash} filtered={!!(query.q || query.kind || query.tag)} canUpload={canUpload} onUpload={() => fileInput.current?.click()} />
      ) : (
        <>
          <Gallery assets={items} selected={selected} onOpen={setOpen} onToggle={canTrash || canCollect ? toggle : undefined} />
          <LoadMore onVisible={() => assets.fetchNextPage()} disabled={!assets.hasNextPage || assets.isFetchingNextPage} />
          {assets.isFetchingNextPage && <p style={{ textAlign: 'center', color: 'var(--graphite)', marginTop: 16 }}>Loading more…</p>}
        </>
      )}

      {dragging && (
        <div className="dropzone" aria-hidden="true">
          <div>Drop to upload</div>
        </div>
      )}
      {open && (
        <AssetDrawer
          assetId={open.id}
          initial={open}
          collectionId={query.collectionId}
          onClose={() => setOpen(null)}
          onTagClick={(tag) => {
            setOpen(null);
            setParam('tag', tag);
          }}
        />
      )}
      {sharing && collection && <ShareDialog target={{ collectionId: collection.id, name: collection.name }} onClose={() => setSharing(false)} />}
    </div>
  );
}

function Empty({ trash, filtered, canUpload, onUpload }: { trash: boolean; filtered: boolean; canUpload: boolean; onUpload: () => void }) {
  if (trash) {
    return (
      <div className="empty">
        <h2>The trash is empty</h2>
        <p>Files you move to the trash show up here until someone restores them or deletes them for good.</p>
      </div>
    );
  }
  if (filtered) {
    return (
      <div className="empty">
        <h2>Nothing matches</h2>
        <p>Try a different word, or clear the filters.</p>
      </div>
    );
  }
  return (
    <div className="empty">
      <h2>No files yet</h2>
      <p>{canUpload ? 'Drag pictures, videos or PDFs onto this page, or choose them from your computer.' : 'When your team uploads files, they’ll appear here.'}</p>
      {canUpload && (
        <button className="btn primary" onClick={onUpload}>
          Upload files
        </button>
      )}
    </div>
  );
}
