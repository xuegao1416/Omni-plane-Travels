// 事件系统接入引擎后的行为：已安装事件包、IndexedDB 加载、回合结算回执、与后台导演请求的关系。
// 由旧的 worldMechanics / cardEvent / enabledEventPack / eventIntegration / eventPackConsumers /
// simulation engine 测试在新接口上移植（同一场景，不再依赖全局规则注册表）。
import 'fake-indexeddb/auto';
import { afterAll, afterEach, describe, expect, test } from 'bun:test';
import JSZip from 'jszip';
import type { ApiConfig } from '../api/types';
import type { EventRule, Manifest, RuleFile } from '../modules/schema';
import { allWebEvents, deleteWebEvent, putWebEvent } from '../modules/eventDb';
import { webGetEventDetail, webImportFromFile, webUninstallPack } from '../modules/webEventStore';
import { invalidateCache } from '../modules/eventApi';
import { receiptCounts, recordSettlementReceipt } from '../gameplay/mechanicalRuntime';
import { createEmptySimState } from '../simulation/types';
import { requestDirectorDecision } from '../director/client';
import { createEmptyDirectorState } from '../director/types';
import { clearEventCatalog, compileEventCatalog, compileEventDefinitions, loadEventCatalog, setEventCatalog } from './catalog';
import { readDirector } from './state';
import {
  canonicalCardFiles, cardWorkflow, eventTestState, eventTestWorld, flagsOf, hostFor, packManifest, playTurn, readPackCards, runtimePack,
} from '../__tests__/helpers/eventFixtures';

const TEST_PACK_PREFIXES = ['evt-engine-', 'rule-mod-a', 'enabled-rule-e2e'];

// 事件包列表缓存是模块级的；用完清掉，免得影响其他测试文件。
afterAll(() => invalidateCache());

afterEach(async () => {
  clearEventCatalog();
  for (const record of await allWebEvents()) {
    if (TEST_PACK_PREFIXES.some(prefix => record.id.startsWith(prefix))) await deleteWebEvent(record.id);
  }
});

function useCatalog(world: ReturnType<typeof eventTestWorld>, packs: ReturnType<typeof runtimePack>[]) {
  const compiled = compileEventCatalog(world, packs, readPackCards);
  setEventCatalog({ worldId: world.id, definitions: compiled.definitions, warnings: compiled.warnings, summary: '' });
  return compiled;
}

