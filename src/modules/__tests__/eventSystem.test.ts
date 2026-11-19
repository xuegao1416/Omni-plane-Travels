import { describe, it, expect, afterAll } from 'bun:test';
import { mock } from 'bun:test';

// ── 模拟 Tauri invoke / event（在导入 eventApi 前注册） ──
const calls: Array<[string, unknown]> = [];
const invokeImpl = async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  calls.push([cmd, args]);
  switch (cmd) {
    case 'list_events':
      return [
        {
          meta: {
            id: 'demo-rule',
            name: '演示规则包',
            version: '1.0.0',
            author: '赖工',
            type: 'rule',
            coverColor: '#3b82f6',
            icon: 'swords',
            schemaVersion: 1,
            minAppVersion: '2.8.1',
            loadOrder: 100,
            enabledByDefault: false,
          },
          enabled: true,
          status: 'enabled',
          registeredAt: '2026-07-13T00:00:00.000Z',
          lastEnabledAt: null,
        },
      ];
    case 'enable_event':
    case 'disable_event':
    case 'uninstall_event':
    case 'export_event':
      return null;
    case 'get_event_detail':
      return {
        meta: {
          meta: { id: 'demo-rule' },
          enabled: true,
          status: 'enabled',
          registeredAt: '',
          lastEnabledAt: null,
        },
        manifest: { id: 'demo-rule', type: 'rule', permissions: ['add_card', 'modify_world_state'] },
        rulesSummary: [],
        cardsSummary: [],
        dependencyStatus: [],
        conflictStatus: [],
      };
    case 'get_event_runtime':
      return {
        id: 'demo-rule',
        manifest: { id: 'demo-rule', type: 'rule', permissions: ['add_card', 'modify_world_state'] },
        files: {
          'schema/rules.json': JSON.stringify({ version: 1, rules: [] }),
        },
      };
    default:
      return null;
  }
};

