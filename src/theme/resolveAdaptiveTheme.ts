import type { WorldDef } from '../data/worldLoader';
import { BUILTIN_WORLD_SKINS, TAG_SKINS, THEME_REGISTRY } from './registry';
import type { AdaptiveThemeSpec, ThemeMode, ThemeSkinId } from './types';

function isThemeMode(value: string): value is ThemeMode {
  return value === 'light' || value === 'dark';
}

function isRegisteredSkin(value: string): value is ThemeSkinId {
  return Object.prototype.hasOwnProperty.call(THEME_REGISTRY, value);
}

function skinFromTags(tags: string[] | undefined): ThemeSkinId | undefined {
  if (!tags?.length) return undefined;
  const normalized = tags
    .filter((tag): tag is string => typeof tag === 'string')
    .map(tag => tag.trim().toLocaleLowerCase());
  return TAG_SKINS.find(entry => entry.tags.some(tag => normalized.includes(tag.toLocaleLowerCase())))?.skin;
}

function skinFromDescription(description: string | undefined): ThemeSkinId | undefined {
  if (typeof description !== 'string' || !description.trim()) return undefined;
  const normalized = description.trim().toLocaleLowerCase();
  return TAG_SKINS.find(entry => entry.tags.some(tag => normalized.includes(tag.toLocaleLowerCase())))?.skin;
}

function resolveSkin(world: WorldDef): ThemeSkinId {
  const explicit = world.presentation?.skin;
  if (typeof explicit === 'string' && isRegisteredSkin(explicit)) return explicit;

  const builtIn = Object.prototype.hasOwnProperty.call(BUILTIN_WORLD_SKINS, world.id)
    ? BUILTIN_WORLD_SKINS[world.id]
    : undefined;
  if (typeof builtIn === 'string' && isRegisteredSkin(builtIn)) return builtIn;

  return skinFromTags(world.tags) ?? skinFromDescription(world.description) ?? 'crystal-neutral';
}

export function resolveAdaptiveTheme(world: WorldDef, mode: ThemeMode | string): AdaptiveThemeSpec {
  const safeMode: ThemeMode = isThemeMode(mode) ? mode : 'light';
  const skinId = resolveSkin(world);
  const definition = THEME_REGISTRY[skinId];

  return {
    skinId,
    mode: safeMode,
    tokens: definition.tokens[safeMode],
    motion: definition.motion,
  };
}
