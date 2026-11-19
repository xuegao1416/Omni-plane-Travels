import {
BufferAttribute,
BufferGeometry,
Color,
CylinderGeometry,
DirectionalLight,
DoubleSide,
Euler,
Group,
HemisphereLight,
IcosahedronGeometry,
InstancedBufferAttribute,
InstancedMesh,
Matrix4,
Mesh,
Object3D,
PCFShadowMap,
PointLight,
Points,
Quaternion,
Scene,
SphereGeometry,
TorusGeometry,
Vector3,
Vector4,
type Texture,
type WebGLRenderer,
} from 'three';
import {
archedDrum,
baluster,
COLUMN_DETAIL,
columnParts,
crease,
crystalCluster,
crystalLozenge,
domeShell,
lathe,
logGeometry,
merge,
placed,
ringMoulding,
rng,
withCrystalAttributes,
} from './geometry';
import {
bakeMarble,
coalMaterial,
domeMaterial,
floorMaterial,
goldMaterial,
logMaterial,
marbleMaterial,
MAX_MEDALLIONS,
sootMaterial,
type FloorUniforms,
} from './materials';
import {
createSharedUniforms,
crystalMaterial,
emberMaterial,
FIRE_BOUND_SCALE,
fireMaterial,
lightColumnMaterial,
moteMaterial,
skyMaterial,
type CrystalUniforms,
type SharedUniforms,
} from './shaders';
import type { FrameScenes } from './pipeline';
import type { QualitySettings } from './quality';

/**
 * The 晨雾琉璃 rotunda. Layout (metres, origin at the hall centre):
 *   floor disc r 19 with a balustrade at 18.6 · 16 columns at r 13, 11.5 m tall ·
 *   entablature → arcaded drum with 16 windows → coffered dome with an oculus ·
 *   dais r 3.4 → marble hearth → teepee bonfire, ringed by a crown of crystals ·
 *   a gold armillary hangs over the fire on the title screen.
 * Light: one low morning sun from the upper left behind the hall (the site-wide
 * light direction), sky fill, and the bonfire.
 */

export const COLUMN_RADIUS = 13;
const COLUMN_COUNT = 16;
const COLUMN_HEIGHT = 11.5;
const DAIS_TOP = 0.46;
export const FIRE_BASE = new Vector3(0, 0.82, 0);
export const FIRE_RADIUS = 1.45;
export const FIRE_HEIGHT = 5.6;
export const SUN_DIR = new Vector3(-0.52, 0.56, -0.64).normalize();

export interface WorldState {
  time: number;
  dt: number;
  /** 0 on the title screen, 1 in the hall (eased during the warp). */
  hall: number;
  /** Extra fire energy (core hover / clicks), 0..1. */
  flare: number;
  medallions: Array<{ x: number; z: number; radius: number; glow: number; ley: number; height: number; color: Color; visible: number }>;
  accent: Color;
  accentMix: number;
}

export interface World {
  scenes: FrameScenes;
  shared: SharedUniforms;
  sun: DirectionalLight;
  fireLight: PointLight;
  floor: FloorUniforms;
  crystalUniforms: CrystalUniforms[];
  firePos: Vector3;
  fireColor: Vector3;
  update(state: WorldState): void;
  setMirror(on: boolean): void;
  setSceneDepth(texture: Texture | null): void;
  setEnvironment(cube: Texture | null, pmrem: Texture | null): void;
  setCapture(on: boolean): void;
  applyQuality(settings: QualitySettings): void;
  dispose(): void;
}

