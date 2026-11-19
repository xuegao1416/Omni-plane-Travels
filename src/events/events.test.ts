import { afterEach, describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { BUILTIN_GAMEPLAY_MODULES, createGameplayHost } from '../core/registry';
import type { GameplayHost } from '../core/host';
import { clearEventCatalog, compileEventDefinitions, getEventCatalog, setEventCatalog, type RuntimePackLike } from './catalog';
import { eventsModule } from './module';
import { sanitizeDynamicOptions } from './resolve';
import { checkChance, checkModifier } from './cards';
import { readDirector } from './state';

const MODULES = [...BUILTIN_GAMEPLAY_MODULES.filter(module => module.id !== 'events'), eventsModule];

function card(id: string, name: string, options: unknown[], shared: Array<Record<string, unknown>> = []) {
  return {
    id,
    name,
    workflow: {
      version: 1,
      id: `wf-${id}`,
      name,
      nodes: [
        { id: 't', typeId: 'narrative.title', position: { x: 0, y: 0 }, widgetValues: { title: name } },
        { id: 'x', typeId: 'narrative.text', position: { x: 0, y: 0 }, widgetValues: { text: `${name}的正文` } },
        { id: 'c', typeId: 'choice.static', position: { x: 0, y: 0 }, widgetValues: { options: JSON.stringify(options) } },
        ...shared.map((values, index) => ({ id: `e${index}`, typeId: 'effect.stat', position: { x: 0, y: 0 }, widgetValues: values })),
      ],
      connections: [
        { id: 'c1', sourceNodeId: 't', sourceSocketKey: 'flow_out', targetNodeId: 'x', targetSocketKey: 'flow_in' },
        { id: 'c2', sourceNodeId: 'x', sourceSocketKey: 'flow_out', targetNodeId: 'c', targetSocketKey: 'flow_in' },
        ...shared.map((_, index) => ({ id: `s${index}`, sourceNodeId: 'c', sourceSocketKey: 'flow_out', targetNodeId: `e${index}`, targetSocketKey: 'flow_in' })),
      ],
    },
  };
}

function makeWorld(overrides: Partial<{ rules: unknown[]; periodic: unknown[]; cards: unknown[] }> = {}): WorldDef {
  return {
    id: 'evt_world',
    name: '事件测试',
    description: '',
    modules: [{
      moduleId: 'stat', enabled: true,
      moduleConfig: {
        attrA: { name: '生命', current: 100, max: 100 },
        attrB: { name: '体力', current: 100, max: 100 },
        dim1: { name: '力量', value: 10, range: [0, 20] },
        special: [],
      },
    }],
    eventPacks: [
      {
        id: 'world:evt:rules', type: 'rule',
        rules: overrides.rules ?? [
          { id: 'tired', once: true, when: { state: { path: '玩家.生存状态.体力值', op: '<', value: 20 } }, then: [{ addEvent: { eventId: 'faint' } }] },
          { id: 'on_sale', when: { event: { type: 'test.sold' } }, then: [{ set: { path: 'flags.sold', value: true } }] },
        ],
        periodicRules: overrides.periodic ?? [
          { id: 'tax', intervalTicks: 3, actions: [{ modifyResource: { key: '货币资源.主货币', delta: -5 } }] },
        ],
      },
      {
        id: 'world:evt:events', type: 'card',
        events: overrides.cards ?? [
          card('faint', '晕倒', [{ label: '休息', effects: [{ stat: '体力', delta: 30 }] }]),
          card('merchant', '行商', [
            { label: '买药', effects: [{ currency: -10 }, { item: '药草', delta: 1 }] },
            {
              label: '比试力气', check: { stat: '力量', dc: 12 },
              success: { effects: [{ currency: 20 }], note: '你赢下了赌注' },
              failure: { effects: [{ stat: 'attrA', delta: -5 }] },
              next: 'aftermath',
            },
            { label: '离开' },
          ], [{ statKey: 'attrB', delta: -2 }]),
          card('aftermath', '余波', [{ label: '收拾心情' }]),
        ],
      },
    ],
  } as unknown as WorldDef;
}

function setup(world: WorldDef = makeWorld(), mutate?: (state: GameState) => void) {
  const state = createDefaultGameState();
  state.世界.时间系统.时钟 = { schemaVersion: 2, elapsedMinutes: 8 * 60 };
  state.玩家.货币资源.主货币 = { 名称: '铜钱', 数量: 100 };
  state.玩家.生存状态 = { 血量: 100, 体力值: 100, dim1: 10 } as GameState['玩家']['生存状态'];
  mutate?.(state);
  const host = createGameplayHost(world, state, MODULES);
  return { world, host, state: host.prepare(state) };
}

function playTurn(host: GameplayHost, state: GameState, turn: number) {
  const started = host.startTurn(state, { turnId: `t${turn}`, round: turn });
  const ended = host.endTurn(started.state, { turnId: `t${turn}`, round: turn, previousClock: structuredClone(started.state.世界.时间系统.时钟) });
  return { started, ended, state: ended.state };
}

afterEach(() => clearEventCatalog());

describe('事件目录', () => {
  test('被规则点名或作为后续的卡不进牌堆，其余卡进牌堆；规则的事件条件成为触发器', () => {
    const catalog = getEventCatalog(makeWorld());
    const byKey = new Map(catalog.definitions.map(def => [def.key, def]));
    expect(byKey.get('world:evt:events/faint')?.trigger.on).toEqual([]);
    expect(byKey.get('world:evt:events/aftermath')?.trigger.on).toEqual([]);
    expect(byKey.get('world:evt:events/merchant')?.trigger.on).toEqual(['deck']);
    expect(byKey.get('world:evt:events/merchant')?.cooldownTurns).toBe(6);
    expect(byKey.get('world:evt:rules/on_sale')?.trigger.on).toEqual(['test.sold']);
    expect(byKey.get('world:evt:rules/tired')?.trigger.on).toEqual(['turn.ended']);
    expect(byKey.get('world:evt:rules/tax')?.trigger.everyTurns).toBe(3);
  });

  test('世界定义里的 trigger 字段覆盖默认（不进牌堆、改为监听领域事件）', () => {
    const world = makeWorld({ cards: [{ ...card('storm', '暴风雨', [{ label: '躲雨' }]), trigger: { on: ['time.day'], once: true, chance: 0.5 } }] });
    const def = getEventCatalog(world).definitions.find(item => item.key === 'world:evt:events/storm');
    expect(def?.trigger).toMatchObject({ on: ['time.day'], chance: 0.5 });
    expect(def?.once).toBe(true);
  });
});

describe('触发', () => {
  test('领域事件触发规则：效果在同一次操作内生效', () => {
    const { host, state } = setup();
    const outcome = host.apply(state, [{ op: 'emit', event: 'test.sold' }], { source: 'system', label: '测试' });
    expect((outcome.state.flags as Record<string, unknown> | undefined)?.sold).toBe(true);
    expect(readDirector(outcome.state).fired['world:evt:rules/on_sale']?.count).toBe(1);
  });

  test('状态条件规则在回合结束时检查；addEvent 跨包找到卡片放进待处理队列；once 只触发一次', () => {
    const { host, state } = setup(undefined, draft => { draft.玩家.生存状态.体力值 = 10; });
    const first = playTurn(host, state, 1);
    expect(readDirector(first.state).queue.map(item => item.key)).toEqual(['world:evt:events/faint']);
    expect(first.ended.cards.map(item => item.eventId)).toEqual(['faint']);
    const dismissed = host.dispatch(first.state, 'events.dismiss', { key: 'world:evt:events/faint' });
    expect(dismissed.status).toBe('applied');
    const second = playTurn(host, dismissed.state, 2);
    expect(readDirector(second.state).queue.some(item => item.eventId === 'faint')).toBe(false);
    expect(readDirector(second.state).history.at(-1)).toMatchObject({ key: 'world:evt:events/faint', dismissed: true });
  });

  test('周期规则每 3 回合执行一次', () => {
    const { host, state } = setup(undefined, draft => { draft.eventDirector = { ...readDirector(draft), pacing: { level: 'off', lastCardTurn: 0, quietTurns: 0 } }; });
    let current = state;
    const money: number[] = [];
    for (let turn = 1; turn <= 6; turn++) {
      current = playTurn(host, current, turn).state;
      money.push(current.玩家.货币资源.主货币.数量);
    }
    expect(money).toEqual([100, 100, 95, 95, 95, 90]);
  });

  test('节奏牌堆：回合结束时按概率抽卡；有待处理卡时不再抽；关闭后不抽', () => {
    const { host, state } = setup(undefined, draft => {
      draft.eventDirector = { ...readDirector(draft), pacing: { level: 'high', lastCardTurn: 0, quietTurns: 0 } };
    });
    let current = state;
    let drawnAt = -1;
    for (let turn = 1; turn <= 12 && drawnAt < 0; turn++) {
      current = playTurn(host, current, turn).state;
      if (readDirector(current).queue.length) drawnAt = turn;
    }
    expect(drawnAt).toBeGreaterThan(0);
    expect(readDirector(current).queue.map(item => item.key)).toEqual(['world:evt:events/merchant']);
    const held = playTurn(host, current, drawnAt + 1).state;
    expect(readDirector(held).queue).toHaveLength(1);

    const off = host.dispatch(state, 'events.setPacing', { level: 'off' });
    let quiet = off.state;
    for (let turn = 1; turn <= 10; turn++) quiet = playTurn(host, quiet, turn).state;
    expect(readDirector(quiet).queue).toHaveLength(0);
  });
});

describe('节奏设定', () => {
  test('新开局默认「偶尔」，世界可以改默认值', () => {
    expect(readDirector(setup().state).pacing.level).toBe('low');
    const fast = { ...makeWorld(), eventPacing: 'high' } as WorldDef;
    expect(readDirector(setup(fast).state).pacing.level).toBe('high');
    const broken = { ...makeWorld(), eventPacing: 'sometimes' } as unknown as WorldDef;
    expect(readDirector(setup(broken).state).pacing.level).toBe('low');
  });

  test('读档保留存档里的节奏（含玩家改过的），不被世界默认值覆盖', () => {
    const fast = { ...makeWorld(), eventPacing: 'high' } as WorldDef;
    const saved = setup(fast, draft => { draft.eventDirector = { ...readDirector(draft), pacing: { level: 'off', lastCardTurn: 0, quietTurns: 0 } }; });
    expect(readDirector(saved.state).pacing.level).toBe('off');
    expect(readDirector(saved.host.prepare(saved.state)).pacing.level).toBe('off');
  });

  test('战斗进行中或等待开战时不从牌堆抽卡', () => {
    const fast = { ...makeWorld(), eventPacing: 'high' } as WorldDef;
    const fighting = setup(fast, draft => {
      draft.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: 'normal' }, combatSession: { lifecycle: 'active' } } as never;
    });
    let current = fighting.state;
    for (let turn = 1; turn <= 12; turn++) current = playTurn(fighting.host, current, turn).state;
    expect(readDirector(current).queue).toHaveLength(0);
    // 战斗结束后恢复抽卡。
    current = { ...current, v3: { ...current.v3!, combatSession: { lifecycle: 'terminal' } } } as never;
    for (let turn = 13; turn <= 30 && readDirector(current).queue.length === 0; turn++) current = playTurn(fighting.host, current, turn).state;
    expect(readDirector(current).queue.length).toBeGreaterThan(0);
  });
});

