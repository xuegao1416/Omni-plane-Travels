import { expect, test } from 'bun:test';
import type { ApiConfig } from '../api/types';
import { VariableManager } from './variableManager';
import { PipelineExecutor } from './pipelineExecutor';

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
    expect(result.status.stages.variable.error).toContain('无法应用');
    expect(result.status.endTime).toBeGreaterThan(0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
