/**
 * 3D 沙盘里的建筑与道具：按画风与地点类型拼出小模型（城墙、楼阁、码头、高楼、穹顶、空间站……），
 * 每个地点合并成一个带顶点色的网格，一次绘制。
 */
import {
  BoxGeometry, BufferAttribute, Color, ConeGeometry, CylinderGeometry, DodecahedronGeometry, IcosahedronGeometry, Matrix4,
  OctahedronGeometry, Quaternion, SphereGeometry, TorusGeometry, Vector3, type BufferGeometry,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { MapLocationKind, MapTheme } from '../../../domains/map/types';
import type { ScenePalette } from './palette';

type Rand = () => number;

export function seeded(text: string): Rand {
  let seed = 2166136261;
  for (let index = 0; index < text.length; index++) { seed ^= text.charCodeAt(index); seed = Math.imul(seed, 16777619); }
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const matrix = new Matrix4();
const quaternion = new Quaternion();
const up = new Vector3(0, 1, 0);

class Kit {
  readonly parts: BufferGeometry[] = [];
  readonly glow: BufferGeometry[] = [];

  add(geometry: BufferGeometry, color: string | Color, x: number, y: number, z: number, options: { rotY?: number; scale?: [number, number, number]; glow?: boolean } = {}) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    quaternion.setFromAxisAngle(up, options.rotY ?? 0);
    matrix.compose(new Vector3(x, y, z), quaternion, new Vector3(...(options.scale ?? [1, 1, 1])));
    g.applyMatrix4(matrix);
    const c = color instanceof Color ? color : new Color(color);
    const count = g.getAttribute('position').count;
    const colors = new Float32Array(count * 3);
    for (let index = 0; index < count; index++) { colors[index * 3] = c.r; colors[index * 3 + 1] = c.g; colors[index * 3 + 2] = c.b; }
    g.setAttribute('color', new BufferAttribute(colors, 3));
    if (g.getAttribute('uv')) g.deleteAttribute('uv');
    (options.glow ? this.glow : this.parts).push(g);
    if (g !== geometry) geometry.dispose();
  }

  box(w: number, h: number, d: number, color: string | Color, x: number, y: number, z: number, rotY = 0, glow = false) {
    this.add(new BoxGeometry(w, h, d), color, x, y + h / 2, z, { rotY, glow });
  }

  /** 两坡屋顶（三棱柱，屋脊沿 x）。 */
  gable(w: number, h: number, d: number, color: string | Color, x: number, y: number, z: number, rotY = 0) {
    const geometry = new CylinderGeometry(1, 1, 1, 3, 1);
    geometry.rotateZ(Math.PI / 2);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0.5, 0);
    geometry.scale(w * 1.12, h / 1.5, d / Math.sqrt(3) * 1.15);
    this.add(geometry, color, x, y - h * 0.33 / 1.5 * 0.5, z, { rotY });
  }

  pyramid(r: number, h: number, color: string | Color, x: number, y: number, z: number, rotY = Math.PI / 4) {
    this.add(new ConeGeometry(r, h, 4), color, x, y + h / 2, z, { rotY });
  }

  cone(r: number, h: number, color: string | Color, x: number, y: number, z: number, segments = 10, glow = false) {
    this.add(new ConeGeometry(r, h, segments), color, x, y + h / 2, z, { glow });
  }

  cylinder(r: number, h: number, color: string | Color, x: number, y: number, z: number, segments = 12, glow = false, top = r) {
    this.add(new CylinderGeometry(top, r, h, segments), color, x, y + h / 2, z, { glow });
  }

  sphere(r: number, color: string | Color, x: number, y: number, z: number, glow = false, squash = 1) {
    this.add(new SphereGeometry(r, 18, 12), color, x, y, z, { glow, scale: [1, squash, 1] });
  }

  dome(r: number, color: string | Color, x: number, y: number, z: number, glow = false) {
    this.add(new SphereGeometry(r, 18, 9, 0, Math.PI * 2, 0, Math.PI / 2), color, x, y, z, { glow });
  }

  torus(r: number, tube: number, color: string | Color, x: number, y: number, z: number, glow = false, flat = true) {
    const geometry = new TorusGeometry(r, tube, 8, 36);
    if (flat) geometry.rotateX(Math.PI / 2);
    this.add(geometry, color, x, y, z, { glow });
  }

  rock(r: number, color: string | Color, x: number, y: number, z: number, rand: Rand) {
    const geometry = rand() > 0.5 ? new DodecahedronGeometry(r, 0) : new IcosahedronGeometry(r, 0);
    this.add(geometry, color, x, y, z, { rotY: rand() * Math.PI, scale: [1 + rand() * 0.4, 0.7 + rand() * 0.5, 1 + rand() * 0.3] });
  }

  crystal(r: number, h: number, color: string | Color, x: number, y: number, z: number, glow = true) {
    this.add(new OctahedronGeometry(r, 0), color, x, y + h / 2, z, { glow, scale: [1, h / (r * 2), 1] });
  }

  build(): { solid: BufferGeometry | null; glow: BufferGeometry | null } {
    const solid = this.parts.length ? mergeGeometries(this.parts, false) : null;
    const glow = this.glow.length ? mergeGeometries(this.glow, false) : null;
    for (const part of [...this.parts, ...this.glow]) part.dispose();
    solid?.computeVertexNormals();
    return { solid, glow };
  }
}

