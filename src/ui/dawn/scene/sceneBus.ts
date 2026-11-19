/**
 * Presentation-only channel between the hall's HTML layer and the 3D scene.
 * The hall publishes where its stage, core and lenses are on screen and which
 * lens has focus; the scene reads it to put the bonfire under the core and a
 * floor medallion + light column under every lens. No game state passes here.
 */

export interface HallSlot {
  /** Viewport px of the lens centre. */
  x: number;
  y: number;
  /** A world (or the empty "new world" slot) occupies this position. */
  occupied: boolean;
  /** Lens accent colour (hex), used to tint its medallion and light column. */
  accent: string | null;
}

export interface HallLayout {
  viewportWidth: number;
  viewportHeight: number;
  /** Viewport px of the core centre and its diameter. */
  coreX: number;
  coreY: number;
  core: number;
  /** Lens diameter in px. */
  lens: number;
  slots: HallSlot[];
}

export interface HallFocus {
  /** Slot index under the pointer or keyboard focus, -1 for none. */
  hovered: number;
  /** Slot index of the selected world on this page, -1 for none. */
  selected: number;
  /** Pointer or focus is on the hearth: the hall core (travel journal) or the title's start plaque. */
  coreHover: boolean;
}

export type ScenePulse = 'core' | 'select' | 'page';

type Listener = () => void;

let layout: HallLayout | null = null;
let focus: HallFocus = { hovered: -1, selected: -1, coreHover: false };
let pulseQueue: ScenePulse[] = [];
const listeners = new Set<Listener>();

const emit = () => { for (const listener of listeners) listener(); };

function sameLayout(a: HallLayout | null, b: HallLayout | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.viewportWidth !== b.viewportWidth || a.viewportHeight !== b.viewportHeight || a.coreX !== b.coreX || a.coreY !== b.coreY
    || a.core !== b.core || a.lens !== b.lens || a.slots.length !== b.slots.length) return false;
  return a.slots.every((slot, index) => {
    const other = b.slots[index];
    return slot.x === other.x && slot.y === other.y && slot.occupied === other.occupied && slot.accent === other.accent;
  });
}

export const dawnSceneBus = {
  getLayout: () => layout,
  setLayout(next: HallLayout | null) {
    if (sameLayout(layout, next)) return;
    layout = next;
    emit();
  },
  getFocus: () => focus,
  setFocus(next: Partial<HallFocus>) {
    const merged = { ...focus, ...next };
    if (merged.hovered === focus.hovered && merged.selected === focus.selected && merged.coreHover === focus.coreHover) return;
    focus = merged;
    emit();
  },
  pulse(kind: ScenePulse) {
    // Without a live scene (night theme, CSS fallback) nobody drains the queue.
    if (!listeners.size) return;
    pulseQueue.push(kind);
    if (pulseQueue.length > 8) pulseQueue.shift();
    emit();
  },
  /** Pulses since the last call (the scene drains them once per frame). */
  takePulses(): ScenePulse[] {
    if (!pulseQueue.length) return pulseQueue;
    const taken = pulseQueue;
    pulseQueue = [];
    return taken;
  },
  subscribe(listener: Listener) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
};
