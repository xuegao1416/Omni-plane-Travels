/** Real endpoint benchmark; annotated queries are supplied externally, never book-specific code. */
import { readFileSync, existsSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildNovelChunks, embedNovelChunks, retrieveNovelChunks } from '../src/novel/semanticIndex';
import { createEmbeddingClient } from '../src/memory/embeddingRuntime';
import type { NovelDataset, NovelChunk } from '../src/novel/types';

const [sourcePath, queryPath, out = 'tmp/novel-retrieval', chapterRange] = process.argv.slice(2);
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null }, configurable: true });
if (!sourcePath || !queryPath) throw Error('Usage: source.json queries.json output-directory');
mkdirSync(out, { recursive: true });
const dataset: NovelDataset = JSON.parse(readFileSync(sourcePath, 'utf8'));
if (chapterRange) {
  const [start, end] = chapterRange.split(':').map(Number);
  if (!Number.isInteger(start) || !Number.isInteger(end) || end < start) throw Error('Chapter range must be start:end (zero-based indices)');
  dataset.chapters = dataset.chapters.filter(chapter => chapter.index >= start && chapter.index <= end);
}
const model = process.env.NOVEL_EMBEDDING_MODEL ?? 'novel-bge-m3';
const endpoint = process.env.NOVEL_EMBEDDING_URL ?? 'http://127.0.0.1:1234/v1';
const identity = `${endpoint}:${model}`;
let calls = 0;
const baseClient = createEmbeddingClient({ vectorRuntime: 'local_endpoint', vectorApiUrl: '', vectorApiKey: '', vectorApiModel: '', localEmbeddingModelId: model, localEmbeddingEndpoint: endpoint });
const client = { ...baseClient, embed: (...args: Parameters<typeof baseClient.embed>) => { calls++; return baseClient.embed(...args); } };
const cachePath = join(out, 'vectors.jsonl');
const cache = new Map<string, NovelChunk>();
if (existsSync(cachePath)) for (const line of readFileSync(cachePath, 'utf8').split('\n')) {
  if (!line.trim()) continue;
  try { const chunk = JSON.parse(line) as NovelChunk; cache.set(chunk.id, chunk); } catch { /* Interrupted final append is rebuilt. */ }
}
const chunks = buildNovelChunks(dataset.id, dataset.chapters).map(chunk => ({ ...chunk, ...cache.get(chunk.id) }));
const started = performance.now(); let lastLogged = 0;
const indexed = await embedNovelChunks(chunks, client, model, { identity,
  onBatch: async batch => { appendFileSync(cachePath, batch.map(chunk => JSON.stringify(chunk)).join('\n') + '\n'); },
  onProgress: (completed, total) => { if (completed === total || completed - lastLogged >= 200) { lastLogged = completed; console.log(JSON.stringify({ completed, total })); } },
});
const indexing = { chunks: indexed.length, calls, elapsedMs: Math.round(performance.now() - started) };
const queries: Array<{ query: string; chapterIndex: number; excerpt: string; kind: string }> = JSON.parse(readFileSync(queryPath, 'utf8'));
const results = [];
for (const item of queries) {
  const chapter = dataset.chapters.find(c => c.index === item.chapterIndex);
  if (!chapter || !chapter.content.includes(item.excerpt)) throw Error(`Invalid annotation: ${item.chapterIndex}`);
  for (const mode of ['basic', 'enhanced', 'degraded'] as const) {
    const before = calls, start = performance.now(); let degraded = 0;
    const found = await retrieveNovelChunks({ query: item.query, chunks: indexed, currentChapterIds: [], limit: 8,
      ...(mode !== 'basic' ? { embeddingClient: mode === 'enhanced' ? client : { ...client, embed: async () => { throw new Error('Simulated unavailable service'); } }, embeddingModel: model, embeddingIdentity: identity } : {}),
      onEmbeddingFailure: () => { degraded++; },
    });
    const offset = chapter.content.indexOf(item.excerpt);
    results.push({ ...item, mode, hit: found.some(result => result.chunk.chapterId === chapter.id && (result.chunk.chapterStartOffset ?? result.chunk.startOffset) <= offset && (result.chunk.chapterEndOffset ?? result.chunk.endOffset) >= offset + item.excerpt.length),
      elapsedMs: Math.round(performance.now() - start), calls: calls - before, degraded, vectorCandidates: found.filter(result => result.source === 'hybrid').length,
      chapterIndices: found.map(result => dataset.chapters.find(c => c.id === result.chunk.chapterId)?.index) });
  }
}
const report = { generatedAt: new Date().toISOString(), sourceVersion: dataset.sourceVersion, indexing, results };
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ indexing, queries: queries.length, modes: ['basic', 'enhanced', 'degraded'].map(mode => ({ mode, hits: results.filter(r => r.mode === mode && r.hit).length, count: queries.length })) }));
