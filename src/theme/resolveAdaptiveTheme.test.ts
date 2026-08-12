import { describe, expect, test } from 'bun:test';
import { resolveAdaptiveTheme } from './resolveAdaptiveTheme';
import type { ThemeSkinId } from './types';

const world = (id: string, tags: string[] = []) => ({
  id,
  name: id,
  description: '',
  entryId: null,
  tags,
});

describe('resolveAdaptiveTheme', () => {
  test('maps a built-in world to its registered skin', () => {
    const result = resolveAdaptiveTheme(world('world-cyber-city'), 'light');
    expect(result.skinId).toBe('crystal-cyber');
    expect(result.mode).toBe('light');
    expect(result.tokens.surface).toBeTruthy();
  });

  test('uses built-in ID mapping when presentation metadata is absent', () => {
    const result = resolveAdaptiveTheme(
      { ...world('world-cyber-city'), presentation: undefined },
      'light',
    );
    expect(result.skinId).toBe('crystal-cyber');
  });

  test('uses explicit custom presentation before tag heuristics', () => {
    const result = resolveAdaptiveTheme(
      { ...world('custom', ['森林']), presentation: { skin: 'crystal-forest' } },
      'dark',
    );
    expect(result.skinId).toBe('crystal-forest');
    expect(result.mode).toBe('dark');
  });

  test('honors an explicit neutral presentation over built-in world skins', () => {
    const result = resolveAdaptiveTheme(
      { ...world('world-cyber-city'), presentation: { skin: 'crystal-neutral' } },
      'light',
    );
    expect(result.skinId).toBe('crystal-neutral');
  });

  test('falls back to neutral for unknown worlds', () => {
    expect(resolveAdaptiveTheme(world('unknown'), 'light').skinId).toBe('crystal-neutral');
  });

  const descriptionCases: Array<[string, ThemeSkinId]> = [
    ['cyber', 'crystal-cyber'],
    ['forest', 'crystal-forest'],
    ['ruins', 'crystal-ruins'],
    ['sakura', 'crystal-sakura'],
  ];

  test.each(descriptionCases)('uses description keyword %s when tags are absent', (keyword, expectedSkin) => {
    expect(
      resolveAdaptiveTheme({ ...world('custom'), description: `A ${keyword} world` }, 'light').skinId,
    ).toBe(expectedSkin);
  });

  test('falls back safely for a hostile built-in world id', () => {
    expect(resolveAdaptiveTheme(world('constructor'), 'light').skinId).toBe('crystal-neutral');
  });

  test('ignores malformed runtime tags before normalizing them', () => {
    const malformedWorld = { ...world('custom'), tags: [null, 42, 'forest'] } as unknown as Parameters<
      typeof resolveAdaptiveTheme
    >[0];
    expect(resolveAdaptiveTheme(malformedWorld, 'light').skinId).toBe('crystal-forest');
  });
});
