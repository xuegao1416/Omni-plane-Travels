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
    expect(workspaceSource).toContain('保存并绑定');
    expect(workspaceSource).toContain('session.lastValidDraft');
  });

  test('owns a structured session and preserves the last valid blueprint during revision', () => {
    expect(workspaceSource).toContain('CustomModuleAgentSession');
    expect(workspaceSource).toContain('applyCustomModuleAgentTurn');
    expect(workspaceSource).toContain('session.brief');
    expect(workspaceSource).toContain('本轮未应用');
    expect(workspaceSource).not.toContain('setDraft(null)');
  });

  test('renders the current follow-up question and exposes its choices as input shortcuts', () => {
    expect(workspaceSource).toContain('activeQuestion');
    expect(workspaceSource).toContain('result.question');
    expect(workspaceSource).toContain('activeQuestion.choices');
    expect(workspaceSource).toContain('setInput(choice)');
    expect(workspaceSource).toContain("result.phase === 'draft_ready' ? undefined");
    expect(workspaceSource).toContain('sameText');
  });
});
