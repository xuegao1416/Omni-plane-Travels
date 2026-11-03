import { describe,expect,test } from 'bun:test';
import { customGameplayModuleSchema,parseCustomGameplayModule } from './manifestSchema';
import type { CustomGameplayModuleV3 } from './schema';
import { normalizeCustomGameplayModule } from './normalize';

const validModule: CustomGameplayModuleV3 = {
  kind: 'custom-gameplay-module',
  schemaVersion: 3,
  capabilities: [], items: {}, inputs: {},
  id: 'reputation-system',
  name: '声望系统',
  version: '1.0.0',
  author: 'player',
  description: '记录玩家在本地社区中的声望。',
  scope: 'world',
  state: {
    score: { type: 'number', default: 0, min: -100, max: 100 },
    title: { type: 'string', default: '陌生人', maxLength: 24 },
    known: { type: 'boolean', default: false },
    rank: { type: 'enum', values: ['unknown', 'friend', 'ally'], default: 'unknown' },
    tags: {
      type: 'array',
      items: { type: 'string', default: '' },
      default: [],
      maxItems: 12,
      maxDepth: 2,
      maxSize: 512,
    },
    summary: {
      type: 'object',
      fields: {
        visits: { type: 'number', default: 0, min: 0, max: 999 },
      },
      default: { visits: 0 },
      maxProperties: 8,
      maxDepth: 2,
      maxSize: 512,
    },
  },
  logic: {
    onGameStart: [],
    onTurnEnd: [
      {
        id: 'turn-reputation',
        when: { type: 'compare', source: 'state', path: 'score', operator: 'gte', value: 0 },
        actions: [
          { type: 'add', path: 'score', value: 1 },
          { type: 'log', message: '声望回合结算完成' },
        ],
      },
    ],
    onTick: [],
    onChoice: [],
    onButton: [],
  },
  view: {
    slot: 'right-panel',
    title: '声望',
    components: [
      { type: 'section', title: '当前状态', children: [{ type: 'text', text: '社区声望' }] },
      { type: 'number', label: '分数', path: 'score' },
      { type: 'progress', label: '进度', path: 'score', min: -100, max: 100 },
      { type: 'badge', label: '称号', path: 'rank' },
      { type: 'list', label: '标签', path: 'tags' },
      { type: 'table', label: '摘要', path: 'summary', columns: [{ key: 'visits', label: '拜访次数' }] },
      { type: 'divider' },
      {
        type: 'conditional',
        when: { type: 'compare', path: 'known', operator: 'eq', value: true },
        children: [{ type: 'text', text: '已建立联系' }],
      },
      { type: 'button', label: '查看记录', event: 'open-history' },
      {
        type: 'card',
        title: '行动卡',
        body: '选择一个行动。',
        children: [{ type: 'text', text: '可执行' }],
        actions: [{ type: 'button', label: '确认', event: 'confirm-action' }],
      },
    ],
  },
  permissions: { read: [], write: 'own-state-only' },
};

describe('custom gameplay module schema', () => {
  test('accepts a V2 module with declared safe inputs, references, and onButton', () => {
    const v2 = {
      ...validModule,
      schemaVersion: 2,
      capabilities: undefined, items: undefined,
      inputs: { health: 'player.stats.attrA', primaryCurrency: 'player.currency.primary' },
      logic: {
        onGameStart: [], onTurnEnd: [], onTick: [],
        onChoice: [{
          when: { type: 'compare', source: 'input', path: 'health', operator: 'lt', value: 10 },
          actions: [{ type: 'set', path: 'score', value: { source: 'input', path: 'primaryCurrency' } }],
        }],
        onButton: [{
          when: { type: 'compare', source: 'event', path: 'button.event', operator: 'eq', value: 'refresh' },
          actions: [{ type: 'add', path: 'score', value: { source: 'input', path: 'health' } }],
        }],
      },
    };
    const { capabilities, items, ...legacy } = v2;
    expect(normalizeCustomGameplayModule(legacy).ok).toBe(true);
  });

  test('accepts the canonical V3 world-scoped contract and all supported field/component kinds', () => {
    const result = customGameplayModuleSchema.safeParse(validModule);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.kind).toBe('custom-gameplay-module');
      expect(result.data.schemaVersion).toBe(3);
      expect(result.data.scope).toBe('world');
    }
  });

  test('defaults every lifecycle array when logic is omitted', () => {
    const result = customGameplayModuleSchema.safeParse({
      ...validModule,
      logic: undefined,
      view: undefined,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.logic).toEqual({
        onGameStart: [],
        onTurnEnd: [],
        onTick: [],
        onChoice: [],
        onButton: [],
      });
    }
  });

  test('rejects unknown fields at the module and nested DSL levels', () => {
    const moduleWithUnknownField = { ...validModule, unexpected: true };
    const moduleWithUnknownActionField = {
      ...validModule,
      logic: {
        ...validModule.logic,
        onTick: [{ actions: [{ type: 'log', message: 'x', unexpected: true }] }],
      },
    };

    expect(customGameplayModuleSchema.safeParse(moduleWithUnknownField).success).toBe(false);
    expect(customGameplayModuleSchema.safeParse(moduleWithUnknownActionField).success).toBe(false);
  });

  test('rejects executable or dynamic extension fields anywhere in the module', () => {
    for (const key of ['code', 'script', 'eval', 'component', 'import']) {
      const candidate = { ...validModule, [key]: 'blocked' };
      expect(customGameplayModuleSchema.safeParse(candidate).success).toBe(false);
    }

    const nestedCandidate = {
      ...validModule,
      view: {
        ...validModule.view,
        components: [{ type: 'text', text: 'x', code: 'alert(1)' }],
      },
    };
    expect(customGameplayModuleSchema.safeParse(nestedCandidate).success).toBe(false);
  });

  test('requires a lowercase, bounded module id and the fixed protocol literals', () => {
    expect(customGameplayModuleSchema.safeParse({ ...validModule, id: 'Bad ID' }).success).toBe(false);
    expect(customGameplayModuleSchema.safeParse({ ...validModule, kind: 'event-pack' }).success).toBe(false);
    expect(customGameplayModuleSchema.safeParse({ ...validModule, schemaVersion: 2 }).success).toBe(false);
    expect(customGameplayModuleSchema.safeParse({ ...validModule, scope: 'player' }).success).toBe(false);
  });

  test.each(['constructor', 'prototype'])('rejects reserved module and dependency IDs: %s', id => {
    expect(customGameplayModuleSchema.safeParse({ ...validModule, id }).success).toBe(false);
    expect(customGameplayModuleSchema.safeParse({ ...validModule, dependencies: [{ id }] }).success).toBe(false);
    const { capabilities, items, ...v2 } = validModule;
    const legacy = { ...v2, id, schemaVersion: 2, logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [] } };
    expect(normalizeCustomGameplayModule(legacy).ok).toBe(false);
    const { inputs, ...v1 } = legacy;
    expect(normalizeCustomGameplayModule({ ...v1, schemaVersion: 1, logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [] } }).ok).toBe(false);
  });

  test('parseCustomGameplayModule returns structured issues without throwing', () => {
    const result = parseCustomGameplayModule({ ...validModule, id: 'not valid' });

    expect(result.ok).toBe(false);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.data).toBeUndefined();
  });
});
