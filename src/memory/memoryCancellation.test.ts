import { afterEach, expect, test } from 'bun:test';
import { callMemoryAI, executeMemoryPrepareForMain, executeMemoryWrite, executeMemorySummary, executeMemoryVector } from './memoryPipeline';
import { useMemoryStore } from './memoryStore';
import { createDefaultMemorySystemConfig } from './memoryConfig';
import { guardTurnMemory } from '../engine/turnSafety';
import { bucketKeyForConfig, notifyRateLimited, waitForRateLimit } from '../api/rateLimiter';
import { resolvePreset, memoryApiPort } from '../api/presets';

const originalFetch = globalThis.fetch;
const originalStore = useMemoryStore.getState();
afterEach(() => { globalThis.fetch = originalFetch; useMemoryStore.setState(originalStore, true); });
const api = { baseUrl: 'https://memory-cancel.test', apiKey: 'test', model: 'test' };
const context = () => ({ floor: 1, batchText: '【AI正文】旅者到了城门', inputText: '城门', recentContext: '', playerName: '旅者', apiConfig: api });

test('loading cleanup releases only its own task and survives save replacement', () => {
  useMemoryStore.getState().initMemoryRuntime('loading');
  const old = useMemoryStore.getState().beginLoading('旧任务');
  const next = useMemoryStore.getState().beginLoading('新任务');
  old(); old();
  expect(useMemoryStore.getState().loadingStage).toBe('新任务');
  next();
  expect(useMemoryStore.getState().isLoading).toBe(false);
  const expired = useMemoryStore.getState().beginLoading('过期任务');
  useMemoryStore.getState().initMemoryRuntime('replacement');
  const replacement = useMemoryStore.getState().beginLoading('新存档任务');
  expired();
  expect(useMemoryStore.getState().loadingStage).toBe('新存档任务');
  replacement();
  expect(useMemoryStore.getState().isLoading).toBe(false);
});

test('real guarded memory preparation crosses structuredClone boundaries', async () => {
  useMemoryStore.getState().initMemoryRuntime('cloneable');
  const store = guardTurnMemory(useMemoryStore.getState(), () => true, useMemoryStore.getState);
  await executeMemoryPrepareForMain(store, context());
  expect(structuredClone(useMemoryStore.getState().lastCompiledContext)).not.toBeNull();
});

test('memory AI timeout actively aborts its transport', async () => {
  let transportAborted = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { transportAborted = true; reject(options.signal?.reason); }, { once: true });
  })) as unknown as typeof fetch;
  await expect(callMemoryAI({ ...api, baseUrl: 'https://memory-timeout.test' }, 'system', 'user', 0.3, undefined, 30)).rejects.toThrow();
  expect(transportAborted).toBe(true);
});

test('memory API selection preserves provider and response timeout without copying generation settings', () => {
  const config = { ...api, provider: 'deepseek' as const, requestTimeoutMs: 300000, maxTokens: 1234 };
  const expected = { ...api, provider: 'deepseek' as const, requestTimeoutMs: 300000 };
  expect(memoryApiPort(config)).toEqual(expected);
  expect(resolvePreset([{ id: 'vector', name: 'vector', createdAt: 0, config }], 'vector')).toEqual(expected);
});

test('vector extraction honors the selected API response timeout', async () => {
  useMemoryStore.setState({ config: { ...createDefaultMemorySystemConfig(), vectorEnabled: true } });
  useMemoryStore.getState().initMemoryRuntime('vector-timeout-policy');
  globalThis.fetch = (async () => {
    await new Promise(resolve => setTimeout(resolve, 80));
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"facts":[]}' } }] }));
  }) as unknown as typeof fetch;
  await expect(executeMemoryVector(guardTurnMemory(useMemoryStore.getState(), () => true, useMemoryStore.getState), {
    ...context(), vectorApiConfig: { ...api, baseUrl: 'https://vector-config-timeout.test', requestTimeoutMs: 15 },
  })).rejects.toThrow('记忆AI调用超时');
  expect(useMemoryStore.getState().memoryRuntime?.sourceEvents).toEqual([]);
  expect(useMemoryStore.getState().isLoading).toBe(false);
});