describe('卡片结算', () => {
  function withMerchant(seed: string) {
    const ready = setup(undefined, draft => {
      draft.gameplay = { ...(draft.gameplay ?? {}), rng: { seed, counter: 0 } } as never;
    });
    const queued = ready.host.dispatch(ready.state, 'events.trigger', { key: 'world:evt:events/merchant' });
    expect(queued.status).toBe('applied');
    return { ...ready, state: queued.state };
  }

  test('选项效果 + 卡片共享效果一起结算，并写入叙事决策记录', () => {
    const { host, state } = withMerchant('a');
    const outcome = host.dispatch(state, 'events.resolveChoice', { key: 'world:evt:events/merchant', option: 0, saveId: 's1' });
    expect(outcome.status).toBe('applied');
    expect(outcome.state.玩家.货币资源.主货币.数量).toBe(90);
    expect(outcome.state.玩家.物品栏.药草?.数量).toBe(1);
    expect(outcome.state.玩家.生存状态.体力值).toBe(98);
    const director = readDirector(outcome.state);
    expect(director.queue).toHaveLength(0);
    expect(director.history.at(-1)).toMatchObject({ key: 'world:evt:events/merchant', choice: '买药' });
    const decision = outcome.state.narrativeDecisions?.at(-1);
    expect(decision).toMatchObject({ saveId: 's1', cardId: 'merchant', status: 'pending', action: { type: 'narrative' } });
    expect(decision?.aiNote).toContain('买药');
    expect(decision?.aiNote).toContain('铜钱 -10');
    expect(outcome.events.some(event => event.type === 'events.resolved')).toBe(true);
    expect(host.dispatch(outcome.state, 'events.resolveChoice', { key: 'world:evt:events/merchant', option: 0 }).status).toBe('failed');
  });

  test('检定：成功与失败走不同分支，后续卡接在队首', () => {
    const seen = new Set<boolean>();
    for (let index = 0; index < 40 && seen.size < 2; index++) {
      const { host, state } = withMerchant(`seed-${index}`);
      const outcome = host.dispatch(state, 'events.resolveChoice', { key: 'world:evt:events/merchant', option: 1 });
      expect(outcome.status).toBe('applied');
      const roll = outcome.events.find(event => event.type === 'check.rolled')?.payload as { success: boolean; roll: number; modifier: number } | undefined;
      expect(roll).toBeDefined();
      expect(roll!.modifier).toBe(checkModifier(10, [0, 20]));
      seen.add(roll!.success);
      if (roll!.success) {
        expect(outcome.state.玩家.货币资源.主货币.数量).toBe(120);
        expect(outcome.state.玩家.生存状态.血量).toBe(100);
        expect(outcome.state.narrativeDecisions?.at(-1)?.aiNote).toContain('你赢下了赌注');
      } else {
        expect(outcome.state.玩家.货币资源.主货币.数量).toBe(100);
        expect(outcome.state.玩家.生存状态.血量).toBe(95);
      }
      expect(readDirector(outcome.state).queue[0]?.key).toBe('world:evt:events/aftermath');
    }
    expect([...seen].sort()).toEqual([false, true]);
  });

  test('检定成功率：属性越高越容易，钳制在 5%~95%', () => {
    expect(checkModifier(20, [0, 20])).toBe(5);
    expect(checkModifier(0, [0, 20])).toBe(-5);
    expect(checkModifier(50)).toBe(0);
    expect(checkChance(12, 0)).toBeCloseTo(0.45);
    expect(checkChance(30, 0)).toBe(0.05);
    expect(checkChance(2, 10)).toBe(0.95);
  });

  test('动态选项只接受文字与单个属性/资源增减', () => {
    const options = sanitizeDynamicOptions([
      { label: '  冲上去 ', aiNote: '莽', effect: { statId: '生命', delta: -500 } },
      { label: '', effect: { statId: '生命', delta: 1 } },
      { label: '求援', effects: [{ command: 'economy.sell' }] },
    ]);
    expect(options).toEqual([
      { label: '冲上去', aiNote: '莽', effect: { statId: '生命', delta: -100 } },
      { label: '求援' },
    ]);
  });
});

