import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { AssetDto } from '@mediavault/shared';
import { justify } from '../lib/justify';
import { PencilMark } from './Wordmark';

interface Props {
  assets: AssetDto[];
  selected: Set<string>;
  onOpen: (asset: AssetDto) => void;
  onToggle?: (asset: AssetDto, range: boolean) => void;
  targetHeight?: number;
}

const GAP = 8;

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const ro = new ResizeObserver(([e]) => setWidth(Math.floor(e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

export function Gallery({ assets, selected, onOpen, onToggle, targetHeight = 220 }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const height = width < 600 ? 150 : targetHeight;
  const rows = useMemo(() => justify(assets.map(aspectOf), width, height, GAP), [assets, width, height]);

  return (
    <div ref={ref} className={`gallery${selected.size ? ' selecting' : ''}`} style={{ ['--gap' as string]: `${GAP}px` }}>
      {rows.map((row, r) => (
        <div className="gallery-row" key={r}>
          {row.boxes.map((box) => {
            const a = assets[box.index]!;
            return <Tile key={a.id} asset={a} width={box.width} height={box.height} selected={selected.has(a.id)} onOpen={onOpen} onToggle={onToggle} />;
          })}
        </div>
      ))}
    </div>
  );
}

function aspectOf(a: { width: number | null; height: number | null; kind: string }) {
  if (a.width && a.height) return a.width / a.height;
  return a.kind === 'document' ? 0.75 : 1.5;
}

function Tile({
  asset,
  width,
  height,
  selected,
  onOpen,
  onToggle,
}: {
  asset: AssetDto;
  width: number;
  height: number;
  selected: boolean;
  onOpen: Props['onOpen'];
  onToggle: Props['onToggle'];
}) {
  const pending = asset.status === 'uploading' || asset.status === 'processing';
  return (
    <div
      className={`tile${pending ? ' processing' : ''}`}
      style={{ width, height, background: asset.dominantColor ?? undefined }}
      data-selected={selected || undefined}
    >
      <button
        type="button"
        className="tile-hit"
        onClick={(e) => (onToggle && (e.shiftKey || e.metaKey || e.ctrlKey) ? onToggle(asset, e.shiftKey) : onOpen(asset))}
        aria-label={`Open ${asset.title}`}
      >
        {asset.thumbUrl ? (
          <img src={asset.thumbUrl} alt="" loading="lazy" decoding="async" width={width} height={height} />
        ) : (
          <span className="tile-fallback">
            {!pending && <b>{asset.kind === 'document' ? 'PDF' : asset.kind === 'video' ? 'VIDEO' : 'FILE'}</b>}
            <span>{asset.fileName}</span>
          </span>
        )}
        <span className="caption">{asset.title}</span>
      </button>
      {pending && <span className="status">Processing</span>}
      {asset.status === 'failed' && <span className="status failed">Failed</span>}
      {onToggle && (
        <button type="button" className="pick" aria-label={selected ? `Deselect ${asset.title}` : `Select ${asset.title}`} onClick={(e) => onToggle(asset, e.shiftKey)} />
      )}
      {selected && <PencilMark />}
    </div>
  );
}

/** Calls `onVisible` when the sentinel scrolls into view (infinite scroll). */
export function LoadMore({ onVisible, disabled }: { onVisible: () => void; disabled: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (disabled || !ref.current) return;
    const io = new IntersectionObserver(([e]) => e?.isIntersecting && onVisible(), { rootMargin: '600px' });
    io.observe(ref.current);
    return () => io.disconnect();
  }, [onVisible, disabled]);
  return <div ref={ref} style={{ height: 1 }} />;
}
