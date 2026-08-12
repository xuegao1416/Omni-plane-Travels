import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('character history ritual surface contract', () => {
  test('uses a responsive surface with a browsable rail and non-overlapping footer', () => {
    const source = read('./StepCharacterHistory.tsx');
    const wizard = read('./WizardShell.tsx');
    const styles = read('../../styles/creation-ritual.css');

    expect(source).toContain('history-ritual-surface');
    expect(source).toContain('history-ritual-surface__editor');
    expect(source).toContain('history-ritual-surface__rail');
    expect(styles).toContain('.history-ritual-surface');
    expect(styles).toMatch(/\.history-ritual-surface__rail[\s\S]*overflow-x:\s*auto/);
    expect(styles).toMatch(/\.history-ritual-surface__editor[\s\S]*min-height:\s*0/);
    expect(styles).toContain('.history-ritual-surface__nav');
    expect(styles).toContain('scroll-padding-inline');
    expect(styles).toMatch(/\.creation-ritual-shell__footer\.is-step-3[\s\S]*grid-template-columns/);
    expect(wizard).toContain("currentStep === 3 ? ' is-step-3' : ''");
    expect(styles).toContain('@media (max-width: 640px)');
  });
});
