import { expect, test } from 'bun:test';
import { TurnOperations, guardTurnMemory, detachTurnMemoryValue } from './turnSafety';
import { useMemoryStore } from '../memory/memoryStore';
import { createDefaultMemorySystemConfig } from '../memory/memoryConfig';
import { executeMemorySummary } from '../memory/memoryPipeline';

test('an expired turn cannot finish or accept work for its replacement', () => {
  const operations = new TurnOperations();
  const old = operations.begin();
  operations.invalidate();
  const current = operations.begin();
  expect(operations.accept(old)).toBe(false);
  expect(operations.owns(old)).toBe(false);
  expect(operations.accept(current)).toBe(true);
  current.abort();
  expect(operations.accept(current)).toBe(false);
  expect(operations.owns(current)).toBe(true);
});

test('memory values stay cloneable and retained snapshots cannot mutate the owner after cancellation', () => {
  let current = true;
  const runtime = { events: [{ text: 'existing' }] };
  let writes = 0;
  const guarded = guardTurnMemory({ getMemoryRuntime: () => runtime, write: () => { writes++; } }, () => current);
  const retained = guarded.getMemoryRuntime();
  expect(structuredClone(retained)).toEqual(runtime);
  expect(structuredClone(guarded.getMemoryRuntime().events)).toEqual(runtime.events);
  const write = guarded.write;
  current = false;
  retained.events.push({ text: 'late' });
  retained.events[0].text = 'late';
  expect(() => write()).toThrow();
  expect(runtime.events).toEqual([{ text: 'existing' }]);
  expect(writes).toBe(0);
});

test('accepted memory records stored by a writer do not retain an expired proxy', () => {
  let current = true;
  const runtime = { events: [{ text: 'existing' }] };
  let stored: { event: { text: string } } | undefined;
  const guarded = guardTurnMemory({ getMemoryRuntime: () => runtime, store: (value: NonNullable<typeof stored>) => { stored = value; } }, () => current);
  guarded.store({ event: guarded.getMemoryRuntime().events[0] });
  current = false;
  expect(stored?.event.text).toBe('existing');
});

test('recovery caches retain usable derived data after their original turn expires', () => {
  let current = true;
  const guarded = guardTurnMemory({ getRecords: () => [{ keywords: ['key'] }] }, () => current);
  const cache = { selected: guarded.getRecords().map(record => ({ keywords: record.keywords })) };
  current = false;
  expect(detachTurnMemoryValue(cache)).toEqual({ selected: [{ keywords: ['key'] }] });
});

test('an in-flight summary cannot write into a replacement memory runtime or clear its busy state', async () => {
  const originalFetch = globalThis.fetch;
  const originalStore = useMemoryStore.getState();
  const config = createDefaultMemorySystemConfig();
  config.writePipeline.retryCount = 0;
  config.writePipeline.saveSummaryAfterIngest = true;
  useMemoryStore.setState({ config });
  useMemoryStore.getState().initMemoryRuntime('old-save');
  let current = true;
  let release!: () => void, requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  const response = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async () => {
    requested(); await response;
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ otherCharacterMemories: [], playerMemories: [{ title: '旧摘要', summary: '旧旅程', keywords: ['旧'] }], itemMemories: [] }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  try {
    const task = executeMemorySummary(guardTurnMemory(useMemoryStore.getState(), () => current), { floor: 1, batchText: '【玩家输入】等待\n【AI正文】等待十分钟。', inputText: '等待', recentContext: '', playerName: '旅者', apiConfig: { baseUrl: 'https://example.test', apiKey: 'test', model: 'test' } });
    await started;
    current = false;
    useMemoryStore.getState().initMemoryRuntime('new-save');
    useMemoryStore.getState().setLoading(true, '新回合');
    release();
    await expect(task).rejects.toThrow();
    expect(useMemoryStore.getState().memoryRuntime?.summarySaveHistory).toEqual([]);
    expect(useMemoryStore.getState().memoryRuntime?.sourceEvents).toEqual([]);
    expect(useMemoryStore.getState().loadingStage).toBe('新回合');
    expect(useMemoryStore.getState().isLoading).toBe(true);
  } finally { release?.(); globalThis.fetch = originalFetch; useMemoryStore.setState(originalStore); }
});
