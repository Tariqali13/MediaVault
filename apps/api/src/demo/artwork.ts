/**
 * Procedural artwork for the demo library, rendered from SVG with sharp at boot.
 * No stock photos, no licensing questions, and every visitor sees real image
 * processing (thumbnails, previews, dominant colours) run on real files.
 */

export interface SeedItem {
  slug: string;
  title: string;
  description: string;
  tags: string[];
  width: number;
  height: number;
  svg: string;
  collections: string[];
  daysAgo: number;
}

type Palette = [string, string, string, string];

const PALETTES: Record<string, Palette> = {
  dusk: ['#2b2d6e', '#e86a5c', '#f6b26b', '#fbe3c4'],
  harbour: ['#0f3d4c', '#2f8f9d', '#a8dadc', '#f1faee'],
  meadow: ['#264027', '#6a994e', '#a7c957', '#f2e8cf'],
  ember: ['#3d0c11', '#9e2a2b', '#e09f3e', '#fff3b0'],
  frost: ['#1d3557', '#457b9d', '#a8c5da', '#edf2f4'],
  citrus: ['#1b4332', '#ffb703', '#fb8500', '#fef9ef'],
  plum: ['#3c1642', '#7d3c98', '#e0aaff', '#f7ebff'],
  ink: ['#14213d', '#fca311', '#e5e5e5', '#ffffff'],
};

