import type { WorldDef } from '../data/worldLoader';

export interface NormalizedWorldPresentation {
  skin: string;
  coverImage?: string;
}

const NEUTRAL_SKIN = 'crystal-neutral';

/**
 * Normalizes optional presentation metadata while keeping old world saves
 * compatible with the adaptive theme layer.
 */
export function normalizeWorldPresentation(
  world: Pick<WorldDef, 'presentation'>,
): NormalizedWorldPresentation {
  const presentation = world.presentation;
  const skin = typeof presentation?.skin === 'string' && presentation.skin.length > 0
    ? presentation.skin
    : NEUTRAL_SKIN;

  const coverImage = typeof presentation?.coverImage === 'string' && presentation.coverImage.length > 0
    ? presentation.coverImage
    : undefined;

  return coverImage ? { skin, coverImage } : { skin };
}
