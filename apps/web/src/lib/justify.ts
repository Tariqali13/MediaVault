export interface Box {
  index: number;
  width: number;
  height: number;
}

export interface Row {
  height: number;
  boxes: Box[];
}

/**
 * Justified rows, like a contact sheet: every image keeps its aspect ratio, every
 * row (except the last) fills the container exactly, and row heights stay close
 * to `targetHeight`. Images are never cropped, which matters for a tool whose
 * users are judging the composition of each image.
 */
export function justify(aspects: number[], containerWidth: number, targetHeight: number, gap: number): Row[] {
  const rows: Row[] = [];
  if (containerWidth <= 0) return rows;
  let start = 0;
  let sum = 0;

  for (let i = 0; i < aspects.length; i++) {
    sum += clampAspect(aspects[i]!);
    const count = i - start + 1;
    const widthAtTarget = sum * targetHeight + gap * (count - 1);
    if (widthAtTarget >= containerWidth) {
      // Scale this row down to fit exactly.
      const height = (containerWidth - gap * (count - 1)) / sum;
      rows.push(makeRow(aspects, start, i, height, containerWidth, gap));
      start = i + 1;
      sum = 0;
    }
  }
  if (start < aspects.length) {
    // Last row: keep the target height rather than blowing up one or two images.
    rows.push(makeRow(aspects, start, aspects.length - 1, targetHeight, null, gap));
  }
  return rows;
}

function makeRow(aspects: number[], from: number, to: number, height: number, fitWidth: number | null, gap: number): Row {
  const boxes: Box[] = [];
  let used = 0;
  for (let i = from; i <= to; i++) {
    const isLast = i === to;
    let width = Math.round(clampAspect(aspects[i]!) * height);
    // Give rounding error to the last box so the row edge is perfectly straight.
    if (isLast && fitWidth !== null) width = Math.round(fitWidth - used);
    boxes.push({ index: i, width, height: Math.round(height) });
    used += width + gap;
  }
  return { height: Math.round(height), boxes };
}

/** Very tall or very wide images would otherwise dominate or vanish. */
function clampAspect(a: number): number {
  if (!Number.isFinite(a) || a <= 0) return 1;
  return Math.min(3, Math.max(0.5, a));
}