describe('回合结算回执', () => {
  test('回执只在结算提交后记录；同一回合重试被宿主拒绝，开始与结束合并成一张回执', () => {
    const engine = { state: createEmptySimState() };
    const { host, state } = hostFor(eventTestWorld(), eventTestState());
    const started = host.startTurn(state, { turnId: 'turn-1', round: 1 });
    expect(started.status).toBe('applied');
    expect(engine.state.mechanics).toBeUndefined();

    recordSettlementReceipt(engine.state, { round: 1, turnId: 'turn-1', time: '', tick: 1, ...receiptCounts(started) });
    expect(engine.state.mechanics?.lastSettlement).toMatchObject({ round: 1, turnId: 'turn-1', origin: 'live' });

    const retry = host.startTurn(started.state, { turnId: 'turn-1', round: 1 });
    expect(retry.status).toBe('blocked');
    expect(retry.state.simulationRuntime?.tick).toBe(1);

    const ended = host.endTurn(started.state, { turnId: 'turn-1', round: 1, previousClock: structuredClone(started.state.世界.时间系统.时钟) });
    recordSettlementReceipt(engine.state, { round: 1, turnId: 'turn-1', time: '', tick: 1, ...receiptCounts(ended) });
    expect(engine.state.mechanics?.tickCount).toBe(1);
    expect(engine.state.mechanics?.lastSettlement?.effectCount).toBe(started.changes.length + ended.changes.length);
    expect(host.endTurn(ended.state, { turnId: 'turn-1', round: 1 }).status).toBe('blocked');
  });

  test('回合数每回合只推进一次，不需要模型接口；新回合继续推进', () => {
    const { host, state } = hostFor(eventTestWorld(), eventTestState());
    const first = host.startTurn(state, { turnId: 'turn1', round: 1 });
    expect(first.state.simulationRuntime?.tick).toBe(1);
    expect(state.simulationRuntime?.tick ?? 0).toBe(0);
    expect(host.startTurn(first.state, { turnId: 'turn1', round: 1 }).status).toBe('blocked');
    const second = host.startTurn(first.state, { turnId: 'turn2', round: 2 });
    expect(second.state.simulationRuntime?.tick).toBe(2);
  });

  test('结算在副本上进行：输入状态不变；一次性规则的记录只在结果里；周期效果进变更记录；下回合不重复出卡', () => {
    const world = eventTestWorld();
    const pack = runtimePack('evt-engine-isolated', ['add_card', 'modify_world_state'], {
      'schema/rules.json': JSON.stringify({
        version: 1,
        rules: [{ id: 'once', once: true, when: { all: [] }, then: [{ addEvent: { eventId: 'card' } }] }],
        periodicRules: [{ id: 'periodic', intervalTicks: 1, actions: [{ set: { path: '玩家.生存状态.血量', value: 90 } }] }],
      } satisfies RuleFile),
      ...canonicalCardFiles('隔离包', [cardWorkflow('card', '一次性卡片', [{ label: '好' }])]),
    });
    useCatalog(world, [pack]);
    const { host, state } = hostFor(world, eventTestState());
    const before = structuredClone(state);
    const turn = playTurn(host, state, 1);
    expect(state).toEqual(before);
    expect(readDirector(turn.state).fired['evt-engine-isolated/once']?.count).toBe(1);
    expect(readDirector(turn.state).queue.map(item => item.key)).toEqual(['evt-engine-isolated/card']);
    expect(turn.ended.changes).toContainEqual({ path: '玩家.生存状态.血量', before: 100, after: 90 });

    const dismissed = host.dispatch(turn.state, 'events.dismiss', { key: 'evt-engine-isolated/card' });
    const next = playTurn(host, dismissed.state, 2);
    expect(next.ended.cards).toEqual([]);
    expect(readDirector(next.state).queue).toEqual([]);
  });
});

