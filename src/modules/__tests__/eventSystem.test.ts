import { describe, it, expect } from 'bun:test';
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
            minAppVersion: '2.6.2',
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
    default:
      return null;
  }
};

mock.module('@tauri-apps/api/core', () => ({ invoke: invokeImpl }));
mock.module('@tauri-apps/api/event', () => ({
  listen: () => Promise.resolve(() => {}),
}));

// eventApi 现以 window.__TAURI_INTERNALS__ 判定是否在 Tauri 运行时（@tauri-apps/api/core 内部亦依赖之）。
// 测试环境已用 mock.module 替换 invoke，这里补上运行时标记，让 isTauri() 返回 true 以走 mock。
const g = globalThis as unknown as { window?: Record<string, unknown> };
g.window = g.window ?? {};
g.window.__TAURI_INTERNALS__ = {};

import { evaluate } from '../ruleEngine';
import { parseManifest } from '../manifestSchema';
import { validateRuleGraph } from '../validateEvent';
import type { EventRule, EventGraph } from '../schema';

describe('ruleEngine — 确定性', () => {
  it('相同输入产生相同输出', () => {
    const ctx = { dice: { lastRoll: { total: 5 } } };
    const rules: EventRule[] = [
      {
        id: 'r1',
        when: { state: { path: 'dice.lastRoll.total', op: '>', value: 4 } },
        then: [{ addEvent: { eventId: 'adventure' } }, { set: { path: 'world.quest', value: 'active' } }],
      },
    ];
    const opts = { permissions: ['add_card', 'modify_world_state'] as const, tick: 1 };
    const a = evaluate(ctx, rules, opts as any);
    const b = evaluate(ctx, rules, opts as any);
    expect(JSON.stringify(a.ctx)).toEqual(JSON.stringify(b.ctx));
    expect(JSON.stringify(a.applied)).toEqual(JSON.stringify(b.applied));
  });

  it('不污染入参上下文', () => {
    const ctx: Record<string, unknown> = { hp: 10 };
    const rules: EventRule[] = [{ id: 'r', when: { all: [] }, then: [{ set: { path: 'hp', value: 99 } }] }];
    evaluate(ctx, rules, { permissions: ['modify_world_state'], tick: 1 });
    expect(ctx.hp).toBe(10);
  });
});

describe('ruleEngine — AC-E1 骰子>4 触发奇遇卡片', () => {
  it('骰子得 5 时触发 addEvent 并改写世界状态', () => {
    const ctx = { dice: { lastRoll: { total: 5 } }, world: {} as Record<string, unknown> };
    const rules: EventRule[] = [
      {
        id: 'adventure-rule',
        when: { state: { path: 'dice.lastRoll.total', op: '>', value: 4 } },
        then: [
          { addEvent: { eventId: 'adventure' } },
          { set: { path: 'world.quest', value: 'active' } },
        ],
      },
    ];
    const res = evaluate(ctx, rules, { permissions: ['add_card', 'modify_world_state'], tick: 3 });
    expect(res.applied.some((a) => a.kind === 'addEvent' && (a.detail as any).eventId === 'adventure')).toBe(true);
    expect((res.ctx.world as Record<string, unknown>).quest).toBe('active');
  });

  it('骰子得 3 时不触发', () => {
    const ctx = { dice: { lastRoll: { total: 3 } }, world: {} as Record<string, unknown> };
    const rules: EventRule[] = [
      {
        id: 'adventure-rule',
        when: { state: { path: 'dice.lastRoll.total', op: '>', value: 4 } },
        then: [{ addEvent: { eventId: 'adventure' } }],
      },
    ];
    const res = evaluate(ctx, rules, { permissions: ['add_card'], tick: 1 });
    expect(res.applied.length).toBe(0);
  });
});

describe('ruleEngine — 权限 / 白名单', () => {
  it('缺少权限的动作被跳过并告警', () => {
    const ctx = {};
    const rules: EventRule[] = [{ id: 'r', when: { all: [] }, then: [{ addEvent: { eventId: 'x' } }] }];
    const res = evaluate(ctx, rules, { permissions: ['modify_world_state'], tick: 1 });
    expect(res.applied.length).toBe(0);
    expect(res.warnings.some((w) => w.includes('缺少权限'))).toBe(true);
  });

  it('未知动作被白名单拒绝', () => {
    const ctx = {};
    const rules: EventRule[] = [
      { id: 'r', when: { all: [] }, then: [{ set: { path: 'a', value: 1 } }, { foo: { x: 1 } } as any] },
    ];
    const res = evaluate(ctx, rules, { permissions: ['modify_world_state'], tick: 1 });
    expect(res.applied.length).toBe(1);
    expect(res.warnings.some((w) => w.includes('无法识别'))).toBe(true);
  });
});

