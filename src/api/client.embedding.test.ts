import { afterEach, describe, expect, test } from 'bun:test';
import { fetchEmbeddingBatch } from './client';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('remote embedding response validation', () => {
  test('rejects incomplete, duplicate, mismatched, or non-finite vectors', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({
      data: [
        { index: 0, embedding: [1, 0] },
        { index: 0, embedding: [2, 0] },
      ],
    }), { status: 200 })) as unknown as typeof fetch;

    await expect(fetchEmbeddingBatch({ baseUrl: 'https://embedding.example/v1', apiKey: 'key', model: 'model' }, ['a', 'b']))
      .rejects.toThrow(/索引重复/);
  });
});
