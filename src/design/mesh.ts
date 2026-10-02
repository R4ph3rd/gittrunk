/** Pure shape and parallax math for MeshBackdrop. */

export interface BlobSpec {
  /** Token index 1..3 (--backdrop-N). */
  color: 1 | 2 | 3;
  /** Position and size in % of the container. */
  x: number;
  y: number;
  size: number;
  /** Parallax: horizontal and vertical amplitude in px, period in px of scroll, phase in radians. */
  ampX: number;
  ampY: number;
  period: number;
  phase: number;
  seed: number;
}

export const BLOBS: readonly BlobSpec[] = [
  { color: 1, x: -12, y: -18, size: 62, ampX: 90, ampY: 18, period: 1800, phase: 0, seed: 11 },
  { color: 2, x: 38, y: 22, size: 70, ampX: 70, ampY: 14, period: 2400, phase: 2.1, seed: 23 },
  { color: 3, x: 62, y: -10, size: 54, ampX: 55, ampY: 20, period: 1300, phase: 4.2, seed: 37 },
];

/** Small deterministic PRNG returning values in [0, 1). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number) => Math.min(100, Math.max(0, v));
const fmt = (v: number) => clamp(v).toFixed(2);

/** Smooth closed SVG path ("M ... C ... Z") of a wavy organic blob in a 100x100 box. Deterministic per seed. */
export function blobPath(seed: number, points = 7): string {
  const n = Math.min(8, Math.max(6, Math.round(points)));
  const rand = mulberry32(seed);
  const pts: [number, number][] = [];
  const offset = rand() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const angle = offset + (i / n) * Math.PI * 2;
    const r = 26 + rand() * 18; // 26..44
    pts.push([50 + Math.cos(angle) * r, 50 + Math.sin(angle) * r]);
  }
  const at = (i: number) => pts[((i % n) + n) % n]!;
  let d = `M ${fmt(at(0)[0])} ${fmt(at(0)[1])}`;
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1[0] + (p2[0] - p0[0]) / 6;
    const c1y = p1[1] + (p2[1] - p0[1]) / 6;
    const c2x = p2[0] - (p3[0] - p1[0]) / 6;
    const c2y = p2[1] - (p3[1] - p1[1]) / 6;
    d += ` C ${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(p2[0])} ${fmt(p2[1])}`;
  }
  return `${d} Z`;
}

/** Parallax offset for a scroll position. Bounded: |x| <= ampX, |y| <= ampY. */
export function blobOffset(scrollTop: number, blob: BlobSpec): { x: number; y: number } {
  const tau = Math.PI * 2;
  return {
    x: blob.ampX * Math.sin((tau * scrollTop) / blob.period + blob.phase),
    y: blob.ampY * Math.sin((tau * scrollTop) / (1.6 * blob.period) + blob.phase),
  };
}
