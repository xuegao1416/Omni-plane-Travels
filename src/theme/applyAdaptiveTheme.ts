import type { AdaptiveThemeSpec } from './types';

/**
 * Applies the resolved adaptive theme to a document root.
 *
 * This deliberately only writes presentation state. Simulation, event, and
 * save state remain owned by their existing stores and providers.
 */
export function applyAdaptiveTheme(root: HTMLElement, spec: AdaptiveThemeSpec): void {
  root.dataset.worldSkin = spec.skinId;
  root.dataset.themeMode = spec.mode;

  for (const [name, value] of Object.entries(spec.tokens)) {
    root.style.setProperty(`--theme-${name}`, value);
  }
}
