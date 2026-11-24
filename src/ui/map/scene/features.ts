/**
 * 3D 沙盘上的手绘要素：河流、道路、铁路、边界做成贴地的带子（按样式合并成少数几个网格），
 * 城墙 / 长城是一串小墙段与烽台，建筑轮廓挤出成白模。水面、地块已经写进地形，这里不再画。
 */
import {
  BoxGeometry, BufferGeometry, Color, DoubleSide, ExtrudeGeometry, Float32BufferAttribute, Group, InstancedMesh, Mesh, MeshStandardMaterial,
  Object3D, Shape,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { polygonContains, smoothLine, type Point2 } from '../../../domains/map/features';
import type { MapFeature, MapModuleSchema, MapTheme } from '../../../domains/map/types';
import { metersPerUnitOf } from '../../../domains/map/config';

/** 沿折线每 spacing 个单位取一个点（首尾保留）。 */
export function resample(points: readonly Point2[], spacing: number): Point2[] {
  if (points.length < 2) return points.map(point => [point[0], point[1]] as Point2);
  const out: Point2[] = [[points[0]![0], points[0]![1]]];
  let carry = 0;
  for (let index = 1; index < points.length; index++) {
    const a = points[index - 1]!;
    const b = points[index]!;
    const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let at = spacing - carry;
    while (at < length) {
      const t = at / length;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      at += spacing;
    }
    carry = length - (at - spacing);
  }
  const last = points[points.length - 1]!;
  const tail = out[out.length - 1]!;
  if (Math.hypot(tail[0] - last[0], tail[1] - last[1]) > spacing * 0.25) out.push([last[0], last[1]]);
  return out;
}

export interface FeatureMask { blocked: (x: number, y: number) => boolean }

/** 道路、铁路、河流与建筑占的地（树和程序生成的楼群避开这些格子）；2 个地图单位一格。 */
export function featureMask(config: Pick<MapModuleSchema, 'width' | 'height' | 'features'>): FeatureMask | undefined {
  const features = (config.features ?? []).filter(feature => feature.kind === 'road' || feature.kind === 'rail' || feature.kind === 'river' || feature.kind === 'building' || feature.kind === 'water');
  if (!features.length) return undefined;
  const cell = 2;
  const cols = Math.ceil(config.width / cell) + 1;
  const rows = Math.ceil(config.height / cell) + 1;
  const data = new Uint8Array(cols * rows);
  const mark = (x: number, y: number, radius: number) => {
    const r = Math.ceil(radius / cell);
    const cx = Math.round(x / cell);
    const cy = Math.round(y / cell);
    for (let dy = -r; dy <= r; dy++) {
      const row = cy + dy;
      if (row < 0 || row >= rows) continue;
      for (let dx = -r; dx <= r; dx++) {
        const col = cx + dx;
        if (col < 0 || col >= cols || dx * dx + dy * dy > r * r + 1) continue;
        data[row * cols + col] = 1;
      }
    }
  };
  for (const feature of features) {
    if (feature.kind === 'building' || feature.kind === 'water') {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [x, y] of feature.points) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
      for (let row = Math.max(0, Math.floor(y0 / cell) - 1); row <= Math.min(rows - 1, Math.ceil(y1 / cell) + 1); row++) {
        for (let col = Math.max(0, Math.floor(x0 / cell) - 1); col <= Math.min(cols - 1, Math.ceil(x1 / cell) + 1); col++) {
          if (polygonContains(feature.points, col * cell, row * cell)) data[row * cols + col] = 1;
        }
      }
      continue;
    }
    const radius = (feature.width ?? (feature.kind === 'rail' ? 2 : 3)) / 2 + 1.5;
    for (const [x, y] of resample(feature.points, 1.5)) mark(x, y, radius);
  }
  return {
    blocked: (x, y) => {
      const col = Math.round(x / cell);
      const row = Math.round(y / cell);
      return col >= 0 && row >= 0 && col < cols && row < rows && data[row * cols + col] === 1;
    },
  };
}

interface Strip { positions: number[]; indices: number[] }

export interface FeatureSceneContext {
  config: MapModuleSchema;
  theme: MapTheme;
  unit: number;
  /** 世界坐标里的地面高度（已乘高度比例；水下为负）。 */
  heightAt: (x: number, y: number) => number;
  waterColor: string;
}