mock.module('@tauri-apps/api/core', () => ({ invoke: invokeImpl }));
mock.module('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}));
// nativeFetch 的 isTauri() 带有模块级缓存；其它测试可能先走过 Web 分支。
// 在本测试边界固定 Tauri 结果，避免依赖测试文件加载顺序。
mock.module('../../utils/nativeFetch', () => ({
  isTauri: () => true,
}));

// eventApi 现以 window.__TAURI_INTERNALS__ 判定是否在 Tauri 运行时（@tauri-apps/api/core 内部亦依赖之）。
// 测试环境已用 mock.module 替换 invoke，这里补上运行时标记，让 isTauri() 返回 true 以走 mock。
const g = globalThis as unknown as { window?: Record<string, unknown> };
const hadWindow = g.window !== undefined;
g.window = g.window ?? {};
const previousTauriMarker = g.window.__TAURI_INTERNALS__;
g.window.__TAURI_INTERNALS__ = {};
// 测试结束后撤掉 Tauri 运行时标记，避免后续测试文件误走原生 HTTP 通道。
afterAll(() => {
  if (!g.window) return;
  if (previousTauriMarker === undefined) delete g.window.__TAURI_INTERNALS__;
  else g.window.__TAURI_INTERNALS__ = previousTauriMarker;
  if (!hadWindow && Object.keys(g.window).length === 0) delete g.window;
});

import { parseManifest } from '../manifestSchema';
import type { EventRule } from '../schema';
import { clearEventCatalog, compileEventCatalog, setEventCatalog } from '../../events/catalog';
import { readDirector } from '../../events/state';
import type { GameState } from '../../schema/variables';
import {
  canonicalCardFiles, cardWorkflow, eventTestState, eventTestWorld, flagsOf, hostFor, playTurn, readPackCards, runtimePack,
} from '../../__tests__/helpers/eventFixtures';

// 规则不再由独立的规则引擎解释，而是编译进事件导演（events 模块）后按回合结算。
// 以下沿用旧 ruleEngine 测试的场景：确定性、条件触发、权限白名单、安全上限、一次性规则。
function rulePack(rules: EventRule[], permissions: string[]) {
  const world = eventTestWorld('rule_engine_world');
  const pack = runtimePack('test:rules', permissions, {
    'schema/rules.json': JSON.stringify({ version: 1, rules }),
    ...canonicalCardFiles('奇遇', [cardWorkflow('adventure', '奇遇', [{ label: '前往' }])]),
  });
  const compiled = compileEventCatalog(world, [pack], readPackCards);
  setEventCatalog({ worldId: world.id, definitions: compiled.definitions, warnings: compiled.warnings, summary: '' });
  return { world, warnings: compiled.warnings, definitions: compiled.definitions };
}

function runTurn(rules: EventRule[], permissions: string[], mutate?: (state: GameState) => void) {
  const { world, warnings, definitions } = rulePack(rules, permissions);
  const { host, state } = hostFor(world, eventTestState(mutate));
  const turn = playTurn(host, state, 1);
  return { host, input: state, ...turn, warnings: [...warnings, ...turn.ended.warnings], definitions };
}

const diceRule: EventRule = {
  id: 'adventure-rule',
  when: { state: { path: 'dice.lastRoll.total', op: '>', value: 4 } },
  then: [{ addEvent: { eventId: 'adventure' } }, { set: { path: 'flags.quest', value: 'active' } }],
};
const withRoll = (total: number) => (state: GameState) => {
  (state as unknown as { dice: unknown }).dice = { lastRoll: { total } };
  // 同样的输入包括同样的随机种子。
  state.gameplay = { ...(state.gameplay ?? {}), rng: { seed: 'rule-determinism', counter: 0 } } as never;
};

describe('事件规则 — 确定性', () => {
  it('相同输入产生相同输出', () => {
    const a = runTurn([diceRule], ['add_card', 'modify_world_state'], withRoll(5));
    const b = runTurn([diceRule], ['add_card', 'modify_world_state'], withRoll(5));
    expect(JSON.stringify(a.state)).toEqual(JSON.stringify(b.state));
    expect(JSON.stringify(a.ended.changes)).toEqual(JSON.stringify(b.ended.changes));
    clearEventCatalog();
  });

  it('不污染入参状态', () => {
    const result = runTurn([{ id: 'r', when: { all: [] }, then: [{ set: { path: 'flags.hp', value: 99 } }] }], ['modify_world_state']);
    expect(flagsOf(result.input).hp).toBeUndefined();
    expect(flagsOf(result.state).hp).toBe(99);
    clearEventCatalog();
  });
});

describe('事件规则 — AC-E1 骰子>4 触发奇遇卡片', () => {
  it('骰子得 5 时触发 addEvent 并改写世界状态', () => {
    const result = runTurn([diceRule], ['add_card', 'modify_world_state'], withRoll(5));
    expect(readDirector(result.state).queue.map(item => item.eventId)).toEqual(['adventure']);
    expect(flagsOf(result.state).quest).toBe('active');
    clearEventCatalog();
  });

  it('骰子得 3 时不触发', () => {
    const result = runTurn([diceRule], ['add_card', 'modify_world_state'], withRoll(3));
    expect(readDirector(result.state).queue).toEqual([]);
    expect(flagsOf(result.state).quest).toBeUndefined();
    clearEventCatalog();
  });
});

describe('事件规则 — 权限 / 白名单', () => {
  it('缺少权限的动作被跳过并告警', () => {
    const result = runTurn([{ id: 'r', when: { all: [] }, then: [{ addEvent: { eventId: 'adventure' } }] }], ['modify_world_state']);
    expect(readDirector(result.state).queue).toEqual([]);
    expect(result.warnings.some(warning => warning.includes('缺少权限'))).toBe(true);
    clearEventCatalog();
  });

  it('未知动作被白名单拒绝，其余动作照常执行', () => {
    const result = runTurn([
      { id: 'r', when: { all: [] }, then: [{ set: { path: 'flags.a', value: 1 } }, { foo: { x: 1 } } as never] },
    ], ['modify_world_state']);
    expect(flagsOf(result.state).a).toBe(1);
    expect(result.warnings.some(warning => warning.includes('无法识别'))).toBe(true);
    clearEventCatalog();
  });
});

describe('事件规则 — 硬性上限', () => {
  it('单规则动作数超过 16 被截断', () => {
    const then = Array.from({ length: 20 }, (_, index) => ({ set: { path: `flags.v${index}`, value: index } }));
    const result = runTurn([{ id: 'r', when: { all: [] }, then }], ['modify_world_state']);
    const flags = flagsOf(result.state);
    expect(Object.keys(flags).filter(key => key.startsWith('v'))).toHaveLength(16);
    expect(flags.v16).toBeUndefined();
    expect(result.warnings.some(warning => warning.includes('动作数'))).toBe(true);
    clearEventCatalog();
  });

  it('每个事件包规则数超过 128 被截断', () => {
    const rules: EventRule[] = Array.from({ length: 200 }, (_, index) => ({
      id: `r${index}`, when: { all: [] }, then: [{ set: { path: `flags.v${index}`, value: index } }],
    }));
    const result = runTurn(rules, ['modify_world_state']);
    expect(result.definitions.filter(def => def.kind === 'rule')).toHaveLength(128);
    expect(Object.keys(flagsOf(result.state))).toHaveLength(128);
    clearEventCatalog();
  });

  it('条件树深超过 6 的规则不加载（AC-E2 防死循环）', () => {
    let condition: EventRule['when'] = { all: [] };
    for (let index = 0; index < 8; index++) condition = { all: [condition] };
    const result = runTurn([{ id: 'r', when: condition, then: [{ set: { path: 'flags.x', value: 1 } }] }], ['modify_world_state']);
    expect(flagsOf(result.state).x).toBeUndefined();
    expect(result.warnings.some(warning => warning.includes('条件树深'))).toBe(true);
    clearEventCatalog();
  });

  it('once 规则仅触发一次', () => {
    const result = runTurn([{ id: 'r', once: true, when: { all: [] }, then: [{ set: { path: 'flags.x', value: 1 } }] }], ['modify_world_state']);
    expect(flagsOf(result.state).x).toBe(1);
    const reset = structuredClone(result.state);
    (reset.flags as Record<string, unknown>).x = 0;
    const second = playTurn(result.host, reset, 2);
    expect(flagsOf(second.state).x).toBe(0);
    expect(readDirector(second.state).fired['test:rules/r']?.count).toBe(1);
    clearEventCatalog();
  });
});

describe('manifestSchema — 安全红线', () => {
  it('合法 manifest 通过', () => {
    const m = {
      id: 'my-mod',
      name: '我的事件',
      version: '1.0.0',
      author: '赖工',
      engine: 'opt-event',
      schemaVersion: 1,
      minAppVersion: '2.8.1',
      type: 'rule',
      coverColor: '#3b82f6',
      icon: 'swords',
    };
    const r = parseManifest(m);
    expect(r.ok).toBe(true);
  });

  it('拒绝未知字段（含 code/script）', () => {
    const m = {
      id: 'my-mod',
      name: '我的事件',
      version: '1.0.0',
      author: '赖工',
      engine: 'opt-event',
      schemaVersion: 1,
      minAppVersion: '2.8.1',
      type: 'rule',
      coverColor: '#3b82f6',
      icon: 'swords',
      code: 'console.log("x")',
    };
    const r = parseManifest(m);
    expect(r.ok).toBe(false);
  });

  it('拒绝非法 coverColor 渐变', () => {
    const m = {
      id: 'my-mod',
      name: '我的事件',
      version: '1.0.0',
      author: '赖工',
      engine: 'opt-event',
      schemaVersion: 1,
      minAppVersion: '2.8.1',
      type: 'rule',
      coverColor: 'linear-gradient(#7C3AED,#A855F7)',
      icon: 'swords',
    };
    const r = parseManifest(m);
    expect(r.ok).toBe(false);
  });
});

describe('eventApi — 缓存与错误解析', () => {
  it('listPacks 走缓存，写命令失效缓存', async () => {
    const eventApi = await import('../eventApi');
    await eventApi.ensureCacheListener();
    const list = await eventApi.listPacks();
    expect(list.length).toBe(1);
    await eventApi.listPacks(); // 应命中缓存
    await eventApi.enablePack('demo-rule'); // 写命令失效
    await eventApi.listPacks();
    expect(calls.some(([c]) => c === 'enable_event')).toBe(true);
    expect(calls.filter(([c]) => c === 'list_events').length).toBeGreaterThanOrEqual(2);
  });

  it('unwrapEventError 解析 JSON 错误信封', async () => {
    const eventApi = await import('../eventApi');
    const err = eventApi.unwrapEventError(new Error(JSON.stringify({ code: 'MOD_NOT_FOUND', message: '未找到事件' })));
    expect(err.code).toBe('MOD_NOT_FOUND');
    expect(err.message).toBe('未找到事件');
  });
});
