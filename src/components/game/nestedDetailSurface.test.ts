import { describe,expect,test } from 'bun:test';
import { readFileSync } from 'node:fs';

const read = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), 'utf8');

describe('nested game detail surface contract', () => {
  const componentSources = [
    read('./panels/characterGrid/NPCDetail.tsx'),
    read('./panels/characterGrid/SharedUI.tsx'),
    read('./panels/characterGrid/DeedsModal.tsx'),
    read('./panels/profilePanel/shared.tsx'),
    read('./panels/variableSnapshot/RollbackConfirm.tsx'),
    read('./panels/EconomyLedger.tsx'),
    read('./panels/ResourcesLedger.tsx'),
    read('./panels/InGameWorldBookEditor.tsx'),
  ];
  // The pipeline monitor is a brass instrument dialog: shared veil, planar frame instead of the plain panel.
  const pipelineMonitor = read('./chat/PipelineMonitorModal.tsx');
  const componentBundle = componentSources.join('\n');
  const worldBookStyles = read('./panels/inGameWorldBook/styles.module.css');
  const journeyStyles = read('../../ui/screens/game-dossier.css');

  test('all ordinary nested details use the shared veil and panel materials', () => {
    for (const source of componentSources) {
      expect(source).toContain('game-journey__nested-overlay');
      expect(source).toContain('game-journey__nested-panel');
    }
    expect(pipelineMonitor).toContain('game-journey__nested-overlay');
    expect(pipelineMonitor).toContain('<PlanarFrame');
  });

  test('ordinary data details do not restore black scrims', () => {
    expect(componentBundle).not.toMatch(/background:\s*['"]rgba\(\s*(?:0\s*,\s*0\s*,\s*0|6\s*,\s*6\s*,\s*14)/);
    expect(worldBookStyles).not.toMatch(/background:\s*rgba\(\s*0\s*,\s*0\s*,\s*0/);
  });

  test('shared nested panels isolate the translucent legacy drawer variables', () => {
    expect(journeyStyles).toContain('.game-journey__nested-overlay {');
    expect(journeyStyles).toContain('.game-journey__nested-panel {');
    expect(journeyStyles).toContain('--bg-primary: color-mix');
    expect(journeyStyles).toContain('--bg-secondary: color-mix');
    expect(journeyStyles).toContain('--bg-tertiary: color-mix');
    expect(journeyStyles).toContain('.game-journey__nested-panel--side {');
  });
});