function shade(color: string, amount: number): Color {
  return new Color(color).multiplyScalar(amount);
}

// ── 名胜 / 秘境按地名挑模型 ───────────────────────────────────────────

/**
 * 「名胜」「秘境」是笼统的类型：操场、泳池、饭店、山峰、火山、海滩都可能写成它们。
 * 先看地名、再看别名，认出是哪一类就用对应的模型；只有塔、楼、大厦才是高塔。
 */
export type LandmarkStyle = 'tower' | 'hotel' | 'venue' | 'sports' | 'pool' | 'gate' | 'volcano' | 'peak' | 'beach' | 'reef' | 'palms' | 'park' | 'water' | 'plaza';

const LANDMARK_STYLES: ReadonlyArray<readonly [LandmarkStyle, RegExp]> = [
  ['tower', /塔|楼$|阁$|大厦|写字楼|摩天|观景台|电视台|钟楼|tower|spire|skyscraper|office/i],
  ['hotel', /饭店|酒店|宾馆|旅馆|旅店|客栈|酒楼|餐厅|饭馆|食堂|hotel|\binn\b|restaurant/i],
  ['venue', /卡拉\s*OK|KTV|酒吧|夜店|歌厅|舞厅|影院|剧院|剧场|健身|会所|网吧|游戏厅|club|\bbar\b|cinema|theat|\bgym/i],
  ['sports', /操场|球场|体育|运动场|跑道|赛场|竞技场|stadium|arena|field/i],
  ['pool', /泳池|游泳|浴场|pool/i],
  ['gate', /门$|大门|牌坊|关口|gate/i],
  ['volcano', /火山口|火山$|volcano|crater/i],
  ['peak', /山|峰|崖|岭|顶|坡|peak|mount|cliff|summit|hill/i],
  ['beach', /海边|海滩|沙滩|海岸|滩|beach|shore|coast/i],
  ['reef', /礁|岩|石|reef|rock/i],
  ['palms', /椰|棕榈|palm/i],
  ['park', /公园|花园|园$|林|森|park|garden|forest|grove|jungle|wood/i],
  ['water', /河|川|江|溪|泉|湖|瀑|桥|堤|渡|river|stream|lake|spring|bridge|falls/i],
];

export function landmarkStyle(location: { kind: MapLocationKind; name: string; aliases?: readonly string[] }): LandmarkStyle | undefined {
  if (location.kind !== 'landmark' && location.kind !== 'wild') return undefined;
  for (const text of [location.name, ...(location.aliases ?? [])]) {
    for (const [style, pattern] of LANDMARK_STYLES) if (pattern.test(text)) return style;
  }
  return location.kind === 'landmark' ? 'plaza' : undefined;
}

// ── Ancient ───────────────────────────────────────────────────────────

function ancientHouse(kit: Kit, palette: ScenePalette, rand: Rand, x: number, y: number, z: number, scale = 1) {
  const w = (0.34 + rand() * 0.18) * scale;
  const d = (0.28 + rand() * 0.12) * scale;
  const h = (0.22 + rand() * 0.12) * scale;
  const rot = rand() * Math.PI;
  kit.box(w, h, d, shade(palette.wall, 0.9 + rand() * 0.1), x, y, z, rot);
  kit.gable(w, h * 0.85, d, palette.roof[Math.floor(rand() * palette.roof.length)]!, x, y + h, z, rot);
}

function ancientTower(kit: Kit, palette: ScenePalette, x: number, y: number, z: number, h: number, r: number, roof: string) {
  kit.cylinder(r, h, shade(palette.wall, 0.86), x, y, z, 10);
  kit.cone(r * 1.35, h * 0.55, roof, x, y + h, z, 10);
}

function ancientWalls(kit: Kit, palette: ScenePalette, half: number, y: number, height: number) {
  const stone = shade('#cbbf9f', 0.92);
  const thickness = 0.12;
  kit.box(half * 2, height, thickness, stone, 0, y, -half);
  kit.box(half * 2, height, thickness, stone, 0, y, half);
  kit.box(thickness, height, half * 2, stone, -half, y, 0);
  kit.box(thickness, height, half * 2, stone, half, y, 0);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) ancientTower(kit, palette, sx * half, y, sz * half, height * 1.9, 0.16, palette.roof[0]!);
}

