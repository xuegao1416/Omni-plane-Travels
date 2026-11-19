import {
Color,
CubeCamera,
HalfFloatType,
LinearMipmapLinearFilter,
MathUtils,
PerspectiveCamera,
PMREMGenerator,
Vector3,
WebGLCubeRenderTarget,
WebGLRenderer,
WebGLRenderTarget,
type Texture,
} from 'three';
import { bakeNoiseVolume } from './shaders';
import { buildWorld,FIRE_BASE,FIRE_HEIGHT,FIRE_RADIUS,SUN_DIR,type World,type WorldState } from './world';
import { Pipeline } from './pipeline';
import {
  detectTier,FrameBudget,frameBudgetMs,isTierForced,recallPerformance,rememberPerformance,settingsFor,type QualitySettings,type QualityTier,
} from './quality';
import { hudRequested,SceneHud } from './hud';
import { applyPose,CameraRig,estimateHallLayout,hallPose,homePose,LENS_HEIGHT,medallionsFor,type Pose } from './rig';
import type { HallFocus,HallLayout,ScenePulse } from './sceneBus';

export type ScenePhase = 'home' | 'warp' | 'hall';

export const WARP_SECONDS = 1.7;

/** Localhost-only QA knobs: `?dwstill=1` draws single frames, `&dwt=<seconds>` fixes the clock. */
const DEV = (() => {
  if (typeof window === 'undefined') return { still: false, time: null as number | null };
  const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);
  const q = new URLSearchParams(window.location.search);
  const t = q.get('dwt');
  return { still: local && q.get('dwstill') === '1', time: local && t !== null ? Number(t) : null };
})();

function motionAllowed() {
  if (DEV.still) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.effects !== 'off';
}

interface MedallionState {
  x: number; z: number; radius: number; occupied: boolean;
  color: Color; target: Color;
  glow: number; ley: number; visible: number; height: number;
  arrival: number;
}

/**
 * Owns the WebGL renderer, the world and the frame loop. Created once per
 * entry visit; the React wrapper keeps it alive across short remounts.
 */
export class DawnEngine {
  readonly canvas: HTMLCanvasElement;
  private readonly renderer: WebGLRenderer;
  private readonly camera = new PerspectiveCamera(50, 1, 0.1, 700);
  private readonly mirrorCamera = new PerspectiveCamera(50, 1, 0.1, 700);
  private settings: QualitySettings;
  private readonly world: World;
  private readonly pipeline: Pipeline;
  private readonly noise: WebGLRenderTarget;
  private cubeRT: WebGLCubeRenderTarget | null = null;
  private pmremRT: WebGLRenderTarget | null = null;
  private budget: FrameBudget;
  private readonly gpu: string;
  /** Even tier 0 missed its frame budget: hold still frames, as with reduced motion. */
  private still = false;
  private readonly hud: SceneHud | null = null;
  private readonly rig: CameraRig;

  private width = 1;
  private height = 1;
  private phase: ScenePhase;
  private layout: HallLayout | null = null;
  private focus: HallFocus = { hovered: -1, selected: -1, coreHover: false };
  private medallions: MedallionState[] = [];
  private hallBlend = 0;
  private flare = 0;
  private flash = 0;
  private time = DEV.time ?? 8;
  private last = 0;
  private raf = 0;
  private disposed = false;
  private suspended = false;
  private ready = false;
  private readyListeners: Array<() => void> = [];
  private lostListeners: Array<() => void> = [];
  private pulses: ScenePulse[] = [];
  private accent = new Color('#3fe0c6');
  private accentMix = 0;
  private configured = '';
  /** QA multipliers (still mode). */
  debug: { density: number; exposure: number; bloom: number; ambient: number; hueKeep: number; view: number; pose: { position: number[]; target: number[]; fov: number } | null } = { density: 1, exposure: 1, bloom: 1, ambient: 1, hueKeep: 0.6, view: 0, pose: null };
  private readonly observer: ResizeObserver;
  private readonly mutation: MutationObserver;
  private host: HTMLElement;

