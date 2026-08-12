import { useLayoutEffect } from 'react';
import { useGame } from '../context/GameContext';
import { findWorldDef } from '../data/worldLoader';
import { useConfigStore } from '../stores/configStore';
import { applyAdaptiveTheme } from './applyAdaptiveTheme';
import { resolveAdaptiveTheme } from './resolveAdaptiveTheme';
import type { ThemeMode } from './types';

const FALLBACK_WORLD = {
  id: 'unknown',
  name: 'Unknown World',
  description: '',
  entryId: null,
} as const;

/**
 * Activates the presentation theme for the currently selected world.
 *
 * The hook is intentionally a one-way bridge from existing app state into
 * the document root; it does not modify the game engine or any persistence
 * state.
 */
export function useAdaptiveTheme(): void {
  const { state } = useGame();
  const configuredTheme = useConfigStore(settings => settings.settings.theme);
  const mode: ThemeMode = configuredTheme === 'dark' ? 'dark' : 'light';

  useLayoutEffect(() => {
    const world = findWorldDef(state.selectedWorld) ?? FALLBACK_WORLD;
    const spec = resolveAdaptiveTheme(world, mode);
    applyAdaptiveTheme(document.documentElement, spec);
  }, [state.selectedWorld, mode]);
}
