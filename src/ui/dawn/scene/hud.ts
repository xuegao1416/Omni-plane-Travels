/**
 * On-device readout for testing on real phones: add `?dwhud=1` to the URL (any
 * host, unlike the localhost-only QA knobs). Shows the GPU, tier and render
 * buffer, the frame rate the loop actually reaches, and the draw load per frame.
 */

export function hudRequested() {
  return typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('dwhud') === '1';
}

export interface HudStats {
  gpu: string;
  tier: number;
  forced: boolean;
  buffer: [number, number];
  fpsCap: number;
  /** Why the scene draws still frames, or null while it animates. */
  still: string | null;
  calls: number;
  triangles: number;
}

const REFRESH_MS = 500;

export class SceneHud {
  private readonly el: HTMLElement;
  private readonly timer: number;
  private frames = 0;
  private spent = 0;
  private since = performance.now();

  constructor(private readonly read: () => HudStats) {
    this.el = document.createElement('div');
    this.el.className = 'dw-hud';
    this.el.setAttribute('aria-hidden', 'true');
    document.body.appendChild(this.el);
    this.timer = window.setInterval(this.refresh, REFRESH_MS);
  }

  /** One frame of the animation loop, `elapsedMs` after the previous one. */
  frame(elapsedMs: number) {
    this.frames++;
    this.spent += elapsedMs;
  }

  setVisible(visible: boolean) { this.el.hidden = !visible; }

  private refresh = () => {
    const now = performance.now();
    const seconds = (now - this.since) / 1000;
    const fps = this.frames / Math.max(seconds, 1e-3);
    const ms = this.frames ? this.spent / this.frames : 0;
    this.frames = 0;
    this.spent = 0;
    this.since = now;
    const s = this.read();
    this.el.textContent = [
      // "ANGLE (Qualcomm, Adreno (TM) 650, OpenGL ES 3.2)" → the part inside the brackets.
      s.gpu.replace(/^ANGLE \((.*)\)$/, '$1').slice(0, 48),
      `tier ${s.tier}${s.forced ? ' (forced)' : ''} · ${s.buffer[0]}×${s.buffer[1]} · cap ${s.fpsCap}`,
      s.still ? `still frames (${s.still})` : `${fps.toFixed(1)} fps · ${ms.toFixed(1)} ms`,
      `${s.calls} calls · ${Math.round(s.triangles / 1000)}k tris`,
    ].join('\n');
  };

  dispose() {
    window.clearInterval(this.timer);
    this.el.remove();
  }
}
