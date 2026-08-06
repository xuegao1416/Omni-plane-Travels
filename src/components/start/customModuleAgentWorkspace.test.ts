import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'bun:test';

const workspaceSource = readFileSync(new URL('./CustomModuleAgentWorkspace.tsx', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('../../styles/custom-modules.css', import.meta.url), 'utf8');

describe('custom module Agent external workspace', () => {
  test('is a standalone overlay with conversation and world context', () => {
    expect(stylesSource).toContain('.custom-module-workspace { position: fixed;');
    expect(workspaceSource).toContain('conversation');
    expect(workspaceSource).toContain('selectedWorldId');
    expect(workspaceSource).toContain('runCustomModuleAgentTurn');
  });

  test('keeps the install action behind a validated draft confirmation', () => {
    expect(workspaceSource).toContain('saveCustomGameplayModule');
    expect(workspaceSource).toContain('bindCustomGameplayModule');
    expect(workspaceSource).toContain('确认安装到当前世界');
    expect(workspaceSource).toContain('draft?.ok');
  });

  test('asks for the minimum design details before calling the Agent', () => {
    expect(workspaceSource).toContain('getMissingCustomModuleRequestFields');
    expect(workspaceSource).toContain("status: 'needs_input'");
  });
});
