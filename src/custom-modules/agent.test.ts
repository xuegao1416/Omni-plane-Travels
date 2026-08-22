import { describe, expect, test } from 'bun:test';
import {
  buildCustomModuleCompilerSystemPrompt,
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

const validV2Module = {
  kind: 'custom-gameplay-module',
  schemaVersion: 2,
  id: 'daily-goals',
  name: '每日目标',
  version: '1.0.0',
  author: 'agent',
  scope: 'world',
  state: { completed: { type: 'number', default: 0, min: 0 } },
  inputs: { round: 'game.round' },
  logic: {
    onGameStart: [],
    onTurnEnd: [{ actions: [{ type: 'add', path: 'completed', value: 1 }] }],
    onTick: [], onChoice: [], onButton: [],
  },
  view: { slot: 'right-panel', components: [{ type: 'number', label: '已完成', path: 'completed' }] },
  permissions: { read: ['game.round'], write: 'own-state-only' },
} as const;

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

  test('separates the conversational planner from the strict V2 compiler contract', () => {
    const plannerPrompt = buildCustomModuleAgentSystemPrompt();
    const compilerPrompt = buildCustomModuleCompilerSystemPrompt();
    expect(plannerPrompt).toContain('module 始终为 null');
    expect(plannerPrompt).toContain('unresolved 为空');
    expect(compilerPrompt).toContain('custom-gameplay-module');
    expect(compilerPrompt).toContain('own-state-only');
    expect(compilerPrompt).toContain('禁止额外字段');
    expect(compilerPrompt).toContain('ASCII 标识符');
    expect(compilerPrompt).toContain('onButton');
    expect(compilerPrompt).toContain('permissions.read');
    expect(compilerPrompt).toContain('array 必须同时给出');
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

  test('accepts an explicit null question in a conversational envelope', () => {
    const result = parseCustomModuleAgentTurn(JSON.stringify({
      message: '需求已经足够，我会开始整理草案。',
      phase: 'draft_ready',
      brief: { goal: '记录目标', presentation: 'right-panel', triggers: ['onTurnEnd'], inputs: [], state: ['completed'], behavior: ['累加'], outputs: ['number'], assumptions: [], unresolved: [] },
      question: null,
      module: null,
    }));
    expect(result.ok).toBe(true);
  });

  test('returns actionable paths instead of a root Invalid input for malformed V2 drafts', () => {
    const result = parseCustomModuleAgentTurn(JSON.stringify({
      message: '草案已生成。',
      phase: 'draft_ready',
      brief: { goal: '记录目标', presentation: 'right-panel', triggers: ['onTurnEnd'], inputs: [], state: ['每日目标'], behavior: ['累加'], outputs: ['number'], assumptions: [], unresolved: [] },
      module: {
        ...validV2Module,
        state: { 每日目标: { type: 'number', default: 0 } },
        logic: { ...validV2Module.logic, onTurnEnd: [{ actions: [{ type: 'add', path: '每日目标', value: 1 }] }] },
      },
    }));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((error) => error.path.join('.').includes('state.每日目标'))).toBe(true);
      expect(result.errors.some((error) => error.message === 'Invalid input')).toBe(false);
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

  test('compiles a closed conversational brief in a separate constrained request', async () => {
    let calls = 0;
    const planner = JSON.stringify({
      message: '需求已经闭合，开始编译模块。',
      phase: 'draft_ready',
      brief: { goal: '记录每日目标', presentation: 'right-panel', triggers: ['onTurnEnd'], inputs: ['game.round'], state: ['completed'], behavior: ['每轮累加'], outputs: ['number'], assumptions: [], unresolved: [] },
      question: null,
      module: null,
    });
    const result = await runCustomModuleAgentTurn(
      { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', provider: 'custom' },
      { id: 'world-a', name: 'World A' },
      '做一个每日目标模块，你看着办',
      {
        request: async () => {
          calls += 1;
          return { text: calls === 1 ? planner : JSON.stringify(validV2Module), elapsed: 1 };
        },
      },
    );
    expect(calls).toBe(2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.module?.id).toBe('daily-goals');
      expect(result.session?.brief.goal).toBe('记录每日目标');
    }
  });
});
