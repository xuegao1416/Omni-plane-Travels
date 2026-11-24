/**
 * 消息菜单（右键 / 长按）放在哪里。
 *
 * - 鼠标：左上角对准光标；右边放不下就放到光标左边，下面放不下就放到光标上面。
 * - 触屏：水平居中在手指上，放在手指上方，不被手指挡住；上方放不下才放到手指下方。
 * 最后都夹在可见区域内（留出边距），保证整个菜单不用滚动就能看到。
 */
export type ContextMenuSource = 'mouse' | 'touch';

export interface ContextMenuBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface ContextMenuPlacement {
  left: number;
  top: number;
  /** 弹出动画的缩放原点，对着光标 / 手指。 */
  transformOrigin: string;
}

const EDGE = 8;
/** 手指接触点到菜单底边的距离：指腹大约 20px 高，再留一点空。 */
const FINGER_GAP_ABOVE = 28;
/** 放到手指下方时让开指腹。 */
const FINGER_GAP_BELOW = 36;
const CURSOR_GAP = 2;

function clamp(value: number, min: number, max: number): number {
  return max < min ? min : Math.min(Math.max(value, min), max);
}

export function placeContextMenu(
  point: { x: number; y: number },
  size: { width: number; height: number },
  bounds: ContextMenuBounds,
  source: ContextMenuSource,
): ContextMenuPlacement {
  const minLeft = bounds.left + EDGE;
  const maxLeft = bounds.left + bounds.width - EDGE - size.width;
  const minTop = bounds.top + EDGE;
  const maxTop = bounds.top + bounds.height - EDGE - size.height;

  if (source === 'touch') {
    const left = clamp(point.x - size.width / 2, minLeft, maxLeft);
    const above = point.y - FINGER_GAP_ABOVE - size.height;
    const below = point.y + FINGER_GAP_BELOW;
    // 上方放得下就放上方；两边都放不下时，选超出得少的一边。
    const placeAbove = above >= minTop || (below > maxTop && above - minTop >= maxTop - below);
    const top = clamp(placeAbove ? above : below, minTop, maxTop);
    const originX = clamp(point.x - left, 0, size.width);
    return { left, top, transformOrigin: `${Math.round(originX)}px ${placeAbove ? '100%' : '0'}` };
  }

  const right = point.x + CURSOR_GAP;
  const flipX = right > maxLeft && point.x - CURSOR_GAP - size.width >= minLeft;
  const down = point.y + CURSOR_GAP;
  const flipY = down > maxTop && point.y - CURSOR_GAP - size.height >= minTop;
  const left = clamp(flipX ? point.x - CURSOR_GAP - size.width : right, minLeft, maxLeft);
  const top = clamp(flipY ? point.y - CURSOR_GAP - size.height : down, minTop, maxTop);
  return { left, top, transformOrigin: `${flipX ? '100%' : '0'} ${flipY ? '100%' : '0'}` };
}

/** 当前可见区域（布局视口坐标）。手机弹出键盘或缩放时用 visualViewport。 */
export function visibleBounds(): ContextMenuBounds {
  const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
  if (viewport) return { left: viewport.offsetLeft, top: viewport.offsetTop, width: viewport.width, height: viewport.height };
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}
