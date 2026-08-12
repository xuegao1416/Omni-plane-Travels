export type DawnV4Mode = 'panel' | 'compact';
export type DawnV4BorderLayer = 'front' | 'behind-content';
export type RailAxis = 'x' | 'y';
export type DawnV4SourceBox = readonly [number, number, number, number];

export interface DawnV4AlphaAudit {
  localAxis: 'x' | 'y';
  localCoordinate: number;
  masterCoordinate: number;
  expectedMaxAlpha: number;
}

export interface DawnV4RailSegment {
  id: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'left-upper' | 'left-lower' | 'right-upper' | 'right-lower';
  rail: 'top' | 'bottom' | 'left' | 'right';
  axis: RailAxis;
  sourceBox: DawnV4SourceBox;
  alphaAudit?: DawnV4AlphaAudit;
}

export interface DawnV4OverlayPiece {
  id: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'top-center' | 'bottom-center' | 'left-center' | 'right-center';
  kind: 'corner' | 'center-decoration';
  sourceBox: DawnV4SourceBox;
  edge?: 'top' | 'bottom' | 'left' | 'right';
}

export interface DawnV4PieceLayout {
  sourceBox: DawnV4SourceBox;
  rect: { left: number; top: number; width: number; height: number };
  axis?: RailAxis;
  visible: boolean;
  role: 'rail-segment' | 'corner' | 'center-decoration';
}

export interface DawnV4Layout {
  width: number;
  height: number;
  scale: number;
  pieces: Record<string, DawnV4PieceLayout>;
}

export interface DawnV4AssemblyPlan {
  source: 'frame-alpha.png';
  sourceSize: { width: 1536; height: 1024 };
  railLayerMode: 'segmented-overlap';
  renderCompleteRailUnderlays: true;
  injectsBackground: false;
  fillRequiresExplicitOptIn: true;
}

export interface DawnV4LayerOrder {
  fill: number;
  content: number;
  border: number;
}

export const DAWN_V4_SOURCE_SIZE = { width: 1536, height: 1024 } as const;
export const DAWN_V4_MASTER_ATLAS = '/art/theme/ui-kit/dawn-v4/frame-alpha.png' as const;
/**
 * CSS-pixel overlap used where a stretchable rail passes under a corner cap.
 * Exact geometric contact is not enough because the atlas crop has transparent
 * edge pixels; the cap must cover a real strip of rail.
 */
export const DAWN_V4_RAIL_OVERLAP_PX = 8;

export function getDawnV4LayerOrder(borderLayer: DawnV4BorderLayer): DawnV4LayerOrder {
  return borderLayer === 'behind-content'
    ? { fill: 0, border: 10, content: 20 }
    : { fill: 0, content: 10, border: 20 };
}

/**
 * These are source-space windows, not resized copies of the old rail slices.
 * Their half-open boundaries stop at each corner/center sourceBox, so a source
 * pixel belongs to exactly one rendered window.
 */
export const DAWN_V4_RAIL_SEGMENTS: readonly DawnV4RailSegment[] = [
  { id: 'top-left', rail: 'top', axis: 'x', sourceBox: [252, 35, 676, 107] },
  { id: 'top-right', rail: 'top', axis: 'x', sourceBox: [860, 35, 1284, 107] },
  { id: 'bottom-left', rail: 'bottom', axis: 'x', sourceBox: [252, 917, 676, 989] },
  { id: 'bottom-right', rail: 'bottom', axis: 'x', sourceBox: [860, 917, 1284, 989] },
  { id: 'left-upper', rail: 'left', axis: 'y', sourceBox: [32, 252, 102, 426] },
  {
    id: 'left-lower',
    rail: 'left',
    axis: 'y',
    sourceBox: [32, 598, 102, 764],
    alphaAudit: { localAxis: 'x', localCoordinate: 11, masterCoordinate: 43, expectedMaxAlpha: 0 },
  },
  { id: 'right-upper', rail: 'right', axis: 'y', sourceBox: [1434, 252, 1504, 426] },
  { id: 'right-lower', rail: 'right', axis: 'y', sourceBox: [1434, 598, 1504, 764] },
];

export const DAWN_V4_OVERLAY_PIECES: readonly DawnV4OverlayPiece[] = [
  { id: 'top-left', kind: 'corner', sourceBox: [4, 4, 252, 252] },
  { id: 'top-right', kind: 'corner', sourceBox: [1284, 4, 1532, 252] },
  { id: 'bottom-left', kind: 'corner', sourceBox: [4, 764, 252, 1020] },
  { id: 'bottom-right', kind: 'corner', sourceBox: [1284, 764, 1532, 1020] },
  { id: 'top-center', kind: 'center-decoration', edge: 'top', sourceBox: [676, 4, 860, 134] },
  { id: 'bottom-center', kind: 'center-decoration', edge: 'bottom', sourceBox: [676, 890, 860, 1020] },
  { id: 'left-center', kind: 'center-decoration', edge: 'left', sourceBox: [8, 426, 122, 598] },
  { id: 'right-center', kind: 'center-decoration', edge: 'right', sourceBox: [1414, 426, 1528, 598] },
];

