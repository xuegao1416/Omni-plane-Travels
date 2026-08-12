import type { ThemeSkinDefinition, ThemeSkinId } from './types';

const sharedMotion = { enterMs: 420, settleMs: 560, reducedMotion: false } as const;

export const THEME_REGISTRY: Record<ThemeSkinId, ThemeSkinDefinition> = {
  'crystal-neutral': {
    id: 'crystal-neutral',
    tokens: {
      light: { accent: '#7c8fb2', surface: '#f4f7fb', border: '#d9e2f0', glow: 'rgba(124,143,178,.28)' },
      dark: { accent: '#b9c8e6', surface: '#141b2d', border: '#34405b', glow: 'rgba(185,200,230,.25)' },
    },
    motion: sharedMotion,
  },
  'crystal-cyber': {
    id: 'crystal-cyber',
    tokens: {
      light: { accent: '#0ba6c7', surface: '#eefbff', border: '#a8e5ef', glow: 'rgba(11,166,199,.3)' },
      dark: { accent: '#5ee7ff', surface: '#101a2b', border: '#24506a', glow: 'rgba(94,231,255,.28)' },
    },
    motion: sharedMotion,
  },
  'crystal-forest': {
    id: 'crystal-forest',
    tokens: {
      light: { accent: '#3d9b78', surface: '#f0faf4', border: '#b8dfc8', glow: 'rgba(61,155,120,.26)' },
      dark: { accent: '#77d6a1', surface: '#11261f', border: '#2f604b', glow: 'rgba(119,214,161,.24)' },
    },
    motion: sharedMotion,
  },
  'crystal-ruins': {
    id: 'crystal-ruins',
    tokens: {
      light: { accent: '#c37a45', surface: '#fff8f0', border: '#e8c7a8', glow: 'rgba(195,122,69,.26)' },
      dark: { accent: '#e6a16b', surface: '#2a1b16', border: '#70452e', glow: 'rgba(230,161,107,.24)' },
    },
    motion: sharedMotion,
  },
  'crystal-sakura': {
    id: 'crystal-sakura',
    tokens: {
      light: { accent: '#c96b91', surface: '#fff4f8', border: '#edbfd2', glow: 'rgba(201,107,145,.26)' },
      dark: { accent: '#f3a7c4', surface: '#291827', border: '#6a3d57', glow: 'rgba(243,167,196,.24)' },
    },
    motion: sharedMotion,
  },
};

export const BUILTIN_WORLD_SKINS: Record<string, ThemeSkinId> = {
  'world-cyber-city': 'crystal-cyber',
  japanese_school: 'crystal-sakura',
  desire_metropolis: 'crystal-cyber',
  wuxia_world: 'crystal-forest',
  wasteland_apocalypse: 'crystal-ruins',
  stranded_island: 'crystal-forest',
  border_trade: 'crystal-ruins',
};

export const TAG_SKINS: Array<{ tags: string[]; skin: ThemeSkinId }> = [
  { tags: ['赛博', '科幻', 'cyber', 'sci-fi'], skin: 'crystal-cyber' },
  { tags: ['森林', '自然', '校园', 'forest', 'school'], skin: 'crystal-forest' },
  { tags: ['樱花', '和风', 'sakura'], skin: 'crystal-sakura' },
  { tags: ['废土', '荒漠', '遗迹', 'ruins', 'wasteland'], skin: 'crystal-ruins' },
];