test('memory AI inherits the preset request timeout instead of a fixed 120s', async () => {
  let transportAborted = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => new Promise((_resolve, reject) => {
    options?.signal?.addEventListener('abort', () => { transportAborted = true; reject(options.signal?.reason); }, { once: true });
  })) as unknown as typeof fetch;
  const started = Date.now();
  await expect(callMemoryAI({ ...api, baseUrl: 'https://memory-inherited-timeout.test', requestTimeoutMs: 60 }, 'system', 'user')).rejects.toThrow();
  expect(transportAborted).toBe(true);
  expect(Date.now() - started).toBeLessThan(1000);

  const controller = new AbortController();
  const pending = callMemoryAI({ ...api, baseUrl: 'https://memory-default-timeout.test' }, 'system', 'user', 0.3, controller.signal);
  let settled = false;
  pending.catch(() => {}).then(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 200));
  expect(settled).toBe(false);
  controller.abort();
  await pending.catch(() => {});
});

test('memory AI receives its full response timeout after rate-limit cooldown', async () => {
  const config = { ...api, baseUrl: 'https://memory-cooldown-budget.test', provider: 'openai' as const };
  notifyRateLimited('1', bucketKeyForConfig(config));
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response(JSON.stringify({ choices: [{ message: { content: 'ready' } }] }));
  }) as unknown as typeof fetch;
  expect(await callMemoryAI(config, 'system', 'user', 0.3, undefined, 100)).toBe('ready');
  expect(requests).toBe(1);
});

for (const format of ['array', 'fenced', 'object'] as const) {
test(`guarded vector extraction accepts ${format} results and preserves embeddings and 200 historical checkpoints`, async () => {
  const config = createDefaultMemorySystemConfig();
  Object.assign(config, { vectorEnabled: true, semanticRetrieveEnabled: true, vectorRuntime: 'remote',
    vectorApiUrl: 'https://vector-regression-embedding.test', vectorApiModel: 'embed', vectorApiKey: 'embedding-key' });
  useMemoryStore.setState({ config });
  useMemoryStore.getState().initMemoryRuntime('vector-regression');
  useMemoryStore.getState().updateSceneAnchor({ locationLabel: '旧旅店' });
  const checkpoint = useMemoryStore.getState().createCheckpoint()!;
  const checkpoints = Array.from({ length: 200 }, (_, index) => ({ ...structuredClone(checkpoint), id: `checkpoint-${index}` }));
  useMemoryStore.setState({ memoryRuntime: { ...useMemoryStore.getState().getMemoryRuntime(), checkpoints } });
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
    requests.push({ url: String(input), body: JSON.parse(String(options?.body)) });
    const facts = [{ fact: '城门夜间关闭', keywords: ['城门'], primaryType: 'rule' }];
    const content = format === 'array' ? JSON.stringify(facts)
      : format === 'fenced' ? '```json\n' + JSON.stringify(facts) + '\n```'
      : JSON.stringify({ facts });
    return new Response(JSON.stringify(String(input).includes('embedding')
      ? { data: [{ index: 0, embedding: [1, 0] }] }
      : { choices: [{ message: { content } }] }));
  }) as unknown as typeof fetch;
  await executeMemoryVector(guardTurnMemory(useMemoryStore.getState(), () => true, useMemoryStore.getState), {
    ...context(), floor: 201, vectorApiConfig: { ...api, baseUrl: `https://vector-regression-extract-${format}.test`, model: 'extract' },
  });
  expect(requests).toHaveLength(2);
  expect(requests[0]!.url).toContain(`vector-regression-extract-${format}.test`);
  expect(requests[0]!.body.model).toBe('extract');
  expect(JSON.stringify(requests[0]!.body)).not.toContain('checkpoint-');
  expect(useMemoryStore.getState().vectorMemory[0]).toMatchObject({ fact: '城门夜间关闭', embedding: [1, 0], sourceStartIndex: 201 });
  expect(useMemoryStore.getState().memoryRuntime?.checkpoints).toEqual(checkpoints);
  expect(useMemoryStore.getState().isLoading).toBe(false);
  expect(useMemoryStore.getState().restoreCheckpoint('checkpoint-0')).toBe(true);
  expect(useMemoryStore.getState().memoryRuntime?.sceneAnchor?.locationLabel).toBe('旧旅店');
});
}

