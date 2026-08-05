import { describe, expect, test } from 'bun:test';
import { hasEnabledSystemModule } from './StepWorldBrowser';
import type { WorldModule } from '../../data/worlds-schema';
import { WORLDS } from '../../data/worldLoader';

describe('world systems tab visibility', () => {
  test('shows the systems tab for legacy string module ids', () => {
    expect(hasEnabledSystemModule(['stat'] as unknown as WorldModule[])).toBe(true);
  });

  test('shows the systems tab for normalized enabled module objects', () => {
    expect(hasEnabledSystemModule([{ moduleId: 'stat', name: '属性', enabled: true }])).toBe(true);
  });

  test('does not show the systems tab for an empty module list', () => {
    expect(hasEnabledSystemModule([])).toBe(false);
  });
});

describe('built-in world source data', () => {
  test('keeps the canonical display name for desire_metropolis', () => {
    expect(WORLDS.find((world) => world.id === 'desire_metropolis')?.name).toBe('烟火人间');
  });

  test('keeps structured system configuration for all six built-in worlds', () => {
    expect(WORLDS).toHaveLength(6);
    for (const world of WORLDS) {
      expect(world.modules?.every((module) => typeof module !== 'string' && module.enabled)).toBe(true);
      expect(world.modules?.some((module) => typeof module !== 'string' && (module.moduleConfig || module.initialState))).toBe(true);
    }
  });
});
