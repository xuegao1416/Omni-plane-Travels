// ============================================================
// 动态选项生成器 — 单元测试
// ============================================================
import { test, expect, describe, beforeEach } from 'bun:test';
import {
  buildDynamicChoicePrompt,
  parseDynamicChoices,
  generateDynamicChoices,
  buildPromptInput,
  clearDynamicChoiceCache,
} from './dynamicChoiceGenerator';
import type { DynamicChoiceConfig, ChoiceOption } from './schema';
import type { GameState } from '../schema/variables';

// ─── 测试用数据 ───

const baseConfig: DynamicChoiceConfig = {
  instruction: '根据玩家当前状态，生成合理的选项',
  countRange: [2, 4],
  optionTemplate: { labelRequired: true, effectRequired: false, aiNoteRequired: true },
  fallbackChoices: [
    { label: '静观其变', aiNote: '玩家选择等待' },
    { label: '谨慎行动', aiNote: '玩家选择谨慎行事' },
  ],
};

const configWithEffects: DynamicChoiceConfig = {
  instruction: '生成带有数值效果的选项',
  countRange: [2, 3],
  optionTemplate: { labelRequired: true, effectRequired: true, aiNoteRequired: true },
};

const mockGameState: GameState = {
  玩家: {
    生存状态: { 生命: 80, 能量: 60, dim1: 50 },
    生存资源: {
      食物: { 数量: 10 },
      水: { 数量: 5 },
    },
    经营资产: { 资金: 1000, 资产列表: [], 交易日志: [] },
    货币资源: { 主货币: { 名称: '金币', 数量: 500 } },
  },
} as unknown as GameState;

// ─── buildDynamicChoicePrompt 测试 ───

describe('buildDynamicChoicePrompt', () => {
  test('构建基本 prompt', () => {
    const input = {
      worldName: '测试世界',
      narrativeText: '你站在森林边缘，前方是一片黑暗的树林。',
      config: baseConfig,
      playerStats: { 生命: 80, 能量: 60 },
      playerResources: { '生存资源.食物': 10 },
      recentDecisions: ['选择了和平路线'],
      gameTime: '第3天',
    };

    const prompt = buildDynamicChoicePrompt(input);

    expect(prompt).toContain('互动叙事游戏的选项生成器');
    expect(prompt).toContain('森林边缘');
    expect(prompt).toContain('生命: 80');
    expect(prompt).toContain('能量: 60');
    expect(prompt).toContain('生存资源.食物: 10');
    expect(prompt).toContain('选择了和平路线');
    expect(prompt).toContain('第3天');
    expect(prompt).toContain('2 到 4 个选项');
    expect(prompt).toContain('aiNote');
  });

  test('无场景描述时使用占位符', () => {
    const input = {
      narrativeText: '',
      config: baseConfig,
      playerStats: {},
      playerResources: {},
      recentDecisions: [],
    };

    const prompt = buildDynamicChoicePrompt(input);
    expect(prompt).toContain('（无场景描述）');
  });

  test('effectRequired 时包含 effect 格式说明', () => {
    const input = {
      narrativeText: '测试',
      config: configWithEffects,
      playerStats: {},
      playerResources: {},
      recentDecisions: [],
    };

    const prompt = buildDynamicChoicePrompt(input);
    expect(prompt).toContain('"effect"');
    expect(prompt).toContain('statId');
  });

  test('自定义 countRange', () => {
    const config: DynamicChoiceConfig = {
      instruction: '测试',
      countRange: [3, 5],
    };
    const input = {
      narrativeText: '测试',
      config,
      playerStats: {},
      playerResources: {},
      recentDecisions: [],
    };

    const prompt = buildDynamicChoicePrompt(input);
    expect(prompt).toContain('3 到 5 个选项');
  });
});

// ─── parseDynamicChoices 测试 ───

