import { describe, expect, test } from 'bun:test';
import type { MemorySystemConfig } from './types';
import {
  clearAllLocalEmbeddingModels,
  createEmbeddingClient,
  deleteLocalEmbeddingModel,
  getInstalledLocalEmbeddingModels,
  warmLocalEmbeddingModel,
} from './embeddingRuntime';

const baseConfig = {
  vectorRuntime: 'remote',
  vectorApiUrl: 'https://embedding.example/v1',
  vectorApiKey: 'key',
  vectorApiModel: 'remote-model',
  localEmbeddingModelId: 'Xenova/all-MiniLM-L6-v2',
  localEmbeddingEndpoint: 'http://127.0.0.1:8080/v1',
} as MemorySystemConfig;

describe('embedding runtime routing', () => {
  test('tracks installed models and supports model deletion and cache cleanup', async () => {
    const progress: number[] = [];
    await warmLocalEmbeddingModel('test/model', {
      load: async (_model, onProgress) => {
        onProgress?.({ status: 'progress', progress: 50 });
        onProgress?.({ status: 'progress', progress: 100 });
      },
    }, value => progress.push(value.progress ?? 0));
    expect(progress).toEqual([50, 100]);
    expect(getInstalledLocalEmbeddingModels().map(model => model.id)).toEqual(['test/model']);
    await deleteLocalEmbeddingModel('test/model');
    expect(getInstalledLocalEmbeddingModels()).toEqual([]);
    await clearAllLocalEmbeddingModels();
  });
  test('uses the remote OpenAI-compatible client in remote mode', async () => {
    const calls: unknown[] = [];
    const client = createEmbeddingClient(baseConfig, {
      remoteBatch: async (config, texts) => {
        calls.push({ config, texts });
        return texts.map((_, index) => [index, 1]);
      },
    });

    await expect(client.embed(['alpha', 'beta'])).resolves.toEqual([[0, 1], [1, 1]]);
    expect(calls).toHaveLength(1);
  });

  test('runs an in-process model without an endpoint or API key', async () => {
    const calls: unknown[] = [];
    const client = createEmbeddingClient({ ...baseConfig, vectorRuntime: 'local' }, {
      localBatch: async (model, texts) => {
        calls.push({ model, texts });
        return texts.map(() => [0.25, 0.75]);
      },
    });

    await expect(client.embed(['本地记忆'])).resolves.toEqual([[0.25, 0.75]]);
    expect(calls).toEqual([{ model: 'Xenova/all-MiniLM-L6-v2', texts: ['本地记忆'] }]);
  });

  test('limits in-process batches to protect mobile WebViews from memory spikes', async () => {
    const batchSizes: number[] = [];
    const client = createEmbeddingClient({ ...baseConfig, vectorRuntime: 'local' }, {
      localBatch: async (_model, texts) => {
        batchSizes.push(texts.length);
        return texts.map(() => [1]);
      },
    });

    const result = await client.embed(Array.from({ length: 17 }, (_, index) => `text-${index}`));
    expect(batchSizes).toEqual([8, 8, 1]);
    expect(result).toHaveLength(17);
  });

  test('keeps an explicit local endpoint mode for advanced users', async () => {
    const calls: unknown[] = [];
    const client = createEmbeddingClient({ ...baseConfig, vectorRuntime: 'local_endpoint' }, {
      remoteBatch: async (config, texts) => {
        calls.push({ config, texts });
        return [[1, 0]];
      },
    });

    await client.embed(['endpoint']);
    expect(calls).toEqual([{
      config: { baseUrl: 'http://127.0.0.1:8080/v1', apiKey: '', model: 'Xenova/all-MiniLM-L6-v2' },
      texts: ['endpoint'],
    }]);
  });
});
