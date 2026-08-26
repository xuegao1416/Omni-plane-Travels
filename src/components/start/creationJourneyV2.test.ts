import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('creation journey v2 integration', () => {
  test('moves stat allocation out of the legacy loadout editor', () => {
    const step = read('./StepPersonalInfo.tsx');

    expect(step).not.toContain('StatsTab');
    expect(step).toContain('StepAbilityAlloc');
    expect(step).toContain('ProgressionInitEditor');
    expect(step).toContain('行囊与同行者');
  });

  test('guards unified spending and exposes its read-only confirmation breakdown', () => {
    const shell = read('./WizardShell.tsx');
    const confirm = read('./StepConfirm.tsx');

    expect(shell).toContain('computeCreationSpending');
    expect(shell).toContain('creationSpending.ok');
    expect(confirm).toContain('talentSpent');
    expect(confirm).toContain('drawSpent');
    expect(confirm).toContain('statSpent');
    expect(confirm).toContain('remaining');
  });

  test('keeps difficulty selection inside the identity narrative panel', () => {
    const shell = read('./WizardShell.tsx');
    const step = read('./StepPersonalInfo.tsx');

    expect(shell).toContain('difficultyContent={showDifficulty ?');
    expect(step).toContain('{difficultyContent}');
  });

  test('persists profession library binding changes through the wizard world save path', () => {
    const shell = read('./WizardShell.tsx');
    const start = read('./StartScreen.tsx');

    expect(shell).toContain('ProfessionLibraryWorkspace');
    expect(shell).toContain('extractLegacyProfessionPack');
    expect(shell).toContain('creationDrawnTalentIds: undefined');
    expect(shell).toContain('onSaveWorld?.(updatedWorld)');
    expect(start).toContain('onSaveWorld={h.handleSaveWorld}');
  });
});