test('memory AI cooldown remains cancellable without sending a request', async () => {
  const config = { ...api, baseUrl: 'https://memory-cooldown-cancel.test', provider: 'openai' as const };
  notifyRateLimited('60', bucketKeyForConfig(config));
  const controller = new AbortController();
  let requests = 0;
  globalThis.fetch = (async () => { requests++; return new Response('{}'); }) as unknown as typeof fetch;
  const waiting = callMemoryAI(config, 'system', 'user', 0.3, controller.signal, 100);
  controller.abort();
  await expect(waiting).rejects.toThrow();
  expect(requests).toBe(0);
});

test('429 cooldown aborts promptly before a paid request can start', async () => {
  const controller = new AbortController();
  notifyRateLimited('60', 'cancel-test');
  const started = Date.now();
  const waiting = waitForRateLimit('cancel-test', controller.signal);
  controller.abort();
  await expect(waiting).rejects.toThrow();
  expect(Date.now() - started).toBeLessThan(300);
});

test('write uses a private draft and aborts before retrying or committing a replacement save', async () => {
  const config = createDefaultMemorySystemConfig();
  config.writePipeline.retryDelayMs = 60000;
  useMemoryStore.setState({ config });
  useMemoryStore.getState().initMemoryRuntime('old');
  const controller = new AbortController();
  let requests = 0, started!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    requests++; started();
    return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => reject(options.signal?.reason), { once: true }));
  }) as unknown as typeof fetch;
  const store = guardTurnMemory(useMemoryStore.getState(), () => !controller.signal.aborted, useMemoryStore.getState);
  const task = executeMemoryWrite(store, { ...context(), signal: controller.signal });
  await entered;
  controller.abort();
  useMemoryStore.getState().initMemoryRuntime('replacement');
  useMemoryStore.getState().setLoading(true, 'replacement busy');
  await expect(task).rejects.toThrow();
  expect(requests).toBe(1);
  expect(useMemoryStore.getState().memoryRuntime?.sourceEvents).toEqual([]);
  expect(useMemoryStore.getState().loadingStage).toBe('replacement busy');
});

test('accepted write commits its cloneable runtime draft and rejects a stale same-save draft', async () => {
  useMemoryStore.setState({ config: createDefaultMemorySystemConfig() });
  useMemoryStore.getState().initMemoryRuntime('current');
  useMemoryStore.getState().updateSceneAnchor({ locationLabel: '旅店' });
  const checkpoint = useMemoryStore.getState().createCheckpoint()!;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ scenePatch: { locationLabel: '城门' } }) } }] }))) as unknown as typeof fetch;
  const guarded = guardTurnMemory(useMemoryStore.getState(), () => true, useMemoryStore.getState);
  await executeMemoryWrite(guarded, { ...context(), apiConfig: { ...api, baseUrl: 'https://memory-accepted.test' } });
  expect(useMemoryStore.getState().memoryRuntime?.sceneAnchor?.locationLabel).toBe('城门');
  expect(useMemoryStore.getState().memoryRuntime?.sourceEvents).toHaveLength(1);
  const baseline = guarded.getMemoryRuntime();
  const version = guarded.getRuntimeVersion();
  const stale = structuredClone(baseline);
  stale.sceneAnchor!.locationLabel = '过期';
  // A normal writer can replace a runtime reference without bumpRuntimeVersion.
  useMemoryStore.getState().updateSceneAnchor({ locationLabel: '玩家的新修改' });
  expect(() => guarded.commitMemoryRuntime(stale, version, baseline)).toThrow();
  expect(useMemoryStore.getState().memoryRuntime?.sceneAnchor?.locationLabel).toBe('玩家的新修改');
  expect(useMemoryStore.getState().restoreCheckpoint(checkpoint.id)).toBe(true);
  expect(useMemoryStore.getState().memoryRuntime?.sceneAnchor?.locationLabel).toBe('旅店');
});