function ancientPagoda(kit: Kit, palette: ScenePalette, x: number, y: number, z: number, tiers: number, scale = 1) {
  let level = y;
  for (let tier = 0; tier < tiers; tier++) {
    const w = (0.62 - tier * 0.12) * scale;
    const h = 0.26 * scale;
    kit.box(w, h, w, shade(palette.wall, 0.95), x, level, z);
    kit.pyramid(w * 0.95, 0.2 * scale, palette.roof[0]!, x, level + h, z);
    level += h + 0.12 * scale;
  }
  kit.cylinder(0.02 * scale, 0.36 * scale, '#c9a24b', x, level, z, 6);
}

/** 古卷的名胜：楼阁是塔，山峰是山石上的小亭，水边是亭子，客栈挂酒旗，关门是牌坊；其余仍用石碑 / 秘境晶石。 */
function ancientLandmark(kit: Kit, palette: ScenePalette, style: LandmarkStyle, rand: Rand, y: number): boolean {
  const roof = palette.roof[0]!;
  switch (style) {
    case 'tower':
      ancientPagoda(kit, palette, 0, y, 0, 3, 0.9);
      return true;
    case 'peak': case 'volcano':
      kit.rock(0.42, '#8f8269', 0, y + 0.14, 0, rand);
      kit.box(0.2, 0.12, 0.2, shade(palette.wall, 0.95), 0, y + 0.42, 0);
      kit.pyramid(0.24, 0.14, roof, 0, y + 0.54, 0);
      return true;
    case 'water':
      kit.cylinder(0.42, 0.03, '#4f8fa0', 0, y, 0, 18);
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) kit.cylinder(0.02, 0.22, '#5a3b1c', sx * 0.13, y, sz * 0.13, 5);
      kit.pyramid(0.26, 0.16, roof, 0, y + 0.22, 0);
      return true;
    case 'hotel': case 'venue':
      ancientHouse(kit, palette, rand, -0.18, y, 0, 1.2);
      ancientHouse(kit, palette, rand, 0.3, y, 0.2, 0.9);
      kit.cylinder(0.015, 0.62, '#5a3b1c', 0.32, y, -0.22, 5);
      kit.box(0.03, 0.24, 0.13, '#b8455a', 0.33, y + 0.36, -0.15);
      return true;
    case 'gate':
      for (const side of [-1, 1]) kit.box(0.08, 0.56, 0.08, '#8c2f1c', side * 0.32, y, 0);
      kit.box(0.82, 0.07, 0.12, '#5a3b1c', 0, y + 0.5, 0);
      kit.gable(0.9, 0.14, 0.2, roof, 0, y + 0.57, 0);
      return true;
    default:
      return false;
  }
}

