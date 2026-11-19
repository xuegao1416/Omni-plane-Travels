/**
 * Orbit geometry for the planar orrery. Pure functions so the layout can be
 * tested without a DOM: the hall measures its stage and asks where each lens
 * belongs, instead of relying on per-aspect-ratio calibration tables.
 *
 * Landscape: two arcs of three lenses flank the astrolabe.
 * Portrait / near-square: a flat-topped hexagon (two lenses top, two bottom, one each side).
 * The astrolabe is sized last, from the room the lenses leave, so it never
 * overlaps them.
 */

export interface StageSize {
  width: number;
  height: number;
}

export interface OrbitGeometry {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Diameter of a world lens in px. */
  lens: number;
  /** Diameter of the central astrolabe in px. */
  core: number;
  /** Slot angles in degrees (0 = right, clockwise positive). */
  angles: readonly number[];
  portrait: boolean;
}

export interface OrbitSlot {
  x: number;
  y: number;
  angle: number;
  /** -1 (top/back) … 1 (bottom/front); drives depth scaling. */
  depth: number;
}

const LANDSCAPE_ANGLES = [-50, 0, 50, 130, 180, 230] as const;
const PORTRAIT_ANGLES = [-60, 0, 60, 120, 180, 240] as const;
/** Breathing room between a caption and the next lens (also absorbs depth/hover scale). */
const PAD = 12;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Vertical room a lens needs below its centre: half disc + caption. */
export const captionDrop = (lens: number) => lens * 0.5 + lens * 0.42 + 18;
/** Half-width of the caption block (captions are 150% of the lens). */
export const captionHalfWidth = (lens: number) => lens * 0.75;

export function getOrbitGeometry({ width, height }: StageSize): OrbitGeometry {
  const w = Math.max(width, 1);
  const h = Math.max(height, 1);
  const portrait = w < h * 1.18;
  const short = Math.min(w, h);
  const angles = portrait ? PORTRAIT_ANGLES : LANDSCAPE_ANGLES;
  const sinMax = Math.max(...angles.map(a => Math.sin(rad(a))));

  let lens: number;
  let rx: number;
  let ry: number;
  if (portrait) {
    // Side slots sit at the stage edge with their caption on screen; the two top
    // slots (±0.5·rx) need 1.5·lens + PAD between them ⇒ rx ≥ 1.5·lens + PAD.
    // With rx = w/2 − 0.75·lens − 4 that gives lens ≤ (w/2 − 4 − PAD) / 2.25.
    // Vertically, ry·sin60 must clear lens + caption: lens ≤ (h/2 − 36 − PAD) / 2.34.
    lens = clamp(Math.min(short * 0.28, (w / 2 - 4 - PAD) / 2.25, (h / 2 - 36 - PAD) / 2.34), 64, 210);
    rx = w / 2 - captionHalfWidth(lens) - 4;
    ry = Math.max(lens, (h / 2 - captionDrop(lens)) / sinMax);
  } else {
    // Vertical gap between an outer slot and the middle slot must clear lens + caption:
    // ry·sinMax ≥ 1.42·lens + 18 + PAD and ry·sinMax ≤ h/2 − captionDrop ⇒ lens ≤ (h/2 − 36 − PAD) / 2.34.
    lens = clamp(Math.min(short * 0.24, (h / 2 - 36 - PAD) / 2.34), 80, 240);
    ry = Math.max(lens * 0.8, (h / 2 - captionDrop(lens)) / sinMax);
    rx = clamp(w * 0.35, lens * 2.2, w / 2 - captionHalfWidth(lens) - 4);
  }

  const geometry: OrbitGeometry = { cx: w / 2, cy: h / 2, rx, ry, lens, core: 0, angles, portrait };
  const nearest = Math.min(...angles.map((_, index) => {
    const slot = getOrbitSlot(geometry, index);
    return Math.hypot(slot.x - geometry.cx, slot.y - geometry.cy);
  }));
  const coreTarget = short * (portrait ? 0.56 : 0.64);
  geometry.core = clamp(Math.min(coreTarget, (nearest - lens * 0.5 - 16) * 2), 120, 680);
  return geometry;
}

export function getOrbitSlot(geometry: OrbitGeometry, index: number): OrbitSlot {
  const angle = geometry.angles[index % geometry.angles.length];
  const sin = Math.sin(rad(angle));
  return {
    x: geometry.cx + Math.cos(rad(angle)) * geometry.rx,
    y: geometry.cy + sin * geometry.ry,
    angle,
    depth: sin,
  };
}
