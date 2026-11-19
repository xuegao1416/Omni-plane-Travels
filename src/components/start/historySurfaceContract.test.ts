import { describe,expect,test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('character history ritual surface contract', () => {
  test('uses a responsive surface with a browsable rail', () => {
    const source = read('./StepCharacterHistory.tsx');
    const wizard = read('./WizardShell.tsx');
    const styles = read('../../ui/screens/wizard-steps.css');

    expect(source).toContain('history-ritual-surface');
    expect(source).toContain('history-ritual-surface__editor');
    expect(source).toContain('history-progress-rail history-ritual-surface__rail');
    expect(styles).toContain('.history-ritual-surface {');
    expect(styles).toMatch(/@media \(max-width: 900px\)[\s\S]*\.history-progress-rail \{[^}]*overflow-x:\s*auto/);
    expect(styles).toContain('scroll-padding-inline');
    expect(wizard).toContain("currentStep === historyStep ? ' is-step-3' : ''");
    expect(styles).toContain('@media (max-width: 640px)');
  });
});
