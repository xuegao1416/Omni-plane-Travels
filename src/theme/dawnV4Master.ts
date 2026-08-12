export type DawnV4MasterPiece =
  | 'top-left'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-right'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'top-center'
  | 'bottom-center'
  | 'left-center'
  | 'right-center';

export interface DawnV4MasterGeometry {
  center: { x: number; y: number };
  offsetPx: { x: number; y: number };
  size: { width: number; height: number };
  scale: number;
  opacity: number;
}

/**
 * The user-approved 16:9 calibration baseline. Centers are normalized to the
 * frame container; sizes and offsets are the unscaled logical measurements.
 */
export const DAWN_V4_MASTER = {
  schemaVersion: 1,
  screen: 'v4-frame',
  profile: '16x9',
  viewport: { width: 1699, height: 943 },
  pieces: {
    'top-left': {
      center: { x: 0.0488194680861311, y: 0.0845861028272059 },
      offsetPx: { x: -2, y: -2.888895670572916 },
      size: { width: 76, height: 76 },
      scale: 1,
      opacity: 1,
    },
    'top-right': {
      center: { x: 0.9450027909487445, y: 0.08458584336958648 },
      offsetPx: { x: -2.429, y: -2.889 },
      size: { width: 76, height: 76 },
      scale: 1,
      opacity: 1,
    },
    'bottom-left': {
      center: { x: 0.0488194680861311, y: 0.9132096965885301 },
      offsetPx: { x: -2, y: 2 },
      size: { width: 76, height: 76 },
      scale: 1,
      opacity: 1,
    },
    'bottom-right': {
      center: { x: 0.9450027909487445, y: 0.9132096965885301 },
      offsetPx: { x: -2.429, y: 2 },
      size: { width: 76, height: 76 },
      scale: 1,
      opacity: 1,
    },
    top: {
      center: { x: 0.5000000182430848, y: 0.04215528482306115 },
      offsetPx: { x: 0, y: 8 },
      size: { width: 640, height: 21.979594811509347 },
      scale: 1,
      opacity: 1,
    },
    bottom: {
      center: { x: 0.4999999817569151, y: 0.957211519667493 },
      offsetPx: { x: 0, y: -8.255294204530689 },
      size: { width: 681.998064313616, height: 21.653515306382808 },
      scale: 1,
      opacity: 1,
    },
    left: {
      center: { x: 0.023324477248051565, y: 0.4969686269035757 },
      offsetPx: { x: 8.721950927734376, y: -1.2224524361746396 },
      size: { width: 21.641524231321124, height: 342.5729435511997 },
      scale: 1,
      opacity: 1,
    },
    right: {
      center: { x: 0.9714567538673151, y: 0.5573491500427845 },
      offsetPx: { x: -12.463474807120763, y: 23.127246311732684 },
      size: { width: 21.232399287413163, height: 336.0967298235212 },
      scale: 1,
      opacity: 1,
    },
    'top-center': {
      center: { x: 0.499992733171192, y: 0.03967556727381479 },
      offsetPx: { x: 0, y: -3 },
      size: { width: 54, height: 40 },
      scale: 1,
      opacity: 1,
    },
    'bottom-center': {
      center: { x: 0.499992733171192, y: 0.959379779966101 },
      offsetPx: { x: 0, y: 2.619035993303573 },
      size: { width: 54, height: 39.238071986607146 },
      scale: 1,
      opacity: 1,
    },
    'left-center': {
      center: { x: 0.02201618657840192, y: 0.5038258485431714 },
      offsetPx: { x: -3.216, y: -1.3142827715192489 },
      size: { width: 35.267, height: 48.28570840018137 },
      scale: 1,
      opacity: 1,
    },
    'right-center': {
      center: { x: 0.9719567284121307, y: 0.5070845227303037 },
      offsetPx: { x: -1.105, y: 0 },
      size: { width: 34.7, height: 48.286 },
      scale: 1,
      opacity: 1,
    },
  } satisfies Record<DawnV4MasterPiece, DawnV4MasterGeometry>,
} as const;

export const DAWN_V4_COMPACT_SCALE = 22 / DAWN_V4_MASTER.pieces['top-left'].size.width;