const SOURCE_BOX_BY_ID = Object.fromEntries([
  ...DAWN_V4_RAIL_SEGMENTS.map(piece => [piece.id, piece]),
  ...DAWN_V4_OVERLAY_PIECES.map(piece => [piece.id, piece]),
]);

function rectFromSourceBox(sourceBox: DawnV4SourceBox) {
  const [left, top, right, bottom] = sourceBox;
  return { left, top, width: right - left, height: bottom - top };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeDimension(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function visibleForMode(id: string, mode: DawnV4Mode) {
  return mode === 'panel' || !id.endsWith('-center');
}

/**
 * Source-ratio layout: art scale comes from the corner art size; positions
 * come from sourceBox relationships and the available container gaps.
 */
export function getDawnV4Layout(width: number, height: number, mode: DawnV4Mode): DawnV4Layout {
  const safeWidth = normalizeDimension(width);
  const safeHeight = normalizeDimension(height);
  const widthCornerCss = clamp(64, safeWidth * 0.068, 76);
  // The source corners are 248px + 256px tall. Panel art must fit both
  // dimensions; width-only scaling makes short save cards overlap vertically.
  const heightCornerCss = safeHeight * (248 / (248 + 256));
  const maxCornerWidth = safeWidth / 2;
  const cornerCss = mode === 'compact'
    ? Math.min(22, safeHeight * 0.58, maxCornerWidth, heightCornerCss)
    : Math.min(widthCornerCss, maxCornerWidth, heightCornerCss);
  const scale = cornerCss / 248;
  const cornerTopHeight = 248 * scale;
  const cornerBottomHeight = 256 * scale;
  const centerWidth = 184 * scale;
  const centerHeight = 130 * scale;
  const sideCenterWidth = 114 * scale;
  const sideCenterHeight = 172 * scale;
  const sideCenterTop = Math.max(0, (safeHeight - sideCenterHeight) / 2);
  const sideCenterBottom = sideCenterTop + sideCenterHeight;
  const horizontalCenterLeft = Math.max(0, (safeWidth - centerWidth) / 2);
  const horizontalCenterRight = horizontalCenterLeft + centerWidth;
  // Compact controls intentionally hide the four center ornaments. Let both
  // rail halves meet at the exact midpoint so the edge stays continuous
  // without reintroducing a gem.
  const horizontalRailSplitLeft = mode === 'compact' ? safeWidth / 2 : horizontalCenterLeft;
  const horizontalRailSplitRight = mode === 'compact' ? safeWidth / 2 : horizontalCenterRight;
  const verticalRailSplitTop = mode === 'compact' ? safeHeight / 2 : sideCenterTop;
  const verticalRailSplitBottom = mode === 'compact' ? safeHeight / 2 : sideCenterBottom;
  const seamOverlap = DAWN_V4_RAIL_OVERLAP_PX;
  const topGapLeft = Math.max(0, horizontalRailSplitLeft - cornerCss);
  const topGapRight = Math.max(0, safeWidth - cornerCss - horizontalRailSplitRight);
  const bottomCornerTop = Math.max(0, safeHeight - cornerBottomHeight);

  const pieces: Record<string, DawnV4PieceLayout> = {};
  const add = (
    id: string,
    rect: { left: number; top: number; width: number; height: number },
    sourceBox: DawnV4SourceBox,
    role: DawnV4PieceLayout['role'],
    axis?: RailAxis,
  ) => {
    pieces[id] = { sourceBox, rect, role, axis, visible: visibleForMode(id, mode) && rect.width > 0 && rect.height > 0 };
  };

  add('overlay-top-left', { left: 0, top: 0, width: cornerCss, height: cornerTopHeight }, SOURCE_BOX_BY_ID['top-left'].sourceBox, 'corner');
  add('overlay-top-right', { left: Math.max(0, safeWidth - cornerCss), top: 0, width: cornerCss, height: cornerTopHeight }, SOURCE_BOX_BY_ID['top-right'].sourceBox, 'corner');
  add('overlay-bottom-left', { left: 0, top: bottomCornerTop, width: cornerCss, height: cornerBottomHeight }, SOURCE_BOX_BY_ID['bottom-left'].sourceBox, 'corner');
  add('overlay-bottom-right', { left: Math.max(0, safeWidth - cornerCss), top: bottomCornerTop, width: cornerCss, height: cornerBottomHeight }, SOURCE_BOX_BY_ID['bottom-right'].sourceBox, 'corner');

  add('overlay-top-center', { left: horizontalCenterLeft, top: 0, width: centerWidth, height: centerHeight }, SOURCE_BOX_BY_ID['top-center'].sourceBox, 'center-decoration');
  add('overlay-bottom-center', { left: horizontalCenterLeft, top: Math.max(0, safeHeight - centerHeight), width: centerWidth, height: centerHeight }, SOURCE_BOX_BY_ID['bottom-center'].sourceBox, 'center-decoration');
  add('overlay-left-center', { left: 4 * scale, top: sideCenterTop, width: sideCenterWidth, height: sideCenterHeight }, SOURCE_BOX_BY_ID['left-center'].sourceBox, 'center-decoration');
  add('overlay-right-center', { left: Math.max(0, safeWidth - 4 * scale - sideCenterWidth), top: sideCenterTop, width: sideCenterWidth, height: sideCenterHeight }, SOURCE_BOX_BY_ID['right-center'].sourceBox, 'center-decoration');

  // Each rail extends under both adjacent caps/decorations. The cap pieces
  // remain above the z2 rails, so this overlap is invisible but closes the
  // alpha seam at all four corners and center decorations.
  add('top-left', { left: Math.max(0, cornerCss - seamOverlap), top: 31 * scale, width: topGapLeft + 2 * seamOverlap, height: 72 * scale }, DAWN_V4_RAIL_SEGMENTS[0].sourceBox, 'rail-segment', 'x');
  add('top-right', { left: Math.max(0, horizontalRailSplitRight - seamOverlap), top: 31 * scale, width: topGapRight + 2 * seamOverlap, height: 72 * scale }, DAWN_V4_RAIL_SEGMENTS[1].sourceBox, 'rail-segment', 'x');
  add('bottom-left', { left: Math.max(0, cornerCss - seamOverlap), top: Math.max(0, safeHeight - 31 * scale - 72 * scale), width: topGapLeft + 2 * seamOverlap, height: 72 * scale }, DAWN_V4_RAIL_SEGMENTS[2].sourceBox, 'rail-segment', 'x');
  add('bottom-right', { left: Math.max(0, horizontalRailSplitRight - seamOverlap), top: Math.max(0, safeHeight - 31 * scale - 72 * scale), width: topGapRight + 2 * seamOverlap, height: 72 * scale }, DAWN_V4_RAIL_SEGMENTS[3].sourceBox, 'rail-segment', 'x');
  add('left-upper', { left: 28 * scale, top: Math.max(0, cornerTopHeight - seamOverlap), width: 70 * scale, height: Math.max(0, verticalRailSplitTop - cornerTopHeight) + 2 * seamOverlap }, DAWN_V4_RAIL_SEGMENTS[4].sourceBox, 'rail-segment', 'y');
  add('left-lower', { left: 28 * scale, top: Math.max(0, verticalRailSplitBottom - seamOverlap), width: 70 * scale, height: Math.max(0, bottomCornerTop - verticalRailSplitBottom) + 2 * seamOverlap }, DAWN_V4_RAIL_SEGMENTS[5].sourceBox, 'rail-segment', 'y');
  add('right-upper', { left: Math.max(0, safeWidth - cornerCss + 150 * scale), top: Math.max(0, cornerTopHeight - seamOverlap), width: 70 * scale, height: Math.max(0, verticalRailSplitTop - cornerTopHeight) + 2 * seamOverlap }, DAWN_V4_RAIL_SEGMENTS[6].sourceBox, 'rail-segment', 'y');
  add('right-lower', { left: Math.max(0, safeWidth - cornerCss + 150 * scale), top: Math.max(0, verticalRailSplitBottom - seamOverlap), width: 70 * scale, height: Math.max(0, bottomCornerTop - verticalRailSplitBottom) + 2 * seamOverlap }, DAWN_V4_RAIL_SEGMENTS[7].sourceBox, 'rail-segment', 'y');

  return { width: safeWidth, height: safeHeight, scale, pieces };
}

export function getDawnV4AssemblyPlan(): DawnV4AssemblyPlan {
  return {
    source: 'frame-alpha.png',
    sourceSize: DAWN_V4_SOURCE_SIZE,
    railLayerMode: 'segmented-overlap',
    renderCompleteRailUnderlays: true,
    injectsBackground: false,
    fillRequiresExplicitOptIn: true,
  };
}
