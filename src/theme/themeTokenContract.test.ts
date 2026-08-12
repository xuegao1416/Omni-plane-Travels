import { describe, expect, test } from 'bun:test';
import { THEME_REGISTRY } from './registry';

const REQUIRED_THEME_VARIABLES = [
  '--theme-accent',
  '--theme-surface',
  '--theme-border',
] as const;

describe('adaptive theme token contract', () => {
  test('every registered skin exposes the required theme variables', () => {
    for (const [skinId, definition] of Object.entries(THEME_REGISTRY)) {
      for (const mode of ['light', 'dark'] as const) {
        const tokens = definition.tokens[mode];
        const contract = {
          '--theme-accent': tokens.accent,
          '--theme-surface': tokens.surface,
          '--theme-border': tokens.border,
        };

        for (const variable of REQUIRED_THEME_VARIABLES) {
          expect(contract[variable], `${skinId}/${mode} is missing ${variable}`).toBeTruthy();
        }
      }
    }
  });
});