function ancientStructures(kit: Kit, palette: ScenePalette, kind: MapLocationKind, rand: Rand, y: number, style?: LandmarkStyle) {
  if (style && ancientLandmark(kit, palette, style, rand, y)) return;
  switch (kind) {
    case 'capital': {
      ancientWalls(kit, palette, 1.25, y, 0.32);
      kit.box(0.9, 0.42, 0.62, shade(palette.wall, 1), 0, y, -0.1);
      kit.pyramid(0.78, 0.42, palette.roof[0]!, 0, y + 0.42, -0.1);
      kit.box(0.5, 0.3, 0.4, shade(palette.wall, 0.95), 0, y + 0.42 + 0.16, -0.1);
      kit.pyramid(0.46, 0.3, palette.roof[0]!, 0, y + 0.88, -0.1);
      for (let index = 0; index < 22; index++) {
        const angle = rand() * Math.PI * 2;
        const radius = 0.5 + rand() * 0.62;
        ancientHouse(kit, palette, rand, Math.cos(angle) * radius, y, Math.sin(angle) * radius + 0.1, 0.82);
      }
      break;
    }
    case 'city':
      ancientWalls(kit, palette, 0.85, y, 0.26);
      for (let index = 0; index < 12; index++) {
        const angle = rand() * Math.PI * 2;
        const radius = rand() * 0.62;
        ancientHouse(kit, palette, rand, Math.cos(angle) * radius, y, Math.sin(angle) * radius, 0.85);
      }
      ancientTower(kit, palette, 0, y, 0, 0.62, 0.18, palette.roof[0]!);
      break;
    case 'town':
      for (let index = 0; index < 8; index++) {
        const angle = (index / 8) * Math.PI * 2 + rand() * 0.5;
        const radius = 0.2 + rand() * 0.45;
        ancientHouse(kit, palette, rand, Math.cos(angle) * radius, y, Math.sin(angle) * radius, 0.9);
      }
      break;
    case 'village':
    case 'home':
      for (let index = 0; index < (kind === 'home' ? 2 : 4); index++) {
        const angle = rand() * Math.PI * 2;
        ancientHouse(kit, { ...palette, roof: ['#8a6a3a', '#7a5a2a'] }, rand, Math.cos(angle) * 0.3, y, Math.sin(angle) * 0.3, 0.75);
      }
      break;
    case 'fortress':
      ancientWalls(kit, palette, 0.55, y, 0.38);
      kit.box(0.5, 0.7, 0.5, shade('#bfb393', 0.9), 0, y, 0);
      kit.box(0.04, 0.6, 0.04, '#5a3b1c', 0, y + 0.7, 0);
      kit.box(0.32, 0.18, 0.02, palette.roof[0]!, 0.17, y + 1.1, 0);
      break;
    case 'port': {
      for (let index = 0; index < 5; index++) ancientHouse(kit, palette, rand, -0.4 + rand() * 0.5, y, -0.3 + rand() * 0.5, 0.8);
      kit.box(0.14, 0.08, 1.2, '#7a5a35', 0.45, y - 0.08, 0.35);
      kit.box(0.5, 0.12, 0.2, '#6b4a2a', 0.45, y - 0.12, 0.95);
      kit.cylinder(0.02, 0.6, '#5a3b1c', 0.45, y - 0.05, 0.95, 5);
      kit.add(new ConeGeometry(0.22, 0.42, 3), '#efe2c6', 0.52, y + 0.3, 0.95, { scale: [0.2, 1, 1] });
      break;
    }
    case 'temple':
      ancientPagoda(kit, palette, 0, y, 0, 4, 1);
      kit.box(1, 0.06, 1, '#bfb393', 0, y - 0.02, 0);
      break;
    case 'academy':
      kit.box(1, 0.08, 0.7, '#bfb393', 0, y, 0);
      kit.box(0.86, 0.34, 0.5, shade(palette.wall, 1), 0, y + 0.08, 0);
      kit.gable(0.92, 0.3, 0.58, palette.roof[2]!, 0, y + 0.42, 0);
      for (const x of [-0.34, -0.11, 0.11, 0.34]) kit.cylinder(0.035, 0.34, '#f4ecd6', x, y + 0.08, 0.3, 8);
      break;
    case 'market':
      for (let index = 0; index < 6; index++) {
        const x = -0.45 + (index % 3) * 0.45;
        const z = index < 3 ? -0.18 : 0.22;
        kit.box(0.3, 0.12, 0.24, '#d8c49a', x, y, z);
        kit.pyramid(0.26, 0.18, ['#9b2f1d', '#c9a24b', '#3e6a78'][index % 3]!, x, y + 0.12, z);
      }
      break;
    case 'station':
      ancientHouse(kit, palette, rand, 0, y, 0, 1.1);
      kit.box(0.03, 0.75, 0.03, '#5a3b1c', 0.42, y, 0.2);
      kit.box(0.26, 0.14, 0.02, palette.roof[0]!, 0.56, y + 0.6, 0.2);
      break;
    case 'ruin':
      for (let index = 0; index < 7; index++) {
        const angle = (index / 7) * Math.PI * 2;
        kit.cylinder(0.06, 0.2 + rand() * 0.55, '#b5ab92', Math.cos(angle) * 0.45, y, Math.sin(angle) * 0.45, 8);
      }
      for (let index = 0; index < 5; index++) kit.rock(0.08 + rand() * 0.06, '#9c927a', -0.4 + rand() * 0.8, y + 0.03, -0.4 + rand() * 0.8, rand);
      kit.box(0.8, 0.06, 0.16, '#b5ab92', 0, y + 0.55, 0.1, 0.4);
      break;
    case 'cave':
      kit.rock(0.62, '#8f8269', 0, y + 0.18, 0, rand);
      kit.rock(0.36, '#7f735c', 0.5, y + 0.1, 0.2, rand);
      kit.add(new SphereGeometry(0.2, 12, 8, 0, Math.PI), '#1a120a', 0, y + 0.12, 0.48, { scale: [1, 1.1, 0.5] });
      break;
    case 'landmark':
      kit.box(0.4, 0.08, 0.4, '#bfb393', 0, y, 0);
      kit.cylinder(0.08, 1.4, '#e8dcc0', 0, y + 0.08, 0, 4, false, 0.04);
      kit.cone(0.07, 0.18, '#e0b44a', 0, y + 1.48, 0, 4);
      break;
    case 'camp':
      for (let index = 0; index < 4; index++) {
        const angle = (index / 4) * Math.PI * 2 + 0.4;
        kit.cone(0.2, 0.32, index % 2 ? '#e2d3ae' : '#c9a46a', Math.cos(angle) * 0.32, y, Math.sin(angle) * 0.32, 6);
      }
      kit.cylinder(0.08, 0.06, '#ff9a3a', 0, y, 0, 8, true);
      break;
    case 'wild':
    default:
      kit.crystal(0.18, 0.9, '#b8455a', 0, y, 0);
      kit.crystal(0.1, 0.5, '#d4606f', 0.25, y, 0.12);
      kit.rock(0.28, '#5a4a3a', -0.15, y + 0.05, 0.1, rand);
      break;
  }
}