export function buildWorld(renderer: WebGLRenderer, settings: QualitySettings, noise: Texture): World {
  // Owned per world: a rebuild after a lost context must not forget what the old world holds.
  const disposables: Array<{ dispose(): void }> = [];
  const keep = <T extends { dispose(): void }>(x: T) => { disposables.push(x); return x; };
  const random = rng(20261119);
  // Geometry is built once, for the tier the device starts at (phones: 1 at most).
  const lite = settings.tier <= 1;
  const shared = createSharedUniforms();
  shared.tNoise.value = noise;
  shared.uSunDir.value.copy(SUN_DIR);
  shared.uFireAxis.value.set(FIRE_BASE.x, FIRE_BASE.z);

  const opaque = new Scene();
  const fireScene = new Scene();
  const crystalScene = new Scene();
  const fx = new Scene();

  const marbleRT = keep(bakeMarble(renderer, settings.tier >= 2 ? 1024 : 512));
  const marbleTex = marbleRT.texture;
  const marble = keep(marbleMaterial(marbleTex, { scale: 0.16 }));
  const marbleWarm = keep(marbleMaterial(marbleTex, { scale: 0.11, tint: '#fbf6ec', roughness: 0.34 }));
  const gold = keep(goldMaterial());
  const goldSoft = keep(goldMaterial(0.34));
  const crystalUniforms: CrystalUniforms[] = [];
  const crystal = (opts?: Parameters<typeof crystalMaterial>[1]) => {
    const c = crystalMaterial(shared, opts);
    keep(c.material);
    crystalUniforms.push(c.uniforms);
    return c.material;
  };
  const crystalMain = crystal({ glow: 0.55, edge: 1 });
  const crystalInlay = crystal({ glow: 1.5, edge: 0.7 });
  const crystalShard = crystal({ glow: 0.7, edge: 1.1 });

  const add = (scene: Scene | Group, mesh: Object3D, cast = true, receive = true) => {
    mesh.castShadow = cast;
    mesh.receiveShadow = receive;
    scene.add(mesh);
    return mesh;
  };
  const geo = <T extends BufferGeometry>(g: T) => keep(g);

  /* Sky ─────────────────────────────────────────────────────────────────── */
  const sky = new Mesh(geo(new SphereGeometry(500, 48, 24)), keep(skyMaterial(shared)));
  sky.frustumCulled = false;
  sky.renderOrder = -10;
  sky.onBeforeRender = (_r, _s, camera) => { sky.position.setFromMatrixPosition(camera.matrixWorld); sky.updateMatrixWorld(); };
  opaque.add(sky);

  /* Lights ──────────────────────────────────────────────────────────────── */
  const sun = new DirectionalLight(new Color(1, 0.91, 0.76), 5.4);
  sun.position.copy(SUN_DIR).multiplyScalar(70).add(new Vector3(0, 6, 0));
  sun.target.position.set(0, 6, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(settings.shadowSize, settings.shadowSize);
  const sc = sun.shadow.camera;
  sc.left = -24; sc.right = 24; sc.top = 24; sc.bottom = -24; sc.near = 20; sc.far = 125;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.04;
  sun.shadow.radius = 2.5;
  opaque.add(sun, sun.target);
  const hemi = new HemisphereLight(new Color('#c9e1ec'), new Color('#efdfc8'), 0.5);
  opaque.add(hemi);
  const fireLight = new PointLight(new Color(1, 0.56, 0.24), 42, 0, 2);
  fireLight.position.set(0, 3.3, 0);
  opaque.add(fireLight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.shadowMap.autoUpdate = false;
  renderer.shadowMap.needsUpdate = true;

  /* Floor, terrace, steps, balustrade ───────────────────────────────────── */
  const floorGeo = geo(new BufferGeometry());
  {
    const seg = 220;
    const rings = 40;
    const pos: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    pos.push(0, 0, 0); uv.push(0.5, 0.5);
    for (let j = 1; j <= rings; j++) {
      const r = 19 * Math.pow(j / rings, 0.85);
      for (let i = 0; i < seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        pos.push(Math.sin(a) * r, 0, Math.cos(a) * r);
        uv.push(0.5 + Math.sin(a) * r / 38, 0.5 + Math.cos(a) * r / 38);
      }
    }
    for (let i = 0; i < seg; i++) idx.push(0, 1 + i, 1 + ((i + 1) % seg));
    for (let j = 1; j < rings; j++) {
      for (let i = 0; i < seg; i++) {
        const a = 1 + (j - 1) * seg + i;
        const b = 1 + (j - 1) * seg + ((i + 1) % seg);
        const c = 1 + j * seg + i;
        const d = 1 + j * seg + ((i + 1) % seg);
        idx.push(a, c, b, b, c, d);
      }
    }
    floorGeo.setAttribute('position', new BufferAttribute(new Float32Array(pos), 3));
    floorGeo.setAttribute('uv', new BufferAttribute(new Float32Array(uv), 2));
    const normals = new Float32Array(pos.length);
    for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
    floorGeo.setAttribute('normal', new BufferAttribute(normals, 3));
    floorGeo.setIndex(idx);
  }
  const floor = floorMaterial(marbleTex);
  keep(floor.material);
  const floorMesh = add(opaque, new Mesh(floorGeo, floor.material), false, true) as Mesh;

  add(opaque, new Mesh(geo(lathe([
    [21.2, -1.4], ...crease(21.2, -0.9), ...crease(20.6, -0.9), ...crease(20.6, -0.6), ...crease(20.0, -0.6), ...crease(20.0, -0.3), ...crease(19.4, -0.3), ...crease(19.4, 0), [19.0, 0],
  ], 220)), marbleWarm), false, true);
  // Balustrade around the terrace.
  {
    const count = 150;
    const bal = geo(baluster(1.02, 0.11, lite ? 14 : 24));
    const inst = new InstancedMesh(bal, marbleWarm, count);
    const m = new Matrix4();
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2;
      m.makeRotationY(a).setPosition(Math.sin(a) * 18.6, 0.13, Math.cos(a) * 18.6);
      inst.setMatrixAt(i, m);
    }
    add(opaque, inst);
    add(opaque, new Mesh(geo(ringMoulding(18.38, 18.82, 0, 0.13, 220)), marbleWarm));
    add(opaque, new Mesh(geo(ringMoulding(18.4, 18.8, 1.15, 1.32, 220, 0.04)), marbleWarm));
    add(opaque, new Mesh(geo(ringMoulding(18.43, 18.77, 1.32, 1.35, 220, 0.01)), goldSoft));
    // Pier blocks every 15 balusters.
    const pier = geo(lathe([[0.36, 0], ...crease(0.36, 1.32), ...crease(0.3, 1.4), [0, 1.4]], 4, Math.PI / 4).toNonIndexed());
    pier.computeVertexNormals();
    const piers = new InstancedMesh(pier, marbleWarm, 10);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2 + 0.04;
      m.makeRotationY(a).setPosition(Math.sin(a) * 18.6, 0, Math.cos(a) * 18.6);
      piers.setMatrixAt(i, m);
    }
    add(opaque, piers);
  }

  /* Columns ─────────────────────────────────────────────────────────────── */
  const parts = columnParts(COLUMN_HEIGHT, 0.62, lite ? COLUMN_DETAIL.lite : COLUMN_DETAIL.full);
  geo(parts.marble); geo(parts.gold); geo(parts.inlay);
  const colMarble = new InstancedMesh(parts.marble, marble, COLUMN_COUNT);
  const colGold = new InstancedMesh(parts.gold, gold, COLUMN_COUNT);
  const colInlay = new InstancedMesh(parts.inlay, crystalInlay, COLUMN_COUNT);
  {
    const m = new Matrix4();
    for (let k = 0; k < COLUMN_COUNT; k++) {
      const phi = ((k + 0.5) / COLUMN_COUNT) * Math.PI * 2;
      m.makeRotationY(phi + Math.PI).setPosition(Math.sin(phi) * COLUMN_RADIUS, 0, Math.cos(phi) * COLUMN_RADIUS);
      colMarble.setMatrixAt(k, m);
      colGold.setMatrixAt(k, m);
      colInlay.setMatrixAt(k, m);
    }
  }
  add(opaque, colMarble);
  add(opaque, colGold);
  add(crystalScene, colInlay, false, false);

  /* Entablature, drum, dome ─────────────────────────────────────────────── */
  const yE = COLUMN_HEIGHT;
  add(opaque, new Mesh(geo(lathe([
    [13.95, yE + 1.62], ...crease(14.25, yE + 1.62), ...crease(14.25, yE + 1.48), [14.0, yE + 1.36], ...crease(13.85, yE + 1.2),
    ...crease(13.85, yE + 0.66), ...crease(13.95, yE + 0.6), ...crease(13.95, yE + 0.46), ...crease(13.82, yE + 0.42), ...crease(13.82, yE + 0.24),
    ...crease(13.74, yE + 0.2), ...crease(13.74, yE),
    ...crease(12.26, yE), ...crease(12.26, yE + 0.2), ...crease(12.18, yE + 0.24), ...crease(12.18, yE + 0.42), ...crease(12.05, yE + 0.46),
    ...crease(12.05, yE + 0.6), ...crease(12.15, yE + 0.66), ...crease(12.15, yE + 1.2), [12.0, yE + 1.36], ...crease(11.75, yE + 1.48), ...crease(11.75, yE + 1.62), [13.95, yE + 1.62],
  ].reverse() as Array<[number, number]>, 256)), marble));
  for (const [r0, r1, y0, y1] of [[12.02, 12.08, yE + 0.6, yE + 0.66], [13.92, 13.98, yE + 0.6, yE + 0.66], [11.73, 11.79, yE + 1.48, yE + 1.62]] as const) {
    add(opaque, new Mesh(geo(ringMoulding(r0, r1, y0, y1, 256, 0.005)), gold), false, false);
  }
  const yD = yE + 1.62;
  const drumTop = yD + 4.6;
  const drum = geo(archedDrum({ rIn: 12.35, rOut: 13.35, y0: yD, y1: drumTop, windows: COLUMN_COUNT, halfWidth: 1.0, sill: yD + 0.7, spring: yD + 3.1, offset: -Math.PI / COLUMN_COUNT }));
  add(opaque, new Mesh(drum, keep(marbleMaterial(marbleTex, { scale: 0.11, tint: '#fbf6ec', roughness: 0.36, side: DoubleSide }))));
  add(opaque, new Mesh(geo(ringMoulding(12.0, 13.5, drumTop, drumTop + 0.32, 256)), marbleWarm));
  add(opaque, new Mesh(geo(ringMoulding(11.96, 12.04, drumTop + 0.1, drumTop + 0.24, 256, 0.004)), gold), false, false);
  add(opaque, new Mesh(geo(ringMoulding(12.2, 12.3, yD + 0.62, yD + 0.7, 256, 0.004)), goldSoft), false, false);
  const oculus = 0.21;
  const domeR = 12.95;
  const dome = new Mesh(geo(domeShell(domeR, oculus, settings.tier >= 2 ? 160 : 96, 56)), keep(domeMaterial(marbleTex)));
  dome.position.y = drumTop + 0.32;
  add(opaque, dome);
  const ocR = Math.sin(oculus) * domeR;
  const ocY = dome.position.y + Math.cos(oculus) * domeR;
  add(opaque, new Mesh(geo(new TorusGeometry(ocR, 0.16, 12, 128).rotateX(Math.PI / 2)), gold)).position.y = ocY;
  // Outer dome skin (casts the shadow that shapes the window beams). It casts from both
  // faces: three draws only back faces of a front-sided mesh into the shadow map, which
  // left the sun-facing half out and let sunlight reach the vault's bumped coffer walls.
  const skin = keep(marbleMaterial(marbleTex, { scale: 0.11, tint: '#fbf6ec', roughness: 0.34 }));
  skin.shadowSide = DoubleSide;
  const outerDome = new Mesh(geo(new SphereGeometry(domeR + 0.5, 64, 24, 0, Math.PI * 2, oculus * 0.9, Math.PI / 2 - oculus * 0.9)), skin);
  outerDome.position.y = drumTop + 0.32;
  add(opaque, outerDome, true, false);

  /* Dais, hearth, logs, coals ───────────────────────────────────────────── */
  add(opaque, new Mesh(geo(lathe([
    [3.42, 0], ...crease(3.42, 0.2), ...crease(3.38, 0.24), ...crease(2.95, 0.24), ...crease(2.95, 0.42), ...crease(2.91, DAIS_TOP), [0, DAIS_TOP],
  ], 160)), marble));
  add(opaque, new Mesh(geo(ringMoulding(3.425, 3.445, 0.06, 0.16, 160, 0.003)), gold), false, false);
  add(opaque, new Mesh(geo(ringMoulding(2.955, 2.975, 0.28, 0.38, 160, 0.003)), gold), false, false);
  const basinOuter: Array<[number, number]> = [
    [1.25, DAIS_TOP], [1.38, DAIS_TOP + 0.12], [1.62, DAIS_TOP + 0.42], [1.82, DAIS_TOP + 0.66], ...crease(1.94, DAIS_TOP + 0.78), [1.97, DAIS_TOP + 0.84], [1.88, DAIS_TOP + 0.88],
  ];
  add(opaque, new Mesh(geo(lathe(basinOuter, 120)), marble));
  const soot = sootMaterial();
  keep(soot.material);
  add(opaque, new Mesh(geo(lathe([[1.88, DAIS_TOP + 0.88], [1.72, DAIS_TOP + 0.72], [1.4, DAIS_TOP + 0.5], [0.6, DAIS_TOP + 0.38], [0, DAIS_TOP + 0.36]], 96)), soot.material), false, true);
  add(opaque, new Mesh(geo(new TorusGeometry(1.93, 0.045, 10, 140).rotateX(Math.PI / 2)), gold)).position.y = DAIS_TOP + 0.84;
  add(opaque, new Mesh(geo(new TorusGeometry(1.42, 0.03, 8, 120).rotateX(Math.PI / 2)), gold)).position.y = DAIS_TOP + 0.13;
  // Crystal studs around the bowl.
  {
    const studs: BufferGeometry[] = [];
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const g = crystalLozenge(0.16, 0.26, 0.09);
      const r = 1.72;
      const y = DAIS_TOP + 0.55;
      studs.push(placed(g, [Math.sin(a) * r, y, Math.cos(a) * r], [-0.62, a, 0]));
    }
    add(crystalScene, new Mesh(geo(withCrystalAttributes(merge(studs), 0.75, 3)), crystalInlay), false, false);
  }
  const emberUniforms = { uTime: shared.uTime, uFire: { value: 1 }, tNoise: shared.tNoise };
  const logs: BufferGeometry[] = [];
  const apex = new Vector3(0, 2.2, 0);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + random() * 0.3;
    const base = new Vector3(Math.sin(a) * 0.92, DAIS_TOP + 0.36, Math.cos(a) * 0.92);
    const dir = apex.clone().add(new Vector3((random() - 0.5) * 0.3, random() * 0.25, (random() - 0.5) * 0.3)).sub(base);
    const len = dir.length() * (1.05 + random() * 0.12);
    const g = logGeometry(len, 0.085 + random() * 0.04, random);
    const q = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize());
    const m = new Matrix4().compose(base, q, new Vector3(1, 1, 1));
    g.applyMatrix4(m);
    logs.push(g);
  }
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.5;
    const g = logGeometry(1.9, 0.11, random);
    g.translate(0, -0.95, 0);
    const q = new Quaternion().setFromEuler(new Euler(Math.PI / 2, 0, a));
    g.applyQuaternion(q);
    g.translate(Math.cos(a) * 0.55, DAIS_TOP + 0.5, Math.sin(a) * 0.55);
    logs.push(g);
  }
  add(opaque, new Mesh(geo(merge(logs)), keep(logMaterial(emberUniforms))));
  {
    const coal = geo(new IcosahedronGeometry(1, 0));
    const count = 170;
    const inst = new InstancedMesh(coal, keep(coalMaterial(emberUniforms)), count);
    const m = new Matrix4();
    const q = new Quaternion();
    for (let i = 0; i < count; i++) {
      const a = random() * Math.PI * 2;
      const r = Math.sqrt(random()) * 1.45;
      const s = 0.07 + random() * 0.11;
      q.setFromEuler(new Euler(random() * 6, random() * 6, random() * 6));
      m.compose(new Vector3(Math.sin(a) * r, DAIS_TOP + 0.38 + random() * 0.08 + (1.45 - r) * 0.04, Math.cos(a) * r), q, new Vector3(s, s * (0.6 + random() * 0.4), s));
      inst.setMatrixAt(i, m);
    }
    add(opaque, inst, false, true);
  }

  /* Bonfire volume and embers ───────────────────────────────────────────── */
  const fireOrigin = FIRE_BASE.clone();
  const fire = fireMaterial(shared, fireOrigin, FIRE_RADIUS, FIRE_HEIGHT);
  keep(fire.material);
  fire.uniforms.uSteps.value = settings.fireSteps;
  const fireBound = FIRE_RADIUS * FIRE_BOUND_SCALE;
  const fireVolume = new Mesh(geo(new CylinderGeometry(fireBound, fireBound, FIRE_HEIGHT * 1.4, 32, 1, false)), fire.material);
  fireVolume.position.set(fireOrigin.x, fireOrigin.y + FIRE_HEIGHT * 0.7, fireOrigin.z);
  fireVolume.frustumCulled = false;
  fireScene.add(fireVolume);

  const embers = emberMaterial(shared, fireOrigin);
  keep(embers.material);
  const emberGeo = geo(new BufferGeometry());
  const buildPoints = (geometry: BufferGeometry, count: number) => {
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < seeds.length; i++) seeds[i] = random();
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
    geometry.setAttribute('aSeed', new BufferAttribute(seeds, 4));
    geometry.setDrawRange(0, count);
  };
  buildPoints(emberGeo, 600);
  emberGeo.setDrawRange(0, settings.embers);
  const emberPoints = new Points(emberGeo, embers.material);
  emberPoints.frustumCulled = false;
  fx.add(emberPoints);

  const moteGeo = geo(new BufferGeometry());
  buildPoints(moteGeo, 4000);
  moteGeo.setDrawRange(0, settings.motes);
  const motes = new Points(moteGeo, keep(moteMaterial(shared)));
  motes.frustumCulled = false;
  fx.add(motes);

  /* Crystals ────────────────────────────────────────────────────────────── */
  {
    const parts: BufferGeometry[] = [];
    // Crown around the hearth: tall points leaning outward. The sector that faces
    // the title camera (+z) stays low so the flames read above it.
    const crown = 14;
    for (let i = 0; i < crown; i++) {
      const a = (i / crown) * Math.PI * 2 + random() * 0.2;
      const facing = Math.cos(a);
      const big = i % 3 === 0 && facing < 0.55;
      const len = (big ? 1.7 + random() * 0.7 : 0.75 + random() * 0.6) * (facing > 0.55 ? 0.62 : 1);
      const g = crystalCluster(random, big ? 5 : 3, len, 0.6);
      const r = 2.2 + random() * 0.35;
      parts.push(withCrystalAttributes(placed(g, [Math.sin(a) * r, DAIS_TOP - 0.05, Math.cos(a) * r], [0.3 + random() * 0.2, a, 0]), big ? 0.85 : 0.6, i));
    }
    // Clusters on the lower step and at column feet.
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3 + random() * 0.3;
      const g = crystalCluster(random, 4, 0.45 + random() * 0.35, 0.8);
      parts.push(withCrystalAttributes(placed(g, [Math.sin(a) * 3.15, 0.2, Math.cos(a) * 3.15], [0.35, a, 0]), 0.5, 40 + i));
    }
    for (let k = 0; k < COLUMN_COUNT; k += 2) {
      const phi = ((k + 0.5) / COLUMN_COUNT) * Math.PI * 2 + (random() - 0.5) * 0.06;
      const r = COLUMN_RADIUS - 1.35 - random() * 0.4;
      const g = crystalCluster(random, 6, 0.9 + random() * 0.8, 0.9);
      parts.push(withCrystalAttributes(placed(g, [Math.sin(phi) * r, -0.05, Math.cos(phi) * r], [0.3, phi + Math.PI, 0]), 0.7, 80 + k));
    }
    add(crystalScene, new Mesh(geo(merge(parts)), crystalMain), false, false);
  }

  // Floating shards orbiting the fire.
  const shardCount = 9;
  const shardGeo = geo(withCrystalAttributes(crystalLozenge(0.2, 0.62, 0.13), 0.7, 5));
  const shards = new InstancedMesh(shardGeo, crystalShard, shardCount);
  shards.frustumCulled = false;
  const shardSeeds = Array.from({ length: shardCount }, (_, i) => ({ r: 4.6 + random() * 2.4, y: 4.2 + random() * 5, a: (i / shardCount) * Math.PI * 2 + random() * 0.4, s: 0.6 + random() * 0.9, spin: random() * 2 - 1, tilt: random() * 0.5 }));
  crystalScene.add(shards);

  /* Armillary over the fire (title screen) ──────────────────────────────── */
  // Hangs in the drum above the title, clear of the logo. It turns, so it casts no
  // shadow: the sun shadow map is baked once and would keep a frozen ring.
  const ARMILLARY_Y = 11.6;
  const armillary = new Group();
  armillary.position.set(0, ARMILLARY_Y, 0);
  const rings: Mesh[] = [];
  for (const [r, tube, tiltX, tiltZ] of [[3.5, 0.05, 1.32, 0.0], [3.08, 0.04, 0.5, 0.9], [2.66, 0.035, 1.9, -0.6]] as const) {
    const ring = new Mesh(geo(new TorusGeometry(r, tube, 10, 220)), gold);
    ring.rotation.set(tiltX, 0, tiltZ);
    ring.castShadow = false;
    ring.receiveShadow = true;
    armillary.add(ring);
    rings.push(ring);
  }
  const loz = geo(withCrystalAttributes(crystalLozenge(0.16, 0.42, 0.1), 0.65, 9));
  const lozenges = new InstancedMesh(loz, crystalShard, 24);
  const lozGroup = new Group();
  {
    const m = new Matrix4();
    for (let i = 0; i < 24; i++) {
      const a = (i / 24) * Math.PI * 2;
      const big = i % 6 === 0 ? 1.7 : 1;
      m.compose(new Vector3(Math.cos(a) * 3.5, Math.sin(a) * 3.5, 0), new Quaternion().setFromEuler(new Euler(0, 0, a + Math.PI / 2)), new Vector3(big, big, big));
      lozenges.setMatrixAt(i, m);
    }
    lozGroup.add(lozenges);
  }
  opaque.add(armillary);
  // Lozenges use the crystal shader, so they live in the crystal scene and copy the outer ring's transform.
  const lozProxy = new Group();
  lozProxy.matrixAutoUpdate = false;
  crystalScene.add(lozProxy);
  lozProxy.add(lozGroup);

  /* Hall light columns under each lens ──────────────────────────────────── */
  const colGeo = geo(new CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0));
  const lightCols = new InstancedMesh(colGeo, keep(lightColumnMaterial(shared)), MAX_MEDALLIONS);
  lightCols.frustumCulled = false;
  const glowAttr = new InstancedBufferAttribute(new Float32Array(MAX_MEDALLIONS), 1);
  colGeo.setAttribute('aGlow', glowAttr);
  for (let i = 0; i < MAX_MEDALLIONS; i++) lightCols.setColorAt(i, new Color(0.4, 1, 0.9));
  fx.add(lightCols);

  /* Per-frame update ────────────────────────────────────────────────────── */
  const firePos = new Vector3(0, 2.6, 0);
  const fireColor = new Vector3(1, 0.5, 0.18);
  const tmpM = new Matrix4();
  const tmpQ = new Quaternion();
  const tmpE = new Euler();
  const tmpV = new Vector3();
  const tmpS = new Vector3();
  const accentBase = new Color('#3fe0c6');

  const update = (s: WorldState) => {
    const t = s.time;
    shared.uTime.value = t;
    // Fire flicker: a few incommensurate sines plus a slow swell.
    const flick = 0.82 + 0.1 * Math.sin(t * 7.1) * Math.sin(t * 3.3 + 1.2) + 0.06 * Math.sin(t * 13.7 + 0.4) + 0.05 * Math.sin(t * 0.7);
    const flare = s.flare;
    const energy = flick * (1 + flare * 0.6);
    fireLight.intensity = 42 * energy;
    fireLight.position.set(Math.sin(t * 2.3) * 0.15, 3.3 + Math.sin(t * 3.7) * 0.12 + flare * 0.5, Math.cos(t * 1.9) * 0.15);
    shared.uFireLight.value = energy;
    shared.uFirePos.value.copy(fireLight.position);
    firePos.copy(fireLight.position);
    fire.uniforms.uFlare.value = flare;
    fire.uniforms.uIntensity.value = (0.84 + 0.2 * flick) * (1 + flare * 0.4);
    embers.uniforms.uFlare.value = flare;
    emberUniforms.uFire.value = 0.85 + 0.15 * flick + flare * 0.3;
    soot.uniforms.uTime.value = t;
    soot.uniforms.uFire.value = energy;

    // Floor: time, hall medallions.
    floor.uniforms.uTime.value = t;
    floor.uniforms.uHall.value = s.hall;
    for (let i = 0; i < MAX_MEDALLIONS; i++) {
      const m = s.medallions[i];
      const target = floor.uniforms.uMedallion.value[i] as Vector4;
      if (!m || m.visible <= 0.001) {
        target.set(0, 0, 0, 0);
        glowAttr.setX(i, 0);
        continue;
      }
      target.set(m.x, m.z, m.radius * m.visible, m.glow);
      floor.uniforms.uMedallionColor.value[i].set(m.color.r, m.color.g, m.color.b);
      floor.uniforms.uLeyGlow.value[i] = m.ley * m.visible;
      tmpM.compose(tmpV.set(m.x, 0, m.z), tmpQ.identity(), tmpS.set(m.radius * 0.42, m.height * m.visible, m.radius * 0.42));
      lightCols.setMatrixAt(i, tmpM);
      lightCols.setColorAt(i, m.color);
      glowAttr.setX(i, (0.25 + m.glow * 0.9) * m.visible * s.hall);
    }
    lightCols.instanceMatrix.needsUpdate = true;
    if (lightCols.instanceColor) lightCols.instanceColor.needsUpdate = true;
    glowAttr.needsUpdate = true;

    // Crystals take a breath of the focused world's accent.
    const glowColor = accentBase.clone().lerp(s.accent, s.accentMix * 0.65);
    for (const u of crystalUniforms) u.uGlowColor.value.copy(glowColor);

    // Shards drift around the fire.
    for (let i = 0; i < shardCount; i++) {
      const d = shardSeeds[i];
      const a = d.a + t * 0.05 * d.s;
      const y = d.y + Math.sin(t * 0.4 * d.s + d.a * 3) * 0.35 + s.hall * 0.6;
      tmpE.set(d.tilt + Math.sin(t * 0.3 + i) * 0.2, t * 0.35 * d.spin + d.a, d.tilt * 0.5);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpV.set(Math.sin(a) * d.r, y, Math.cos(a) * d.r), tmpQ, tmpS.setScalar(0.7 + d.s * 0.45));
      shards.setMatrixAt(i, tmpM);
    }
    shards.instanceMatrix.needsUpdate = true;

    // Armillary: turns slowly, rises out of the way in the hall.
    const show = 1 - s.hall;
    armillary.position.y = ARMILLARY_Y + s.hall * 9;
    armillary.visible = show > 0.01;
    rings[0].rotation.y = t * 0.06;
    rings[1].rotation.y = -t * 0.045;
    rings[2].rotation.y = t * 0.035;
    armillary.rotation.y = t * 0.02;
    armillary.scale.setScalar(0.92 + 0.08 * show);
    armillary.updateMatrixWorld(true);
    lozProxy.visible = armillary.visible;
    lozProxy.matrix.copy(rings[0].matrixWorld);
  };

  let mirrorHidden: Object3D[] = [];
  const setMirror = (on: boolean) => {
    if (on) {
      mirrorHidden = [floorMesh];
      floorMesh.visible = false;
      fire.uniforms.uSteps.value = Math.max(12, Math.round(settings.fireSteps * 0.5));
      for (const u of crystalUniforms) u.uSceneOn.value = 0;
    } else {
      for (const o of mirrorHidden) o.visible = true;
      mirrorHidden = [];
      fire.uniforms.uSteps.value = settings.fireSteps;
      for (const u of crystalUniforms) u.uSceneOn.value = 1;
    }
  };

  const setSceneDepth = (texture: Texture | null) => {
    fire.uniforms.tSceneDepth.value = texture;
    fire.uniforms.uDepthOn.value = texture ? 1 : 0;
  };

  const setEnvironment = (cube: Texture | null, pmrem: Texture | null) => {
    // Lit materials read this through scene.environment, so three applies
    // opaque.environmentIntensity to all of them; a per-material envMapIntensity has no effect.
    opaque.environment = pmrem;
    for (const u of crystalUniforms) u.tEnv.value = cube;
  };

  let captureHidden: Object3D[] = [];
  const setCapture = (on: boolean) => {
    if (on) {
      captureHidden = [armillary].filter(o => o.visible);
      for (const o of captureHidden) o.visible = false;
    } else {
      for (const o of captureHidden) o.visible = true;
      captureHidden = [];
    }
  };

  const applyQuality = (q: QualitySettings) => {
    settings = q;
    fire.uniforms.uSteps.value = q.fireSteps;
    emberGeo.setDrawRange(0, q.embers);
    moteGeo.setDrawRange(0, q.motes);
  };

  const dispose = () => {
    for (const d of disposables) d.dispose();
    disposables.length = 0;
    for (const s of [opaque, fireScene, crystalScene, fx]) s.clear();
  };

  return {
    scenes: { opaque, fire: fireScene, crystal: crystalScene, fx },
    shared,
    sun,
    fireLight,
    floor: floor.uniforms,
    crystalUniforms,
    firePos,
    fireColor,
    update,
    setMirror,
    setSceneDepth,
    setEnvironment,
    setCapture,
    applyQuality,
    dispose,
  };
}
