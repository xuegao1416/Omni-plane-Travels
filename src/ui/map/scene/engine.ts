/**
 * 3D 沙盘：整张地图做成一块带土层侧面的地形沙盘（星域则是悬浮的全息星图），
 * 镜头默认对准当前位置，可拖拽旋转、滚轮缩放、点选地点、飞到某个地区。
 *
 * 地形、海岸与 2D 地图共用 domains/map/terrain 的同一个地形场；地名用 HTML 叠在画布上，清晰可读。
 * 画质分 0–3 档（沿用晨雾场景的 GPU 档位判断，本机可用 ?dwq= 固定），隐藏页面停帧，减动效只画静帧。
 */
import {
  ACESFilmicToneMapping, AdditiveBlending, AmbientLight, BufferAttribute, BufferGeometry, CatmullRomCurve3, Color, CylinderGeometry,
  DirectionalLight, DoubleSide, Float32BufferAttribute, Fog, Group, HalfFloatType, HemisphereLight, IcosahedronGeometry, InstancedMesh,
  MathUtils, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PCFShadowMap, PerspectiveCamera, PlaneGeometry, Points,
  PointsMaterial, Raycaster, RingGeometry, Scene, SphereGeometry, Sprite, SpriteMaterial, SRGBColorSpace, TubeGeometry, Vector2,
  Vector3, WebGLRenderer, WebGLRenderTarget, BoxGeometry, type Material, type ShaderMaterial, type Texture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { biomeAt, createNoise2D, sampleTerrainGrid, type TerrainGrid } from '../../../domains/map/terrain';
import type { MapLocation, MapRoute, MapTheme } from '../../../domains/map/types';
import type { MapViewModel } from '../../../domains/map/viewModel';
import { detectTier, type QualityTier } from '../../dawn/scene/quality';
import { SCENE_PALETTES, type ScenePalette } from './palette';
import { backgroundTexture, createBeamMaterial, createHoloMaterial, createRouteMaterial, createWaterMaterial, glowTexture, heightTexture } from './shaders';
import { buildStructure, landmarkStyle, seeded, treeGeometry } from './structures';
import { buildFeatureMeshes, featureMask, resample } from './features';
import { hasFeatures, routeLine, smoothLine } from '../../../domains/map/features';

const UNIT = 0.1;
const BASE = -3.2;

interface Settings { tier: QualityTier; pixelRatio: number; shadows: boolean; shadowSize: number; bloom: boolean; cols: number; trees: number; samples: number; fps: number }

function settingsFor(tier: QualityTier, theme: MapTheme): Settings {
  const dpr = typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1;
  return {
    tier,
    pixelRatio: Math.min(dpr, [0.85, 1.1, 1.5, 2][tier]!),
    shadows: tier >= 1,
    shadowSize: tier >= 3 ? 4096 : 2048,
    bloom: tier >= 1 || theme === 'scifi',
    cols: [161, 201, 241, 281][tier]!,
    trees: [700, 1400, 2400, 3200][tier]!,
    samples: tier >= 2 ? 4 : 0,
    fps: tier >= 2 ? 60 : 30,
  };
}

function motionAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  if (new URLSearchParams(window.location.search).get('dwstill') === '1' && ['localhost', '127.0.0.1'].includes(window.location.hostname)) return false;
  return !window.matchMedia('(prefers-reduced-motion: reduce)').matches && document.documentElement.dataset.effects !== 'off';
}

