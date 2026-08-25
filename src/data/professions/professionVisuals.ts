import type { ProfessionAbilityDef, ProfessionDef, ProfessionAccentKey } from '../../modules/schema';
export type { ProfessionAccentKey };

/** Finite semantic accents shared by creation, profession book and combat HUD. */
export const PROFESSION_ACCENT_KEYS: readonly ProfessionAccentKey[] = [
  'crimson', 'amber', 'jade', 'azure', 'violet', 'silver',
];

export const PROFESSION_EMBLEM_KEYS = [
  'warrior', 'mage', 'ranger', 'rogue', 'cleric', 'paladin',
  'swordsman', 'bladesman', 'spearmaster', 'unarmed', 'healer', 'qimen',
] as const;

export type ProfessionEmblemKey = typeof PROFESSION_EMBLEM_KEYS[number];

const FALLBACK_ORDER: readonly ProfessionAccentKey[] = PROFESSION_ACCENT_KEYS;

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function isProfessionAccentKey(value: unknown): value is ProfessionAccentKey {
  return typeof value === 'string' && (PROFESSION_ACCENT_KEYS as readonly string[]).includes(value);
}

export function isProfessionEmblemKey(value: unknown): value is ProfessionEmblemKey {
  return typeof value === 'string' && (PROFESSION_EMBLEM_KEYS as readonly string[]).includes(value);
}

export function fallbackProfessionAccent(professionId: string): ProfessionAccentKey {
  return FALLBACK_ORDER[stableHash(professionId) % FALLBACK_ORDER.length];
}

export function fallbackProfessionEmblem(professionId: string): ProfessionEmblemKey {
  const normalizedId = professionId.trim().toLowerCase();
  if (isProfessionEmblemKey(normalizedId)) return normalizedId;
  return PROFESSION_EMBLEM_KEYS[stableHash(professionId) % PROFESSION_EMBLEM_KEYS.length];
}

export function resolveProfessionVisual(profession: Pick<ProfessionDef, 'id' | 'visual'>): {
  emblemKey: ProfessionEmblemKey;
  accentKey: ProfessionAccentKey;
} {
  return {
    emblemKey: isProfessionEmblemKey(profession.visual?.emblemKey)
      ? profession.visual.emblemKey
      : fallbackProfessionEmblem(profession.id),
    accentKey: isProfessionAccentKey(profession.visual?.accentKey)
      ? profession.visual.accentKey
      : fallbackProfessionAccent(profession.id),
  };
}

export function resolveAbilityIconKey(ability: Pick<ProfessionAbilityDef, 'id' | 'iconKey'>, professionId: string): ProfessionEmblemKey {
  return isProfessionEmblemKey(ability.iconKey)
    ? ability.iconKey
    : fallbackProfessionEmblem(professionId || ability.id);
}

export function professionEmblemSrc(emblemKey: ProfessionEmblemKey): string {
  return `/art/theme/ui-kit/dawn-v4/professions/emblems-v1/${emblemKey}.png`;
}