// ── Modern ────────────────────────────────────────────────────────────

function modernTowers(kit: Kit, palette: ScenePalette, rand: Rand, y: number, count: number, spread: number, maxHeight: number) {
  for (let index = 0; index < count; index++) {
    const angle = rand() * Math.PI * 2;
    const radius = Math.sqrt(rand()) * spread;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const h = (0.3 + Math.pow(rand(), 1.6) * maxHeight) * (1 - radius / (spread * 1.6));
    const w = 0.22 + rand() * 0.22;
    const tone = palette.roof[Math.floor(rand() * palette.roof.length)]!;
    kit.box(w, h, w * (0.8 + rand() * 0.4), rand() > 0.7 ? palette.glass : tone, x, y, z, Math.round(rand()) * Math.PI / 4 * 0.2);
    if (h > maxHeight * 0.55) kit.box(w * 0.7, 0.04, w * 0.7, palette.emissive, x, y + h, z, 0, true);
  }
}

/** 现代的名胜按类别拼模型：高塔只给塔楼大厦，其余是饭店、场馆、操场、泳池、校门、火山、山顶、海滩、礁石、椰林、公园、栈桥与广场。 */
function modernLandmark(kit: Kit, palette: ScenePalette, style: LandmarkStyle, rand: Rand, y: number) {
  switch (style) {
    case 'tower':
      kit.box(0.55, 4.6, 0.55, palette.glass, 0, y, 0);
      kit.box(0.42, 0.9, 0.42, palette.wall, 0, y + 4.6, 0);
      kit.cylinder(0.03, 1.1, '#d0d6dc', 0, y + 5.5, 0, 6);
      kit.sphere(0.07, '#ff5a5a', 0, y + 6.62, 0, true);
      modernTowers(kit, palette, rand, y, 6, 0.8, 1.6);
      break;
    case 'hotel':
      kit.box(1.1, 0.32, 0.8, shade(palette.wall, 0.94), 0, y, 0.08);
      kit.box(0.8, 1.5, 0.5, palette.wall, 0, y, -0.05);
      for (let floor = 0; floor < 4; floor++) kit.box(0.82, 0.07, 0.52, palette.glass, 0, y + 0.45 + floor * 0.26, -0.05);
      kit.box(0.46, 0.16, 0.04, '#d9342b', 0, y + 1.5, 0.2, 0, true);
      break;
    case 'venue':
      kit.box(0.85, 0.5, 0.6, palette.wall, 0, y, 0);
      kit.box(0.87, 0.06, 0.62, '#ff5cdc', 0, y + 0.34, 0, 0, true);
      kit.box(0.42, 0.18, 0.04, '#ffb84f', 0, y + 0.5, 0.26, 0, true);
      break;
    case 'sports':
      kit.add(new CylinderGeometry(1, 1, 0.04, 36), '#d9826a', 0, y + 0.02, 0, { scale: [1.15, 1, 0.62] });
      kit.add(new CylinderGeometry(1, 1, 0.05, 36), '#6fbf5a', 0, y + 0.025, 0, { scale: [0.88, 1, 0.4] });
      kit.box(1.5, 0.22, 0.22, '#cfd5db', 0, y, -0.8);
      kit.box(1.5, 0.05, 0.26, '#2f5fb8', 0, y + 0.22, -0.82);
      break;
    case 'pool':
      kit.box(1.2, 0.06, 0.72, '#e9e5dc', 0, y, 0);
      kit.box(1, 0.03, 0.52, '#4fb3e8', 0, y + 0.06, 0);
      for (let lane = 1; lane < 4; lane++) kit.box(1, 0.035, 0.012, '#ffffff', 0, y + 0.06, -0.26 + lane * 0.13);
      kit.box(0.5, 0.3, 0.24, palette.wall, 0, y, -0.5);
      break;
    case 'gate':
      for (const side of [-1, 1]) kit.box(0.12, 0.62, 0.12, '#c9c4ba', side * 0.42, y, 0);
      kit.box(1.04, 0.1, 0.16, '#3a3f46', 0, y + 0.62, 0);
      kit.box(0.24, 0.36, 0.24, palette.wall, 0.66, y, 0.2);
      break;
    case 'volcano':
      kit.cylinder(0.95, 0.7, '#5d4a40', 0, y, 0, 14, false, 0.36);
      kit.cylinder(0.3, 0.05, '#ff6a2a', 0, y + 0.68, 0, 14, true);
      break;
    case 'peak':
      kit.rock(0.34, '#a39784', 0, y + 0.12, 0, rand);
      kit.cylinder(0.018, 0.75, '#e8e8e8', 0.06, y + 0.2, 0, 6);
      kit.box(0.3, 0.17, 0.012, '#e0483d', 0.22, y + 0.76, 0);
      break;
    case 'beach': {
      const umbrellas: Array<[number, number, string]> = [[-0.45, 0.1, '#e0483d'], [0, -0.15, '#f4bd47'], [0.45, 0.12, '#1a73e8']];
      for (const [x, z, color] of umbrellas) {
        kit.cylinder(0.014, 0.34, '#eeeeee', x, y, z, 6);
        kit.cone(0.22, 0.09, color, x, y + 0.32, z, 12);
      }
      break;
    }
    case 'reef':
      for (let index = 0; index < 5; index++) kit.rock(0.12 + rand() * 0.12, index % 2 ? '#e8826a' : '#9c9488', -0.5 + index * 0.25, y + 0.02, (rand() - 0.5) * 0.4, rand);
      break;
    case 'palms':
      for (let index = 0; index < 3; index++) {
        const x = -0.4 + index * 0.4;
        const z = (rand() - 0.5) * 0.4;
        const h = 0.7 + rand() * 0.3;
        kit.cylinder(0.035, h, '#8a6a45', x, y, z, 6, false, 0.025);
        kit.sphere(0.24, '#3f9a4a', x, y + h, z, false, 0.32);
      }
      break;
    case 'park':
      for (let index = 0; index < 4; index++) {
        const angle = (index / 4) * Math.PI * 2 + rand();
        const x = Math.cos(angle) * 0.42;
        const z = Math.sin(angle) * 0.32;
        const h = 0.22 + rand() * 0.1;
        kit.cylinder(0.03, h, '#7a5a3a', x, y, z, 6);
        kit.sphere(0.18 + rand() * 0.06, '#5fae55', x, y + h + 0.12, z);
      }
      kit.cylinder(0.16, 0.04, '#d8d2c4', 0, y, 0, 16);
      break;
    case 'water':
      kit.box(0.9, 0.05, 0.24, '#b89a72', 0, y + 0.16, 0);
      for (const x of [-0.36, 0, 0.36]) for (const z of [-0.1, 0.1]) kit.box(0.04, 0.18, 0.04, '#7a5a3a', x, y, z);
      break;
    case 'plaza':
    default:
      kit.cylinder(0.5, 0.05, '#d8d2c4', 0, y, 0, 24);
      kit.cylinder(0.28, 0.12, '#b9b2a4', 0, y + 0.05, 0, 20);
      kit.cylinder(0.22, 0.03, '#4fb3e8', 0, y + 0.15, 0, 20);
      kit.cylinder(0.04, 0.3, '#e8e4dc', 0, y + 0.05, 0, 8);
      break;
  }
}

