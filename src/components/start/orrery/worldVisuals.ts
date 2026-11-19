import type { WorldDef } from '../../../data/worldLoader';
import { resolveWorldArtwork } from '../../../data/worldArtwork';

export const BUILTIN_WORLD_ORDER = [
  'japanese_school',
  'desire_metropolis',
  'wuxia_world',
  'wasteland_apocalypse',
  'stranded_island',
  'border_trade',
] as const;

export const BUILTIN_WORLD_SET = new Set<string>(BUILTIN_WORLD_ORDER);

const DIFFICULTY_LABEL: Record<string, string> = { easy: '平缓', medium: '起伏', hard: '凶险' };

export function difficultyLabel(difficulty?: string) {
  return difficulty ? DIFFICULTY_LABEL[difficulty] ?? difficulty : '未测定';
}

export function planeCode(index: number) {
  return `P-${String(index + 1).padStart(2, '0')}`;
}

export interface WorldVisual {
  scene: string;
  accent: string;
  focalX: number;
  focalY: number;
}

export function getWorldVisual(world: WorldDef): WorldVisual {
  const artwork = resolveWorldArtwork(world);
  return {
    scene: artwork.src,
    accent: world.coverColor || '#c9a86a',
    focalX: artwork.focalX,
    focalY: artwork.focalY,
  };
}

export function hasEnabledSystemModule(world: WorldDef) {
  return world.modules?.some(module => module.enabled) ?? false;
}
