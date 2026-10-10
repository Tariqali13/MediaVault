import { justify } from './justify';

describe('justify', () => {
  const rowWidth = (r: { boxes: { width: number }[] }, gap: number) => r.boxes.reduce((s, b) => s + b.width, 0) + gap * (r.boxes.length - 1);

  it('fills every full row to the exact container width', () => {
    const rows = justify([1.5, 1.5, 0.66, 1, 1.78, 1.5, 0.75, 1.33, 1, 1.5], 1000, 220, 8);
    for (const row of rows.slice(0, -1)) expect(rowWidth(row, 8)).toBe(1000);
  });

  it('keeps each image’s aspect ratio', () => {
    const aspects = [1.5, 0.75, 1.33, 1, 1.78, 1.5];
    const rows = justify(aspects, 900, 200, 6);
    for (const row of rows) for (const box of row.boxes.slice(0, -1)) expect(box.width / box.height).toBeCloseTo(aspects[box.index]!, 1);
  });

  it('keeps row heights near the target and leaves the last row unstretched', () => {
    const rows = justify([1.5, 1.5, 1.5, 1.5, 1.5], 1000, 200, 0);
    expect(rows[0]!.height).toBeGreaterThan(150);
    expect(rows[0]!.height).toBeLessThanOrEqual(260);
    expect(rows[rows.length - 1]!.height).toBe(200);
  });

  it('includes every item exactly once, in order', () => {
    const aspects = Array.from({ length: 37 }, (_, i) => 0.6 + (i % 5) * 0.3);
    const order = justify(aspects, 1200, 180, 4).flatMap((r) => r.boxes.map((b) => b.index));
    expect(order).toEqual(aspects.map((_, i) => i));
  });

  it('copes with missing or extreme aspect ratios', () => {
    const rows = justify([0, Number.NaN, 20, 0.01], 600, 150, 4);
    expect(rows.flatMap((r) => r.boxes).every((b) => b.width > 0 && Number.isFinite(b.width))).toBe(true);
  });
});
