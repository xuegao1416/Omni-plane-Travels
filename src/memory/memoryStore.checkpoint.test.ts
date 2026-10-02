import { beforeEach, describe, expect, test } from 'bun:test';
import { useMemoryStore } from './memoryStore';

beforeEach(() => {
  useMemoryStore.getState().resetMemoryRuntime();
  useMemoryStore.getState().initMemoryRuntime('checkpoint-test');
});

describe('memory checkpoint vector snapshot', () => {
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