  static create(host: HTMLElement, phase: ScenePhase): DawnEngine | null {
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2')) return null;
      return new DawnEngine(host, phase);
    } catch (error) {
      console.warn('[dawn scene] WebGL unavailable, using the CSS backdrop', error);
      return null;
    }
  }

  private constructor(host: HTMLElement, phase: ScenePhase) {
    this.host = host;
    this.phase = phase;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'dw-scene__canvas';
    this.renderer = new WebGLRenderer({ canvas: this.canvas, antialias: false, alpha: false, depth: true, stencil: false, powerPreference: 'high-performance', preserveDrawingBuffer: false });
    this.renderer.autoClear = false;
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    const detected = detectTier(this.gpu);
    const learned = isTierForced() ? null : recallPerformance(this.gpu);
    this.settings = settingsFor(learned ? (Math.min(detected, learned.tier) as QualityTier) : detected);
    this.still = learned?.still ?? false;
    this.budget = new FrameBudget(frameBudgetMs(this.settings));
    host.appendChild(this.canvas);
    if (hudRequested()) {
      // Per-frame draw totals: the pipeline renders many passes, so the counters reset once per frame.
      this.renderer.info.autoReset = false;
      this.hud = new SceneHud(() => ({
        gpu: this.gpu,
        tier: this.settings.tier,
        forced: isTierForced(),
        buffer: [Math.round(this.width * this.settings.pixelRatio), Math.round(this.height * this.settings.pixelRatio)],
        fpsCap: this.settings.fps,
        still: this.still ? 'device too slow' : motionAllowed() ? null : 'reduced motion',
        calls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles,
      }));
    }

    this.noise = bakeNoiseVolume(this.renderer);
    this.world = buildWorld(this.renderer, this.settings, this.noise.texture);
    this.pipeline = new Pipeline(this.renderer, this.settings, this.mirrorCamera);
    this.measure();
    this.rig = new CameraRig(phase === 'home' ? homePose(this.width, this.height) : this.hallTargetPose());
    if (phase !== 'home') this.hallBlend = 1;
    this.refreshHallPose(true);

    this.observer = new ResizeObserver(() => { this.measure(); this.kick(); });
    this.observer.observe(host);
    this.mutation = new MutationObserver(() => this.kick());
    this.mutation.observe(document.documentElement, { attributes: true, attributeFilter: ['data-effects'] });
    document.addEventListener('visibilitychange', this.kick);
    window.addEventListener('pointermove', this.onPointer, { passive: true });
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);

    // Heavy one-off work (shadow map, environment capture, shader compile) after first paint.
    requestAnimationFrame(() => { if (!this.disposed) void this.prepare(); });
    if (DEV.still) (window as unknown as { __dawn?: unknown }).__dawn = this;
  }

  /** QA: advance the clock and draw one frame (still mode only). */
  debugFrame(seconds = 0) {
    this.time += seconds;
    this.renderFrame(seconds);
  }

  /** Whether the scene animates continuously: motion is allowed and the device keeps up. */
  private moving() {
    return motionAllowed() && !this.still;
  }

  /** Moves the canvas into a new host element (the wrapper remounted). */
  attach(host: HTMLElement) {
    this.suspended = false;
    this.hud?.setVisible(true);
    if (this.host !== host) {
      this.observer.unobserve(this.host);
      this.host = host;
      host.appendChild(this.canvas);
      this.observer.observe(host);
      this.measure();
    }
    this.kick();
  }

  /** Stops drawing while the wrapper is unmounted (kept warm for a quick remount). */
  suspend() {
    this.suspended = true;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.hud?.setVisible(false);
  }

  onReady(listener: () => void) {
    if (this.ready) listener();
    else this.readyListeners.push(listener);
  }

  /** QA: moves the sun (still mode only) and rebuilds the shadow map and environment. */
  debugSun(x: number, y: number, z: number) {
    SUN_DIR.set(x, y, z).normalize();
    this.world.sun.position.copy(SUN_DIR).multiplyScalar(70).add(new Vector3(0, 6, 0));
    this.world.shared.uSunDir.value.copy(SUN_DIR);
    this.relight();
    this.pipeline.resetHistory();
  }

  /** Renders the static sun shadow map and captures the environment for reflections. */
  private relight() {
    const r = this.renderer;
    r.shadowMap.needsUpdate = true;
    const warm = new WebGLRenderTarget(4, 4);
    applyPose(this.camera, this.rig.update(0, this.time), this.width, this.height);
    r.setRenderTarget(warm);
    r.render(this.world.scenes.opaque, this.camera);
    r.setRenderTarget(null);
    warm.dispose();
    const shadow = this.world.sun.shadow;
    this.world.shared.tShadow.value = shadow.map?.depthTexture ?? null;
    this.world.shared.uShadowMatrix.value.copy(shadow.matrix);
    this.captureEnvironment();
  }

  private async prepare() {
    const r = this.renderer;
    this.relight();
    try {
      for (const scene of Object.values(this.world.scenes)) await r.compileAsync(scene, this.camera);
    } catch { /* compileAsync unsupported: shaders compile on first draw */ }
    if (this.disposed) return;
    this.ready = true;
    for (const l of this.readyListeners.splice(0)) l();
    this.last = performance.now();
    this.kick();
  }

  private captureEnvironment() {
    const r = this.renderer;
    const size = this.settings.tier >= 2 ? 256 : 128;
    this.cubeRT?.dispose();
    this.cubeRT = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: true, minFilter: LinearMipmapLinearFilter });
    const cubeCam = new CubeCamera(0.2, 600, this.cubeRT);
    cubeCam.position.set(0, 5.5, 4.5);
    this.world.update(this.state(0));
    this.world.setCapture(true);
    const autoClear = r.autoClear;
    r.autoClear = true;
    cubeCam.update(r, this.world.scenes.opaque);
    r.autoClear = autoClear;
    this.world.setCapture(false);
    const pmrem = new PMREMGenerator(r);
    this.pmremRT?.dispose();
    this.pmremRT = pmrem.fromCubemap(this.cubeRT.texture);
    pmrem.dispose();
    this.world.setEnvironment(this.cubeRT.texture as Texture, this.pmremRT.texture);
  }

  private measure() {
    const w = Math.max(1, this.host.clientWidth || window.innerWidth);
    const h = Math.max(1, this.host.clientHeight || window.innerHeight);
    const changed = w !== this.width || h !== this.height;
    this.width = w;
    this.height = h;
    const ratio = this.settings.pixelRatio;
    this.renderer.setPixelRatio(ratio);
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = '100%';
    this.canvas.style.height = '100%';
    const bw = Math.round(w * ratio);
    const bh = Math.round(h * ratio);
    const key = `${bw}x${bh}@${this.settings.tier}`;
    if (key !== this.configured) {
      this.configured = key;
      this.pipeline.configure(this.settings, bw, bh);
    }
    this.world.shared.uResolution.value.set(bw, bh);
    this.world.shared.uPixelRatio.value = ratio * (h / 900) ** 0.35;
    this.world.floor.uResolution.value.set(bw, bh);
    if (changed && this.rig) this.refreshHallPose(true);
  }

  private hallTargetPose(): Pose {
    return hallPose(this.layout ?? estimateHallLayout(this.width, this.height), this.width, this.height);
  }

  private refreshHallPose(snap = false) {
    const layout = this.layout ?? estimateHallLayout(this.width, this.height);
    const pose = hallPose(layout, this.width, this.height);
    const meds = medallionsFor(layout, pose, this.width, this.height);
    const next: MedallionState[] = meds.map((m, i) => {
      const prev = this.medallions[i];
      const target = new Color(m.accent ?? '#5fe3cf');
      return {
        x: m.x, z: m.z, radius: m.radius, occupied: m.occupied,
        color: prev?.color ?? target.clone(), target,
        glow: prev?.glow ?? 0, ley: prev?.ley ?? 0,
        visible: prev?.visible ?? 0, height: LENS_HEIGHT, arrival: prev?.arrival ?? 0,
      };
    });
    this.medallions = next;
    if (this.phase === 'home') return;
    if (snap && !this.rig.flying) this.rig.jump(pose);
    else this.rig.retarget(pose);
  }

  setPhase(phase: ScenePhase) {
    if (phase === this.phase) return;
    const prev = this.phase;
    this.phase = phase;
    const animate = this.moving();
    if (phase === 'warp' || (phase === 'hall' && prev === 'home')) {
      if (animate && phase === 'warp') {
        this.rig.fly(this.hallTargetPose(), WARP_SECONDS, 'warp');
        this.flare = Math.max(this.flare, 1);
        for (const m of this.medallions) { m.visible = 0; m.arrival = 0; }
      } else if (phase === 'hall' && !this.rig.flying) {
        this.rig.jump(this.hallTargetPose());
      }
    } else if (phase === 'home') {
      if (animate) this.rig.fly(homePose(this.width, this.height), 1.35, 'return');
      else this.rig.jump(homePose(this.width, this.height));
    }
    this.kick();
  }

  setLayout(layout: HallLayout | null) {
    this.layout = layout;
    this.refreshHallPose(false);
    this.kick();
  }

  setFocus(focus: HallFocus) {
    this.focus = focus;
    this.kick();
  }

  pulse(kind: ScenePulse) {
    this.pulses.push(kind);
    this.kick();
  }

  private onPointer = (event: PointerEvent) => {
    this.rig.setPointer(event.clientX / window.innerWidth - 0.5, event.clientY / window.innerHeight - 0.5);
  };

  /** The GPU dropped the context: baked textures and the shadow map are gone, so the owner rebuilds or falls back. */
  private onContextLost = (event: Event) => {
    event.preventDefault();
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ready = false;
    for (const l of this.lostListeners.splice(0)) l();
  };

  /** Registers a context-loss handler; returns its removal. */
  onLost(listener: () => void) {
    this.lostListeners.push(listener);
    return () => { this.lostListeners = this.lostListeners.filter(l => l !== listener); };
  }

  /** (Re)starts the loop, or draws one still frame when motion is off. */
  kick = () => {
    if (this.disposed || !this.ready || this.suspended) return;
    if (document.hidden) { cancelAnimationFrame(this.raf); this.raf = 0; return; }
    if (this.moving() || this.rig.flying) {
      if (!this.raf) { this.last = performance.now(); this.raf = requestAnimationFrame(this.loop); }
    } else {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
      this.renderFrame(0);
    }
  };

  private loop = (now: number) => {
    this.raf = 0;
    if (this.disposed || this.suspended || document.hidden) return;
    // Behind the settings sheet (inert backdrop) the hall only needs to look alive.
    const background = this.host.closest('[inert]') !== null;
    const minDelta = 1000 / (background ? 20 : this.settings.fps) - 2;
    const elapsed = now - this.last;
    if (elapsed < minDelta) { this.raf = requestAnimationFrame(this.loop); return; }
    const dt = Math.min(elapsed / 1000, 0.1);
    this.last = now;
    const t0 = performance.now();
    this.renderFrame(dt);
    const cost = performance.now() - t0;
    this.hud?.frame(elapsed);
    // Behind the settings sheet the rate is capped on purpose; those frames say nothing about the device.
    if (!background && !isTierForced() && this.budget.push(Math.max(cost, elapsed)) !== null) this.onBudgetMissed();
    if (this.moving() || this.rig.flying) this.raf = requestAnimationFrame(this.loop);
    else this.renderFrame(0);
  };

  /** One tier down; below tier 0 the scene holds still. Remembered for the tab session. */
  private onBudgetMissed() {
    if (this.settings.tier > 0) {
      this.settings = settingsFor((this.settings.tier - 1) as QualityTier);
      this.world.applyQuality(this.settings);
      this.measure();
      this.budget = new FrameBudget(frameBudgetMs(this.settings));
    } else {
      this.still = true;
    }
    rememberPerformance(this.gpu, { tier: this.settings.tier, still: this.still });
  }

  private state(dt: number): WorldState {
    return {
      time: this.time,
      dt,
      hall: this.hallBlend,
      flare: this.flare,
      medallions: this.medallions.map(m => ({ x: m.x, z: m.z, radius: m.radius, glow: m.glow, ley: m.ley, height: m.height, color: m.color, visible: m.visible })),
      accent: this.accent,
      accentMix: this.accentMix,
    };
  }

  private step(dt: number) {
    const animate = this.moving();
    if (animate) this.time += dt;
    for (const p of this.pulses.splice(0)) {
      if (p === 'core') this.flare = Math.max(this.flare, 1);
      if (p === 'select') this.flash = Math.max(this.flash, 0.25);
      if (p === 'page') for (const m of this.medallions) m.arrival = 0;
    }
    const wantHall = this.phase === 'home' ? 0 : 1;
    if (this.rig.flying) {
      const k = this.rig.progress;
      this.hallBlend = this.rig.kind === 'return' ? 1 - k : this.rig.kind === 'warp' ? k : this.hallBlend + (wantHall - this.hallBlend) * Math.min(1, dt * 3);
    } else {
      this.hallBlend += (wantHall - this.hallBlend) * (animate ? Math.min(1, dt * 4) : 1);
    }
    const coreHover = this.focus.coreHover && this.phase !== 'warp' ? 0.45 : 0;
    this.flare += (coreHover - this.flare) * Math.min(1, dt * (this.flare > coreHover ? 1.4 : 3));
    if (!animate) this.flare = coreHover;
    this.flash = Math.max(0, this.flash - dt * 1.6);
    const focusIndex = this.focus.hovered >= 0 ? this.focus.hovered : this.focus.selected;
    const inHall = this.phase === 'hall';
    this.medallions.forEach((m, i) => {
      const hovered = this.focus.hovered === i;
      const selected = this.focus.selected === i;
      m.arrival = animate ? Math.min(1, m.arrival + (inHall ? dt * 1.1 : 0)) : inHall ? 1 : 0;
      const delay = 0.18 + i * 0.075;
      const appear = MathUtils.smoothstep(m.arrival, delay, delay + 0.45);
      const show = m.occupied && inHall ? appear : 0;
      m.visible += (show - m.visible) * (animate ? Math.min(1, dt * 5) : 1);
      const glow = hovered ? 1 : selected ? 0.55 : 0.12;
      m.glow += (glow - m.glow) * (animate ? Math.min(1, dt * 6) : 1);
      const ley = hovered ? 1 : selected ? 0.4 : 0.05;
      m.ley += (ley - m.ley) * (animate ? Math.min(1, dt * 5) : 1);
      m.color.lerp(m.target, animate ? Math.min(1, dt * 4) : 1);
    });
    const focusMed = focusIndex >= 0 ? this.medallions[focusIndex] : undefined;
    if (focusMed) this.accent.lerp(focusMed.target, animate ? Math.min(1, dt * 3) : 1);
    const mix = focusMed && inHall ? 1 : 0;
    this.accentMix += (mix - this.accentMix) * (animate ? Math.min(1, dt * 3) : 1);
    this.rig.setParallax(animate ? (this.phase === 'home' ? 1 : 0.3) : 0);
  }

  private renderFrame(dt: number) {
    if (!this.ready) return;
    if (this.hud) this.renderer.info.reset();
    this.step(dt);
    const pose = this.rig.update(dt, this.time);
    const qa = this.debug.pose;
    if (qa) {
      pose.position.fromArray(qa.position);
      pose.target.fromArray(qa.target);
      pose.fov = qa.fov;
      pose.shift.set(0, 0);
    }
    applyPose(this.camera, pose, this.width, this.height);
    this.world.update(this.state(dt));
    const w = this.world;
    w.floor.uReflectMix.value = 0;
    const fireTop = FIRE_BASE.clone().add(new Vector3(0, FIRE_HEIGHT * 0.55, 0));
    const p = fireTop.clone().project(this.camera);
    const edge = FIRE_BASE.clone().add(new Vector3(FIRE_RADIUS, FIRE_HEIGHT * 0.55, 0)).project(this.camera);
    const hazeW = Math.max(0.02, Math.abs(edge.x - p.x) * 0.5);
    const haze = p.z < 1 ? { x: p.x * 0.5 + 0.5, y: p.y * 0.5 + 0.5, w: hazeW * 1.2, h: hazeW * 2.6 * (this.width / this.height) } : null;
    const dense = MathUtils.lerp(0.03, 0.026, this.hallBlend);
    this.pipeline.render(w.scenes, this.camera, {
      time: this.time,
      exposure: MathUtils.lerp(1.2, 1.25, this.hallBlend) * this.debug.exposure,
      bloom: 0.42 * this.debug.bloom,
      density: dense * this.debug.density,
      ambient: new Vector3(0.55, 0.7, 0.84).multiplyScalar(0.5 * this.debug.ambient),
      sunDir: SUN_DIR,
      sunColor: new Vector3(1, 0.88, 0.7).multiplyScalar(6.5),
      firePos: w.firePos,
      fireColor: new Vector3(1, 0.52, 0.2).multiplyScalar(2.4),
      fireLight: w.shared.uFireLight.value,
      shadowMap: w.shared.tShadow.value,
      shadowMatrix: w.shared.uShadowMatrix.value,
      noise: this.noise.texture,
      haze,
      flash: this.flash,
      mist: new Vector3(0.9, 0.95, 0.94),
      sunUv: null,
      sunOn: 0,
      historyMix: this.rig.flying ? 0.55 : 0.16,
      hueKeep: this.debug.hueKeep,
      view: this.debug.view,
    }, {
      beforeMirror: () => w.setMirror(true),
      afterMirror: () => {
        w.setMirror(false);
        w.floor.tReflect.value = this.pipeline.mirrorTexture;
        w.floor.uReflectMatrix.value.copy(this.pipeline.reflectMatrix);
        w.floor.uReflectMix.value = 1;
      },
      setRefraction: (texture, size) => {
        for (const u of w.crystalUniforms) { u.tScene.value = texture; u.uResolution.value.copy(size); }
      },
      setSceneDepth: texture => w.setSceneDepth(texture),
      setCrystalPass: pass => { w.shared.uCrystalPass.value = pass; },
    });
  }

  /** Releases the GPU context and listeners. */
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.mutation.disconnect();
    document.removeEventListener('visibilitychange', this.kick);
    window.removeEventListener('pointermove', this.onPointer);
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.hud?.dispose();
    this.world.dispose();
    this.pipeline.dispose();
    this.noise.dispose();
    this.cubeRT?.dispose();
    this.pmremRT?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.canvas.remove();
  }
}