describe('事件包规则', () => {
  test('含 addEvent 的规则：卡片带着事件包 ID 进入待处理队列；没有事件包时什么都不发生', () => {
    const world = eventTestWorld();
    useCatalog(world, [runtimePack('evt-engine-card-mod', ['add_card'], {
      'schema/rules.json': JSON.stringify({ version: 1, rules: [{ id: 'r1', when: { all: [] }, then: [{ addEvent: { eventId: 'card-ccc' } }] }] }),
      ...canonicalCardFiles('卡片包', [cardWorkflow('card-ccc', '卡片 C')]),
    })]);
    const { host, state } = hostFor(world, eventTestState());
    const turn = playTurn(host, state, 1);
    expect(readDirector(turn.state).queue).toEqual([
      expect.objectContaining({ key: 'evt-engine-card-mod/card-ccc', packId: 'evt-engine-card-mod', eventId: 'card-ccc' }),
    ]);
    expect(turn.ended.cards).toEqual([{ eventId: 'card-ccc', packId: 'evt-engine-card-mod' }]);

    clearEventCatalog();
    const empty = hostFor(world, eventTestState());
    const quiet = playTurn(empty.host, empty.state, 1);
    expect(readDirector(quiet.state).queue).toEqual([]);
    expect(quiet.ended.cards).toEqual([]);
  });

  test('规则以类型化动作发出战斗遭遇请求，由调用方在提交后转交战斗界面', () => {
    const request = {
      schemaVersion: 2 as const,
      source: 'event-workflow' as const,
      proposal: {
        schemaVersion: 2 as const,
        id: 'rule-combat', context: '敌对行动已经发生', threatBand: 'matched' as const,
        allies: [], enemies: [{ id: 'enemy', identity: '敌人', temporary: true }], neutrals: [],
      },
    };
    const world = eventTestWorld();
    useCatalog(world, [runtimePack('evt-engine-combat', ['emit_world_event'], {
      'schema/rules.json': JSON.stringify({ version: 1, rules: [{ id: 'combat-rule', when: { all: [] }, then: [{ requestCombat: request }] }] }),
    })]);
    const { host, state } = hostFor(world, eventTestState());
    expect(playTurn(host, state, 1).ended.combats).toEqual([request]);
  });

  test('事件包规则在回合结束时改变状态；没有事件包时状态不变', () => {
    const world = eventTestWorld();
    useCatalog(world, [runtimePack('evt-engine-fake', ['modify_world_state'], {
      'schema/rules.json': JSON.stringify({ version: 1, rules: [{ id: 'r1', when: { all: [] }, then: [{ set: { path: 'flags.mod_flag', value: 42 } }] }] }),
    })]);
    const { host, state } = hostFor(world, eventTestState());
    expect(flagsOf(playTurn(host, state, 1).state).mod_flag).toBe(42);

    clearEventCatalog();
    const empty = hostFor(world, eventTestState(draft => { draft.玩家.生存状态.血量 = 10; }));
    const quiet = playTurn(empty.host, empty.state, 1).state;
    expect(quiet.玩家.生存状态.血量).toBe(10);
    expect(flagsOf(quiet).mod_flag).toBeUndefined();
  });

  test('目录只采用已索引的规范卡片工作流，残留文件不会出卡', () => {
    const files = canonicalCardFiles('测试包', [cardWorkflow('event-one', '事件一'), cardWorkflow('event-two', '事件二')]);
    files['schema/event-stale.json'] = JSON.stringify(cardWorkflow('stale', '残留'));
    const keys = compileEventDefinitions(undefined, [runtimePack('evt-engine-consumer', ['add_card'], files)], readPackCards)
      .filter(def => def.kind === 'card').map(def => def.key);
    expect(keys).toEqual(['evt-engine-consumer/event-one', 'evt-engine-consumer/event-two']);
  });

  test('旧版内嵌卡片格式的事件包不会出卡，也不影响同时加载的其他包', () => {
    const legacy = runtimePack('evt-engine-legacy', ['add_card'], {
      'schema/events.json': JSON.stringify({ version: 1, events: [{ id: 'legacy-event', name: '旧事件', cards: [{ id: 'legacy-card' }] }] }),
    });
    const valid = runtimePack('evt-engine-valid', ['add_card'], canonicalCardFiles('有效包', [cardWorkflow('fine', '正常卡')]));
    const compiled = compileEventCatalog(undefined, [legacy, valid], readPackCards);
    expect(compiled.definitions.filter(def => def.packId === 'evt-engine-legacy')).toEqual([]);
    expect(compiled.definitions.map(def => def.key)).toEqual(['evt-engine-valid/fine']);
    expect(compiled.warnings.some(warning => warning.includes('evt-engine-legacy'))).toBe(true);
  });
});

