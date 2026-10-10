/** A frame with a grease-pencil circle in the corner: the "select" mark. */
export function Wordmark({ size = 26, light = false }: { size?: number; light?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="4" y="7" width="20" height="18" rx="2" fill="none" stroke={light ? '#fff' : 'currentColor'} strokeWidth="2.4" />
      <path d="M21 6.5c3.5-1.6 7.6.6 7.4 4.6-.2 3.8-4.7 5.6-7.6 3.9-2.8-1.7-2.3-6.4.8-7.6" fill="none" stroke="#E03A2F" strokeWidth="2.4" strokeLinecap="round" />
    </svg>
  );
}

/** The grease-pencil loop drawn around a picked tile. */
export function PencilMark() {
  return <span className="mark" aria-hidden="true" />;
}
