import { describe, expect, test } from 'bun:test';
import { getRateLimitInterval } from '../api/rateLimiter';
import type { EmbeddingClient } from '../memory/embeddingRuntime';
import type { NovelChunk } from './types';
import { embedNovelChunks, retrieveNovelChunks } from './semanticIndex';

const chunks: NovelChunk[] = [
  { id: 'k1', datasetId: 'd1', chapterId: 'c1', index: 0, text: '沈砚曾在旧塔藏下一枚铜符。', contextPrefix: '第一章', startOffset: 0, endOffset: 14, contentHash: 'h1', embedding: [1, 0], embeddingModel: 'demo', embeddingDimension: 2 },
  { id: 'k2', datasetId: 'd1', chapterId: 'c2', index: 1, text: '众人在城门遭到盘查。', contextPrefix: '第二章', startOffset: 0, endOffset: 11, contentHash: 'h2', embedding: [0, 1], embeddingModel: 'demo', embeddingDimension: 2 },
  { id: 'k3', datasetId: 'd1', chapterId: 'c3', index: 2, text: '通行证需要用旧塔铜符换取。', contextPrefix: '第三章', startOffset: 0, endOffset: 14, contentHash: 'h3', embedding: [1, 0], embeddingModel: 'demo', embeddingDimension: 2 },
];

describe('novel semantic index', () => {
  test('uses embeddings to recall relevant non-adjacent evidence', async () => {
    const client: EmbeddingClient = { embed: async () => [[1, 0]] };
    const result = await retrieveNovelChunks({
      query: '旧塔铜符如何取得通行证', chunks, currentChapterIds: ['c2'], embeddingClient: client,
      embeddingModel: 'demo', limit: 2,
    });

    expect(result.map(item => item.chunk.id)).toContain('k3');
    expect(result[0].source).toBe('hybrid');
  });

  test('falls back to keyword and adjacent evidence when embedding fails', async () => {
    const client: EmbeddingClient = { embed: async () => { throw new Error('offline'); } };
    const result = await retrieveNovelChunks({
      query: '通行证', chunks: chunks.map(({ embedding: _embedding, ...chunk }) => chunk),
      currentChapterIds: ['c2'], embeddingClient: client, embeddingModel: 'demo', limit: 3,
    });

    expect(result[0].chunk.id).toBe('k3');
    expect(result.some(item => item.chunk.id === 'k2')).toBe(true);
    expect(result.every(item => item.source !== 'hybrid')).toBe(true);
  });

  test('records the embedding model and dimensions when indexing chunks', async () => {
    const client: EmbeddingClient = { embed: async texts => texts.map((_text, index) => [index, 1]) };
    const indexed = await embedNovelChunks(chunks.map(({ embedding: _embedding, ...chunk }) => chunk), client, 'new-model');

    expect(indexed[0]).toMatchObject({ embeddingModel: 'new-model', embeddingDimension: 2 });
    expect(indexed.every(item => Array.isArray(item.embedding))).toBe(true);
  });

  test('embedding indexing respects its own rate limit bucket', async () => {
    const client: EmbeddingClient = { embed: async texts => texts.map(() => [1, 0]) };
    const bare = chunks.map(({ embedding: _embedding, ...chunk }) => chunk);
    const start = Date.now();
    await embedNovelChunks(bare, client, 'local-model', { identity: 'local:a', rateLimitMs: 1000, batchSize: 1 });
    expect(Date.now() - start).toBeGreaterThanOrEqual(900);
    expect(getRateLimitInterval('novel:embedding:local:a')).toBe(1000);
  });
});
