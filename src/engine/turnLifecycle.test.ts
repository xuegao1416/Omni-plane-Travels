import { expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { useGameEngine } from './useGameEngine';
import type { GameEngine } from './types';
import { useMemoryStore } from '../memory/memoryStore';
import { eventBus, EVENTS } from './eventBus';
import { STORAGE_KEYS } from '../config/storageKeys';
import { useSaveStore } from '../stores/saveStore';
import { loadGame, deleteSave } from '../storage/db';
import { recoveryVersion } from './turnRecovery';

function mountEngine(): GameEngine {
  let engine!: GameEngine;
  renderToString(createElement(() => {
    engine = useGameEngine({ apiKey: 'test', baseUrl: 'https://example.test', model: 'test', provider: 'custom', stream: false });
    return null;
  }));
  return engine;
}

function setup() {
  const oldStorage = globalThis.localStorage;
  const values = new Map<string, string>([[STORAGE_KEYS.PIPELINE_VARIABLE_ENABLED, 'false']]);
  globalThis.localStorage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value); }, removeItem: key => { values.delete(key); }, clear: () => values.clear(), key: index => [...values.keys()][index] ?? null, get length() { return values.size; } };
  const enabled = useMemoryStore.getState().config.enabled;
  useMemoryStore.getState().setConfig({ enabled: false });
  return () => { globalThis.localStorage = oldStorage; useMemoryStore.getState().setConfig({ enabled }); };
}

function response(text: string) {
  return new Response(JSON.stringify({ choices: [{ message: { content: `<contenttext>${text}</contenttext><TimeAdvance>{"minutes":10,"reason":"等待十分钟","evidence":"十分钟"}</TimeAdvance>` } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
}

test('reset discards late results and old finalizers cannot release the next turn', async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  const releases: Array<() => void> = [];
  const requests: Array<Promise<void>> = [];
  const starts: Array<() => void> = [];
  for (let index = 0; index < 2; index++) requests.push(new Promise(resolve => { starts.push(resolve); }));
  let calls = 0;
  globalThis.fetch = (async () => {
    const index = calls++;
    if (index >= 2) return response('等待十分钟。');
    const wait = new Promise<void>(resolve => { releases[index] = resolve; });
    starts[index](); await wait; return response(index === 0 ? '旧旅程等待十分钟。' : '新旅程等待十分钟。');
  }) as unknown as typeof fetch;
  try {
    const engine = mountEngine();
    const old = engine.sendMessage('等待十分钟'); await requests[0];
    engine.reset();
    const next = engine.sendMessage('继续等待十分钟'); await requests[1];
    releases[0](); await old;
    expect(engine.isGenerating).toBe(true);
    expect(engine.messages).toHaveLength(2);
    expect(engine.messages.some(message => message.rawText.includes('旧旅程'))).toBe(false);
    releases[1](); await next;
    expect(engine.isGenerating).toBe(false);
    expect(engine.messages.at(-1)?.rawText).toContain('新旅程');
  } finally { releases.forEach(release => release()); globalThis.fetch = oldFetch; restore(); }
});

test('cancel after accepted narrative resumes clock settlement once without requesting narrative again', async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return response('你等待十分钟。'); }) as unknown as typeof fetch;
  const engine = mountEngine();
  engine.reset();
  const unsubscribe = eventBus.on(EVENTS.MESSAGE_RECEIVED, () => engine.cancel());
  try {
    const before = engine.variableManager.getState().世界.时间系统.时钟!.elapsedMinutes;
    await engine.sendMessage('等待十分钟'); unsubscribe();
    const generatedCalls = calls;
    expect(engine.variableManager.getState().世界.时间系统.时钟!.elapsedMinutes).toBe(before);
    await engine.retryPipeline();
    const settled = engine.variableManager.getState().世界.时间系统.时钟!.elapsedMinutes;
    expect(settled).toBe(before + 10);
    await engine.retryPipeline();
    expect(engine.variableManager.getState().世界.时间系统.时钟!.elapsedMinutes).toBe(settled);
    expect(calls).toBe(generatedCalls);
  } finally { unsubscribe(); globalThis.fetch = oldFetch; restore(); }
});

test('loading another save clears the previous turn recovery context', async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return response('旧旅程等待十分钟。'); }) as unknown as typeof fetch;
  try {
    const engine = mountEngine(); engine.reset();
    await engine.sendMessage('等待十分钟');
    const generatedCalls = calls;
    const state = engine.variableManager.getState();
    engine.loadSave({ id: 'replacement-save', name: 'replacement', timestamp: 1, worldId: 'default', messages: [], gameState: state });
    await engine.retryPipeline(); await engine.retrySingleStage('variable');
    expect(calls).toBe(generatedCalls);
    expect(engine.messages).toEqual([]);
    expect(engine.variableManager.getState()).toEqual(state);
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test('capturing a completed turn does not rebuild recovery or rewrite chat messages', async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => response('你等待十分钟。')) as unknown as typeof fetch;
  try {
    const engine = mountEngine(); engine.reset();
    await engine.sendMessage('等待十分钟');
    const messages = engine.messages;
    expect(messages.at(-1)?.turnRecovery).toBeUndefined();
    let reads = 0;
    const toJSON = useMemoryStore.getState().toJSON;
    useMemoryStore.setState({ toJSON: () => { reads++; return toJSON(); } });
    try {
      engine.prepareSaveCapture(); engine.prepareSaveCapture();
      expect(reads).toBe(0);
      expect(engine.messages).toBe(messages);
    } finally { useMemoryStore.setState({ toJSON }); }
  } finally { globalThis.fetch = oldFetch; restore(); }
});

