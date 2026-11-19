import { useCallback,useEffect,useLayoutEffect,type RefObject } from 'react';
import { dawnSceneBus,type HallFocus,type HallSlot,type ScenePulse } from './scene/sceneBus';

/** Stage-local px of the hall core (centre, diameter) and the lens diameter. */
export interface BridgeStage {
  cx: number;
  cy: number;
  core: number;
  lens: number;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Lens accents come from user world data; only plain hex colours reach the GPU. */
export const sceneAccent = (color: string | null | undefined) => (color && HEX.test(color.trim()) ? color.trim() : null);

/**
 * Position of an element inside the fixed entry root, from layout boxes only.
 * offsetLeft / offsetTop ignore CSS transforms, so the hall's zoom-in on arrival
 * does not skew the numbers the camera is aimed with.
 */
function layoutOrigin(el: HTMLElement) {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node) {
    x += node.offsetLeft;
    y += node.offsetTop;
    const parent = node.offsetParent as HTMLElement | null;
    if (parent) { x += parent.clientLeft; y += parent.clientTop; }
    node = parent;
  }
  return { x, y };
}

/**
 * Tells the 3D dawn scene where the hall's core and lenses are and what has
 * focus, so it can put the bonfire under the core and a floor medallion with a
 * light column under every lens. Publishes nothing unless `active` (dawn theme).
 */
export function useDawnHallBridge(
  active: boolean,
  stageRef: RefObject<HTMLElement | null>,
  stage: BridgeStage | null,
  slots: HallSlot[],
  focus: HallFocus,
) {
  const slotKey = slots.map(s => `${Math.round(s.x)},${Math.round(s.y)},${s.occupied ? 1 : 0},${s.accent ?? ''}`).join('|');

  useLayoutEffect(() => {
    const el = stageRef.current;
    if (!active || !el || !stage) return;
    const origin = layoutOrigin(el);
    const root = el.closest('.pl-entry-root') as HTMLElement | null;
    dawnSceneBus.setLayout({
      viewportWidth: root?.clientWidth || window.innerWidth,
      viewportHeight: root?.clientHeight || window.innerHeight,
      coreX: origin.x + stage.cx,
      coreY: origin.y + stage.cy,
      core: stage.core,
      lens: stage.lens,
      slots: slots.map(s => ({ ...s, x: origin.x + s.x, y: origin.y + s.y })),
    });
    // slotKey stands in for the slot array, which is rebuilt every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, stageRef, stage?.cx, stage?.cy, stage?.core, stage?.lens, slotKey]);

  // The next warp aims with a fresh estimate instead of a layout from an older window size.
  useEffect(() => {
    if (!active) return undefined;
    return () => {
      dawnSceneBus.setLayout(null);
      dawnSceneBus.setFocus({ hovered: -1, selected: -1, coreHover: false });
    };
  }, [active]);

  useEffect(() => {
    if (active) dawnSceneBus.setFocus(focus);
  }, [active, focus.hovered, focus.selected, focus.coreHover]); // eslint-disable-line react-hooks/exhaustive-deps

  return useCallback((kind: ScenePulse) => { if (active) dawnSceneBus.pulse(kind); }, [active]);
}