const ROAD_COLORS: Record<MapTheme, Record<string, string>> = {
  modern: { highway: '#f4c45f', major: '#fbfbf8', street: '#f2f1ec', path: '#c9b590' },
  ancient: { highway: '#7a5532', major: '#7a5532', street: '#8a6a45', path: '#8a6a45' },
  scifi: { highway: '#3ee8ff', major: '#7fd8ff', street: '#4f8fb8', path: '#4f8fb8' },
};

export function buildFeatureMeshes(context: FeatureSceneContext): Group {
  const { config, theme, unit } = context;
  const group = new Group();
  const features = config.features ?? [];
  const toX = (x: number) => (x - config.width / 2) * unit;
  const toZ = (y: number) => (y - config.height / 2) * unit;
  const strips = new Map<string, Strip>();
  const strip = (key: string): Strip => {
    let found = strips.get(key);
    if (!found) { found = { positions: [], indices: [] }; strips.set(key, found); }
    return found;
  };
  /** 贴地的带子：左右两侧各自取地面高度，坡上也贴得住。 */
  const ribbon = (target: Strip, points: readonly Point2[], half: number, lift: number, floor = -Infinity) => {
    const samples = resample(smoothLine(points, 3), Math.max(1, Math.min(4, half * 1.6)));
    if (samples.length < 2) return;
    const start = target.positions.length / 3;
    for (let index = 0; index < samples.length; index++) {
      const prev = samples[Math.max(0, index - 1)]!;
      const next = samples[Math.min(samples.length - 1, index + 1)]!;
      let tx = next[0] - prev[0];
      let ty = next[1] - prev[1];
      const length = Math.hypot(tx, ty) || 1;
      tx /= length; ty /= length;
      const [x, y] = samples[index]!;
      const lx = x - ty * half, ly = y + tx * half;
      const rx = x + ty * half, ry = y - tx * half;
      target.positions.push(toX(lx), Math.max(context.heightAt(lx, ly), floor) + lift, toZ(ly));
      target.positions.push(toX(rx), Math.max(context.heightAt(rx, ry), floor) + lift, toZ(ry));
      if (index > 0) {
        const a = start + (index - 1) * 2;
        target.indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
  };

  const walls: Array<{ x: number; y: number; angle: number; tower: boolean }> = [];
  for (const feature of features) {
    switch (feature.kind) {
      case 'river':
        ribbon(strip('river'), feature.points, Math.max(0.7, (feature.width ?? 3) / 2), 0.025, 0.03);
        break;
      case 'road': {
        const level = feature.level ?? 'street';
        const width = feature.width ?? (level === 'highway' ? 5 : level === 'major' ? 3.6 : level === 'path' ? 1 : 2.2);
        const half = theme === 'ancient' ? Math.max(0.5, width * 0.22) : width / 2;
        ribbon(strip(`road:${level}`), feature.points, half, 0.03 + (level === 'highway' ? 0.014 : level === 'major' ? 0.009 : 0.004), 0.03);
        break;
      }
      case 'rail':
        if (feature.level === 'tunnel') break;
        ribbon(strip(feature.level === 'metro' ? `metro:${feature.color ?? '#7b61c9'}` : 'rail'), feature.points, feature.level === 'metro' ? 0.9 : 1.1, 0.04, 0.03);
        break;
      case 'border':
        if (feature.level === 'wall') {
          const samples = resample(smoothLine(feature.points, 3), 2.4);
          samples.forEach((point, index) => {
            const next = samples[Math.min(samples.length - 1, index + 1)]!;
            const prev = samples[Math.max(0, index - 1)]!;
            walls.push({ x: point[0], y: point[1], angle: Math.atan2(next[1] - prev[1], next[0] - prev[0]), tower: index % 12 === 0 });
          });
        } else {
          ribbon(strip(`border:${feature.level ?? 'national'}`), feature.points, feature.level === 'region' ? 0.8 : 1.6, 0.06, 0.03);
        }
        break;
      default:
        break;
    }
  }

  const material = (key: string): MeshStandardMaterial => {
    const [kind, extra] = key.split(':') as [string, string | undefined];
    const base = { roughness: 0.75, metalness: 0, side: DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 };
    if (kind === 'river') return new MeshStandardMaterial({ ...base, color: context.waterColor, roughness: 0.25, metalness: 0.15 });
    if (kind === 'road') {
      const color = ROAD_COLORS[theme][extra ?? 'street'] ?? ROAD_COLORS[theme].street!;
      return new MeshStandardMaterial({ ...base, color, ...(theme === 'scifi' ? { emissive: new Color(color), emissiveIntensity: 0.8 } : {}), ...(theme === 'ancient' ? { transparent: true, opacity: 0.75 } : {}) });
    }
    if (kind === 'metro') return new MeshStandardMaterial({ ...base, color: extra ?? '#7b61c9', transparent: true, opacity: 0.85 });
    if (kind === 'rail') return new MeshStandardMaterial({ ...base, color: theme === 'scifi' ? '#e6ff4f' : '#8f959c' });
    return new MeshStandardMaterial({ ...base, color: theme === 'ancient' ? '#8c2f1c' : '#9a6fb0', transparent: true, opacity: extra === 'region' ? 0.45 : 0.7 });
  };
  for (const [key, data] of strips) {
    if (!data.indices.length) continue;
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(data.positions, 3));
    geometry.setIndex(data.indices);
    geometry.computeVertexNormals();
    const mesh = new Mesh(geometry, material(key));
    mesh.receiveShadow = true;
    mesh.renderOrder = key === 'river' ? 2 : 3;
    group.add(mesh);
  }

  if (walls.length) {
    const box = new BoxGeometry(1, 1, 1);
    box.translate(0, 0.5, 0);
    const color = new Color('#9a8461');
    const segments = new InstancedMesh(box, new MeshStandardMaterial({ color, roughness: 0.9 }), walls.length);
    const dummy = new Object3D();
    walls.forEach((wall, index) => {
      dummy.position.set(toX(wall.x), Math.max(context.heightAt(wall.x, wall.y), 0.02) - 0.02, toZ(wall.y));
      dummy.rotation.set(0, -wall.angle, 0);
      dummy.scale.set(wall.tower ? 0.42 : 0.3, wall.tower ? 0.5 : 0.22, wall.tower ? 0.42 : 0.1);
      dummy.updateMatrix();
      segments.setMatrixAt(index, dummy.matrix);
    });
    segments.castShadow = true;
    segments.receiveShadow = true;
    group.add(segments);
  }

  const buildings = features.filter((feature): feature is MapFeature => feature.kind === 'building' && feature.points.length >= 3);
  if (buildings.length) {
    // 高度 1 ≈ 18 米（五六层楼），竖向放大一倍好看清；1 个世界单位 = 10 个地图单位。
    const perHeight = Math.min(2.4, Math.max(0.05, 3.6 / metersPerUnitOf(config)));
    const parts: { tall: BufferGeometry[]; low: BufferGeometry[] } = { tall: [], low: [] };
    for (const feature of buildings) {
      const shape = new Shape(feature.points.map(([x, y]) => ({ x: toX(x), y: toZ(y) }) as never));
      const height = (feature.height ?? 1) * perHeight;
      const geometry = new ExtrudeGeometry(shape, { depth: height, bevelEnabled: false });
      geometry.rotateX(Math.PI / 2);
      let ground = Infinity;
      for (const [x, y] of feature.points) ground = Math.min(ground, context.heightAt(x, y));
      geometry.translate(0, Math.max(ground, 0.02) - 0.02 + height, 0);
      ((feature.height ?? 1) > 2.5 ? parts.tall : parts.low).push(geometry);
    }
    for (const [key, list] of Object.entries(parts)) {
      if (!list.length) continue;
      const merged = mergeGeometries(list, false);
      list.forEach(geometry => geometry.dispose());
      if (!merged) continue;
      const mesh = new Mesh(merged, new MeshStandardMaterial({
        color: theme === 'scifi' ? (key === 'tall' ? '#1b2c4a' : '#16243c') : key === 'tall' ? '#e8ecf1' : '#f6f5f1',
        roughness: theme === 'scifi' ? 0.4 : 0.66, metalness: theme === 'scifi' ? 0.5 : 0.04,
        ...(theme === 'scifi' ? { emissive: new Color('#061428') } : {}),
      }));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }
  return group;
}