test('a successful narrative creates its rollback checkpoint only once', async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  globalThis.fetch = (async () => response('你等待十分钟。')) as unknown as typeof fetch;
  const createCheckpoint = useMemoryStore.getState().createCheckpoint;
  let checkpoints = 0;
  useMemoryStore.setState({ createCheckpoint: (...args) => { checkpoints++; return createCheckpoint(...args); } });
  try {
    const engine = mountEngine(); engine.reset();
    useMemoryStore.getState().initMemoryRuntime('single-checkpoint');
    await engine.sendMessage('等待十分钟');
    expect(checkpoints).toBe(1);
    expect(engine.messages.at(-1)?.snapshot).toBeDefined();
    expect(engine.messages.at(-1)?.memoryCheckpointId).toBeTruthy();
  } finally {
    useMemoryStore.setState({ createCheckpoint }); globalThis.fetch = oldFetch; restore();
  }
});

for (const legacy of [false, true]) test(`saved accepted narrative (${legacy ? 'previous JSON' : 'compact hash'} recovery) survives a new engine and settles time only once`, async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  const previousSave = useSaveStore.getState().currentSaveId;
  useSaveStore.setState({ currentSaveId: 'refresh-save' });
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return response('你等待十分钟。'); }) as unknown as typeof fetch;
  const first = mountEngine(); first.reset();
  const unsubscribe = eventBus.on(EVENTS.MESSAGE_RECEIVED, () => first.cancel());
  try {
    const before = first.variableManager.getState().世界.时间系统.时钟!.elapsedMinutes;
    await first.sendMessage('等待十分钟'); unsubscribe();
    const bundle = first.variableManager.createModulePersistenceBundle('refresh-save');
    const memory = useMemoryStore.getState().toJSON();
    const capture = structuredClone({ id: 'refresh-save', name: 'refresh', timestamp: 1, worldId: 'default',
      messages: first.messages, gameState: bundle.coreState, moduleStates: bundle.current, moduleCheckpoints: bundle.checkpoints,
      memoryRuntime: memory.memoryRuntime, memoryConfig: memory.config, vectorMemory: memory.vectorMemory });
    if (legacy) {
      const version = (value: unknown) => JSON.stringify(value, (key, item) => key === 'moduleRevisions' ? undefined
        : item && typeof item === 'object' && !Array.isArray(item)
          ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
      capture.messages.at(-1)!.turnRecovery!.stateVersion = version(first.variableManager.getState());
      capture.messages.at(-1)!.turnRecovery!.memoryVersion = version({ memoryRuntime: memory.memoryRuntime, vectorMemory: memory.vectorMemory });
    }
    await useSaveStore.getState().performSave(capture);
    const saved = (await loadGame('refresh-save'))!;
    expect(saved.messages.at(-1)?.turnRecovery?.settlement.narrativeDecisionRequest.saveId).toBe(saved.id);
    expect(JSON.stringify(saved.messages)).not.toContain('test');
    if (process.env.TURN_RECOVERY_FIXTURE) {
      await Bun.write(process.env.TURN_RECOVERY_FIXTURE, JSON.stringify({ type: 'omni-plane-travels-save', version: '2.0',
        save: { ...saved, name: '主流程恢复验收' } }));
    }
    const next = mountEngine(); next.loadSave(saved);
    if (!legacy) {
      expect(saved.messages.at(-1)!.turnRecovery!.stateVersion).toBe(recoveryVersion(next.variableManager.getState()));
      expect(saved.messages.at(-1)!.turnRecovery!.stateVersion.length).toBe(71);
    }
    await next.retryPipeline();
    expect(next.variableManager.getState().世界.时间系统.时钟!.elapsedMinutes).toBe(before + 10);
    const again = mountEngine(); again.loadSave({ ...saved, messages: structuredClone(next.messages), gameState: next.variableManager.getState(), ...useMemoryStore.getState().toJSON() });
    await again.retryPipeline();
    expect(again.variableManager.getState().世界.时间系统.时钟!.elapsedMinutes).toBe(before + 10);
    expect(calls).toBe(1);
  } finally { unsubscribe(); await deleteSave('refresh-save'); useSaveStore.setState({ currentSaveId: previousSave }); globalThis.fetch = oldFetch; restore(); }
});