function ease(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** 3D 用的地形：在陆地上做几遍 3×3 均值，去掉 2D 明暗用的细碎起伏，山体更圆润。 */
function smoothGrid(grid: TerrainGrid, passes: number): TerrainGrid {
  if (grid.space || passes <= 0) return grid;
  const { cols, rows } = grid;
  let heights = Float32Array.from(grid.heights);
  for (let pass = 0; pass < passes; pass++) {
    const next = Float32Array.from(heights);
    for (let row = 1; row < rows - 1; row++) {
      for (let col = 1; col < cols - 1; col++) {
        const index = row * cols + col;
        const h = heights[index]!;
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += heights[index + dy * cols + dx]!;
        const average = sum / 9;
        // 海岸附近不动，免得海岸线跑位。
        next[index] = h > 0.04 ? Math.max(0.03, average * 0.7 + h * 0.3) : h;
      }
    }
    heights = next;
  }
  return { ...grid, heights };
}

export interface MapSceneCallbacks {
  onSelect?: (id: string | null) => void;
  onHover?: (id: string | null) => void;
  onLost?: () => void;
}

interface LabelEntry { element: HTMLDivElement; position: Vector3; priority: number; id: string }

interface Flight { fromTarget: Vector3; toTarget: Vector3; fromDistance: number; toDistance: number; fromPolar: number; toPolar: number; start: number; duration: number }

export class MapScene {
  private readonly renderer: WebGLRenderer;
  private readonly scene = new Scene();
  private readonly camera = new PerspectiveCamera(36, 1, 0.5, 3000);
  private readonly controls: OrbitControls;
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private readonly startedAt = performance.now();
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly labels: HTMLDivElement;
  private readonly observer: ResizeObserver;
  private readonly visibility: IntersectionObserver;
  private settings: Settings;
  private palette: ScenePalette;
  private theme: MapTheme;
  private view: MapViewModel | null = null;
  private grid: TerrainGrid | null = null;
  private mask: ReturnType<typeof featureMask> = undefined;
  private content = new Group();
  private readonly animated: Array<{ material: ShaderMaterial }> = [];
  private hitTargets: Mesh[] = [];
  private structures = new Map<string, Group>();
  private labelEntries: LabelEntry[] = [];
  private regionLabels: LabelEntry[] = [];
  private beacon: Group | null = null;
  private selectRing: Mesh | null = null;
  private planMesh: Mesh | null = null;
  private spinning: Object3D[] = [];
  private flight: Flight | null = null;
  private raf = 0;
  private visible = true;
  private disposed = false;
  private dirty = true;
  private lastFrame = 0;
  private hovered: string | null = null;
  private selected: string | null = null;
  private down: { x: number; y: number } | null = null;
  private configKey = '';
  private width = 1;
  private height = 1;
  private gpu = '';

  static create(host: HTMLElement, theme: MapTheme, callbacks: MapSceneCallbacks): MapScene | null {
    try {
      const probe = document.createElement('canvas');
      if (!probe.getContext('webgl2')) return null;
      return new MapScene(host, theme, callbacks);
    } catch (error) {
      console.warn('[地图] 3D 不可用，改用 2D', error);
      return null;
    }
  }

  private constructor(private readonly host: HTMLElement, theme: MapTheme, private readonly callbacks: MapSceneCallbacks) {
    this.theme = theme;
    this.palette = SCENE_PALETTES[theme];
    const canvas = document.createElement('canvas');
    canvas.className = 'map3d__canvas';
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
    const gl = this.renderer.getContext();
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    this.gpu = info ? String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER));
    this.settings = settingsFor(detectTier(this.gpu), theme);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setPixelRatio(this.settings.pixelRatio);
    host.appendChild(canvas);
    this.labels = document.createElement('div');
    this.labels.className = 'map3d__labels';
    host.appendChild(this.labels);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 14;
    this.controls.maxDistance = 190;
    this.controls.maxPolarAngle = 1.32;
    this.controls.minPolarAngle = 0.18;
    this.controls.zoomToCursor = true;
    this.controls.screenSpacePanning = false;
    this.controls.addEventListener('change', () => { this.dirty = true; });
    this.controls.addEventListener('start', () => { this.flight = null; });

    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerleave', this.onPointerLeave);
    canvas.addEventListener('webglcontextlost', this.onLost);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(host);
    this.visibility = new IntersectionObserver(entries => { this.visible = entries.some(entry => entry.isIntersecting); if (this.visible) this.kick(); });
    this.visibility.observe(host);
    document.addEventListener('visibilitychange', this.kick);
    this.scene.add(this.content);
    this.resize();
  }

  // ── Public API ──

  setView(view: MapViewModel, theme: MapTheme) {
    const key = `${theme}|${view.config.seed}|${view.config.width}x${view.config.height}|${view.config.landform}|${JSON.stringify(view.config.regions)}|${view.config.locations.map(item => `${item.id}:${item.x},${item.y},${item.kind}`).join(';')}`;
    const rebuild = key !== this.configKey;
    this.view = view;
    if (theme !== this.theme) {
      this.theme = theme;
      this.palette = SCENE_PALETTES[theme];
      this.settings = settingsFor(this.settings.tier, theme);
    }
    if (rebuild) {
      this.configKey = key;
      this.build();
      this.frame();
    } else {
      this.refreshDynamic();
    }
    this.dirty = true;
    this.kick();
  }

  setSelected(id: string | null) {
    this.selected = id;
    this.placeSelectRing();
    this.dirty = true;
    this.kick();
  }

  setPlan(nodes: string[] | undefined) {
    if (this.planMesh) {
      const material = this.planMesh.material as ShaderMaterial;
      const index = this.animated.findIndex(item => item.material === material);
      if (index >= 0) this.animated.splice(index, 1);
      this.disposeObject(this.planMesh);
      this.content.remove(this.planMesh);
      this.planMesh = null;
    }
    if (!this.view || !nodes || nodes.length < 2) { this.dirty = true; return; }
    const points: Vector3[] = [];
    for (let index = 1; index < nodes.length; index++) {
      const a = this.locationOf(nodes[index - 1]!);
      const b = this.locationOf(nodes[index]!);
      if (!a || !b) continue;
      const route = this.view.routes.find(item => (item.route.from === a.id && item.route.to === b.id) || (item.route.from === b.id && item.route.to === a.id))?.route;
      const segment = this.routePoints(route ?? { id: `${a.id}-${b.id}`, from: a.id, to: b.id, kind: 'road' }, a, b, 0.32);
      points.push(...(points.length ? segment.slice(1) : segment));
    }
    if (points.length < 2) return;
    const curve = new CatmullRomCurve3(points);
    const material = createRouteMaterial({ color: this.palette.select, length: curve.getLength(), dash: 0.9, gap: 0.6, flow: 2.4, opacity: 0.95, glow: true });
    this.animated.push({ material });
    this.planMesh = new Mesh(new TubeGeometry(curve, Math.min(400, points.length * 3), 0.16, 8, false), material);
    this.planMesh.renderOrder = 6;
    this.content.add(this.planMesh);
    this.dirty = true;
    this.kick();
  }

  focusLocation(id: string, distance = 34) {
    const location = this.locationOf(id);
    if (!location) return;
    this.flyTo(this.anchor(location), distance, 0.92);
  }

  focusRegion(id: string) {
    const region = this.view?.config.regions.find(item => item.id === id);
    if (!region || !this.view) return;
    const world = this.toWorld(region.x, region.y);
    this.flyTo(new Vector3(world.x, Math.max(0, this.heightAt(region.x, region.y)), world.z), MathUtils.clamp(region.radius * UNIT * 3.4, 26, 110), 0.88);
  }

  reset() {
    this.flyTo(new Vector3(0, 0, 0), this.fitDistance(), 0.86);
  }

  zoomBy(factor: number) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = MathUtils.clamp(offset.length() / factor, this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(this.controls.target.clone(), distance, this.controls.getPolarAngle(), 420);
  }

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.observer.disconnect();
    this.visibility.disconnect();
    document.removeEventListener('visibilitychange', this.kick);
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointerleave', this.onPointerLeave);
    canvas.removeEventListener('webglcontextlost', this.onLost);
    this.controls.dispose();
    this.clearContent();
    (this.scene.background as Texture | null)?.dispose?.();
    this.composer?.dispose();
    this.renderer.dispose();
    canvas.remove();
    this.labels.remove();
  }

  // ── Building ──

  private clearContent() {
    this.disposeObject(this.content);
    this.scene.remove(this.content);
    for (const child of [...this.scene.children]) { this.disposeObject(child); this.scene.remove(child); }
    this.content = new Group();
    this.scene.add(this.content);
    this.animated.length = 0;
    this.hitTargets = [];
    this.structures.clear();
    this.spinning = [];
    this.beacon = null;
    this.selectRing = null;
    this.planMesh = null;
    this.labels.replaceChildren();
    this.labelEntries = [];
    this.regionLabels = [];
  }

  private disposeObject(object: Object3D) {
    object.traverse(child => {
      const mesh = child as Mesh;
      mesh.geometry?.dispose?.();
      const material = mesh.material as Material | Material[] | undefined;
      const list = Array.isArray(material) ? material : material ? [material] : [];
      for (const item of list) {
        for (const value of Object.values(item as unknown as Record<string, unknown>)) if (value && typeof value === 'object' && (value as Texture).isTexture) (value as Texture).dispose();
        const uniforms = (item as ShaderMaterial).uniforms;
        if (uniforms) for (const uniform of Object.values(uniforms)) if ((uniform.value as Texture)?.isTexture) (uniform.value as Texture).dispose();
        item.dispose();
      }
    });
  }

  private build() {
    const view = this.view!;
    this.clearContent();
    const palette = this.palette;
    const space = view.config.landform === 'space';
    const aspect = view.config.height / view.config.width;
    this.grid = smoothGrid(sampleTerrainGrid(view.config, this.settings.cols, Math.round((this.settings.cols - 1) * aspect) + 1), this.theme === 'ancient' ? 2 : 1);

    this.scene.background = backgroundTexture(palette.background[0], palette.background[1]);
    this.scene.fog = new Fog(palette.fog, palette.fogNear, palette.fogFar);
    this.renderer.toneMappingExposure = palette.exposure;
    this.renderer.shadowMap.enabled = this.settings.shadows && !space;

    const sun = new DirectionalLight(palette.sun.color, palette.sun.intensity);
    sun.position.set(...palette.sun.position);
    if (this.renderer.shadowMap.enabled) {
      sun.castShadow = true;
      sun.shadow.mapSize.set(this.settings.shadowSize, this.settings.shadowSize);
      const extent = Math.max(view.config.width, view.config.height) * UNIT * 0.62;
      Object.assign(sun.shadow.camera, { left: -extent, right: extent, top: extent, bottom: -extent, near: 10, far: 400 });
      sun.shadow.bias = -0.0006;
      sun.shadow.normalBias = 0.04;
      sun.shadow.camera.updateProjectionMatrix();
    }
    this.scene.add(sun, new HemisphereLight(palette.hemi.sky, palette.hemi.ground, palette.hemi.intensity));
    if (this.theme === 'scifi') this.scene.add(new AmbientLight('#3a5a8a', 0.4));

    if (space) this.buildSpace();
    else this.buildTerrain();
    this.buildRoutes();
    this.buildStructures();
    this.buildLabels();
    this.buildBeacon();
    this.placeSelectRing();
    this.setupComposer();
    this.refreshDynamic();
    // 首次进入：从高处缓缓推到当前位置。
    const current = view.current?.location;
    // 镜头对准当前位置与地图中心之间，既看得清脚下也看得到周边。
    const target = current ? this.anchor(current).lerp(new Vector3(0, 0, 0), 0.35) : new Vector3();
    const final = current ? this.fitDistance() * 0.68 : this.fitDistance();
    this.placeCamera(target, final * 1.7, 0.5, 0.3);
    this.flyTo(target, final, 0.9, motionAllowed() ? 1700 : 0);
  }

  private setupComposer() {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
    if (!this.settings.bloom) return;
    const target = new WebGLRenderTarget(this.width, this.height, { type: HalfFloatType, samples: this.settings.samples });
    const composer = new EffectComposer(this.renderer, target);
    composer.setPixelRatio(this.settings.pixelRatio);
    composer.setSize(this.width, this.height);
    composer.addPass(new RenderPass(this.scene, this.camera));
    const { strength, radius, threshold } = this.palette.bloom;
    this.bloom = new UnrealBloomPass(new Vector2(this.width, this.height), strength, radius, threshold);
    composer.addPass(this.bloom);
    composer.addPass(new OutputPass());
    this.composer = composer;
  }

  private toWorld(x: number, y: number): { x: number; z: number } {
    const view = this.view!;
    return { x: (x - view.config.width / 2) * UNIT, z: (y - view.config.height / 2) * UNIT };
  }

  private elevation(h: number): number {
    return h >= 0 ? h * this.palette.heightScale : h * this.palette.heightScale * 0.42;
  }

  /**
   * 世界坐标里的地面高度。按地形网格的三角面插值（每格沿右上—左下对角线切成两个三角形），
   * 和网格表面完全一致；用双线性插值时，窄河谷里的河流、道路带子会陷进网格下面看不见。
   */
  private heightAt(x: number, y: number): number {
    const grid = this.grid;
    if (!grid || grid.space) return 0;
    const fx = MathUtils.clamp((x / grid.width) * (grid.cols - 1), 0, grid.cols - 1.0001);
    const fy = MathUtils.clamp((y / grid.height) * (grid.rows - 1), 0, grid.rows - 1.0001);
    const col = Math.floor(fx);
    const row = Math.floor(fy);
    const tx = fx - col;
    const ty = fy - row;
    const index = row * grid.cols + col;
    const a = this.elevation(grid.heights[index]!);
    const b = this.elevation(grid.heights[index + 1]!);
    const c = this.elevation(grid.heights[index + grid.cols]!);
    const d = this.elevation(grid.heights[index + grid.cols + 1]!);
    return tx + ty <= 1 ? a + (b - a) * tx + (c - a) * ty : d + (c - d) * (1 - tx) + (b - d) * (1 - ty);
  }

  private groundAt(x: number, y: number): number {
    return Math.max(this.heightAt(x, y), 0.02);
  }

  private locationOf(id: string): MapLocation | undefined {
    return this.view?.locations.find(item => item.location.id === id)?.location;
  }

  /** 地点在 3D 里的位置（星域悬浮在网格上方）。 */
  private anchor(location: MapLocation): Vector3 {
    const world = this.toWorld(location.x, location.y);
    if (this.view?.config.landform === 'space') return new Vector3(world.x, this.spaceHeight(location), world.z);
    return new Vector3(world.x, this.groundAt(location.x, location.y), world.z);
  }

  private spaceHeight(location: MapLocation): number {
    const rand = seeded(location.id);
    return 3.2 + rand() * 3.4 + (location.kind === 'capital' ? 1.5 : 0);
  }

  private fitDistance(): number {
    const view = this.view!;
    const size = Math.max(view.config.width, view.config.height * this.width / Math.max(1, this.height)) * UNIT;
    return MathUtils.clamp(size * 1.25, 60, 180);
  }

  private buildTerrain() {
    const grid = this.grid!;
    const view = this.view!;
    const palette = this.palette;
    const { cols, rows } = grid;
    const width = view.config.width * UNIT;
    const depth = view.config.height * UNIT;
    const positions = new Float32Array(cols * rows * 3);
    const colors = new Float32Array(cols * rows * 3);
    const color = new Color();
    const rock = new Color(palette.rock);
    const snow = new Color(palette.snow);
    const biomeColors = new Map<string, Color>();
    const rand = seeded(`${view.config.seed}`);
    const noise = createNoise2D(view.config.seed + 5);
    for (let row = 0; row < rows; row++) {
      for (let col = 0; col < cols; col++) {
        const index = row * cols + col;
        const h = grid.heights[index]!;
        positions[index * 3] = (col / (cols - 1) - 0.5) * width;
        positions[index * 3 + 1] = this.elevation(h);
        positions[index * 3 + 2] = (row / (rows - 1) - 0.5) * depth;
        const biome = biomeAt(grid, index);
        let base = biomeColors.get(biome);
        if (!base) { base = new Color(palette.land[biome]); biomeColors.set(biome, base); }
        color.copy(base);
        if (h < 0) color.lerp(new Color(palette.deep), Math.min(1, -h * 1.4));
        else {
          const left = grid.heights[row * cols + Math.max(0, col - 1)]!;
          const right = grid.heights[row * cols + Math.min(cols - 1, col + 1)]!;
          const upper = grid.heights[Math.max(0, row - 1) * cols + col]!;
          const lower = grid.heights[Math.min(rows - 1, row + 1) * cols + col]!;
          const slope = Math.min(1, Math.hypot(right - left, lower - upper) * 9);
          color.lerp(rock, Math.min(0.85, slope * 0.75 + Math.max(0, h - 0.55) * 0.9));
          if (h > 0.8) color.lerp(snow, Math.min(1, (h - 0.8) * 7));
        }
        // 大块色斑 + 细微颗粒，打破平地的单调。
        const patch = h >= 0 ? 0.9 + 0.2 * (0.5 + 0.5 * noise(col * 0.045, row * 0.045)) : 1;
        const jitter = patch * (0.96 + rand() * 0.07);
        colors[index * 3] = color.r * jitter;
        colors[index * 3 + 1] = color.g * jitter;
        colors[index * 3 + 2] = color.b * jitter;
      }
    }
    const indices: number[] = [];
    for (let row = 0; row < rows - 1; row++) {
      for (let col = 0; col < cols - 1; col++) {
        const a = row * cols + col;
        const b = a + 1;
        const c = a + cols;
        const d = c + 1;
        indices.push(a, c, b, b, c, d);
      }
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const scifi = this.theme === 'scifi';
    const terrain = new Mesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: scifi ? 0.55 : 0.96, metalness: scifi ? 0.2 : 0, ...(scifi ? { emissive: new Color('#03141e') } : {}) }));
    terrain.receiveShadow = true;
    terrain.castShadow = true;
    this.content.add(terrain);
    if (scifi) {
      const holo = createHoloMaterial({ color: palette.foam, heightScale: palette.heightScale });
      const current = view.current?.location;
      if (current) { const world = this.toWorld(current.x, current.y); holo.uniforms.origin!.value = [world.x, world.z]; }
      this.animated.push({ material: holo });
      const overlay = new Mesh(geometry, holo);
      overlay.renderOrder = 2;
      this.content.add(overlay);
    }

    // 沙盘侧面：四条边各拉一段土层到底座。
    const skirt = new BufferGeometry();
    const skirtPositions: number[] = [];
    const skirtColors: number[] = [];
    const strata = palette.strata.map(value => new Color(value));
    const edge = (indicesAlong: number[]) => {
      for (let step = 0; step < indicesAlong.length - 1; step++) {
        const a = indicesAlong[step]!;
        const b = indicesAlong[step + 1]!;
        const ax = positions[a * 3]!, az = positions[a * 3 + 2]!, ay = Math.max(positions[a * 3 + 1]!, 0);
        const bx = positions[b * 3]!, bz = positions[b * 3 + 2]!, by = Math.max(positions[b * 3 + 1]!, 0);
        const quad = [[ax, ay, az], [bx, by, bz], [ax, BASE, az], [bx, by, bz], [bx, BASE, bz], [ax, BASE, az]];
        for (const [x, y, z] of quad) {
          skirtPositions.push(x!, y!, z!);
          const t = MathUtils.clamp((Math.max(ay, by) - y!) / (Math.max(ay, by) - BASE + 0.001), 0, 1);
          const tone = t < 0.18 ? strata[0]! : t < 0.6 ? strata[1]! : strata[2]!;
          skirtColors.push(tone.r, tone.g, tone.b);
        }
      }
    };
    const north = Array.from({ length: cols }, (_, col) => col);
    const south = Array.from({ length: cols }, (_, col) => (rows - 1) * cols + col).reverse();
    const west = Array.from({ length: rows }, (_, row) => row * cols).reverse();
    const east = Array.from({ length: rows }, (_, row) => row * cols + cols - 1);
    edge(north); edge(south); edge(west); edge(east);
    skirt.setAttribute('position', new Float32BufferAttribute(skirtPositions, 3));
    skirt.setAttribute('color', new Float32BufferAttribute(skirtColors, 3));
    skirt.computeVertexNormals();
    const skirtMesh = new Mesh(skirt, new MeshStandardMaterial({ vertexColors: true, roughness: 1, side: DoubleSide }));
    this.content.add(skirtMesh);

    // 底座与包边
    const plinth = new Mesh(new BoxGeometry(width + 2.6, 1.6, depth + 2.6), new MeshStandardMaterial({ color: palette.plinth, roughness: this.theme === 'modern' ? 0.6 : 0.8, metalness: 0.05 }));
    plinth.position.y = BASE - 0.8;
    plinth.receiveShadow = true;
    const trim = new Mesh(new BoxGeometry(width + 2.9, 0.18, depth + 2.9), new MeshStandardMaterial({ color: palette.trim, roughness: 0.55, metalness: this.theme === 'ancient' ? 0.5 : 0.2, ...(scifi ? { emissive: new Color(palette.trim), emissiveIntensity: 1.6 } : {}) }));
    trim.position.y = BASE + 0.02;
    this.content.add(plinth, trim);
    const shadow = new Mesh(new PlaneGeometry(width * 2.2, depth * 2.4), new MeshBasicMaterial({ map: glowTexture('rgba(0,0,0,0.7)', 'rgba(0,0,0,0)'), transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = BASE - 1.65;
    this.content.add(shadow);

    let hasWater = false;
    for (let index = 0; index < grid.heights.length; index++) if (grid.heights[index]! < 0) { hasWater = true; break; }
    if (hasWater) {
      const water = new Mesh(new PlaneGeometry(width, depth), createWaterMaterial({
        heights: heightTexture(grid), shallow: palette.shallow, deep: palette.deep, foam: palette.foam, sky: palette.background[0],
        sunDir: palette.sun.position, scifi,
      }));
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.03;
      water.renderOrder = 1;
      this.animated.push({ material: water.material as ShaderMaterial });
      this.content.add(water);
    }
    this.mask = featureMask(view.config);
    if (this.theme !== 'scifi') this.buildTrees();
    // 画了建筑轮廓的地图挤出真实楼宇，不再铺程序生成的楼群。
    if (this.theme !== 'ancient' && !hasFeatures(view.config, 'building')) this.buildCityBlocks();
    if (hasFeatures(view.config)) {
      this.content.add(buildFeatureMeshes({ config: view.config, theme: this.theme, unit: UNIT, heightAt: (x, y) => this.heightAt(x, y), waterColor: String(palette.shallow) }));
    }
  }

  /** 城区铺满楼群：离城市、地标越近越高，避开道路与地点本身（现代白模 / 科幻霓虹）。 */
  private buildCityBlocks() {
    const grid = this.grid!;
    const view = this.view!;
    const scifi = this.theme === 'scifi';
    const rand = seeded(`city-${view.config.seed}`);
    const locations = view.locations.map(item => item.location);
    const tall: Record<string, number> = { capital: 1, landmark: 0.9, city: 0.75, station: 0.45, market: 0.35, academy: 0.3, town: 0.35, fortress: 0.3, home: 0.25 };
    // 只有塔楼大厦一类的名胜周围起高楼；操场、公园、山顶这些名胜按普通街区算。
    const anchors = locations.flatMap(location => {
      const weight = location.kind === 'landmark' && landmarkStyle(location) !== 'tower' ? 0.3 : tall[location.kind];
      return weight === undefined ? [] : [{ x: location.x, y: location.y, weight }];
    });
    const roads = new Map<string, Array<[number, number]>>();
    const key = (x: number, z: number) => `${Math.floor(x)}|${Math.floor(z)}`;
    for (const { route, known } of view.routes) {
      if (!known) continue;
      const a = this.locationOf(route.from);
      const b = this.locationOf(route.to);
      if (!a || !b) continue;
      for (const point of this.routePoints(route, a, b)) {
        const bucket = roads.get(key(point.x, point.z));
        if (bucket) bucket.push([point.x, point.z]); else roads.set(key(point.x, point.z), [[point.x, point.z]]);
      }
    }
    const nearRoad = (x: number, z: number) => {
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        for (const [px, pz] of roads.get(key(x + dx, z + dz)) ?? []) if (Math.hypot(px - x, pz - z) < 0.34) return true;
      }
      return false;
    };
    const spots: Array<{ x: number; z: number; ground: number; w: number; d: number; h: number; rot: number; cap: boolean }> = [];
    const spacing = 5.6;
    for (let y = spacing / 2; y < view.config.height; y += spacing) {
      for (let x = spacing / 2; x < view.config.width; x += spacing) {
        const px = x + (rand() - 0.5) * 1.6;
        const py = y + (rand() - 0.5) * 1.6;
        const col = Math.round((px / view.config.width) * (grid.cols - 1));
        const row = Math.round((py / view.config.height) * (grid.rows - 1));
        const index = row * grid.cols + col;
        if (biomeAt(grid, index) !== 'urban' || (grid.heights[index] ?? 0) < 0.012) continue;
        if (rand() > 0.3 + (grid.weights[index] ?? 0) * 0.65) continue;
        if (locations.some(location => Math.hypot(location.x - px, location.y - py) < 13)) continue;
        if (this.mask?.blocked(px, py)) continue;
        const world = this.toWorld(px, py);
        if (nearRoad(world.x, world.z)) continue;
        let lift = 0;
        for (const anchor of anchors) lift = Math.max(lift, anchor.weight * Math.exp(-Math.hypot(anchor.x - px, anchor.y - py) / 70));
        const h = 0.16 + rand() * 0.32 + lift * (0.4 + Math.pow(rand(), 1.8) * (scifi ? 4 : 3.2));
        spots.push({ x: world.x, z: world.z, ground: this.heightAt(px, py), w: 0.2 + rand() * 0.2, d: 0.2 + rand() * 0.22, h, rot: (grid.regions[index] ?? 0) * 0.37, cap: scifi ? rand() < 0.45 : h > 1.6 && rand() < 0.4 });
      }
    }
    const limit = [700, 1400, 2400, 3200][this.settings.tier]!;
    const chosen = spots.length > limit ? spots.filter(() => rand() < limit / spots.length) : spots;
    if (!chosen.length) return;
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const blocks = new InstancedMesh(box, new MeshStandardMaterial({ roughness: scifi ? 0.4 : 0.62, metalness: scifi ? 0.5 : 0.05, ...(scifi ? { emissive: new Color('#061428') } : {}) }), chosen.length);
    const dummy = new Object3D();
    const tint = new Color();
    const tones = scifi ? ['#16243c', '#1b2c4a', '#101c30', '#22385a'] : ['#f6f6f4', '#eceef0', '#e2e6ea', '#dfe7ef', '#d6e2ee'];
    chosen.forEach((spot, index) => {
      dummy.position.set(spot.x, spot.ground - 0.02, spot.z);
      dummy.rotation.set(0, spot.rot, 0);
      dummy.scale.set(spot.w, spot.h, spot.d);
      dummy.updateMatrix();
      blocks.setMatrixAt(index, dummy.matrix);
      blocks.setColorAt(index, tint.set(tones[index % tones.length]!));
    });
    blocks.castShadow = true;
    blocks.receiveShadow = true;
    this.content.add(blocks);
    const capped = chosen.filter(spot => spot.cap);
    if (!capped.length) return;
    const caps = new InstancedMesh(box.clone(), new MeshBasicMaterial({ color: '#ffffff' }), capped.length);
    const neon = scifi ? ['#3ee8ff', '#ff5cdc', '#8aff6b', '#ffb84f'] : ['#ffe7a8', '#ffd27a'];
    capped.forEach((spot, index) => {
      dummy.position.set(spot.x, spot.ground + spot.h - 0.01, spot.z);
      dummy.rotation.set(0, spot.rot, 0);
      dummy.scale.set(spot.w * 1.04, 0.035, spot.d * 1.04);
      dummy.updateMatrix();
      caps.setMatrixAt(index, dummy.matrix);
      caps.setColorAt(index, tint.set(neon[index % neon.length]!).multiplyScalar(scifi ? 2.2 : 1.2));
    });
    this.content.add(caps);
  }

  private buildTrees() {
    const grid = this.grid!;
    const view = this.view!;
    const rand = seeded(`trees-${view.config.seed}`);
    const spots: Array<{ x: number; y: number }> = [];
    const spacing = 6.2;
    const locations = view.locations.map(item => item.location);
    for (let y = spacing / 2; y < view.config.height; y += spacing) {
      for (let x = spacing / 2; x < view.config.width; x += spacing) {
        const px = x + (rand() - 0.5) * spacing;
        const py = y + (rand() - 0.5) * spacing;
        const col = Math.round((px / view.config.width) * (grid.cols - 1));
        const row = Math.round((py / view.config.height) * (grid.rows - 1));
        const index = row * grid.cols + col;
        const h = grid.heights[index] ?? 0;
        const biome = biomeAt(grid, index);
        const chance = biome === 'forest' ? 0.85 : biome === 'swamp' ? 0.22 : biome === 'hills' ? 0.12 : biome === 'farmland' || biome === 'plains' ? (this.theme === 'modern' ? 0.015 : 0.022) : 0;
        if (h <= 0.02 || h > 0.62 || rand() > chance) continue;
        if (locations.some(location => Math.hypot(location.x - px, location.y - py) < 22)) continue;
        if (this.mask?.blocked(px, py)) continue;
        spots.push({ x: px, y: py });
      }
    }
    const selected = spots.length > this.settings.trees ? spots.filter(() => rand() < this.settings.trees / spots.length) : spots;
    const dummy = new Object3D();
    const tint = new Color();
    for (let variant = 0; variant < 2; variant++) {
      const list = selected.filter((_, index) => index % 2 === variant);
      if (!list.length) continue;
      const geometry = treeGeometry(this.theme, this.palette, variant);
      const mesh = new InstancedMesh(geometry, new MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }), list.length);
      list.forEach((spot, index) => {
        const world = this.toWorld(spot.x, spot.y);
        dummy.position.set(world.x, this.heightAt(spot.x, spot.y) - 0.02, world.z);
        dummy.rotation.y = rand() * Math.PI * 2;
        const scale = 0.85 + rand() * 0.7;
        dummy.scale.set(scale, scale * (0.9 + rand() * 0.35), scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(index, dummy.matrix);
        tint.setScalar(0.82 + rand() * 0.3);
        mesh.setColorAt(index, tint);
      });
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.content.add(mesh);
    }
  }

  private buildSpace() {
    const view = this.view!;
    const palette = this.palette;
    const width = view.config.width * UNIT;
    const depth = view.config.height * UNIT;
    // 全息网格底板
    const grid = new Mesh(new PlaneGeometry(width * 1.1, depth * 1.1), createHoloMaterial({ color: palette.foam, heightScale: 1, contours: false, gridSize: 5 }));
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -0.01;
    this.animated.push({ material: grid.material as ShaderMaterial });
    const current = view.current?.location;
    if (current) { const world = this.toWorld(current.x, current.y); (grid.material as ShaderMaterial).uniforms.origin!.value = [world.x, world.z]; }
    const disc = new Mesh(new PlaneGeometry(width * 1.1, depth * 1.1), new MeshBasicMaterial({ color: '#04101e', transparent: true, opacity: 0.55, depthWrite: false }));
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = -0.05;
    this.content.add(disc, grid);
    const rim = new Mesh(new RingGeometry(width * 0.62, width * 0.625, 128), new MeshBasicMaterial({ color: palette.foam, transparent: true, opacity: 0.35, side: DoubleSide }));
    rim.rotation.x = -Math.PI / 2;
    this.content.add(rim);
    // 星空
    const rand = seeded(`stars-${view.config.seed}`);
    const starCount = [900, 1600, 2400, 3000][this.settings.tier]!;
    const stars = new Float32Array(starCount * 3);
    const starColors = new Float32Array(starCount * 3);
    for (let index = 0; index < starCount; index++) {
      const theta = rand() * Math.PI * 2;
      const phi = Math.acos(rand() * 1.6 - 0.6);
      const radius = 420 + rand() * 200;
      stars[index * 3] = Math.sin(phi) * Math.cos(theta) * radius;
      stars[index * 3 + 1] = Math.cos(phi) * radius * 0.7 + 40;
      stars[index * 3 + 2] = Math.sin(phi) * Math.sin(theta) * radius;
      const tone = 0.6 + rand() * 0.4;
      starColors[index * 3] = tone * (0.85 + rand() * 0.15);
      starColors[index * 3 + 1] = tone * 0.92;
      starColors[index * 3 + 2] = tone;
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new BufferAttribute(stars, 3));
    starGeometry.setAttribute('color', new BufferAttribute(starColors, 3));
    this.scene.add(new Points(starGeometry, new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0.85, fog: false })));
    // 星云与小行星带
    const glow = glowTexture();
    for (const { region, accent } of view.regions) {
      const world = this.toWorld(region.x, region.y);
      const spread = region.radius * UNIT;
      if (region.terrain === 'asteroid') {
        const count = Math.round(spread * spread * 2.4);
        const rocks = new InstancedMesh(new IcosahedronGeometry(0.16, 0), new MeshStandardMaterial({ color: '#8a7058', roughness: 0.9, metalness: 0.1 }), count);
        const dummy = new Object3D();
        const belt = new Group();
        belt.position.set(world.x, 1.2, world.z);
        for (let index = 0; index < count; index++) {
          const angle = rand() * Math.PI * 2;
          const radius = Math.sqrt(rand()) * spread * 0.95;
          dummy.position.set(Math.cos(angle) * radius, (rand() - 0.5) * 1.6, Math.sin(angle) * radius);
          dummy.rotation.set(rand() * 3, rand() * 3, rand() * 3);
          const scale = 0.3 + Math.pow(rand(), 3) * 2.6;
          dummy.scale.set(scale, scale * (0.6 + rand() * 0.5), scale);
          dummy.updateMatrix();
          rocks.setMatrixAt(index, dummy.matrix);
        }
        belt.add(rocks);
        this.spinning.push(belt);
        this.content.add(belt);
      }
      if (region.terrain === 'void') {
        const ring = new Mesh(new RingGeometry(spread * 0.78, spread * 0.8, 96), new MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.35, side: DoubleSide, depthWrite: false }));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(world.x, 0.05, world.z);
        this.content.add(ring);
        continue;
      }
      const count = Math.round(Math.min(1800, spread * spread * (this.settings.tier >= 2 ? 7 : 4)));
      const cloud = new Float32Array(count * 3);
      const tints = new Float32Array(count * 3);
      const base = new Color(accent);
      for (let index = 0; index < count; index++) {
        const angle = rand() * Math.PI * 2;
        const radius = Math.abs((rand() + rand() + rand() - 1.5) / 1.5) * spread;
        cloud[index * 3] = world.x + Math.cos(angle) * radius;
        cloud[index * 3 + 1] = 0.6 + (rand() - 0.3) * 3.2 * (1 - radius / spread);
        cloud[index * 3 + 2] = world.z + Math.sin(angle) * radius * 0.85;
        const shift = 0.75 + rand() * 0.5;
        tints[index * 3] = base.r * shift; tints[index * 3 + 1] = base.g * shift; tints[index * 3 + 2] = base.b * shift;
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(cloud, 3));
      geometry.setAttribute('color', new BufferAttribute(tints, 3));
      const dusty = region.terrain === 'asteroid';
      this.content.add(new Points(geometry, new PointsMaterial({ size: dusty ? 1.6 : 2.1, map: glow, vertexColors: true, transparent: true, opacity: dusty ? 0.1 : 0.17, depthWrite: false, blending: AdditiveBlending })));
      for (let index = 0; index < 4; index++) {
        const sprite = new Sprite(new SpriteMaterial({ map: glow, color: accent, transparent: true, opacity: region.terrain === 'asteroid' ? 0.04 : 0.085, depthWrite: false, blending: AdditiveBlending }));
        const angle = rand() * Math.PI * 2;
        const radius = rand() * spread * 0.4;
        sprite.position.set(world.x + Math.cos(angle) * radius, 1 + rand() * 2, world.z + Math.sin(angle) * radius);
        sprite.scale.setScalar(spread * (1.1 + rand() * 0.7));
        this.content.add(sprite);
      }
    }
  }

  /** 路线上的采样点：沿 2D 曲线（与平面地图相同）贴地，海路与航空走弧线。 */
  private routePoints(route: MapRoute, a: MapLocation, b: MapLocation, lift = 0.14): Vector3[] {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy) || 1;
    let hash = 0;
    for (let index = 0; index < route.id.length; index++) hash = (hash * 31 + route.id.charCodeAt(index)) | 0;
    const sign = hash & 1 ? 1 : -1;
    const bend = route.kind === 'sea' ? 0.2 : route.kind === 'air' ? 0.24 : route.kind === 'rail' || route.kind === 'highway' || route.kind === 'warp' ? 0.03 : 0.09;
    const cx = (a.x + b.x) / 2 - (dy / length) * length * bend * sign;
    const cy = (a.y + b.y) / 2 + (dx / length) * length * bend * sign;
    const steps = Math.max(12, Math.min(90, Math.round(length / 6)));
    const space = this.view?.config.landform === 'space';
    const startY = space ? this.spaceHeight(a) : 0;
    const endY = space ? this.spaceHeight(b) : 0;
    // 有途经点的路线沿折线走（与 2D 一致），每 3 个地图单位取一个点贴地。
    const line = routeLine(route, a, b);
    const flat: Array<[number, number]> = line ? resample(smoothLine(line, 3), 3) : Array.from({ length: steps + 1 }, (_, step) => {
      const t = step / steps;
      return [(1 - t) * (1 - t) * a.x + 2 * (1 - t) * t * cx + t * t * b.x, (1 - t) * (1 - t) * a.y + 2 * (1 - t) * t * cy + t * t * b.y] as [number, number];
    });
    const points: Vector3[] = [];
    for (let step = 0; step < flat.length; step++) {
      const t = flat.length > 1 ? step / (flat.length - 1) : 0;
      const [x, y] = flat[step]!;
      const world = this.toWorld(x, y);
      let height: number;
      if (space) height = startY + (endY - startY) * t + Math.sin(t * Math.PI) * Math.min(6, length * UNIT * 0.12);
      else if (route.kind === 'air') height = this.groundAt(x, y) + Math.sin(t * Math.PI) * Math.min(9, length * UNIT * 0.22) + lift;
      else if (route.kind === 'sea' || route.kind === 'river') height = Math.max(this.heightAt(x, y), 0.05) + lift * 0.8;
      else height = this.groundAt(x, y) + lift;
      points.push(new Vector3(world.x, height, world.z));
    }
    return points;
  }

  private buildRoutes() {
    const view = this.view!;
    const palette = this.palette;
    const scifi = this.theme === 'scifi';
    for (const { route, known, walked } of view.routes) {
      if (!known) continue;
      const a = this.locationOf(route.from);
      const b = this.locationOf(route.to);
      if (!a || !b) continue;
      const curve = new CatmullRomCurve3(this.routePoints(route, a, b));
      const length = curve.getLength();
      const danger = (route.danger ?? 0) >= 3;
      const style = scifi
        ? { color: danger ? palette.danger : route.kind === 'air' ? palette.routeAlt : route.kind === 'secret' ? '#ff5cdc' : palette.route, radius: 0.075, dash: route.kind === 'air' ? 0.4 : 1.2, gap: route.kind === 'air' ? 0.5 : 0.7, flow: 2.2, glow: true }
        : this.theme === 'modern'
          ? {
            color: route.kind === 'highway' ? palette.routeAlt : route.kind === 'rail' ? '#6d7884' : route.kind === 'sea' ? '#2f83d9' : route.kind === 'air' ? '#8e5bd6' : route.kind === 'trail' ? '#9c8a74' : danger ? '#e0a49c' : palette.route,
            radius: route.kind === 'highway' ? 0.14 : route.kind === 'trail' ? 0.05 : 0.1, dash: route.kind === 'trail' || route.kind === 'sea' || route.kind === 'air' ? 0.5 : 0, gap: route.kind === 'trail' || route.kind === 'sea' || route.kind === 'air' ? 0.4 : 0, flow: 0, glow: false,
          }
          : {
            color: route.kind === 'river' || route.kind === 'sea' ? '#2f5560' : route.kind === 'secret' ? palette.danger : route.kind === 'trail' || route.kind === 'mountain' ? '#7a5a35' : '#5a3b1c',
            radius: route.kind === 'road' ? 0.085 : 0.06, dash: route.kind === 'road' ? 0.7 : 0.35, gap: route.kind === 'road' ? 0.35 : 0.4, flow: 0, glow: false,
          };
      const material = createRouteMaterial({ color: walked && !scifi ? (this.theme === 'ancient' ? '#9b2f1d' : '#1a73e8') : style.color, length, dash: style.dash, gap: style.gap, flow: style.flow, opacity: route.hidden ? 0.6 : 0.95, glow: style.glow });
      if (style.flow) this.animated.push({ material });
      const mesh = new Mesh(new TubeGeometry(curve, Math.max(16, Math.round(length * 2.2)), walked ? style.radius * 1.35 : style.radius, 6, false), material);
      mesh.renderOrder = 4;
      mesh.castShadow = !style.glow && this.theme === 'modern';
      this.content.add(mesh);
    }
  }

  private buildStructures() {
    const view = this.view!;
    const space = view.config.landform === 'space';
    const solidMaterial = new MeshStandardMaterial({ vertexColors: true, roughness: this.theme === 'modern' ? 0.55 : 0.85, metalness: this.theme === 'scifi' ? 0.35 : 0.02, ...(space ? { emissive: new Color('#1a3050'), emissiveIntensity: 0.9 } : {}) });
    const glowMaterial = new MeshStandardMaterial({ vertexColors: true, emissive: new Color('#ffffff'), emissiveIntensity: this.theme === 'scifi' ? 2.4 : 1.3, roughness: 0.4, toneMapped: true });
    // 发光体用顶点色作自发光颜色：复制一份顶点色给 emissiveMap 不方便，这里让 emissive 乘以顶点色。
    glowMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n totalEmissiveRadiance *= vColor.rgb;');
    };
    for (const item of view.locations) {
      const location = item.location;
      const group = new Group();
      const anchor = this.anchor(location);
      group.position.set(anchor.x, 0, anchor.z);
      const { solid, glow } = buildStructure(this.theme, location.kind, location.id, this.palette, anchor.y, space, landmarkStyle(location));
      if (solid) {
        const mesh = new Mesh(solid, solidMaterial);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      if (glow) group.add(new Mesh(glow, glowMaterial));
      if (space && ['capital', 'city', 'town', 'village', 'home', 'academy'].includes(location.kind)) {
        const halo = new Sprite(new SpriteMaterial({ map: glowTexture(), color: location.kind === 'capital' ? '#ff9ae6' : '#7fd8ff', transparent: true, opacity: 0.32, depthWrite: false, blending: AdditiveBlending }));
        halo.position.y = anchor.y;
        halo.scale.setScalar(location.kind === 'capital' ? 9 : 6);
        group.add(halo);
      }
      if (space) {
        const stem = new Mesh(new CylinderGeometry(0.03, 0.03, anchor.y, 6, 1, true), new MeshBasicMaterial({ color: this.palette.foam, transparent: true, opacity: 0.35, depthWrite: false, blending: AdditiveBlending }));
        stem.position.y = anchor.y / 2;
        const foot = new Mesh(new RingGeometry(0.5, 0.62, 32), new MeshBasicMaterial({ color: this.palette.foam, transparent: true, opacity: 0.5, side: DoubleSide, depthWrite: false }));
        foot.rotation.x = -Math.PI / 2;
        foot.position.y = 0.03;
        group.add(stem, foot);
      }
      const hit = new Mesh(new SphereGeometry(space ? 2.4 : 1.6, 8, 6), new MeshBasicMaterial({ visible: false }));
      hit.position.y = anchor.y + 0.6;
      hit.userData.id = location.id;
      group.add(hit);
      this.hitTargets.push(hit);
      this.structures.set(location.id, group);
      this.content.add(group);
    }
  }

  private buildLabels() {
    const view = this.view!;
    for (const item of view.locations) {
      const element = document.createElement('div');
      element.className = `map3d-label map3d-label--${item.location.kind}`;
      element.textContent = item.location.name;
      element.dataset.id = item.location.id;
      this.labels.appendChild(element);
      const anchor = this.anchor(item.location);
      const kind = item.location.kind;
      const priority = kind === 'capital' ? 5 : kind === 'city' ? 4 : ['town', 'port'].includes(kind) ? 3 : 2;
      const lift = view.config.landform === 'space'
        ? (kind === 'capital' ? 3.4 : ['city', 'town'].includes(kind) ? 2.8 : 2.2)
        : this.theme === 'modern'
          ? (kind === 'landmark' ? (landmarkStyle(item.location) === 'tower' ? 7.2 : 1.9) : kind === 'capital' ? 4.8 : kind === 'city' ? 3.4 : 1.6)
          : this.theme === 'scifi'
            ? (kind === 'capital' ? 5.2 : kind === 'city' || kind === 'landmark' ? 3.6 : 1.8)
            : (kind === 'capital' ? 2.1 : kind === 'landmark' ? 2 : 1.35);
      this.labelEntries.push({ element, position: anchor.clone().add(new Vector3(0, lift, 0)), priority, id: item.location.id });
    }
    for (const { region } of view.regions) {
      const element = document.createElement('div');
      element.className = `map3d-region-label${region.terrain === 'sea' || region.terrain === 'lake' ? ' is-water' : ''}`;
      element.textContent = region.name;
      this.labels.appendChild(element);
      const world = this.toWorld(region.x, region.y);
      this.regionLabels.push({ element, position: new Vector3(world.x, Math.max(0.4, this.heightAt(region.x, region.y)) + (view.config.landform === 'space' ? 7 : 4.5), world.z), priority: 0, id: region.id });
    }
  }

  private buildBeacon() {
    const group = new Group();
    const beam = new Mesh(new CylinderGeometry(0.16, 0.36, 12, 24, 1, true), createBeamMaterial(this.palette.beacon));
    beam.position.y = 6;
    this.animated.push({ material: beam.material as ShaderMaterial });
    const ringMaterial = new MeshBasicMaterial({ color: this.palette.beacon, transparent: true, opacity: 0.8, side: DoubleSide, depthWrite: false, blending: AdditiveBlending });
    const ring = new Mesh(new RingGeometry(0.9, 1.15, 48), ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.08;
    ring.name = 'pulse';
    const core = new Mesh(new SphereGeometry(0.16, 16, 12), new MeshBasicMaterial({ color: new Color(this.palette.beacon).multiplyScalar(1.6) }));
    core.position.y = 0.3;
    group.add(beam, ring, core);
    group.visible = false;
    this.beacon = group;
    this.content.add(group);
    const select = new Mesh(new RingGeometry(1.5, 1.72, 6), new MeshBasicMaterial({ color: this.palette.select, transparent: true, opacity: 0.95, side: DoubleSide, depthWrite: false }));
    select.rotation.x = -Math.PI / 2;
    select.visible = false;
    this.selectRing = select;
    this.content.add(select);
  }

  private placeSelectRing() {
    if (!this.selectRing) return;
    const location = this.selected ? this.locationOf(this.selected) : undefined;
    if (!location) { this.selectRing.visible = false; return; }
    const anchor = this.anchor(location);
    this.selectRing.position.set(anchor.x, anchor.y + 0.12, anchor.z);
    this.selectRing.visible = true;
  }

  /** 位置、已知范围变化：显隐建筑与地名、移动光柱，不重建地形。 */
  private refreshDynamic() {
    const view = this.view;
    if (!view) return;
    const status = new Map(view.locations.map(item => [item.location.id, item.status] as const));
    for (const [id, group] of this.structures) group.visible = status.get(id) !== 'unknown';
    for (const entry of this.labelEntries) {
      const state = status.get(entry.id);
      entry.element.classList.toggle('is-current', state === 'current');
      entry.element.classList.toggle('is-visited', state === 'visited');
      entry.element.hidden = state === 'unknown';
    }
    for (const entry of this.regionLabels) entry.element.hidden = !view.regions.find(item => item.region.id === entry.id)?.known;
    const current = view.current?.location;
    if (this.beacon) {
      this.beacon.visible = Boolean(current);
      if (current) { const anchor = this.anchor(current); this.beacon.position.set(anchor.x, anchor.y, anchor.z); }
    }
    this.placeSelectRing();
  }

  // ── Camera ──

  private placeCamera(target: Vector3, distance: number, polar: number, azimuth: number) {
    this.controls.target.copy(target);
    const offset = new Vector3().setFromSphericalCoords(distance, polar, azimuth);
    this.camera.position.copy(target).add(offset);
    this.camera.lookAt(target);
    this.controls.update();
  }

  private flyTo(target: Vector3, distance: number, polar: number, duration = 1100) {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const fromDistance = offset.length();
    const fromPolar = Math.acos(MathUtils.clamp(offset.y / Math.max(fromDistance, 1e-6), -1, 1));
    if (!duration || !motionAllowed()) {
      const azimuth = Math.atan2(offset.x, offset.z);
      this.placeCamera(target, distance, polar, azimuth);
      this.flight = null;
      this.dirty = true;
      this.kick();
      return;
    }
    this.flight = { fromTarget: this.controls.target.clone(), toTarget: target.clone(), fromDistance, toDistance: distance, fromPolar, toPolar: polar, start: performance.now(), duration };
    this.kick();
  }

  private stepFlight(now: number) {
    const flight = this.flight;
    if (!flight) return;
    const t = Math.min(1, (now - flight.start) / flight.duration);
    const k = ease(t);
    const offset = this.camera.position.clone().sub(this.controls.target);
    const azimuth = Math.atan2(offset.x, offset.z);
    const target = flight.fromTarget.clone().lerp(flight.toTarget, k);
    const distance = MathUtils.lerp(flight.fromDistance, flight.toDistance, k);
    const polar = MathUtils.lerp(flight.fromPolar, flight.toPolar, k);
    this.placeCamera(target, distance, polar, azimuth + (this.view?.config.landform === 'space' ? 0 : 0));
    if (t >= 1) this.flight = null;
    this.dirty = true;
  }

  // ── Loop ──

  private resize() {
    const rect = this.host.getBoundingClientRect();
    this.width = Math.max(1, Math.round(rect.width));
    this.height = Math.max(1, Math.round(rect.height));
    this.renderer.setSize(this.width, this.height, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = this.width / this.height;
    this.camera.updateProjectionMatrix();
    this.composer?.setSize(this.width, this.height);
    this.bloom?.setSize(this.width, this.height);
    this.dirty = true;
    this.kick();
  }

  private readonly kick = () => {
    if (this.disposed || this.raf) return;
    this.raf = requestAnimationFrame(this.tick);
  };

  private readonly tick = (now: number) => {
    this.raf = 0;
    if (this.disposed) return;
    const moving = motionAllowed();
    if (document.hidden || !this.visible) return;
    const minGap = 1000 / this.settings.fps - 2;
    if (moving && now - this.lastFrame < minGap) { this.raf = requestAnimationFrame(this.tick); return; }
    this.lastFrame = now;
    this.stepFlight(now);
    const changed = this.controls.update();
    if (moving || this.dirty || changed || this.flight) this.frame();
    if (moving || this.flight || changed) this.raf = requestAnimationFrame(this.tick);
  };

  private frame() {
    const elapsed = (performance.now() - this.startedAt) / 1000;
    const time = motionAllowed() ? elapsed : 4;
    for (const { material } of this.animated) if (material.uniforms.time) material.uniforms.time.value = time;
    if (this.beacon) {
      const pulse = this.beacon.getObjectByName('pulse') as Mesh | undefined;
      if (pulse) {
        const phase = (time * 0.6) % 1;
        pulse.scale.setScalar(1 + phase * 2.4);
        (pulse.material as MeshBasicMaterial).opacity = 0.85 * (1 - phase);
      }
    }
    if (this.selectRing?.visible) this.selectRing.rotation.z = time * 0.6;
    for (const object of this.spinning) object.rotation.y = time * 0.02;
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
    this.updateLabels();
    this.dirty = false;
  }

  private updateLabels() {
    const half = { x: this.width / 2, y: this.height / 2 };
    const projected = new Vector3();
    const cameraDistance = this.camera.position.distanceTo(this.controls.target);
    const place = (entry: LabelEntry, region: boolean) => {
      if (entry.element.hidden) return;
      projected.copy(entry.position).project(this.camera);
      const behind = projected.z > 1;
      const x = projected.x * half.x + half.x;
      const y = -projected.y * half.y + half.y;
      const distance = this.camera.position.distanceTo(entry.position);
      const fade = region
        ? MathUtils.clamp((cameraDistance - 28) / 30, 0, 1)
        : MathUtils.clamp(1.35 - distance / (entry.priority >= 4 ? 260 : entry.priority >= 3 ? 170 : 120), 0, 1);
      const important = entry.element.classList.contains('is-current') || entry.id === this.selected || entry.id === this.hovered;
      const opacity = behind ? 0 : important ? 1 : fade;
      entry.element.style.opacity = opacity.toFixed(2);
      entry.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      entry.element.classList.toggle('is-hover', entry.id === this.hovered);
      entry.element.classList.toggle('is-selected', entry.id === this.selected);
    };
    for (const entry of this.labelEntries) place(entry, false);
    for (const entry of this.regionLabels) place(entry, true);
  }

  // ── Pointer ──

  private pick(event: PointerEvent): string | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const visibleTargets = this.hitTargets.filter(target => target.parent?.visible !== false);
    const hit = this.raycaster.intersectObjects(visibleTargets, false)[0];
    return (hit?.object.userData.id as string | undefined) ?? null;
  }

  private readonly onPointerDown = (event: PointerEvent) => { this.down = { x: event.clientX, y: event.clientY }; };

  private readonly onPointerUp = (event: PointerEvent) => {
    const down = this.down;
    this.down = null;
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
    this.callbacks.onSelect?.(this.pick(event));
  };

  private readonly onPointerMove = (event: PointerEvent) => {
    if (this.down) return;
    const id = this.pick(event);
    if (id === this.hovered) return;
    this.hovered = id;
    this.renderer.domElement.style.cursor = id ? 'pointer' : '';
    this.callbacks.onHover?.(id);
    this.dirty = true;
    this.kick();
  };

  private readonly onPointerLeave = () => {
    if (!this.hovered) return;
    this.hovered = null;
    this.callbacks.onHover?.(null);
    this.dirty = true;
    this.kick();
  };

  private readonly onLost = (event: Event) => {
    event.preventDefault();
    this.callbacks.onLost?.();
  };
}