function rng(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/** A layered landscape: sky gradient, sun, three ridges of hills. */
function landscape(w: number, h: number, p: Palette, seed: number): string {
  const r = rng(seed);
  const ridge = (base: number, amp: number, color: string) => {
    const pts: string[] = [`0,${h}`];
    for (let x = 0; x <= w; x += w / 12) pts.push(`${x.toFixed(0)},${(base + Math.sin(x / (w / (2 + r() * 3)) + r() * 6) * amp).toFixed(0)}`);
    pts.push(`${w},${h}`);
    return `<polygon points="${pts.join(' ')}" fill="${color}"/>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${p[0]}"/><stop offset="0.7" stop-color="${p[2]}"/><stop offset="1" stop-color="${p[3]}"/></linearGradient></defs>
  <rect width="${w}" height="${h}" fill="url(#sky)"/>
  <circle cx="${(w * (0.25 + r() * 0.5)).toFixed(0)}" cy="${(h * 0.42).toFixed(0)}" r="${(Math.min(w, h) * 0.09).toFixed(0)}" fill="${p[3]}" opacity="0.92"/>
  ${ridge(h * 0.62, h * 0.05, p[1])}${ridge(h * 0.72, h * 0.04, p[0])}${ridge(h * 0.84, h * 0.03, '#00000055')}
</svg>`;
}

/** Bauhaus-ish poster: overlapping primitives on a solid ground. */
function poster(w: number, h: number, p: Palette, seed: number): string {
  const r = rng(seed);
  const shapes: string[] = [];
  for (let i = 0; i < 7; i++) {
    const c = p[1 + Math.floor(r() * 3)]!;
    const x = r() * w;
    const y = r() * h;
    const s = Math.min(w, h) * (0.15 + r() * 0.35);
    shapes.push(
      i % 3 === 0
        ? `<circle cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="${(s / 2).toFixed(0)}" fill="${c}" opacity="0.9"/>`
        : i % 3 === 1
          ? `<rect x="${x.toFixed(0)}" y="${y.toFixed(0)}" width="${s.toFixed(0)}" height="${(s * 0.6).toFixed(0)}" fill="${c}" transform="rotate(${(r() * 40 - 20).toFixed(0)} ${x.toFixed(0)} ${y.toFixed(0)})"/>`
          : `<polygon points="${x.toFixed(0)},${(y - s / 2).toFixed(0)} ${(x + s / 2).toFixed(0)},${(y + s / 2).toFixed(0)} ${(x - s / 2).toFixed(0)},${(y + s / 2).toFixed(0)}" fill="${c}"/>`,
    );
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" fill="${p[0]}"/>${shapes.join('')}</svg>`;
}

/** Soft gradient mesh used for "texture" studies. */
function texture(w: number, h: number, p: Palette, seed: number): string {
  const r = rng(seed);
  const blobs = Array.from({ length: 5 }, (_, i) => {
    const c = p[i % 4]!;
    return `<circle cx="${(r() * w).toFixed(0)}" cy="${(r() * h).toFixed(0)}" r="${(Math.max(w, h) * (0.25 + r() * 0.3)).toFixed(0)}" fill="${c}" opacity="0.75"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="${(Math.min(w, h) / 9).toFixed(0)}"/></filter></defs>
  <rect width="${w}" height="${h}" fill="${p[3]}"/><g filter="url(#b)">${blobs}</g>
</svg>`;
}

interface Spec {
  slug: string;
  title: string;
  palette: keyof typeof PALETTES;
  kind: 'landscape' | 'poster' | 'texture';
  size: [number, number];
  tags: string[];
  collections?: string[];
  daysAgo: number;
  description?: string;
}

const SPECS: Spec[] = [
  { slug: 'harbour-dawn', title: 'Harbour at dawn', palette: 'harbour', kind: 'landscape', size: [2400, 1600], tags: ['landscape', 'campaign', 'approved'], collections: ['Spring campaign'], daysAgo: 0, description: 'Hero option A for the spring landing page.' },
  { slug: 'dusk-ridge', title: 'Dusk ridge', palette: 'dusk', kind: 'landscape', size: [2400, 1600], tags: ['landscape', 'campaign'], collections: ['Spring campaign'], daysAgo: 0, description: 'Hero option B, warmer grade.' },
  { slug: 'meadow-wide', title: 'Meadow, wide crop', palette: 'meadow', kind: 'landscape', size: [3000, 1688], tags: ['landscape', 'social'], collections: ['Spring campaign'], daysAgo: 1 },
  { slug: 'frost-valley', title: 'Frost valley', palette: 'frost', kind: 'landscape', size: [1600, 2400], tags: ['landscape', 'print'], daysAgo: 2, description: 'Portrait crop for the print run.' },
  { slug: 'ember-hills', title: 'Ember hills', palette: 'ember', kind: 'landscape', size: [2400, 1600], tags: ['landscape'], daysAgo: 3 },
  { slug: 'poster-citrus', title: 'Citrus festival poster', palette: 'citrus', kind: 'poster', size: [1800, 2546], tags: ['poster', 'print', 'approved'], collections: ['Posters'], daysAgo: 1 },
  { slug: 'poster-ink', title: 'Night market poster', palette: 'ink', kind: 'poster', size: [1800, 2546], tags: ['poster', 'print'], collections: ['Posters'], daysAgo: 4 },
  { slug: 'poster-plum', title: 'Jazz series poster', palette: 'plum', kind: 'poster', size: [1800, 2546], tags: ['poster', 'review'], collections: ['Posters'], daysAgo: 6, description: 'Waiting on type changes from the client.' },
  { slug: 'poster-ember', title: 'Ceramics fair poster', palette: 'ember', kind: 'poster', size: [1800, 2546], tags: ['poster'], collections: ['Posters'], daysAgo: 9 },
  { slug: 'square-harbour', title: 'Harbour square crop', palette: 'harbour', kind: 'poster', size: [1800, 1800], tags: ['social', 'campaign'], collections: ['Spring campaign'], daysAgo: 0 },
  { slug: 'texture-dusk', title: 'Texture study, dusk', palette: 'dusk', kind: 'texture', size: [2000, 2000], tags: ['texture', 'brand'], collections: ['Brand textures'], daysAgo: 5 },
  { slug: 'texture-frost', title: 'Texture study, frost', palette: 'frost', kind: 'texture', size: [2000, 2000], tags: ['texture', 'brand'], collections: ['Brand textures'], daysAgo: 5 },
  { slug: 'texture-plum', title: 'Texture study, plum', palette: 'plum', kind: 'texture', size: [2400, 1350], tags: ['texture', 'brand', 'approved'], collections: ['Brand textures'], daysAgo: 7 },
  { slug: 'texture-meadow', title: 'Texture study, meadow', palette: 'meadow', kind: 'texture', size: [2400, 1350], tags: ['texture'], collections: ['Brand textures'], daysAgo: 8 },
  { slug: 'texture-citrus', title: 'Texture study, citrus', palette: 'citrus', kind: 'texture', size: [1600, 2000], tags: ['texture', 'review'], daysAgo: 10 },
  { slug: 'ink-ridge', title: 'Ink ridge', palette: 'ink', kind: 'landscape', size: [2400, 1600], tags: ['landscape', 'review'], daysAgo: 12 },
];

const RENDER = { landscape, poster, texture };

export function seedItems(): SeedItem[] {
  return SPECS.map((spec, i) => {
    const [width, height] = spec.size;
    return {
      slug: spec.slug,
      title: spec.title,
      description: spec.description ?? '',
      tags: spec.tags,
      collections: spec.collections ?? [],
      daysAgo: spec.daysAgo,
      width,
      height,
      svg: RENDER[spec.kind](width, height, PALETTES[spec.palette]!, i + 7),
    };
  });
}

/** A tiny but valid one-page PDF: the brand guidelines "document" in the demo library. */
export function seedPdf(): Buffer {
  const text = 'Northwind Studio brand guidelines (demo)';
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${44 + text.length} >>\nstream\nBT /F1 24 Tf 60 760 Td (${text}) Tj ET\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  body += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, 'latin1');
}
