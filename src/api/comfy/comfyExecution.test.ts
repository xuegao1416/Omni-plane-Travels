import { describe, expect, test } from 'bun:test';
import { waitForComfyExecution } from './comfyExecution';

class FakeWebSocket {
  private listeners = new Map<string, Array<(event: any) => void>>();
  addEventListener(type: string, handler: (event: any) => void) {
    const handlers = this.listeners.get(type) || [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }
  emit(type: string, event: any = {}) {
    for (const handler of this.listeners.get(type) || []) handler(event);
  }
  close() {}
}

describe('ComfyUI execution lifecycle', () => {
  test('supports old-style history that exposes images without status', async () => {
    const result = await waitForComfyExecution({
      promptId: 'p1', pollIntervalMs: 1, timeoutMs: 100,
      fetchHistory: async () => ({ p1: { outputs: { '9': { images: [{ filename: 'ok.png', type: 'output' }] } } } }),
    });
    expect((result.entry.outputs as any)['9'].images[0].filename).toBe('ok.png');
  });

  test('does not fail when a history entry appears before its image output', async () => {
    let calls = 0;
    const result = await waitForComfyExecution({
      promptId: 'p2', pollIntervalMs: 1, timeoutMs: 100, legacySettlePolls: 3,
      fetchHistory: async () => {
        calls += 1;
        if (calls === 1) return { p2: { outputs: {} } };
        return { p2: { outputs: { '4': { images: [{ filename: 'late.png' }] } } } };
      },
    });
    expect(calls).toBeGreaterThanOrEqual(2);
    expect((result.entry.outputs as any)['4'].images[0].filename).toBe('late.png');
  });

  test('surfaces the real execution_error from history', async () => {
    await expect(waitForComfyExecution({
      promptId: 'p3', pollIntervalMs: 1, timeoutMs: 100,
      fetchHistory: async () => ({ p3: {
        outputs: {},
        status: { status_str: 'error', messages: [['execution_error', {
          node_id: '7', node_type: 'CheckpointLoaderSimple', exception_message: 'model not found',
        }]] },
      } }),
    })).rejects.toThrow('节点 7 (CheckpointLoaderSimple)');
  });

  test('tolerates transient history request failures and then succeeds', async () => {
    let calls = 0;
    const result = await waitForComfyExecution({
      promptId: 'p4', pollIntervalMs: 1, timeoutMs: 100, maxConsecutiveErrors: 3,
      fetchHistory: async () => {
        calls += 1;
        if (calls === 1) throw new Error('temporary network failure');
        return { p4: { outputs: { '9': { images: [{ filename: 'recovered.png' }] } } } };
      },
    });
    expect(calls).toBe(2);
    expect((result.entry.outputs as any)['9'].images[0].filename).toBe('recovered.png');
  });

  test('WebSocket transport failure does not block HTTP fallback', async () => {
    const fake = new FakeWebSocket();
    let calls = 0;
    setTimeout(() => fake.emit('error', new Event('error')), 0);
    const result = await waitForComfyExecution({
      promptId: 'pws1', websocketUrl: 'ws://localhost:8188/ws?clientId=test',
      webSocketFactory: () => fake as unknown as WebSocket,
      pollIntervalMs: 1, timeoutMs: 100,
      fetchHistory: async () => {
        calls += 1;
        if (calls === 1) return {};
        return { pws1: { outputs: { '9': { images: [{ filename: 'fallback.png' }] } } } };
      },
    });
    expect((result.entry.outputs as any)['9'].images[0].filename).toBe('fallback.png');
  });

  test('WebSocket execution_error surfaces immediately when available', async () => {
    const fake = new FakeWebSocket();
    setTimeout(() => fake.emit('message', { data: JSON.stringify({
      type: 'execution_error',
      data: { prompt_id: 'pws2', node_id: '42', node_type: 'KSampler', exception_message: 'sampler exploded' },
    }) }), 0);

    await expect(waitForComfyExecution({
      promptId: 'pws2', websocketUrl: 'ws://localhost:8188/ws?clientId=test',
      webSocketFactory: () => fake as unknown as WebSocket,
      pollIntervalMs: 20, timeoutMs: 100,
      fetchHistory: async () => ({}),
    })).rejects.toThrow('节点 42 (KSampler)');
  });

  test('accepts explicit execution_success with no image so caller can report output configuration', async () => {
    const result = await waitForComfyExecution({
      promptId: 'p5', pollIntervalMs: 1, timeoutMs: 100,
      fetchHistory: async () => ({ p5: {
        outputs: {},
        status: { messages: [['execution_success', { prompt_id: 'p5' }]] },
      } }),
    });
    expect(result.entry.outputs).toEqual({});
  });
});