describe('旧存档迁移', () => {
  test('旧规则运行态、待弹卡片与延迟事件搬进导演状态，旧字段清除', () => {
    const { state } = setup(undefined, draft => {
      draft.simulationRuntime = {
        tick: 5, periodicCounters: {}, effectLog: [], triggeredPeriodicEvents: [],
        eventRuntimes: { 'world:evt:rules': { onceFired: { tired: true }, cooldownRemaining: { on_sale: 2 } } },
        pendingAddEvents: [{ eventId: 'merchant', eventPackId: 'tax' }],
        scheduledTicks: [{ scheduledAt: 7, ruleId: 'r', payload: { type: 'test.sold' } }],
      };
    });
    const director = readDirector(state);
    expect(director.fired['world:evt:rules/tired']).toEqual({ count: 1, lastTurn: 5 });
    expect(director.cooldowns['world:evt:rules/on_sale']).toBe(7);
    expect(director.queue.map(item => item.key)).toEqual(['world:evt:events/merchant']);
    expect(state.gameplay?.scheduledEvents.map(item => [item.dueTick, item.event.type])).toEqual([[7, 'test.sold']]);
    expect(state.simulationRuntime?.eventRuntimes).toBeUndefined();
    expect(state.simulationRuntime?.pendingAddEvents).toBeUndefined();
    expect(state.simulationRuntime?.scheduledTicks).toBeUndefined();
  });
});

