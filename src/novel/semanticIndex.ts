import { setRateLimitInterval, waitForRateLimit } from '../api/rateLimiter';
import type { EmbeddingClient } from '../memory/embeddingRuntime';
import { cosineSimilarity } from '../memory/vectorUtils';
import { estimateNovelTokens, hashNovelText } from './segmentation';
import type { NovelChapter, NovelChunk } from './types';

export interface RetrievedNovelChunk { chunk: NovelChunk; score: number; source: 'hybrid' | 'keyword' | 'adjacent'; }

function keywordTerms(query: string): string[] {
  const source = query.trim().toLowerCase();
  const words = source.split(/[\s,，。！？!?;；、：:]+/).filter(item => item.length >= 2);
  const windows: string[] = [];
  for (const part of source.match(/[\u3400-\u9fff\uf900-\ufaff]+/g) ?? []) {
    for (const size of [4, 3, 2]) for (let i = 0; i + size <= part.length; i++) windows.push(part.slice(i, i + size));
  }
  return [...new Set([...words, ...windows])].slice(0, 96);
}

/** Literal original slices preserve evidence offsets, even across indented paragraphs. */
export function buildNovelChunks(datasetId: string, chapters: NovelChapter[], maxTokens = 500): NovelChunk[] {
  const budget = Math.max(32, Math.floor(maxTokens));
  const output: NovelChunk[] = [];
  for (const chapter of [...chapters].sort((a, b) => a.index - b.index)) {
    if (chapter.included === false) continue;
    const source = chapter.content;
    let start = 0;
    while (start < source.length) {
      while (start < source.length && /\s/.test(source[start])) start++;
      if (start >= source.length) break;
      let low = start + 1, high = Math.min(source.length, start + budget * 4), end = low;
      while (low <= high) {
        const mid = Math.floor((low + high) / 2);
        if (estimateNovelTokens(source.slice(start, mid)) <= budget) { end = mid; low = mid + 1; }
        else high = mid - 1;
      }
      if (end < source.length) {
        const candidate = source.slice(start, end);
        const boundary = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf('。'), candidate.lastIndexOf('！'), candidate.lastIndexOf('？'));
        if (boundary > candidate.length * 0.55) end = start + boundary + 1;
      }
      while (end > start && /\s/.test(source[end - 1])) end--;
      if (end <= start) break;
      const text = source.slice(start, end);
      output.push({ id: `${datasetId}:${chapter.id}:${start}`, datasetId, chapterId: chapter.id, index: output.length,
        text, contextPrefix: [chapter.volumeTitle, chapter.title].filter(Boolean).join(' · '),
        startOffset: (chapter.startOffset ?? 0) + start, endOffset: (chapter.startOffset ?? 0) + end,
        chapterStartOffset: start, chapterEndOffset: end, contentHash: hashNovelText(text) });
      if (end >= source.length || !source.slice(end).trim()) break;
      start = Math.max(start + 1, end - Math.min(40, Math.floor((end - start) / 10)));
    }
  }
  return output;
}

/** 可中断的等待竞态：取消任务时不必等完当前的限流间隔。 */
function abortWhen(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    const reason = () => signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (signal.aborted) { reject(reason()); return; }
    signal.addEventListener('abort', () => reject(reason()), { once: true });
  });
}

function validVector(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(n => typeof n === 'number' && Number.isFinite(n)) && value.some(n => n !== 0);
}
function validateMatrix(vectors: number[][], expected: number): number {
  if (vectors.length !== expected) throw new Error('Embedding 返回数量与小说分块数量不一致');
  const dimension = vectors[0]?.length ?? 0;
  if (!dimension || vectors.some(vector => !validVector(vector) || vector.length !== dimension)) throw new Error('Embedding 返回的小说向量格式无效');
  return dimension;
}

/** Bounds legacy clients while also forwarding cancellation to network-capable ones. */
export async function requestNovelEmbedding(client: EmbeddingClient, texts: string[], signal?: AbortSignal, rateLimitMs?: number, bucket?: string): Promise<number[][]> {
  signal?.throwIfAborted();
  if (typeof rateLimitMs === 'number' && rateLimitMs > 0 && bucket) {
    setRateLimitInterval(rateLimitMs, bucket);
    await Promise.race([waitForRateLimit(bucket), abortWhen(signal)]);
  }
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('Embedding 请求超时')), 60_000);
  let rejectAbort: (() => void) | undefined;
  try {
    return await Promise.race([client.embed(texts, { signal: controller.signal }), new Promise<never>((_resolve, reject) => {
      rejectAbort = () => reject(controller.signal.reason ?? new DOMException('Aborted', 'AbortError'));
      controller.signal.addEventListener('abort', rejectAbort, { once: true });
      if (controller.signal.aborted) rejectAbort();
    })]);
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', abort);
    if (rejectAbort) controller.signal.removeEventListener('abort', rejectAbort);
  }
}
export async function probeNovelEmbedding(client: EmbeddingClient, signal?: AbortSignal): Promise<{ dimension: number }> {
  const matrix = await requestNovelEmbedding(client, ['古城中的药剂师收藏了一枚铜符。', '天空下起了雨，行人撑开雨伞。'], signal);
  return { dimension: validateMatrix(matrix, 2) };
}
export function novelEmbeddingInputHash(chunk: NovelChunk): string {
  return hashNovelText(`chunks-v2\n${chunk.contextPrefix}\n${chunk.text}`);
}

