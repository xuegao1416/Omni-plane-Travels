import { beforeEach, describe, expect, test } from 'bun:test';
import { useMemoryStore } from './memoryStore';

beforeEach(() => {
  useMemoryStore.getState().resetMemoryRuntime();
  useMemoryStore.getState().initMemoryRuntime('checkpoint-test');
});

describe('memory checkpoint vector snapshot', () => {
  test('long history shares unchanged facts and restores an isolated exact turn after reload', () => {
    const store = useMemoryStore.getState();
    const ids: string[] = [];
    for (let round = 0; round < 30; round++) {
      store.updateSceneAnchor({ locationLabel: `第${round}轮` });
      store.appendSourceEvent({ id: `source-${round}`, round, userText: '继续', assistantText: '正文'.repeat(500), createdAt: round });
      const checkpoint = store.createCheckpoint(ids)!;
      ids.push(checkpoint.id);
    }
    const history = store.getMemoryRuntime().checkpoints;
    expect(new Set(ids).size).toBe(30);
    expect(history).toHaveLength(30);
    expect(history[29]!.snapshot!.sourceEvents[0]).toBe(history[0]!.snapshot!.sourceEvents[0]);
    store.fromJSON(JSON.parse(JSON.stringify(store.toJSON())));
    const loaded = store.getMemoryRuntime().checkpoints;
    expect(loaded[29]!.snapshot!.sourceEvents[0]).toBe(loaded[0]!.snapshot!.sourceEvents[0]);
    expect(store.restoreCheckpoint(ids[7]!)).toBe(true);
    expect(store.getMemoryRuntime().sceneAnchor?.locationLabel).toBe('第7轮');
    expect(store.getMemoryRuntime().sourceEvents).toHaveLength(8);
    store.getMemoryRuntime().sourceEvents[0]!.assistantText = '恢复后的编辑';
    expect(loaded[0]!.snapshot!.sourceEvents[0]!.assistantText).toBe('正文'.repeat(500));
    expect(store.restoreCheckpoint(ids[29]!)).toBe(true);
    expect(store.getMemoryRuntime().sourceEvents).toHaveLength(30);
  });

  test('structured draft commits detach facts while preserving store-owned ledgers', () => {
    const store = useMemoryStore.getState();
    store.updateSceneAnchor({ locationLabel: '旅店' });
    const checkpoint = store.createCheckpoint()!;
    const current = store.getMemoryRuntime();
    const baseline = structuredClone({ ...current, checkpoints: [] });
    const draft = structuredClone(baseline);
    draft.sceneAnchor!.locationLabel = '城门';
    store.appendSourceEvent({ id: 'parallel-source', round: 1, userText: '前进', assistantText: '到达城门', createdAt: 1 });
    const ledgers = store.getMemoryRuntime();
    store.commitMemoryRuntime(draft, store.getRuntimeVersion(), baseline);
    const committed = store.getMemoryRuntime();
    expect(committed.checkpoints).toBe(ledgers.checkpoints);
    expect(committed.sourceEvents).toBe(ledgers.sourceEvents);
    expect(committed.sourceEvents[0]?.id).toBe('parallel-source');
    draft.sceneAnchor!.locationLabel = '过期修改';
    expect(committed.sceneAnchor?.locationLabel).toBe('城门');
    expect(store.restoreCheckpoint(checkpoint.id)).toBe(true);
    expect(store.getMemoryRuntime().sceneAnchor?.locationLabel).toBe('旅店');
  });

  test('loading keeps historical checkpoint bindings and new checkpoints retain those referenced by messages', () => {
    const snapshot = structuredClone(useMemoryStore.getState().getMemoryRuntime());
    const checkpoints = Array.from({ length: 20 }, (_, i) => ({
      id: `history-${i}`, createdAt: i, lastIngestCursor: i,
      activeThreadCount: 0, eventCount: 0, entityCount: 0, snapshot,
    }));
    useMemoryStore.getState().fromJSON({ memoryRuntime: { ...snapshot, checkpoints } });
    expect(useMemoryStore.getState().getMemoryRuntime().checkpoints).toHaveLength(20);
    useMemoryStore.getState().createCheckpoint(checkpoints.map(cp => cp.id));
    expect(useMemoryStore.getState().restoreCheckpoint('history-0')).toBe(true);
    expect(useMemoryStore.getState().getMemoryRuntime().lastIngestCursor).toBe(0);
  });
  test('restores vector memory saved with the checkpoint', () => {
    const vector = {
      id: 'vector-1',
      fact: '测试事实',
      keywords: [], entities: [], primaryType: 'event', secondaryTypes: [],
      characters: [], locations: [], factions: [], items: [], abilities: [], events: [], rules: [], timeMarkers: [],
      importance: 1, timeScope: 'long', state: 'active', embedding: [1, 0],
    } as any;
    useMemoryStore.getState().setVectorMemory([vector]);
    const checkpoint = useMemoryStore.getState().createCheckpoint();
    expect(checkpoint?.vectorMemory).toEqual([vector]);

    useMemoryStore.getState().setVectorMemory([]);
    expect(useMemoryStore.getState().restoreCheckpoint(checkpoint!.id)).toBe(true);
    expect(useMemoryStore.getState().vectorMemory[0]).toMatchObject(vector);
  });
});