describe('用户事件包', () => {
  const world = makeWorld();
  const pack: RuntimePackLike = {
    id: 'user:pack',
    manifest: { name: '外来包', permissions: ['add_card'] },
    files: {
      'schema/rules.json': JSON.stringify({ version: 1, rules: [
        { id: 'ping', when: { event: { type: 'test.ping' } }, then: [{ set: { path: 'flags.hacked', value: true } }, { addEvent: { eventId: 'faint' } }] },
      ] }),
    },
  };

  test('权限不足的动作被跳过，其余动作照常执行', () => {
    setEventCatalog({ worldId: world.id, definitions: compileEventDefinitions(world, [pack]), summary: '' });
    const { host, state } = setup(world);
    const outcome = host.apply(state, [{ op: 'emit', event: 'test.ping' }], { source: 'system', label: '测试' });
    expect((outcome.state.flags as Record<string, unknown> | undefined)?.hacked).toBeUndefined();
    expect(readDirector(outcome.state).queue.map(item => item.key)).toEqual(['world:evt:events/faint']);
    expect(outcome.warnings.some(warning => warning.includes('modify_world_state'))).toBe(true);
  });

  test('节点工作流在回合结束时读取本回合的事件', () => {
    const workflowPack: RuntimePackLike = {
      id: 'user:flow',
      manifest: { name: '工作流包', permissions: ['modify_world_state'] },
      files: {
        'schema/workflow.json': JSON.stringify({
          version: 1, id: 'flow', name: '工作流',
          nodes: [
            { id: 'trig', typeId: 'triggers.world_event', position: { x: 0, y: 0 }, widgetValues: { match_type: 'test.ping' } },
            { id: 'set', typeId: 'actions.set_value', position: { x: 0, y: 0 }, widgetValues: { path: 'flags.flow', value: 'ok' } },
          ],
          connections: [{ id: 'c', sourceNodeId: 'trig', sourceSocketKey: 'flow_out', targetNodeId: 'set', targetSocketKey: 'flow_in' }],
        }),
      },
    };
    setEventCatalog({ worldId: world.id, definitions: compileEventDefinitions(world, [workflowPack]), summary: '' });
    const { host, state } = setup(world);
    const pinged = host.apply(state, [{ op: 'emit', event: 'test.ping' }], { source: 'system', label: '测试' });
    expect((pinged.state.flags as Record<string, unknown> | undefined)?.flow).toBeUndefined();
    const ended = playTurn(host, pinged.state, 1).state;
    expect((ended.flags as Record<string, unknown> | undefined)?.flow).toBe('ok');
    const quiet = playTurn(host, ended, 2).state;
    expect(readDirector(quiet).fired['user:flow/workflow']?.count).toBe(1);
  });
});