function modernStructures(kit: Kit, palette: ScenePalette, kind: MapLocationKind, rand: Rand, y: number, style?: LandmarkStyle) {
  if (style) { modernLandmark(kit, palette, style, rand, y); return; }
  switch (kind) {
    case 'capital': modernTowers(kit, palette, rand, y, 26, 1.3, 4.2); break;
    case 'city': modernTowers(kit, palette, rand, y, 16, 1, 2.8); break;
    case 'town': modernTowers(kit, palette, rand, y, 9, 0.75, 1.2); break;
    case 'village': case 'home': modernTowers(kit, palette, rand, y, kind === 'home' ? 3 : 6, 0.5, 0.6); break;
    case 'landmark':
      modernLandmark(kit, palette, 'plaza', rand, y);
      break;
    case 'station':
      kit.box(1.6, 0.22, 0.5, palette.wall, 0, y, 0);
      kit.add(new CylinderGeometry(0.3, 0.3, 1.5, 16, 1, false, 0, Math.PI), palette.glass, 0, y + 0.22, 0, { rotY: Math.PI / 2, scale: [1, 1, 1] });
      break;
    case 'port':
      for (let index = 0; index < 10; index++) kit.box(0.26, 0.12, 0.1, ['#e0483d', '#1a73e8', '#f4bd47', '#2f9a6b'][index % 4]!, -0.5 + (index % 5) * 0.28, y + Math.floor(index / 5) * 0.12, 0.1);
      kit.box(0.06, 0.9, 0.06, '#f4bd47', 0.6, y, -0.2);
      kit.box(0.7, 0.06, 0.06, '#f4bd47', 0.35, y + 0.9, -0.2);
      kit.box(1.6, 0.06, 0.4, '#c9c4ba', 0, y - 0.06, 0.55);
      break;
    case 'academy':
      for (let index = 0; index < 4; index++) kit.box(0.5, 0.5 + rand() * 0.3, 0.3, palette.wall, -0.4 + (index % 2) * 0.8, y, -0.3 + Math.floor(index / 2) * 0.6);
      kit.box(0.4, 1.1, 0.4, '#e8d9c2', 0, y, 0);
      kit.pyramid(0.32, 0.3, '#a34a3a', 0, y + 1.1, 0);
      break;
    case 'market':
      for (let index = 0; index < 5; index++) {
        kit.box(0.34, 0.24, 0.3, palette.wall, -0.6 + index * 0.3, y, 0);
        kit.box(0.36, 0.03, 0.12, ['#ef8a24', '#e0483d', '#2f9a6b'][index % 3]!, -0.6 + index * 0.3, y + 0.2, 0.18);
      }
      break;
    case 'fortress':
      kit.box(0.9, 0.7, 0.6, '#cfd5db', 0, y, 0);
      kit.box(0.92, 0.08, 0.62, '#2f5fb8', 0, y + 0.4, 0);
      kit.box(0.04, 0.4, 0.04, '#9aa3ad', 0.3, y + 0.7, 0);
      break;
    case 'ruin':
      for (let index = 0; index < 3; index++) kit.box(0.5, 0.4, 0.4, '#b7aa98', -0.5 + index * 0.5, y, 0);
      kit.cylinder(0.1, 1.4, '#9c8f7c', 0.6, y, -0.3, 10);
      kit.cylinder(0.08, 1.1, '#9c8f7c', 0.85, y, -0.2, 10);
      break;
    case 'cave': kit.rock(0.5, '#a39784', 0, y + 0.1, 0, rand); break;
    case 'camp':
      for (let index = 0; index < 4; index++) kit.cone(0.18, 0.28, ['#2f9a6b', '#ef8a24'][index % 2]!, -0.4 + index * 0.27, y, 0, 6);
      break;
    case 'temple':
      kit.box(0.7, 0.3, 0.7, palette.wall, 0, y, 0);
      kit.pyramid(0.65, 0.4, '#8d5bd6', 0, y + 0.3, 0);
      break;
    case 'wild':
    default:
      kit.cone(0.2, 0.5, '#e0483d', 0, y, 0, 3);
      break;
  }
}

