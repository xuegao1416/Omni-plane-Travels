import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { DirectorRuntime } from './engine';
import { SIM_STORAGE_KEY } from './storage';
import type { SimEvent } from './types';
import { createDefaultGameState } from '../schema/variables';
import { deleteSave, loadGame, saveGameIncremental, SAVE_SCHEMA_VERSION } from '../storage/db';

test('a detached opening snapshot cannot replace the active director cache', () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map([[SIM_STORAGE_KEY, 'old director cache']]);
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  try {
    const staging = new DirectorRuntime();
    staging.createSnapshot(0, '开局', true, '开局', [], { persist: false });
    expect(staging.state.snapshots).toHaveLength(1);
    expect(values.get(SIM_STORAGE_KEY)).toBe('old director cache');
  } finally {
    if (before) Object.defineProperty(globalThis, 'localStorage', before);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});

test('thirty retained director turns share immutable history while the bounded cache and full save reload preserve rollback ownership', async () => {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  } });
  const saveId = `save_${Date.now()}_simulationhistory`;
  try {
    const engine = new DirectorRuntime();
    const event = (id: string): SimEvent => ({
      id, title: id, description: '稳定的世界事件'.repeat(20), level: 'civilian', region: 'town', severity: 1,
      status: 'active', factStatus: 'confirmed', childEventIds: [], affectedNpcIds: [], affectedFactions: [],
      playerHooks: [{ title: '入口', description: '场景描述', level: 'civilian', keyEntities: ['npc'], suggestedActions: ['观察'], urgency: 'ongoing' }],
      createdAtTime: 'day1', createdAtTick: 1, batchId: 'initial', lastUpdatedTick: 1,
    });
    engine.state.events = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`stable${index}`, event(`stable${index}`)]));
    engine.state.events.changed = event('changed');
    engine.state.storylines.npc = { npcId: 'npc', beats: [{ id: 'beat', time: 'day1', title: '暗线', narrative: '此前的暗线事实', merged: false, tick: 1, relatedEventIds: [] }], lastSimulatedTick: 1 };
    const ids: string[] = [];
    let firstCacheSize = 0;
    let published = engine.state;
    engine.onStateChange = state => { published = state; };
    for (let round = 1; round <= 30; round++) {
      engine.state.tickCount = round;
      engine.state.mechanics = { lastTurnId: `r${round}`, lastRound: round, tickCount: round, lastTime: `day${round}` };
      engine.state.events.changed.description = `第${round}轮世界动态`;
      ids.push(engine.createSnapshot(round, `day${round}`, false, undefined, ids).id);
      if (round === 1) firstCacheSize = values.get(SIM_STORAGE_KEY)!.length;
    }
    expect(engine.state.snapshots).toHaveLength(30);
    expect(published).toBe(engine.state);
    expect(published.snapshots).toHaveLength(30);
    const first = engine.state.snapshots[0]!.snapshot;
    const last = engine.state.snapshots[29]!.snapshot;
    expect(last.config).toBe(first.config);
    expect(last.events.stable0).toBe(first.events.stable0);
    expect(last.storylines.npc).toBe(first.storylines.npc);
    expect(last.events.stable0).not.toBe(engine.state.events.stable0);
    expect(last.events.changed.description).toBe('第30轮世界动态');
    expect(first.events.changed.description).toBe('第1轮世界动态');
    const cache = values.get(SIM_STORAGE_KEY)!;
    expect(cache.length).toBeLessThan(firstCacheSize + 500);
    expect(JSON.parse(cache).snapshots).toEqual([]);
    expect(DirectorRuntime.loadState().mechanics?.lastRound).toBe(30);
    engine.state.events.stable0.description = '快照之后修改当前事件';
    expect(first.events.stable0.description).toBe('稳定的世界事件'.repeat(20));

    await saveGameIncremental(saveId, {
      id: saveId, name: saveId, timestamp: 1, worldId: 'default', schemaVersion: SAVE_SCHEMA_VERSION,
      round: 30, gameState: createDefaultGameState(), simulationState: engine.state,
    }, ids.map((simulationSnapshotId, seq) => ({ id: `${saveId}:${seq}`, role: 'assistant' as const, rawText: `正文${seq + 1}`, seq, round: seq + 1, timestamp: seq + 1, simulationSnapshotId })));
    const saved = await loadGame(saveId);
    expect(saved?.messages.map(message => message.simulationSnapshotId)).toEqual(ids);
    expect(saved?.simulationState?.snapshots).toHaveLength(30);
    const reloaded = new DirectorRuntime(saved!.simulationState!);
    expect(reloaded.state.snapshots[29]!.snapshot.events.stable0).toBe(reloaded.state.snapshots[0]!.snapshot.events.stable0);
    expect(reloaded.restoreSnapshot(ids[6]!)).toBe(true);
    expect(reloaded.state.mechanics?.lastRound).toBe(7);
    expect(reloaded.state.events.changed.description).toBe('第7轮世界动态');
    expect(reloaded.state.events.stable0.description).toBe('稳定的世界事件'.repeat(20));
    reloaded.state.events.stable0.description = '回滚后修改当前事件';
    expect(reloaded.state.snapshots[6]!.snapshot.events.stable0.description).toBe('稳定的世界事件'.repeat(20));

    const fallback = new DirectorRuntime(DirectorRuntime.loadState());
    expect(fallback.state.mechanics?.lastRound).toBe(7);
    expect(fallback.state.snapshots).toEqual([]);
    fallback.replaceState(structuredClone(saved!.simulationState!));
    expect(fallback.state.snapshots[29]!.snapshot.events.stable0).toBe(fallback.state.snapshots[0]!.snapshot.events.stable0);
    expect(fallback.restoreSnapshot(ids[0]!)).toBe(true);
    expect(fallback.state.mechanics?.lastRound).toBe(1);
    expect(fallback.state.events.changed.description).toBe('第1轮世界动态');
    expect(fallback.state.snapshots).toHaveLength(30);
  } finally {
    try { await deleteSave(saveId); }
    finally {
      if (before) Object.defineProperty(globalThis, 'localStorage', before);
      else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  }
});
