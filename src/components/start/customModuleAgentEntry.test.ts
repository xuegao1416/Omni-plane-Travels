import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const startScreenSource = readFileSync(new URL('./StartScreen.tsx', import.meta.url), 'utf8');
const worldHallSource = readFileSync(new URL('./WorldHallView.tsx', import.meta.url), 'utf8');
const rightPanelSource = readFileSync(new URL('../game/panels/RightPanel.tsx', import.meta.url), 'utf8');

describe('custom module Agent entry placement', () => {
  test('main menu exposes an external workspace callback', () => {
    expect(worldHallSource).toContain('onOpenCustomModules');
    expect(startScreenSource).toContain('CustomModuleAgentWorkspace');
  });

  test('game right panel does not mount the Agent workspace', () => {
    expect(rightPanelSource).not.toContain('CustomModuleAgentPanel');
    expect(rightPanelSource).not.toContain('自定义模块 Agent');
  });
});