test('parallel summary completion survives the later structured memory draft commit', async () => {
  useMemoryStore.setState({ config: createDefaultMemorySystemConfig() });
  useMemoryStore.getState().initMemoryRuntime('parallel');
  let release!: () => void;
  const ready = new Promise<void>(resolve => { release = resolve; });
  const payload = (data: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(data) } }] }));
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes('structured')) { await ready; return payload({ scenePatch: { locationLabel: '城门' } }); }
    return payload({ playerMemories: [{ title: '城门', summary: '到达城门', keywords: ['城门'] }] });
  }) as unknown as typeof fetch;
  const guarded = guardTurnMemory(useMemoryStore.getState(), () => true, useMemoryStore.getState);
  const ctx = { ...context(), writeApiConfig: { ...api, baseUrl: 'https://structured-parallel.test' }, summaryApiConfig: { ...api, baseUrl: 'https://summary-parallel.test' } };
  const write = executeMemoryWrite(guarded, ctx);
  await executeMemorySummary(guarded, ctx);
  useMemoryStore.getState().appendWriteDebugLog({ kind: 'vector_embedding', message: '并行向量消费者日志' });
  release();
  await write;
  expect(useMemoryStore.getState().memoryRuntime?.summarySaveHistory).toHaveLength(1);
  expect(useMemoryStore.getState().memoryRuntime?.sceneAnchor?.locationLabel).toBe('城门');
  expect(useMemoryStore.getState().memoryRuntime?.writeDebugLogs.some(log => log.message === '并行向量消费者日志')).toBe(true);
});

test('cancellation interrupts a write retry delay without sending another request', async () => {
  const config = createDefaultMemorySystemConfig();
  config.writePipeline.retryDelayMs = 60000;
  useMemoryStore.setState({ config });
  useMemoryStore.getState().initMemoryRuntime('retry');
  const controller = new AbortController();
  let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    setTimeout(() => controller.abort(), 20);
    return new Response('failed', { status: 500 });
  }) as unknown as typeof fetch;
  const started = Date.now();
  await expect(executeMemoryWrite(guardTurnMemory(useMemoryStore.getState(), () => !controller.signal.aborted, useMemoryStore.getState), {
    ...context(), apiConfig: { ...api, baseUrl: 'https://memory-retry.test' }, signal: controller.signal,
  })).rejects.toThrow();
  expect(requests).toBe(1);
  expect(Date.now() - started).toBeLessThan(500);
});

for (const stage of ['embedding', 'rerank'] as const) {
  test(`semantic recall actively aborts its ${stage} transport`, async () => {
    const config = createDefaultMemorySystemConfig();
    Object.assign(config, { vectorEnabled: true, semanticRetrieveEnabled: true, vectorApiUrl: 'https://embedding-cancel.test', vectorApiModel: 'embed', vectorScoreThreshold: 0,
      vectorRetrieveMode: 'hybrid', vectorRerankApiUrl: 'https://rerank-cancel.test', vectorRerankModel: 'rank' });
    useMemoryStore.getState().initMemoryRuntime('semantic');
    const facts = [1, 2].map(id => ({ id: `f${id}`, fact: '城门', keywords: ['城门'], entities: [], primaryType: 'rule' as const, secondaryTypes: [], characters: [], locations: [], factions: [], items: [], abilities: [], events: [], rules: [], timeMarkers: [], importance: 5, timeScope: 'long' as const, state: 'active' as const, embedding: [1, 0] }));
    useMemoryStore.setState({ config, vectorMemory: facts });
    const controller = new AbortController();
    let transportAborted = false, entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    globalThis.fetch = (async (input: RequestInfo | URL, options?: RequestInit) => {
      if (stage === 'rerank' && String(input).includes('embedding')) return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }));
      entered();
      return new Promise((_resolve, reject) => options?.signal?.addEventListener('abort', () => { transportAborted = true; reject(options.signal?.reason); }, { once: true }));
    }) as unknown as typeof fetch;
    const task = executeMemoryPrepareForMain(guardTurnMemory(useMemoryStore.getState(), () => !controller.signal.aborted, useMemoryStore.getState), { ...context(), signal: controller.signal });
    await started; controller.abort();
    await expect(task).rejects.toThrow();
    expect(transportAborted).toBe(true);
    expect(useMemoryStore.getState().lastCompiledContext).toBeNull();
  });
}
