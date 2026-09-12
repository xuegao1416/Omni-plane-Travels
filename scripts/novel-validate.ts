/** Reproducible developer validation. Credentials come only from environment variables. */
import 'fake-indexeddb/auto';
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createEmbeddingClient } from '../src/memory/embeddingRuntime';
import { probeNovelEmbedding } from '../src/novel/semanticIndex';
import { createNovelAnalysisRequest } from '../src/novel/requestScheduler';
import { createNovelDatasetFromBytes } from '../src/novel/plainText';
import { importNovelDataset } from '../src/novel/datasetImport';
import { getNovelDataset, saveNovelDataset } from '../src/novel/novelStore';
import { runNovelAnalysis } from '../src/novel/analysisRunner';
import { createWorldFromNovel } from '../src/novel/worldFactory';
import type { ApiConfig } from '../src/api/types';
import type { NovelDataset, NovelSegment } from '../src/novel/types';

const argv = process.argv.slice(2);
// The app reads browser preferences; validation deliberately uses an isolated empty store.
const preferences = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: {
  getItem: (key: string) => preferences.get(key) ?? null, setItem: (key: string, value: string) => preferences.set(key, value),
  removeItem: (key: string) => preferences.delete(key), clear: () => preferences.clear(), key: (index: number) => [...preferences.keys()][index] ?? null,
  get length() { return preferences.size; },
} });
const arg = (name: string, fallback = '') => { const i = argv.indexOf(name); return i < 0 ? fallback : argv[i + 1] ?? fallback; };
const mode = arg('--mode', 'probe');
const out = resolve(arg('--output', 'tmp/novel-validation'));
mkdirSync(out, { recursive: true });
const config: ApiConfig = { baseUrl: process.env.NOVEL_API_URL ?? 'https://gcli.ggchan.dev/v1', apiKey: process.env.NOVEL_API_KEY ?? '',
  model: process.env.NOVEL_API_MODEL ?? 'gemini-3.5-flash', provider: 'custom', temperature: 0.2, maxTokens: 16384, stream: true };
const embeddingModel = process.env.NOVEL_EMBEDDING_MODEL ?? 'novel-bge-m3';
const embeddingEndpoint = process.env.NOVEL_EMBEDDING_URL ?? 'http://127.0.0.1:1234/v1';
const client = createEmbeddingClient({ vectorRuntime: 'local_endpoint', vectorApiUrl: '', vectorApiKey: '', vectorApiModel: '', localEmbeddingModelId: embeddingModel, localEmbeddingEndpoint: embeddingEndpoint });
const controller = new AbortController(); process.once('SIGINT', () => controller.abort());
const report: Record<string, unknown> = { mode, generatedAt: new Date().toISOString(), model: config.model };
if (mode === 'probe') {
  const started = performance.now();
  report.embedding = { ...await probeNovelEmbedding(client, controller.signal), elapsedMs: Math.round(performance.now() - started), model: embeddingModel };
  if (!config.apiKey) throw new Error('NOVEL_API_KEY is required for Flash validation');
  const request = createNovelAnalysisRequest();
  const messages = [{ role: 'user' as const, content: '只返回 JSON 对象 {"ok":true,"kind":"novel-analysis"}，不返回其他文本。' }];
  for (const stream of [false, true]) {
    const response = await request({ ...config, stream }, messages, { responseFormat: 'json', maxTokens: 512, onDelta: () => {}, signal: controller.signal });
    const parsed = JSON.parse(response.text.replace(/^```(?:json)?\s*|\s*```$/g, ''));
    if (parsed.ok !== true) throw new Error('Flash JSON probe failed');
    report[stream ? 'streaming' : 'completion'] = { elapsedMs: response.elapsed, finishReason: response.finishReason, usage: response.usage, valid: true };
  }
} else {
  const source = arg('--source'); if (!source) throw new Error('--source TXT path is required');
  const stateFile = join(out, 'source.json'), segmentDir = join(out, 'segments'), headerFile = join(out, 'header.json');
  mkdirSync(segmentDir, { recursive: true });
  let dataset: NovelDataset;
  if (existsSync(stateFile)) {
    dataset = importNovelDataset(JSON.parse(readFileSync(stateFile, 'utf8')));
    if (existsSync(headerFile)) dataset = { ...dataset, ...JSON.parse(readFileSync(headerFile, 'utf8')) };
    const saved = new Map(readdirSync(segmentDir).filter(f => f.endsWith('.json')).map(file => { const segment = JSON.parse(readFileSync(join(segmentDir, file), 'utf8')) as NovelSegment; return [segment.id, segment]; }));
    dataset.segments = dataset.segments.map(segment => saved.get(segment.id) ?? segment);
  } else {
    dataset = createNovelDatasetFromBytes('长篇功能验证', readFileSync(source));
    const limit = Number(arg('--limit', '3')); if (limit > 0) dataset.segments = dataset.segments.slice(0, limit);
    writeFileSync(stateFile, JSON.stringify(dataset));
  }
  await saveNovelDataset(dataset);
  report.source = { chapters: dataset.chapters.length, characters: dataset.rawTextLength, selectedSegments: dataset.segments.length, encoding: dataset.encoding, importIssues: dataset.importIssues?.length ?? 0 };
  const versions = new Map<string, number>();
  let lastPhase = '';
  const result = await runNovelAnalysis({ datasetId: dataset.id, config, signal: controller.signal,
    embedding: mode === 'enhanced' ? { client, model: embeddingModel, identity: `${embeddingEndpoint}:${embeddingModel}` } : undefined,
    onProgress: progress => { if (lastPhase !== `${progress.phase}:${progress.completed}`) { lastPhase = `${progress.phase}:${progress.completed}`; console.log(JSON.stringify({ phase: progress.phase, completed: progress.completed, total: progress.total, message: progress.message })); } },
    onCheckpoint: snapshot => {
      for (const segment of snapshot.segments) if (versions.get(segment.id) !== segment.updatedAt) { writeFileSync(join(segmentDir, `${segment.id}.json`), JSON.stringify(segment)); versions.set(segment.id, segment.updatedAt ?? 0); }
      const { rawText: _raw, chapters: _chapters, segments: _segments, ...header } = snapshot;
      writeFileSync(headerFile, JSON.stringify(header));
    },
  });
  report.job = result.job; report.worldReady = result.worldReady;
  report.coverage = result.dataset.coverage;
  report.failedSegments = result.dataset.segments.filter(s => s.status === 'failed').map(s => ({ index: s.index, error: s.error }));
  if (result.worldReady) {
    const world = createWorldFromNovel((await getNovelDataset(dataset.id))!);
    report.worldEntries = world.worldBookEntries?.length;
    writeFileSync(join(out, 'world.json'), JSON.stringify(world, null, 2));
  }
  if (result.job.status === 'failed') process.exitCode = 1;
}
writeFileSync(join(out, 'report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
