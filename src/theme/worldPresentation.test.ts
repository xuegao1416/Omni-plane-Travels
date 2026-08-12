import { describe, expect, test } from 'bun:test';
import type { WorldDef } from '../data/worldLoader';
import { normalizeWorldPresentation } from './worldPresentation';

describe('normalizeWorldPresentation', () => {
  test('keeps an explicit skin for new world definitions', () => {
    const world = {
      id: 'custom-1',
      name: 'Crystal Sea',
      description: '',
      entryId: null,
      presentation: {
        skin: 'crystal-sea',
        coverImage: '/art/theme/worlds/wuxia_world-scene.png',
      },
    } as WorldDef;

    expect(normalizeWorldPresentation(world)).toEqual({
      skin: 'crystal-sea',
      coverImage: '/art/theme/worlds/wuxia_world-scene.png',
    });
  });

  test('returns neutral defaults for old saves', () => {
    const world = {
      id: 'old',
      name: 'Old World',
      description: '',
      entryId: null,
    } as WorldDef;

    expect(normalizeWorldPresentation(world)).toEqual({ skin: 'crystal-neutral' });
  });
});
