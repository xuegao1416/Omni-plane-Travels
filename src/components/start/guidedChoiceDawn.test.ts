import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('guided world weave Dawn presentation', () => {
  const editor = read('./WorldEditorForm.tsx');
  const overlay = read('./GuidedChoiceOverlay.tsx');
  const indicator = read('./guidedChoice/StepIndicator.tsx');
  const dimensions = read('./guidedChoice/dimensions.ts');
  const navigation = read('./guidedChoice/BottomNav.tsx');
  const loading = read('./guidedChoice/LoadingView.tsx');
  const styles = read('../../styles/layout-wizard.css');

  test('renders the inference flow inside the World Weave body', () => {
    expect(editor).toContain("world-editor-body${showGuidedChoice ? ' has-guided-choice' : ''}");
    expect(editor).toMatch(/world-editor-body[\s\S]*showGuidedChoice[\s\S]*<GuidedChoiceOverlay[\s\S]*world-editor-footer/);
    expect(overlay).toContain('className="guided-choice-panel"');
    expect(overlay).not.toContain("position: 'fixed'");
    expect(overlay).toContain('世界织构推演');
  });

  test('uses the existing ritual assets and compact Dawn actions', () => {
    expect(indicator).toContain('src={dim.emblem}');
    expect(dimensions).toContain("emblem-31-v2.png");
    expect(dimensions).toContain("emblem-38-v2.png");
    expect(loading).toContain('/art/theme/ui-kit/dawn-v4/ritual/talent-astrolabe-v1.png');
    expect(navigation).toContain('EntrySlicedButton');
  });

  test('removes the legacy inline visual contract and locks responsive rules', () => {
    expect(existsSync(new URL('./guidedChoice/styles.ts', import.meta.url))).toBe(false);
    expect(styles).toContain('.guided-choice-options {');
    expect(styles).toContain('@media (max-height: 660px) and (min-width: 641px)');
    expect(styles).toContain('@media (max-width: 640px)');
    expect(styles).toContain('grid-template-columns: 1fr;');
  });
});
