import { expect, test } from 'bun:test';
import { buildNovelChunks, embedNovelChunks, probeNovelEmbedding, retrieveNovelChunks } from './semanticIndex';

test('embedding batches persist before a later failure and resume only missing inputs', async () => {
  const chunks = buildNovelChunks('batch', Array.from({ length: 18 }, (_, index) => ({ id: `c${index}`, index, title: `章${index}`, content: `不同的原文证据${index}` })));
  const saved: typeof chunks = [];
  let calls = 0;
  await expect(embedNovelChunks(chunks, { embed: async texts => {
    if (++calls === 2) throw new Error('offline');
    return texts.map(() => [1, 0]);
  } }, 'model', { identity: 'local-a', onBatch: async batch => { saved.push(...batch); } })).rejects.toThrow('offline');
  expect(saved).toHaveLength(8);
  const restored = chunks.map(c => saved.find(s => s.id === c.id) ?? c);
  const requests: number[] = [];
  const result = await embedNovelChunks(restored, { embed: async texts => { requests.push(texts.length); return texts.map(() => [1, 0]); } }, 'model', { identity: 'local-a' });
  expect(requests).toEqual([8, 2]);
  expect(result.every(c => c.embeddingIdentity === 'local-a')).toBe(true);
});

test('changed context prefix invalidates embedding and cancellation stops batches', async () => {
  const chunks = buildNovelChunks('batch', [{ id: 'c1', index: 0, title: '旧标题', content: '原文' }]);
  const client = { embed: async (texts: string[]) => texts.map(() => [1, 0]) };
  const first = await embedNovelChunks(chunks, client, 'model');
  let called = false;
  await embedNovelChunks([{ ...first[0], contextPrefix: '新标题' }], { embed: async texts => { called = true; return client.embed(texts); } }, 'model');
  expect(called).toBe(true);
  const controller = new AbortController(); controller.abort();
  await expect(embedNovelChunks(chunks, client, 'model', { signal: controller.signal })).rejects.toThrow();
});

test('probe and query reject nonfinite, zero or inconsistent vectors', async () => {
  await expect(probeNovelEmbedding({ embed: async () => [[0, 0], [0, 0]] })).rejects.toThrow();
  await expect(probeNovelEmbedding({ embed: async () => [[1, 0], [1]] })).rejects.toThrow();
  const chunks = buildNovelChunks('d', [{ id: 'c', index: 0, title: '旧塔', content: '铜符开启城门' }]);
  const indexed = await embedNovelChunks(chunks, { embed: async () => [[1, 0]] }, 'm');
  const retrieved = await retrieveNovelChunks({ query: '铜符', chunks: indexed, currentChapterIds: ['c'], embeddingClient: { embed: async () => [[NaN, 0]] }, embeddingModel: 'm' });
  expect(retrieved[0].source).not.toBe('hybrid');
});

test('source offsets point to exact original text including indented paragraphs', () => {
  const content = '  第一段内容。\n\n    第二段内容。\n第三段内容。';
  const chunks = buildNovelChunks('offsets', [{ id: 'c', index: 0, title: '章', content, startOffset: 10 }], 32);
  for (const chunk of chunks) {
    expect(content.slice(chunk.chapterStartOffset, chunk.chapterEndOffset)).toBe(chunk.text);
    expect(chunk.startOffset).toBe(10 + chunk.chapterStartOffset!);
  }
});
