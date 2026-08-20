import { beforeEach, describe, expect, test } from 'bun:test';
import { useMemoryStore } from './memoryStore';

beforeEach(() => {
  useMemoryStore.getState().resetMemoryRuntime();
  useMemoryStore.getState().initMemoryRuntime('checkpoint-test');
});

describe('memory checkpoint vector snapshot', () => {
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
