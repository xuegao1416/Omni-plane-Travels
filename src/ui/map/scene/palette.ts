/**
 * 3D 沙盘的画风参数：地貌配色、光照、雾、水面、辉光与底座材质。
 */
import type { MapTerrain, MapTheme } from '../../../domains/map/types';

export interface ScenePalette {
  land: Record<MapTerrain, string>;
  /** 海拔越高越往这个颜色靠（岩石 / 积雪）。 */
  rock: string;
  snow: string;
  shallow: string;
  deep: string;
  foam: string;
  /** 背景（画布渐变：中心 → 边缘）。 */
  background: [string, string];
  fog: string;
  fogNear: number;
  fogFar: number;
  sun: { color: string; intensity: number; position: [number, number, number] };
  hemi: { sky: string; ground: string; intensity: number };
  exposure: number;
  bloom: { strength: number; radius: number; threshold: number };
  /** 沙盘侧面的土层（上 → 下）与底座。 */
  strata: [string, string, string];
  plinth: string;
  trim: string;
  heightScale: number;
  /** 路线颜色（按类型覆盖）。 */
  route: string;
  routeAlt: string;
  danger: string;
  beacon: string;
  select: string;
  tree: [string, string];
  roof: string[];
  wall: string;
  glass: string;
  emissive: string;
}

export const SCENE_PALETTES: Record<MapTheme, ScenePalette> = {
  ancient: {
    land: {
      sea: '#6f8578', lake: '#6f8578', plains: '#b4aa7c', farmland: '#a7a26c', forest: '#6c7d45', hills: '#a6946a', mountains: '#958670',
      snow: '#ece6d8', desert: '#cdb07a', swamp: '#76805a', urban: '#b8a17a', wasteland: '#9f8c6c', void: '#b4aa7c', nebula: '#b4aa7c', asteroid: '#b4aa7c',
    },
    rock: '#8b7d68', snow: '#f4f0e6', shallow: '#5f8a86', deep: '#1f3c40', foam: '#e8dfc4',
    background: ['#3a2615', '#120a05'], fog: '#2a1b0f', fogNear: 170, fogFar: 520,
    sun: { color: '#ffe2b8', intensity: 2.3, position: [-70, 95, -45] },
    hemi: { sky: '#d6c9a8', ground: '#4a3520', intensity: 0.85 },
    exposure: 0.98, bloom: { strength: 0.2, radius: 0.45, threshold: 0.9 },
    strata: ['#7a5a35', '#5b4128', '#3a2817'], plinth: '#2b1a0d', trim: '#b8883f', heightScale: 8.5,
    route: '#5a3b1c', routeAlt: '#2f5560', danger: '#9b2f1d', beacon: '#ffcf6a', select: '#ff9d5c',
    tree: ['#4f6b34', '#6b7d3e'], roof: ['#9b2f1d', '#7c3a22', '#3e4f5c', '#8a5a2b'], wall: '#efe2c6', glass: '#d8c9a5', emissive: '#ffcf6a',
  },
  modern: {
    land: {
      sea: '#8fc3e6', lake: '#8fc3e6', plains: '#e7e2d6', farmland: '#dfdcc3', forest: '#a9cf98', hills: '#dcd6c6', mountains: '#cbc4b3',
      snow: '#f7f8fa', desert: '#eadbb5', swamp: '#bcd3b4', urban: '#dedad2', wasteland: '#d4cbb6', void: '#e7e2d6', nebula: '#e7e2d6', asteroid: '#e7e2d6',
    },
    rock: '#bdb5a3', snow: '#ffffff', shallow: '#9fd3f2', deep: '#3d8fd0', foam: '#ffffff',
    background: ['#f2f5f8', '#c9d3dc'], fog: '#dfe6ec', fogNear: 190, fogFar: 600,
    sun: { color: '#ffffff', intensity: 2.4, position: [-55, 110, 35] },
    hemi: { sky: '#eef4fb', ground: '#b5ad9c', intensity: 1.05 },
    exposure: 1.0, bloom: { strength: 0.18, radius: 0.4, threshold: 0.9 },
    strata: ['#f1efea', '#e2ded5', '#cfc9bd'], plinth: '#f6f4f0', trim: '#c7ccd2', heightScale: 6,
    route: '#ffffff', routeAlt: '#f4bd47', danger: '#e0483d', beacon: '#3d8bff', select: '#1a73e8',
    tree: ['#6fae5e', '#8cc072'], roof: ['#f4f4f2', '#e6e8ea', '#d8dde2', '#c9d2da'], wall: '#f4f4f2', glass: '#8fb6d9', emissive: '#ffe4a0',
  },
  scifi: {
    land: {
      sea: '#03101c', lake: '#041422', plains: '#0b2a36', farmland: '#0c2e36', forest: '#0a3036', hills: '#0f3a48', mountains: '#14485a',
      snow: '#2c7a8c', desert: '#1e2a30', swamp: '#0a2a2e', urban: '#101e34', wasteland: '#1a1e2a', void: '#030712', nebula: '#030712', asteroid: '#030712',
    },
    rock: '#1d5c70', snow: '#4fb6cc', shallow: '#062436', deep: '#01060c', foam: '#3ee8ff',
    background: ['#071a2e', '#010308'], fog: '#02060d', fogNear: 160, fogFar: 520,
    sun: { color: '#9fb8ff', intensity: 0.9, position: [-40, 90, -60] },
    hemi: { sky: '#1b3557', ground: '#020408', intensity: 0.55 },
    exposure: 1.05, bloom: { strength: 0.85, radius: 0.5, threshold: 0.24 },
    strata: ['#0a2a3a', '#061826', '#030a12'], plinth: '#050d18', trim: '#3ee8ff', heightScale: 7,
    route: '#3ee8ff', routeAlt: '#8aff6b', danger: '#ff5c7a', beacon: '#ff5cdc', select: '#e6ff4f',
    tree: ['#0f4f5c', '#14606e'], roof: ['#1a2c4a', '#16243c', '#203658', '#0f1c30'], wall: '#1b2a44', glass: '#3ee8ff', emissive: '#3ee8ff',
  },
};