export async function embedNovelChunks(chunks: NovelChunk[], client: EmbeddingClient, model: string,
  options: { identity?: string; signal?: AbortSignal; batchSize?: number; onBatch?: (batch: NovelChunk[]) => Promise<void>; onProgress?: (completed: number, total: number) => void; rateLimitMs?: number } = {},
): Promise<NovelChunk[]> {
  const identity = options.identity ?? model;
  const bucket = `novel:embedding:${identity || model}`;
  const output = [...chunks]; options.signal?.throwIfAborted();
  const missing = chunks.map((chunk, index) => ({ chunk, index })).filter(({ chunk }) =>
    chunk.embeddingIdentity !== identity || chunk.embeddingModel !== model || chunk.embeddingInputHash !== novelEmbeddingInputHash(chunk)
    || !validVector(chunk.embedding) || chunk.embeddingDimension !== chunk.embedding.length);
  let completed = chunks.length - missing.length;
  options.onProgress?.(completed, chunks.length);
  const batchSize = Math.max(1, Math.min(32, options.batchSize ?? 8));
  for (let i = 0; i < missing.length; i += batchSize) {
    options.signal?.throwIfAborted();
    const batch = missing.slice(i, i + batchSize);
    const vectors = await requestNovelEmbedding(client, batch.map(({ chunk }) => `${chunk.contextPrefix}\n${chunk.text}`), options.signal, options.rateLimitMs, bucket);
    const dimension = validateMatrix(vectors, batch.length); options.signal?.throwIfAborted();
    const indexed = batch.map(({ chunk, index }, j) => {
      const next = { ...chunk, embedding: vectors[j], embeddingModel: model, embeddingDimension: dimension,
        embeddingIdentity: identity, embeddingInputHash: novelEmbeddingInputHash(chunk), embeddedAt: Date.now() };
      output[index] = next; return next;
    });
    await options.onBatch?.(indexed); completed += indexed.length; options.onProgress?.(completed, chunks.length);
  }
  return output;
}

interface SearchIndex { order: Map<string, number>; texts: string[]; }
const indexes = new WeakMap<NovelChunk[], SearchIndex>();
function searchIndex(chunks: NovelChunk[]): SearchIndex {
  let value = indexes.get(chunks);
  if (!value) {
    const order = new Map<string, number>();
    for (const chunk of chunks) if (!order.has(chunk.chapterId)) order.set(chunk.chapterId, order.size);
    value = { order, texts: chunks.map(chunk => `${chunk.contextPrefix}\n${chunk.text}`.toLowerCase()) }; indexes.set(chunks, value);
  }
  return value;
}
export async function retrieveNovelChunks(params: {
  query: string; chunks: NovelChunk[]; currentChapterIds: string[]; embeddingClient?: EmbeddingClient;
  embeddingModel?: string; embeddingIdentity?: string; limit?: number; signal?: AbortSignal; onEmbeddingFailure?: (error: unknown) => void;
}): Promise<RetrievedNovelChunk[]> {
  params.signal?.throwIfAborted();
  const terms = keywordTerms(params.query); let queryVector: number[] | undefined;
  if (params.embeddingClient && params.embeddingModel) {
    try {
      const candidate = (await requestNovelEmbedding(params.embeddingClient, [params.query], params.signal))[0];
      if (!validVector(candidate)) throw new Error('查询向量无效'); queryVector = candidate;
    } catch (error) { params.signal?.throwIfAborted(); params.onEmbeddingFailure?.(error); }
  }
  const index = searchIndex(params.chunks);
  const currentOrders = params.currentChapterIds.map(id => index.order.get(id)).filter((n): n is number => n !== undefined);
  const scored = params.chunks.map((chunk, i) => {
    const order = index.order.get(chunk.chapterId)!;
    const distance = currentOrders.length ? Math.min(...currentOrders.map(current => Math.abs(current - order))) : Infinity;
    const keyword = Math.min(1, terms.filter(term => index.texts[i].includes(term)).reduce((s, term) => s + Math.max(0.08, term.length / 12), 0));
    const adjacent = distance === 0 ? 0.35 : distance === 1 ? 0.2 : 0;
    const canUseVector = Boolean(queryVector && chunk.embeddingModel === params.embeddingModel
      && (!params.embeddingIdentity || chunk.embeddingIdentity === params.embeddingIdentity)
      && chunk.embeddingDimension === queryVector.length && validVector(chunk.embedding) && chunk.embedding!.length === queryVector.length);
    const semantic = canUseVector ? Math.max(0, cosineSimilarity(queryVector!, chunk.embedding!)) : 0;
    return { chunk, score: semantic * 0.7 + keyword * 0.55 + adjacent,
      source: (canUseVector ? 'hybrid' : keyword > 0 ? 'keyword' : 'adjacent') as RetrievedNovelChunk['source'] };
  }).filter(item => item.score > 0).sort((a, b) => b.score - a.score || a.chunk.index - b.chunk.index);
  const limit = Math.max(1, Math.floor(params.limit ?? 8)); const selected = scored.slice(0, limit);
  const local = scored.find(item => params.currentChapterIds.includes(item.chunk.chapterId));
  if (local && limit >= 3 && !selected.includes(local)) selected[selected.length - 1] = local;
  return selected;
}
export function renderNovelRetrievedEvidence(items: RetrievedNovelChunk[], tokenBudget = 4000): string {
  const output: string[] = []; let used = 0;
  for (const item of items) {
    const text = `[证据-${output.length + 1}] ${item.chunk.contextPrefix} (${item.source}, ${item.score.toFixed(3)})\n章节 ${item.chunk.chapterId}，原文位置 ${item.chunk.chapterStartOffset ?? item.chunk.startOffset}\n${item.chunk.text}`;
    const cost = estimateNovelTokens(text); if (used + cost > tokenBudget) continue;
    output.push(text); used += cost;
  }
  return output.join('\n\n');
}
