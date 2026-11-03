import { expect, test } from 'bun:test';
import type { ApiConfig } from '../api/types';
import { VariableManager } from './variableManager';
import { PipelineExecutor } from './pipelineExecutor';
import { setRateLimitInterval, waitForRateLimit } from '../api/rateLimiter';

const config = { executionOrder: [['main'], ['memory_write', 'memory_summary']] as import('./pipelineTypes').PipelineTaskId[][],
  variableEnabled: false, variableDelayMs: 0, variableMaxRetries: 0, memoryEnabled: true };
const narrative = { text: 'Complete narrative.', parsed: { content: 'Complete narrative.', thinking: '' } };
const params = () => ({ config, varMgr: new VariableManager(), worldBook: null, userText: 'Wait.', mainApiConfig: apiConfig });

test('late narrative result is refused after cancellation', async () => {
  const controller = new AbortController();
  const executor = new PipelineExecutor(1, { onUpdate: () => {} });
  await expect(executor.execute({ ...params(), signal: controller.signal, mainTask: async () => { controller.abort(); return narrative; } })).rejects.toThrow();
  expect(executor.getStatus().stages.main.status).not.toBe('success');
});

for (const alongsideMain of [false, true]) {
  test(`cancel interrupts scheduler cooldown ${alongsideMain ? 'alongside' : 'after'} main before memory starts`, async () => {
    setRateLimitInterval(1000);
    await waitForRateLimit();
    setRateLimitInterval(60000);
    const controller = new AbortController();
    let writes = 0;
    const executor = new PipelineExecutor(1, { onUpdate: () => {} });
    const started = Date.now();
    const timer = setTimeout(() => controller.abort(), 20);
    try {
      await expect(executor.execute({ ...params(), config: { ...config, executionOrder: alongsideMain ? [['main', 'memory_write']] : [['main'], ['memory_write']] },
        signal: controller.signal, mainTask: async () => narrative, memoryTasks: { write: async () => { writes++; } } })).rejects.toThrow();
      expect(Date.now() - started).toBeLessThan(300);
      expect(writes).toBe(0);
    } finally { clearTimeout(timer); setRateLimitInterval(1000); }
  });
}

test('resume reuses completed narrative and successful writes, but runs unfinished work', async () => {
  const controller = new AbortController();
  let mainCalls = 0, writes = 0, summaries = 0;
  const executor = new PipelineExecutor(1, { onUpdate: () => {} });
  const tasks = { write: async () => { writes++; }, summary: async () => { summaries++; if (summaries === 1) { controller.abort(); throw new DOMException('cancelled', 'AbortError'); } } };
  await expect(executor.execute({ ...params(), signal: controller.signal, mainTask: async () => { mainCalls++; return narrative; }, memoryTasks: tasks })).rejects.toThrow();
  await executor.execute({ ...params(), resume: true, signal: new AbortController().signal, mainTask: async () => { mainCalls++; return narrative; }, memoryTasks: tasks });
  expect(mainCalls).toBe(1);
  expect(writes).toBe(1);
  expect(summaries).toBe(2);
  expect(executor.getStatus().stages.memory_summary.status).toBe('success');
});

const apiConfig: ApiConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://example.test',
  model: 'test-model',
  provider: 'custom',
  stream: false,
};

test('variable extraction does not report success for an unusable update', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '<UpdateVariable>not valid JSON</UpdateVariable>' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  try {
    const executor = new PipelineExecutor(1, { onUpdate: () => {} });
    const result = await executor.execute({
      config: {
        executionOrder: [['main'], ['variable']],
        variableEnabled: true,
        variableDelayMs: 0,
        variableMaxRetries: 0,
        memoryEnabled: false,
      },
      mainTask: async () => ({
        text: 'A complete narrative.',
        parsed: { content: 'A complete narrative.', thinking: '' },
      }),
      varMgr: new VariableManager(),
      worldBook: null,
      userText: 'Advance one round.',
      mainApiConfig: apiConfig,
      signal: new AbortController().signal,
    });

    expect(result.mainResult?.text).toBe('A complete narrative.');
    expect(result.status.stages.main.status).toBe('success');
    expect(result.status.stages.variable.status).toBe('error');
    expect(result.status.stages.variable.error).toContain('JSON解析失败');
    expect(result.status.endTime).toBeGreaterThan(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
