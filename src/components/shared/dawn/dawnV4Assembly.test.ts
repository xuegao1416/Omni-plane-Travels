import { describe, expect, test } from 'bun:test';
import {
  DAWN_V4_OVERLAY_PIECES,
  DAWN_V4_RAIL_SEGMENTS,
  DAWN_V4_RAIL_OVERLAP_PX,
  getDawnV4AssemblyPlan,
  getDawnV4Layout,
  getDawnV4LayerOrder,
} from './dawnV4Assembly';

describe('Dawn V4 transparent source-ratio assembly', () => {
  test('defines exactly eight rail segments with runtime seam overlap', () => {
    expect(DAWN_V4_RAIL_SEGMENTS.map(segment => segment.id)).toEqual([
      'top-left', 'top-right',
      'bottom-left', 'bottom-right',
      'left-upper', 'left-lower',
      'right-upper', 'right-lower',
    ]);
    expect(DAWN_V4_RAIL_SEGMENTS).toHaveLength(8);
    expect(new Set(DAWN_V4_RAIL_SEGMENTS.map(segment => segment.sourceBox.join(','))).size).toBe(8);
  });

  test('locks the left-lower segment to the audited master box and transparent local x=11', () => {
    const segment = DAWN_V4_RAIL_SEGMENTS.find(item => item.id === 'left-lower');

    expect(segment).toBeDefined();
    expect(segment?.sourceBox).toEqual([32, 598, 102, 764]);
    expect(segment?.alphaAudit).toEqual({
      localAxis: 'x',
      localCoordinate: 11,
      masterCoordinate: 43,
      expectedMaxAlpha: 0,
    });
  });

  test('keeps center decorations as overlays with the fine seam underlay contract', () => {
    const plan = getDawnV4AssemblyPlan();

    expect(DAWN_V4_OVERLAY_PIECES.map(piece => piece.id)).toEqual([
      'top-left', 'top-right', 'bottom-left', 'bottom-right',
      'top-center', 'bottom-center', 'left-center', 'right-center',
    ]);
    expect(plan.renderCompleteRailUnderlays).toBe(true);
    expect(plan.railLayerMode).toBe('segmented-overlap');
  });

  test('uses transparent border composition and source-ratio layout geometry', () => {
    const plan = getDawnV4AssemblyPlan();
    const layout = getDawnV4Layout(1120, 619, 'panel');

    expect(plan.injectsBackground).toBe(false);
    expect(plan.fillRequiresExplicitOptIn).toBe(true);
    expect(layout.scale).toBeGreaterThan(0);
    expect(layout.pieces['left-lower'].sourceBox).toEqual([32, 598, 102, 764]);
    expect(layout.pieces['left-lower'].rect.height).toBeGreaterThan(0);
  });

  test('keeps the decorative border above normal content by default', () => {
    const order = getDawnV4LayerOrder('front');

    expect(order.fill).toBeLessThan(order.content);
    expect(order.content).toBeLessThan(order.border);
  });

  test('extends every rail under both adjacent corner/decorative regions', () => {
    const layout = getDawnV4Layout(1179, 820, 'panel');
    const rect = (id: string) => layout.pieces[id].rect;
    const topLeftCorner = rect('overlay-top-left');
    const topRightCorner = rect('overlay-top-right');
    const bottomLeftCorner = rect('overlay-bottom-left');
    const bottomRightCorner = rect('overlay-bottom-right');
    const rightCenter = rect('overlay-right-center');

    expect(rect('top-left').left).toBeLessThan(topLeftCorner.width);
    expect(rect('top-left').left + rect('top-left').width)
      .toBeGreaterThan(rect('overlay-top-center').left);
    expect(rect('top-right').left).toBeLessThan(
      rect('overlay-top-center').left + rect('overlay-top-center').width,
    );
    expect(rect('top-right').left + rect('top-right').width)
      .toBeGreaterThan(topRightCorner.left);
    expect(rect('bottom-left').left).toBeLessThan(bottomLeftCorner.width);
    expect(rect('bottom-left').left + rect('bottom-left').width)
      .toBeGreaterThan(rect('overlay-bottom-center').left);
    expect(rect('bottom-right').left + rect('bottom-right').width)
      .toBeGreaterThan(bottomRightCorner.left);
    expect(rect('right-upper').top).toBeLessThan(topRightCorner.height);
    expect(rect('right-upper').top + rect('right-upper').height)
      .toBeGreaterThan(rightCenter.top);
    expect(rect('right-lower').top).toBeLessThan(rightCenter.top + rightCenter.height);
    expect(rect('right-lower').top + rect('right-lower').height)
      .toBeGreaterThan(bottomRightCorner.top);
    expect(DAWN_V4_RAIL_OVERLAP_PX).toBe(8);
  });

  test('requires an explicit layer mode for content that intentionally crosses the border', () => {
    const order = getDawnV4LayerOrder('behind-content');

    expect(order.fill).toBeLessThan(order.border);
    expect(order.border).toBeLessThan(order.content);
  });

  test('keeps responsive pieces finite and inside arbitrary panel and compact containers', () => {
    const cases = [
      [1120, 619, 'panel'],
      [720, 480, 'panel'],
      [360, 640, 'panel'],
      [240, 360, 'panel'],
      [240, 36, 'compact'],
      [124, 38, 'compact'],
      [108, 38, 'compact'],
      [42, 42, 'compact'],
    ] as const;

    for (const [width, height, mode] of cases) {
      const layout = getDawnV4Layout(width, height, mode);
      for (const piece of Object.values(layout.pieces).filter(item => item.visible)) {
        const { left, top, width: pieceWidth, height: pieceHeight } = piece.rect;
        expect([left, top, pieceWidth, pieceHeight].every(Number.isFinite)).toBe(true);
        expect(left).toBeGreaterThanOrEqual(0);
        expect(top).toBeGreaterThanOrEqual(0);
        expect(pieceWidth).toBeGreaterThan(0);
        expect(pieceHeight).toBeGreaterThan(0);
        expect(left + pieceWidth).toBeLessThanOrEqual(width + 0.001);
        expect(top + pieceHeight).toBeLessThanOrEqual(height + 0.001);
      }
    }
  });

  test('constrains panel corner geometry by both width and height on short save cards', () => {
    for (const [width, height] of [[300, 87], [300, 106], [320, 120], [360, 144]] as const) {
      const layout = getDawnV4Layout(width, height, 'panel');
      const topLeft = layout.pieces['overlay-top-left'].rect;
      const bottomLeft = layout.pieces['overlay-bottom-left'].rect;

      expect(topLeft.height + bottomLeft.height).toBeLessThanOrEqual(height + 0.001);
      expect(topLeft.left + topLeft.width).toBeLessThanOrEqual(width + 0.001);
      expect(bottomLeft.top + bottomLeft.height).toBeLessThanOrEqual(height + 0.001);
    }
  });

  test('fills compact top and bottom rails through the hidden ornament gap', () => {
    const layout = getDawnV4Layout(108, 38, 'compact');
    const topLeft = layout.pieces['top-left'].rect;
    const topRight = layout.pieces['top-right'].rect;
    const bottomLeft = layout.pieces['bottom-left'].rect;
    const bottomRight = layout.pieces['bottom-right'].rect;

    expect(topLeft.left + topLeft.width).toBeGreaterThanOrEqual(topRight.left);
    expect(bottomLeft.left + bottomLeft.width).toBeGreaterThanOrEqual(bottomRight.left);
    expect(topLeft.left + topLeft.width - topRight.left).toBeLessThanOrEqual(2 * DAWN_V4_RAIL_OVERLAP_PX);
    expect(bottomLeft.left + bottomLeft.width - bottomRight.left).toBeLessThanOrEqual(2 * DAWN_V4_RAIL_OVERLAP_PX);
    expect(layout.pieces['overlay-top-center'].visible).toBe(false);
    expect(layout.pieces['overlay-bottom-center'].visible).toBe(false);
  });

  test('scales compact corner art down with shorter mobile controls', () => {
    const desktopCompact = getDawnV4Layout(108, 38, 'compact');
    const mobileCompact = getDawnV4Layout(108, 32, 'compact');

    expect(mobileCompact.scale).toBeLessThan(desktopCompact.scale);
    expect(mobileCompact.pieces['overlay-top-left'].rect.width).toBeLessThan(desktopCompact.pieces['overlay-top-left'].rect.width);
  });

  test('normalizes invalid and tiny containers for both frame modes', () => {
    const cases = [
      [Number.NaN, Number.NaN],
      [Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY],
      [Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY],
      [-1, -2],
      [0, 0],
      [Number.MIN_VALUE, Number.MIN_VALUE],
      [1, 1],
    ] as const;

    for (const [width, height] of cases) {
      for (const mode of ['panel', 'compact'] as const) {
        const layout = getDawnV4Layout(width, height, mode);
        expect(Number.isFinite(layout.width)).toBe(true);
        expect(Number.isFinite(layout.height)).toBe(true);
        expect(Number.isFinite(layout.scale)).toBe(true);
        expect(layout.width).toBeGreaterThanOrEqual(0);
        expect(layout.height).toBeGreaterThanOrEqual(0);
        for (const piece of Object.values(layout.pieces)) {
          const { left, top, width: pieceWidth, height: pieceHeight } = piece.rect;
          expect([left, top, pieceWidth, pieceHeight].every(Number.isFinite)).toBe(true);
          expect(left).toBeGreaterThanOrEqual(0);
          expect(top).toBeGreaterThanOrEqual(0);
          expect(pieceWidth).toBeGreaterThanOrEqual(0);
          expect(pieceHeight).toBeGreaterThanOrEqual(0);
        }
        const topCorner = layout.pieces['overlay-top-left'].rect;
        const bottomCorner = layout.pieces['overlay-bottom-left'].rect;
        expect(topCorner.width).toBeLessThanOrEqual(layout.width / 2 + Number.EPSILON);
        expect(bottomCorner.width).toBeLessThanOrEqual(layout.width / 2 + Number.EPSILON);
        expect(topCorner.height + bottomCorner.height).toBeLessThanOrEqual(layout.height + Number.EPSILON);
      }
    }
  });
});
