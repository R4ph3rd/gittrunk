/** Pure wave-shape math for MeshBackdrop. Coordinates live in a 100x100 viewBox (y grows downward). */

export interface WaveLayerSpec {
  /** Baseline y (% from the top) of the crest line; the wave fills below it. */
  base: number;
  /** Two sine components: amplitude (% of height), wavelength (% of width), phase (rad). */
  a1: number;
  l1: number;
  p1: number;
  a2: number;
  l2: number;
  p2: number;
  /** Scroll response: radians of phase shift per px, amplitude modulation depth (0..1) and period (px). */
  speed: number;
  breathe: number;
  period: number;
  /** Share of the intensity alpha this layer paints (the layers stack in the contrast test). */
  weight: number;
}

/** Back layer is taller and slower, front layer lower and faster in the opposite direction. */
export const WAVE_LAYERS: readonly WaveLayerSpec[] = [
  {
    base: 62,
    a1: 7,
    l1: 85,
    p1: 0.6,
    a2: 3.5,
    l2: 38,
    p2: 2.4,
    speed: 0.0032,
    breathe: 0.3,
    period: 2600,
    weight: 0.6,
  },
  {
    base: 72,
    a1: 6,
    l1: 70,
    p1: 3.4,
    a2: 3,
    l2: 30,
    p2: 0.9,
    speed: -0.0046,
    breathe: 0.25,
    period: 1900,
    weight: 1,
  },
];

/** Horizontal overscan (in viewBox units) so blurred side edges stay inside the container. */
export const WAVE_X_MIN = -12;
export const WAVE_X_MAX = 112;
/** The fill closes below the container (clipped) so the blur does not fade the bottom edge. */
export const WAVE_BOTTOM = 140;

const TAU = Math.PI * 2;
const SEGMENTS = 10;

/** Crest height (y) of a layer at x for a scroll position. */
export function waveY(x: number, scrollTop: number, layer: WaveLayerSpec): number {
  const shift = scrollTop * layer.speed;
  const amp = 1 + layer.breathe * Math.sin((TAU * scrollTop) / layer.period + layer.p1);
  return (
    layer.base +
    amp * layer.a1 * Math.sin((TAU * x) / layer.l1 + layer.p1 + shift) +
    amp * layer.a2 * Math.sin((TAU * x) / layer.l2 + layer.p2 - shift * 1.7)
  );
}

const f = (v: number) => v.toFixed(2);

/** Smooth closed path ("M ... C ... L ... Z"): Catmull-Rom curve along the crest, closed below the container. */
export function wavePath(scrollTop: number, layer: WaveLayerSpec): string {
  const step = (WAVE_X_MAX - WAVE_X_MIN) / SEGMENTS;
  const pts: [number, number][] = [];
  for (let i = -1; i <= SEGMENTS + 1; i++) {
    const x = WAVE_X_MIN + i * step;
    pts.push([x, waveY(x, scrollTop, layer)]);
  }
  let d = `M ${f(pts[1]![0])} ${f(pts[1]![1])}`;
  for (let i = 1; i <= SEGMENTS; i++) {
    const p0 = pts[i - 1]!;
    const p1 = pts[i]!;
    const p2 = pts[i + 1]!;
    const p3 = pts[i + 2]!;
    d += ` C ${f(p1[0] + (p2[0] - p0[0]) / 6)} ${f(p1[1] + (p2[1] - p0[1]) / 6)}`;
    d += ` ${f(p2[0] - (p3[0] - p1[0]) / 6)} ${f(p2[1] - (p3[1] - p1[1]) / 6)}`;
    d += ` ${f(p2[0])} ${f(p2[1])}`;
  }
  return `${d} L ${WAVE_X_MAX} ${WAVE_BOTTOM} L ${WAVE_X_MIN} ${WAVE_BOTTOM} Z`;
}