// ── Sci-fi ────────────────────────────────────────────────────────────

function scifiStructures(kit: Kit, palette: ScenePalette, kind: MapLocationKind, rand: Rand, y: number, space: boolean) {
  const hull = palette.wall;
  const neon = palette.emissive;
  if (space) {
    switch (kind) {
      case 'capital': case 'city': case 'town': case 'village': case 'home': {
        const r = kind === 'capital' ? 2.2 : kind === 'city' ? 1.7 : kind === 'town' ? 1.3 : 1;
        kit.sphere(r, ['#2a5a8a', '#3a7a6a', '#6a4a8a', '#8a6a3a'][Math.floor(rand() * 4)]!, 0, y, 0);
        kit.torus(r * 1.55, 0.04, neon, 0, y, 0, true);
        if (kind === 'capital') kit.torus(r * 1.85, 0.03, '#ff5cdc', 0, y, 0, true);
        break;
      }
      case 'station': case 'port': case 'fortress': case 'market':
        kit.torus(1.1, 0.16, hull, 0, y, 0, false);
        kit.sphere(0.4, hull, 0, y, 0);
        kit.box(2.2, 0.06, 0.06, hull, 0, y - 0.03, 0);
        kit.box(0.06, 0.06, 2.2, hull, 0, y - 0.03, 0);
        kit.torus(1.1, 0.05, kind === 'market' ? '#ffb84f' : kind === 'fortress' ? '#8aa4ff' : neon, 0, y, 0, true);
        break;
      case 'academy':
        kit.sphere(0.9, '#1d3a5a', 0, y, 0);
        kit.torus(1.4, 0.04, '#8aff6b', 0, y, 0, true);
        kit.torus(1.4, 0.04, '#8aff6b', 0, y, 0, true, false);
        break;
      case 'ruin':
        for (let index = 0; index < 6; index++) kit.box(0.4 + rand() * 0.6, 0.2 + rand() * 0.3, 0.3 + rand() * 0.4, '#3a3f4a', -0.8 + rand() * 1.6, y - 0.3 + rand() * 0.6, -0.8 + rand() * 1.6, rand() * Math.PI);
        kit.box(0.08, 0.08, 0.08, '#ff8a5c', 0.2, y, 0.1, 0, true);
        break;
      case 'cave':
        kit.rock(1, '#4a3f36', 0, y, 0, rand);
        for (let index = 0; index < 4; index++) kit.box(0.08, 0.08, 0.08, '#ffb84f', -0.5 + rand(), y + rand() * 0.4, -0.5 + rand(), 0, true);
        break;
      case 'landmark':
        kit.cylinder(0.12, 2.4, hull, 0, y - 1.2, 0, 6, false, 0.02);
        kit.crystal(0.22, 0.8, '#e6ff4f', 0, y + 1.1, 0);
        break;
      case 'camp':
        for (let index = 0; index < 4; index++) kit.box(0.5, 0.25, 0.25, hull, -0.4 + rand() * 0.8, y - 0.2 + rand() * 0.4, -0.4 + rand() * 0.8, rand() * Math.PI);
        kit.torus(0.8, 0.03, '#4fffc4', 0, y, 0, true);
        break;
      case 'wild':
      default:
        kit.torus(1.2, 0.08, '#ff4f6b', 0, y, 0, true);
        kit.torus(0.8, 0.05, '#ff4fd8', 0, y, 0, true, false);
        kit.sphere(0.3, '#ff4f6b', 0, y, 0, true);
        break;
    }
    return;
  }
  switch (kind) {
    case 'capital': case 'city': case 'town': {
      const count = kind === 'capital' ? 18 : kind === 'city' ? 11 : 6;
      const spread = kind === 'capital' ? 1.2 : kind === 'city' ? 0.9 : 0.6;
      for (let index = 0; index < count; index++) {
        const angle = rand() * Math.PI * 2;
        const radius = Math.sqrt(rand()) * spread;
        const h = (0.5 + Math.pow(rand(), 1.4) * (kind === 'capital' ? 4.6 : 2.6)) * (1 - radius / (spread * 1.7));
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        kit.box(0.2, h, 0.2, hull, x, y, z);
        kit.box(0.21, 0.04, 0.21, rand() > 0.5 ? neon : '#ff5cdc', x, y + h, z, 0, true);
      }
      kit.dome(0.5, '#123250', 0, y, 0);
      break;
    }
    case 'station': case 'port':
      kit.cylinder(0.9, 0.08, hull, 0, y, 0, 24);
      kit.torus(0.8, 0.03, neon, 0, y + 0.1, 0, true);
      kit.box(0.2, 0.9, 0.2, hull, 0.6, y, -0.5);
      break;
    case 'academy': case 'temple':
      kit.dome(0.7, '#123250', 0, y, 0);
      kit.torus(0.72, 0.03, '#8aff6b', 0, y + 0.02, 0, true);
      break;
    case 'fortress':
      kit.box(1, 0.6, 1, hull, 0, y, 0);
      kit.box(1.02, 0.05, 1.02, '#8aa4ff', 0, y + 0.6, 0, 0, true);
      break;
    case 'market':
      for (let index = 0; index < 5; index++) kit.box(0.3, 0.3, 0.3, hull, -0.6 + index * 0.3, y, 0);
      kit.box(1.6, 0.03, 0.06, '#ffb84f', 0, y + 0.32, 0.16, 0, true);
      break;
    case 'landmark':
      kit.cylinder(0.14, 3, hull, 0, y, 0, 6, false, 0.02);
      kit.crystal(0.2, 0.6, '#e6ff4f', 0, y + 3, 0);
      break;
    default:
      kit.crystal(0.24, 1, '#ff4f6b', 0, y, 0);
      kit.rock(0.3, '#2a2f3a', 0.3, y + 0.05, 0.1, rand);
      break;
  }
}