describe('parseDynamicChoices', () => {
  test('解析正常 JSON 数组', () => {
    const raw = JSON.stringify([
      { label: '选项一', aiNote: '玩家选择了选项一' },
      { label: '选项二', aiNote: '玩家选择了选项二' },
    ]);

    const result = parseDynamicChoices(raw, baseConfig);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('选项一');
    expect(result[0].aiNote).toBe('玩家选择了选项一');
    expect(result[1].label).toBe('选项二');
  });

  test('解析带 effect 的选项', () => {
    const raw = JSON.stringify([
      { label: '攻击', aiNote: '发起攻击', effect: { statId: '生命', delta: -10 } },
      { label: '防御', aiNote: '进行防御', effect: { resourcePath: '生存资源.体力', delta: -5 } },
    ]);

    const result = parseDynamicChoices(raw, configWithEffects);
    expect(result).toHaveLength(2);
    expect(result[0].effect?.statId).toBe('生命');
    expect(result[0].effect?.delta).toBe(-10);
    expect(result[1].effect?.resourcePath).toBe('生存资源.体力');
    expect(result[1].effect?.delta).toBe(-5);
  });

  test('从 ```json``` 代码块中提取', () => {
    const raw = '```json\n[{"label":"选项A","aiNote":"备注A"}]\n```';

    const result = parseDynamicChoices(raw, baseConfig);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('选项A');
  });

  test('从混合文本中提取数组', () => {
    const raw = '这是AI的解释文字\n[{"label":"选项B","aiNote":"备注B"}]\n结束';

    const result = parseDynamicChoices(raw, baseConfig);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('选项B');
  });

  test('空字符串返回空数组', () => {
    expect(parseDynamicChoices('', baseConfig)).toEqual([]);
  });

  test('无效 JSON 返回空数组', () => {
    expect(parseDynamicChoices('这不是JSON', baseConfig)).toEqual([]);
  });

  test('非数组 JSON 返回空数组', () => {
    expect(parseDynamicChoices('{"key":"value"}', baseConfig)).toEqual([]);
  });

  test('缺少 label 的选项被过滤', () => {
    const raw = JSON.stringify([
      { label: '有效选项', aiNote: '备注' },
      { aiNote: '没有label' },
      { label: '', aiNote: '空label' },
      { label: '另一个有效选项' },
    ]);

    const result = parseDynamicChoices(raw, baseConfig);
    expect(result).toHaveLength(2);
    expect(result[0].label).toBe('有效选项');
    expect(result[1].label).toBe('另一个有效选项');
  });

  test('处理旧版 string 格式（通过 normalizeChoice，但 parseDynamicChoices 不处理）', () => {
    // parseDynamicChoices 只处理对象格式，string 格式由 CardRenderer 的 normalizeChoice 处理
    const raw = JSON.stringify(['选项一', '选项二']);
    const result = parseDynamicChoices(raw, baseConfig);
    // string 元素没有 label 属性，会被过滤
    expect(result).toHaveLength(0);
  });
});

// ─── buildPromptInput 测试 ───

describe('buildPromptInput', () => {
  test('从 GameState 提取属性和资源', () => {
    const input = buildPromptInput(baseConfig, mockGameState, '测试场景', { worldName: '测试世界', gameTime: '第5天' });

    expect(input.narrativeText).toBe('测试场景');
    expect(input.worldName).toBe('测试世界');
    expect(input.gameTime).toBe('第5天');
    expect(input.playerStats).toEqual({ 生命: 80, 能量: 60, dim1: 50 });
    expect(input.playerResources['生存资源.食物']).toBe(10);
    expect(input.playerResources['生存资源.水']).toBe(5);
    expect(input.playerResources['经营资产.资金']).toBe(1000);
    expect(input.playerResources['货币资源.主货币']).toBe(500);
  });

  test('空 GameState 返回空摘要', () => {
    const input = buildPromptInput(baseConfig, {} as unknown as GameState, '测试');
    expect(input.playerStats).toEqual({});
    expect(input.playerResources).toEqual({});
  });
});

// ─── 缓存测试 ───

describe('缓存', () => {
  beforeEach(() => {
    clearDynamicChoiceCache();
  });

  test('buildPromptInput 正确提取数据', () => {
    const input = buildPromptInput(baseConfig, mockGameState, '场景');
    expect(input.playerStats['生命']).toBe(80);
    expect(input.playerResources['生存资源.食物']).toBe(10);
  });
});

// ─── 边界情况测试 ───

describe('边界情况', () => {
  test('parseDynamicChoices 处理 extra whitespace', () => {
    const raw = '  \n  [{"label":"  带空格  ","aiNote":"  备注  "}]  \n  ';
    const result = parseDynamicChoices(raw, baseConfig);
    expect(result).toHaveLength(1);
    expect(result[0].label).toBe('带空格');
    expect(result[0].aiNote).toBe('备注');
  });

  test('parseDynamicChoices 处理嵌套对象', () => {
    const raw = JSON.stringify([
      { label: '选项', aiNote: '备注', effect: { statId: '生命', delta: -10, extra: 'ignored' } },
    ]);
    const result = parseDynamicChoices(raw, configWithEffects);
    expect(result).toHaveLength(1);
    expect(result[0].effect?.delta).toBe(-10);
  });

  test('parseDynamicChoices 处理 delta 为字符串', () => {
    const raw = JSON.stringify([
      { label: '选项', effect: { statId: '生命', delta: '-15' } },
    ]);
    const result = parseDynamicChoices(raw, configWithEffects);
    expect(result).toHaveLength(1);
    expect(result[0].effect?.delta).toBe(-15);
  });

  test('buildDynamicChoicePrompt 无最近决策时不包含决策段', () => {
    const input = {
      narrativeText: '测试',
      config: baseConfig,
      playerStats: {},
      playerResources: {},
      recentDecisions: [],
    };
    const prompt = buildDynamicChoicePrompt(input);
    expect(prompt).not.toContain('最近决策');
  });
});
