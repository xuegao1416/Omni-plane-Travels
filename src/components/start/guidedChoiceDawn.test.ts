import { describe,expect,test } from 'bun:test';
import { existsSync,readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('guided world weave Dawn presentation', () => {
  const editor = read('./WorldEditorForm.tsx');
  const overlay = read('./GuidedChoiceOverlay.tsx');
  const indicator = read('./guidedChoice/StepIndicator.tsx');
  const dimensions = read('./guidedChoice/dimensions.ts');
  const navigation = read('./guidedChoice/BottomNav.tsx');
  const loading = read('./guidedChoice/LoadingView.tsx');
  const styles = read('../../ui/screens/world-weave.css');

  test('renders the inference flow inside the World Weave body', () => {
    expect(editor).toContain("world-editor-body${showGuidedChoice ? ' has-guided-choice' : ''}");
    expect(editor).toMatch(/world-editor-body[\s\S]*showGuidedChoice[\s\S]*<GuidedChoiceOverlay[\s\S]*world-editor-footer/);
    expect(overlay).toContain('className="guided-choice-panel"');
    expect(overlay).not.toContain("position: 'fixed'");
    expect(overlay).toContain('世界织构推演');
  });

  test('draws step badges in code and keeps the compact Dawn actions', () => {
    expect(indicator).toContain('<dim.icon className="guided-choice-step__glyph"');
    expect(indicator).not.toContain('<img');
    expect(dimensions).toContain('icon:');
    expect(styles).toContain('.guided-choice-step__glyph {');
    expect(loading).toContain('<Astrolabe variant="ritual"');
    expect(navigation).toContain('EntrySlicedButton');
  });

  test('removes the legacy inline visual contract and locks responsive rules', () => {
    expect(existsSync(new URL('./guidedChoice/styles.ts', import.meta.url))).toBe(false);
    expect(styles).toContain('.guided-choice-options {');
    expect(styles).toContain('@media (max-width: 640px)');
    expect(styles).toContain('grid-template-columns: 1fr;');
  });
});
