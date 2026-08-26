import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('new journey draft reset', () => {
  test('clears save-derived wizard state before entering character creation', () => {
    const startScreen = read('./StartScreen.tsx');
    const wizard = read('../../hooks/useWizard.ts');

    expect(startScreen).toContain('clearSegmentsCache();');
    expect(startScreen).toContain('h.resetForNewJourney();');
    expect(startScreen).toContain('h.setSegments({});');
    expect(startScreen).toContain('h.setIncludeAgeStages(true);');
    expect(wizard).toContain('resetForNewJourney');
  });

  test('resets world-specific creation choices only after the selected world changes', () => {
    const shell = read('./WizardShell.tsx');

    expect(shell).toContain('previousWorldRef');
    expect(shell).toContain('previousWorldRef.current === selectedWorld');
    expect(shell).toContain('creationDrawnTalentIds: undefined');
  });
});