test('successful engine turns own survival consumption without mounted page effects', async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  const engine = mountEngine(); engine.reset();
  const world = { id: 'survival-owner', name: '生存', modules: [{ moduleId: 'survival', enabled: true, name: '生存', moduleConfig: {
    description: '', resources: [{ id: 'water', name: '水', symbol: '💧', amount: 3, max: 10, scarce: true, description: '' }],
    rules: { cycleName: '回合', consumePerCycle: '', criticalThreshold: 1 }, consumption: { perCycle: { water: 1 } },
  } }] };
  const state = engine.variableManager.getState(); state.玩家.生存资源 = { water: { 数量: 3, 最大值: 10 } };
  engine.loadSave({ id: 'survival-save', name: '生存', timestamp: 1, worldId: world.id, customWorld: world, messages: [], gameState: state });
  globalThis.fetch = (async () => response('你等待十分钟。')) as unknown as typeof fetch;
  const unsubscribe = eventBus.on(EVENTS.MESSAGE_RECEIVED, () => engine.cancel());
  try {
    eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
    expect(engine.variableManager.getState().玩家.生存资源?.water.数量).toBe(3);
    await engine.sendMessage('等待十分钟'); unsubscribe();
    expect(engine.variableManager.getState().玩家.生存资源?.water.数量).toBe(3);
    await engine.retryPipeline();
    expect(engine.variableManager.getState().玩家.生存资源?.water.数量).toBe(2);
    await engine.retryPipeline();
    expect(engine.variableManager.getState().玩家.生存资源?.water.数量).toBe(2);
  } finally { unsubscribe(); globalThis.fetch = oldFetch; restore(); }
});

test('manual gameplay commits refresh the complete latest checkpoint and refuse active turns', async () => {
  const restore = setup(), oldFetch = globalThis.fetch;
  const engine = mountEngine(); engine.reset();
  globalThis.fetch = (async () => response('你等待十分钟。')) as unknown as typeof fetch;
  try {
    await engine.sendMessage('等待十分钟');
    const next = engine.variableManager.getState(); next.玩家.货币资源.主货币.数量 = 123;
    useMemoryStore.getState().getMemoryRuntime();
    expect(engine.commitPlayerState(next)).toBe(true);
    expect((engine.messages.at(-1)?.snapshot as typeof next).玩家.货币资源.主货币.数量).toBe(123);
    expect(engine.messages.at(-1)?.memoryCheckpointId).toBeTruthy();
    let release!: () => void;
    const started = new Promise<void>(resolve => { globalThis.fetch = (async () => { resolve(); await new Promise<void>(done => { release = done; }); return response('稍后。'); }) as unknown as typeof fetch; });
    const pending = engine.sendMessage('继续等待'); await started;
    const denied = engine.variableManager.getState(); denied.玩家.货币资源.主货币.数量 = 999;
    expect(engine.commitPlayerState(denied)).toBe(false);
    expect(engine.variableManager.getState().玩家.货币资源.主货币.数量).toBe(123);
    engine.cancel(); release(); await pending;
  } finally { globalThis.fetch = oldFetch; restore(); }
});