describe('ruleEngine — 硬性上限', () => {
  it('单规则动作数超过 16 被截断', () => {
    const ctx = {};
    const then = Array.from({ length: 20 }, (_, i) => ({ set: { path: `v${i}`, value: i } })) as any;
    const rules: EventRule[] = [{ id: 'r', when: { all: [] }, then }];
    const res = evaluate(ctx, rules, { permissions: ['modify_world_state'], tick: 1 });
    expect(res.applied.length).toBe(16);
    expect(res.warnings.some((w) => w.includes('动作数'))).toBe(true);
  });

  it('每 mod 规则数超过 128 被截断', () => {
    const ctx = {};
    const rules: EventRule[] = Array.from({ length: 200 }, (_, i) => ({
      id: `r${i}`,
      when: { all: [] },
      then: [{ set: { path: `v${i}`, value: i } }],
    }));
    const res = evaluate(ctx, rules, { permissions: ['modify_world_state'], tick: 1 });
    expect(res.applied.length).toBe(128);
  });

  it('条件树深超过 6 中止求值（AC-E2 防死循环）', () => {
    let cond: any = { all: [] };
    for (let i = 0; i < 8; i++) cond = { all: [cond] };
    const rules: EventRule[] = [{ id: 'r', when: cond, then: [{ set: { path: 'x', value: 1 } }] }];
    const res = evaluate({}, rules, { permissions: ['modify_world_state'], tick: 1 });
    expect(res.aborted).toBe(true);
  });

  it('once 规则仅触发一次', () => {
    const ctx = {};
    const rules: EventRule[] = [
      { id: 'r', once: true, when: { all: [] }, then: [{ set: { path: 'x', value: 1 } }] },
    ];
    const runtime = { onceFired: {}, cooldownRemaining: {} };
    const r1 = evaluate(ctx, rules, { permissions: ['modify_world_state'], runtime, tick: 1 });
    expect(r1.applied.length).toBe(1);
    const r2 = evaluate(ctx, rules, { permissions: ['modify_world_state'], runtime, tick: 2 });
    expect(r2.applied.length).toBe(0);
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
      minAppVersion: '2.6.2',
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
      minAppVersion: '2.6.2',
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
      minAppVersion: '2.6.2',
      type: 'rule',
      coverColor: 'linear-gradient(#7C3AED,#A855F7)',
      icon: 'swords',
    };
    const r = parseManifest(m);
    expect(r.ok).toBe(false);
  });
});

describe('validateEvent — 图结构', () => {
  const baseGraph = (): EventGraph => ({ nodes: [], edges: [] });

  it('孤立效果节点被检出', () => {
    const g = baseGraph();
    g.nodes.push({ id: 'fx1', kind: 'effect', label: '效果' });
    const issues = validateRuleGraph(g);
    expect(issues.some((i) => i.code === 'ISOLATED_EFFECT' && i.nodeId === 'fx1')).toBe(true);
  });

  it('普通触发环被检出', () => {
    const g = baseGraph();
    g.nodes.push({ id: 't1', kind: 'trigger', label: '触发1' });
    g.nodes.push({ id: 't2', kind: 'trigger', label: '触发2' });
    g.nodes.push({ id: 'fx', kind: 'effect', label: '效果' });
    g.edges.push({ id: 'e1', source: 't1', target: 't2' });
    g.edges.push({ id: 'e2', source: 't2', target: 't1' });
    g.edges.push({ id: 'e3', source: 't1', target: 'fx' });
    const issues = validateRuleGraph(g);
    expect(issues.some((i) => i.code === 'CYCLE')).toBe(true);
  });

  it('普通节点自环被检出', () => {
    const g = baseGraph();
    g.nodes.push({ id: 'fx', kind: 'effect', label: '效果' });
    g.edges.push({ id: 'e', source: 'fx', target: 'fx' });
    const issues = validateRuleGraph(g);
    expect(issues.some((i) => i.code === 'SELF_LOOP' && i.nodeId === 'fx')).toBe(true);
  });
});


describe('eventApi — 缓存与错误解析', () => {
  it('listMods 走缓存，写命令失效缓存', async () => {
    const eventApi = await import('../eventApi');
    await eventApi.ensureModListener();
    const list = await eventApi.listMods();
    expect(list.length).toBe(1);
    await eventApi.listMods(); // 应命中缓存
    await eventApi.enableMod('demo-rule'); // 写命令失效
    await eventApi.listMods();
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
