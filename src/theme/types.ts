export type ThemeMode = 'light' | 'dark';

export type ThemeSkinId =
  | 'crystal-neutral'
  | 'crystal-cyber'
  | 'crystal-forest'
  | 'crystal-ruins'
  | 'crystal-sakura';

export interface ThemeTokenSet {
  accent: string;
  surface: string;
  border: string;
  glow: string;
}

export interface ThemeMotionSpec {
  enterMs: number;
  settleMs: number;
  reducedMotion: boolean;
}

export interface ThemeSkinDefinition {
  id: ThemeSkinId;
  tokens: Record<ThemeMode, ThemeTokenSet>;
  motion: ThemeMotionSpec;
}

export interface AdaptiveThemeSpec {
  skinId: ThemeSkinId;
  mode: ThemeMode;
  tokens: ThemeTokenSet;
  motion: ThemeMotionSpec;
}