export interface StructureMeshData { solid: BufferGeometry | null; glow: BufferGeometry | null }

/** 以地点为原点（y 为地面高度）拼一个地点的模型。 */
export function buildStructure(theme: MapTheme, kind: MapLocationKind, id: string, palette: ScenePalette, ground: number, space: boolean, style?: LandmarkStyle): StructureMeshData {
  const kit = new Kit();
  const rand = seeded(id);
  if (theme === 'ancient') ancientStructures(kit, palette, kind, rand, ground, style);
  else if (theme === 'modern') modernStructures(kit, palette, kind, rand, ground, style);
  else scifiStructures(kit, palette, kind, rand, ground, space);
  return kit.build();
}

/** 树：古卷是针叶 + 圆冠，现代是圆冠行道树。返回合并后的单棵树（实例化用）。 */
export function treeGeometry(theme: MapTheme, palette: ScenePalette, variant: number): BufferGeometry {
  const kit = new Kit();
  if (theme === 'modern') {
    kit.cylinder(0.03, 0.16, '#7a5a3a', 0, 0, 0, 5);
    kit.sphere(0.17, palette.tree[variant % 2]!, 0, 0.3, 0, false, 1.1);
  } else if (variant % 2 === 0) {
    kit.cylinder(0.035, 0.12, '#5a3b1c', 0, 0, 0, 5);
    kit.cone(0.2, 0.34, palette.tree[0]!, 0, 0.1, 0, 7);
    kit.cone(0.15, 0.28, shade(palette.tree[0]!, 1.15), 0, 0.3, 0, 7);
  } else {
    kit.cylinder(0.035, 0.16, '#5a3b1c', 0, 0, 0, 5);
    kit.sphere(0.2, palette.tree[1]!, 0, 0.3, 0, false, 0.9);
  }
  return kit.build().solid!;
}