describe('从 IndexedDB 加载事件目录', () => {
  const ruleManifest: Manifest = { ...packManifest('rule-mod-a', 'rule', ['modify_world_state']), rules: ['schema/rules.json'] };

  test('已启用并保存的规则包会在下一回合生效', async () => {
    const packId = 'enabled-rule-e2e';
    const rules: EventRule[] = [{ id: 'enabled-rule', when: { all: [] }, then: [{ set: { path: 'flags.enabled_tick', value: true } }] }];
    await putWebEvent({
      id: packId, manifest: packManifest(packId, 'rule', ['modify_world_state']), enabled: true, status: 'enabled',
      installedAt: new Date().toISOString(), files: { 'schema/rules.json': JSON.stringify({ version: 1, rules } satisfies RuleFile) },
    });
    const world = eventTestWorld('evt_engine_enabled');
    const catalog = await loadEventCatalog(world);
    expect(catalog.definitions.some(def => def.key === `${packId}/enabled-rule`)).toBe(true);
    const { host, state } = hostFor(world, eventTestState());
    expect(flagsOf(playTurn(host, state, 1).state).enabled_tick).toBe(true);
  });

  test('导入 .opt-event 规则包 → 加载目录 → 每回合生效', async () => {
    const zip = new JSZip();
    zip.file('manifest.json', JSON.stringify(ruleManifest));
    zip.file('schema/rules.json', JSON.stringify({ version: 1, rules: [{ id: 'r2', when: { all: [] }, then: [{ set: { path: 'flags.web_mod_flag', value: 'on' } }] }] } satisfies RuleFile));
    const buffer = await (await zip.generateAsync({ type: 'blob' })).arrayBuffer();
    try {
      const meta = await webImportFromFile(buffer);
      expect(meta.id).toBe('rule-mod-a');
      expect((await webGetEventDetail('rule-mod-a')).manifest.permissions).toContain('modify_world_state');
      const world = eventTestWorld('evt_engine_import');
      await loadEventCatalog(world, { activePackIds: ['rule-mod-a'] });
      const { host, state } = hostFor(world, eventTestState());
      const first = playTurn(host, state, 1).state;
      expect(flagsOf(first).web_mod_flag).toBe('on');
      expect(readDirector(playTurn(host, first, 2).state).fired['rule-mod-a/r2']?.count).toBe(2);
    } finally {
      await webUninstallPack('rule-mod-a').catch(() => {});
    }
  });

  const apiConfig: ApiConfig = { apiKey: 'test-key', baseUrl: 'https://example.test', model: 'test-model', provider: 'custom', stream: false };

  async function installCardRulePacks(rule: EventRule) {
    await putWebEvent({
      id: 'evt-engine-cards', manifest: packManifest('evt-engine-cards', 'card', ['add_card']), enabled: true, status: 'enabled',
      installedAt: new Date().toISOString(), files: canonicalCardFiles('E2E card pack', [cardWorkflow('e2e-card-event', 'E2E card')]),
    });
    await putWebEvent({
      id: 'evt-engine-rules', manifest: packManifest('evt-engine-rules', 'rule', ['add_card']), enabled: true, status: 'enabled',
      installedAt: new Date().toISOString(), files: { 'schema/rules.json': JSON.stringify({ version: 1, rules: [rule] } satisfies RuleFile) },
    });
    const world = eventTestWorld('evt_engine_e2e');
    await loadEventCatalog(world, { activePackIds: ['evt-engine-cards', 'evt-engine-rules'] });
    return world;
  }

  test('确定性规则出卡不发起任何模型请求', async () => {
    const originalFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => { calls += 1; throw new Error('不应请求网络'); }) as unknown as typeof fetch;
    try {
      const world = await installCardRulePacks({
        id: 'e2e-every-tick', when: { all: [] }, then: [{ addEvent: { eventId: 'e2e-card-event', eventPackId: 'evt-engine-cards' } }],
      });
      const { host, state } = hostFor(world, eventTestState());
      const turn = playTurn(host, state, 1);
      expect(readDirector(turn.state).queue.map(item => item.key)).toEqual(['evt-engine-cards/e2e-card-event']);
      expect(calls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test('后台导演请求未完成时，确定性规则照常出卡，重试同一回合不会重复', async () => {
    const originalFetch = globalThis.fetch;
    let markStarted!: () => void;
    let release: (() => void) | undefined;
    const started = new Promise<void>(resolve => { markStarted = resolve; });
    globalThis.fetch = (async () => {
      markStarted();
      return new Promise<Response>(resolve => {
        release = () => resolve(new Response(JSON.stringify({
          choices: [{ message: { content: '{"conditions":[],"plans":[],"offscreen":[]}' } }],
        }), { status: 200, headers: { 'content-type': 'application/json' } }));
      });
    }) as unknown as typeof fetch;
    let pending: Promise<unknown> | undefined;
    try {
      const world = await installCardRulePacks({
        id: 'e2e-pending-current-state', once: true,
        when: { state: { path: '世界.时间系统.当前时间', op: '==', value: '' } },
        then: [{ addEvent: { eventId: 'e2e-card-event', eventPackId: 'evt-engine-cards' } }],
      });
      const { host, state } = hostFor(world, eventTestState());
      pending = requestDirectorDecision(createEmptyDirectorState(), {
        saveId: 'save', worldId: world.id, completedTurnId: 'turn1', stateVersion: '1', variableProjection: state, memories: [],
      }, 'E2E world', apiConfig);
      await started;
      const turn = playTurn(host, state, 1, 'turn1');
      expect(readDirector(turn.state).queue).toHaveLength(1);
      const retry = host.endTurn(turn.state, { turnId: 'turn1', round: 1 });
      expect(retry.status).toBe('blocked');
      release?.();
      await pending;
      expect(readDirector(playTurn(host, turn.state, 2).state).queue).toHaveLength(1);
    } finally {
      release?.();
      await pending?.catch(() => undefined);
      globalThis.fetch = originalFetch;
    }
  });
});
