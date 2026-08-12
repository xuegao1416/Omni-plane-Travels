import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const wizardSource = readFileSync(new URL('./WizardShell.tsx', import.meta.url), 'utf8');
const stepSource = readFileSync(new URL('./StepPersonalInfo.tsx', import.meta.url), 'utf8');

describe('wizard modal interaction guard', () => {
  test('blocks both global navigation controls while a child modal is open', () => {
    expect(wizardSource).toContain('modalOpen');
    expect(wizardSource).toContain('disabled={modalOpen}');
    expect(wizardSource).toContain('disabled={modalOpen || !canAdvance}');
  });

  test('reports NPC and picker modal state to the Wizard shell', () => {
    expect(stepSource).toContain('onModalStateChange');
    expect(stepSource).toContain('npcEditorOpen || npcPickerOpen || playerPickerOpen');
  });
});
