import { describe, expect, test } from 'bun:test';
import {
  buildCustomModuleAgentSystemPrompt,
  extractCustomModuleJson,
  parseCustomModuleAgentTurn,
  parseCustomModuleDraft,
  runCustomModuleAgentTurn,
} from './agent';

const validJson = JSON.stringify({
  kind: 'custom-gameplay-module',
  schemaVersion: 1,
  id: 'camp-morale',
  name: 'Camp Morale',
  version: '1.0.0',
  author: 'agent',
  scope: 'world',
  state: { score: { type: 'number', default: 50, min: 0, max: 100 } },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [] },
  view: { slot: 'right-panel', components: [{ type: 'progress', path: 'score' }] },
  permissions: { read: [], write: 'own-state-only' },
});

describe('custom module agent draft protocol', () => {
  test('extracts JSON from plain and fenced assistant output', () => {
    expect(extractCustomModuleJson(validJson)).toEqual(JSON.parse(validJson));
    expect(extractCustomModuleJson(`这里是草案：\n\`\`\`json\n${validJson}\n\`\`\``)).toEqual(JSON.parse(validJson));
  });

  test('validates a draft before it can be installed', () => {
    const result = parseCustomModuleDraft(`${validJson}\n请确认`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.module.id).toBe('camp-morale');

    const invalid = parseCustomModuleDraft('{"kind":"custom-gameplay-module","code":"alert(1)"}');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.errors.length).toBeGreaterThan(0);
  });

  test('system prompt fixes v1 boundaries and prevents executable extensions', () => {
    const prompt = buildCustomModuleAgentSystemPrompt();
    expect(prompt).toContain('custom-gameplay-module');
    expect(prompt).toContain('own-state-only');
    expect(prompt).toContain('禁止');
    expect(prompt).toContain('code');
    expect(prompt).toContain('right-panel');
    expect(prompt).toContain('"actions": [{ "type": "add"');
    expect(prompt).toContain('Do not output legacy rule fields');
    expect(prompt).toContain('"type":"progress"');
    expect(prompt).toContain('"type":"table"');
    expect(prompt).toContain('permissions.read');
    expect(prompt).toContain('inputs');
    expect(prompt).toContain('精确列出');
  });

  test('parses a conversational clarification turn without requiring a module', () => {
    const result = parseCustomModuleAgentTurn(JSON.stringify({
      message: '你希望这个模块显示在右侧卡片，还是只在后台运行？',
      status: 'needs_input',
      question: { id: 'presentation', text: '请选择展示方式', choices: ['右侧卡片', '后台运行'] },
      module: null,
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('needs_input');
      expect(result.message).toContain('右侧卡片');
      expect(result.module).toBeUndefined();
      expect(result.question?.text).toBe('请选择展示方式');
      expect(result.question?.choices).toEqual(['右侧卡片', '后台运行']);
    }
  });

  test('parses a draft-ready turn and validates its nested module', () => {
    const result = parseCustomModuleAgentTurn(JSON.stringify({
      message: '我已经整理好了第一版草案。',
      status: 'draft_ready',
      module: JSON.parse(validJson),
    }));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe('draft_ready');
      expect(result.module?.id).toBe('camp-morale');
    }
  });

  test('repairs one invalid model turn with validator feedback and stops after one retry', async () => {
    let calls = 0;
    const invalid = JSON.stringify({
      message: 'draft',
      status: 'draft_ready',
      module: {
        ...JSON.parse(validJson),
        logic: { onGameStart: [{ action: 'add', path: 'score', value: 1 }] },
      },
    });
    const repaired = JSON.stringify({
      message: 'repaired',
      status: 'draft_ready',
      module: JSON.parse(validJson),
    });

    const result = await runCustomModuleAgentTurn(
      { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', provider: 'custom' },
      { id: 'world-a', name: 'World A' },
      [{ role: 'user', content: '做一个后台模块，每轮记录声望' }],
      {
        request: async (_config, messages) => {
          calls += 1;
          if (calls === 2) expect(messages.at(-1)?.content).toContain('logic.onGameStart.0.actions');
          return { text: calls === 1 ? invalid : repaired, elapsed: 1 };
        },
      },
    );

    expect(calls).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.module?.id).toBe('camp-morale');
  });
});
