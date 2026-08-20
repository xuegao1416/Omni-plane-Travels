import type { EmbeddingConfig } from '../api/client';
import type { MemorySystemConfig } from './types';

export const DEFAULT_LOCAL_EMBEDDING_MODEL = 'onnx-community/bge-small-zh-v1.5-ONNX';

export interface EmbeddingClient {
  embed(texts: string[]): Promise<number[][]>;
}

export interface EmbeddingRuntimeDependencies {
  remoteBatch?: (config: EmbeddingConfig, texts: string[]) => Promise<number[][]>;
  localBatch?: (model: string, texts: string[]) => Promise<number[][]>;
}

export interface LocalEmbeddingProgress {
  status: string;
  progress?: number;
  loaded?: number;
  total?: number;
  file?: string;
}

export type LocalEmbeddingProgressCallback = (progress: LocalEmbeddingProgress) => void;

export interface LocalEmbeddingModelMetadata {
  id: string;
  installedAt: number;
  lastUsedAt: number;
}

export interface LocalEmbeddingModelManagerDependencies {
  load?: (model: string, onProgress?: LocalEmbeddingProgressCallback) => Promise<void>;
  deleteCache?: (model: string) => Promise<void>;
  clearCache?: () => Promise<void>;
}

type FeatureExtractor = (
  texts: string[],
  options: { pooling: 'mean'; normalize: true },
) => Promise<{ tolist(): unknown }>;

const extractorCache = new Map<string, Promise<FeatureExtractor>>();
const MODEL_METADATA_KEY = 'omni-plane-travels.local-embedding-models.v1';
const memoryMetadata = new Map<string, LocalEmbeddingModelMetadata>();
const LOCAL_BATCH_SIZE = 8;

function readModelMetadata(): LocalEmbeddingModelMetadata[] {
  try {
    const raw = localStorage.getItem(MODEL_METADATA_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as unknown;
      if (Array.isArray(parsed)) return parsed.filter(item => item && typeof item.id === 'string') as LocalEmbeddingModelMetadata[];
    }
  } catch { /* fall back to an in-memory inventory in non-browser/test runtimes */ }
  return [...memoryMetadata.values()];
}

function writeModelMetadata(models: LocalEmbeddingModelMetadata[]): void {
  memoryMetadata.clear();
  for (const model of models) memoryMetadata.set(model.id, model);
  try { localStorage.setItem(MODEL_METADATA_KEY, JSON.stringify(models)); } catch { /* cache metadata is best effort */ }
}

function recordInstalledModel(id: string): void {
  const now = Date.now();
  const existing = readModelMetadata().find(model => model.id === id);
  const current = readModelMetadata().filter(model => model.id !== id);
  writeModelMetadata([...current, { id, installedAt: existing?.installedAt ?? now, lastUsedAt: now }]);
}

async function deleteBrowserCacheForModel(model: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  const { env } = await import('@huggingface/transformers');
  const cache = await caches.open(env.cacheKey);
  const keys = await cache.keys();
  let decodedModel = model;
  try { decodedModel = decodeURIComponent(model); } catch { /* model IDs are still matched in their raw form */ }
  await Promise.all(keys
    .filter(request => {
      if (request.url.includes(model)) return true;
      try { return decodeURIComponent(request.url).includes(decodedModel); } catch { return false; }
    })
    .map(request => cache.delete(request)));
}

async function clearBrowserEmbeddingCache(): Promise<void> {
  if (typeof caches === 'undefined') return;
  const { env } = await import('@huggingface/transformers');
  const cache = await caches.open(env.cacheKey);
  const keys = await cache.keys();
  await Promise.all(keys.map(request => cache.delete(request)));
}

function assertEmbeddingMatrix(value: unknown, expectedRows: number): number[][] {
  if (!Array.isArray(value) || value.length !== expectedRows) {
    throw new Error(`本地 Embedding 返回数量不匹配：期望 ${expectedRows}，实际 ${Array.isArray(value) ? value.length : 0}`);
  }
  return value.map((row, rowIndex) => {
    if (!Array.isArray(row) || row.length === 0 || row.some(item => !Number.isFinite(Number(item)))) {
      throw new Error(`本地 Embedding 第 ${rowIndex + 1} 项格式无效`);
    }
    return row.map(Number);
  });
}

async function loadLocalExtractor(model: string, onProgress?: LocalEmbeddingProgressCallback): Promise<FeatureExtractor> {
  let pending = extractorCache.get(model);
  if (!pending) {
    pending = import('@huggingface/transformers').then(async ({ pipeline }) => {
      const extractor = await pipeline('feature-extraction', model, {
        dtype: 'q8',
        progress_callback: (value: unknown) => {
          if (!value || typeof value !== 'object') return;
          const progress = value as Record<string, unknown>;
          onProgress?.({
            status: typeof progress.status === 'string' ? progress.status : 'progress',
            ...(typeof progress.progress === 'number' ? { progress: progress.progress } : {}),
            ...(typeof progress.loaded === 'number' ? { loaded: progress.loaded } : {}),
            ...(typeof progress.total === 'number' ? { total: progress.total } : {}),
            ...(typeof progress.file === 'string' ? { file: progress.file } : {}),
          });
        },
      } as never);
      return extractor as unknown as FeatureExtractor;
    }).catch(error => {
      extractorCache.delete(model);
      throw error;
    });
    extractorCache.set(model, pending);
  }
  return pending;
}

export function getInstalledLocalEmbeddingModels(): LocalEmbeddingModelMetadata[] {
  const now = Date.now();
  const known = readModelMetadata();
  const knownIds = new Set(known.map(model => model.id));
  for (const id of extractorCache.keys()) {
    if (!knownIds.has(id)) known.push({ id, installedAt: now, lastUsedAt: now });
  }
  return known.sort((a, b) => b.lastUsedAt - a.lastUsedAt).map(model => ({ ...model }));
}

export function isLocalEmbeddingModelInstalled(model: string): boolean {
  return getInstalledLocalEmbeddingModels().some(item => item.id === model.trim());
}

export async function deleteLocalEmbeddingModel(
  model: string,
  dependencies: LocalEmbeddingModelManagerDependencies = {},
): Promise<void> {
  const id = model.trim();
  if (!id) return;
  extractorCache.delete(id);
  await (dependencies.deleteCache ?? deleteBrowserCacheForModel)(id);
  writeModelMetadata(readModelMetadata().filter(item => item.id !== id));
}

export async function clearAllLocalEmbeddingModels(
  dependencies: LocalEmbeddingModelManagerDependencies = {},
): Promise<void> {
  extractorCache.clear();
  await (dependencies.clearCache ?? clearBrowserEmbeddingCache)();
  writeModelMetadata([]);
}

async function runLocalEmbedding(model: string, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const extractor = await loadLocalExtractor(model);
  recordInstalledModel(model);
  const output = await extractor(texts, { pooling: 'mean', normalize: true });
  return assertEmbeddingMatrix(output.tolist(), texts.length);
}

async function runRemoteEmbedding(config: EmbeddingConfig, texts: string[]): Promise<number[][]> {
  const { fetchEmbeddingBatch } = await import('../api/client');
  return fetchEmbeddingBatch(config, texts);
}

export function resolveEmbeddingEndpoint(
  config: Pick<MemorySystemConfig, 'vectorRuntime' | 'vectorApiUrl' | 'localEmbeddingEndpoint'>,
): string {
  if (config.vectorRuntime === 'local') return '';
  return config.vectorRuntime === 'local_endpoint'
    ? config.localEmbeddingEndpoint.trim()
    : config.vectorApiUrl.trim();
}

export function createEmbeddingClient(
  config: Pick<MemorySystemConfig,
    'vectorRuntime' | 'vectorApiUrl' | 'vectorApiKey' | 'vectorApiModel' | 'localEmbeddingModelId' | 'localEmbeddingEndpoint'>,
  dependencies: EmbeddingRuntimeDependencies = {},
): EmbeddingClient {
  const model = config.localEmbeddingModelId?.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
  if (config.vectorRuntime === 'local') {
    const localBatch = dependencies.localBatch ?? runLocalEmbedding;
    return {
      embed: async texts => {
        const embeddings: number[][] = [];
        for (let start = 0; start < texts.length; start += LOCAL_BATCH_SIZE) {
          embeddings.push(...await localBatch(model, texts.slice(start, start + LOCAL_BATCH_SIZE)));
        }
        return embeddings;
      },
    };
  }

  const remoteBatch = dependencies.remoteBatch ?? runRemoteEmbedding;
  const endpoint = config.vectorRuntime === 'local_endpoint'
    ? config.localEmbeddingEndpoint.trim()
    : config.vectorApiUrl.trim();
  return {
    embed: texts => remoteBatch({
      baseUrl: endpoint,
      apiKey: config.vectorRuntime === 'local_endpoint' ? '' : config.vectorApiKey.trim(),
      model: config.vectorRuntime === 'local_endpoint' ? model : config.vectorApiModel.trim(),
    }, texts),
  };
}

/** Downloads and initializes the model once; later calls reuse the cached pipeline. */
export async function warmLocalEmbeddingModel(
  model = DEFAULT_LOCAL_EMBEDDING_MODEL,
  dependencies: LocalEmbeddingModelManagerDependencies = {},
  onProgress?: LocalEmbeddingProgressCallback,
): Promise<void> {
  const id = model.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL;
  const loader = dependencies.load ?? (async (modelId, progress) => {
    await loadLocalExtractor(modelId, progress);
  });
  await loader(id, onProgress);
  recordInstalledModel(id);
}

export function isLocalEmbeddingModelLoaded(model = DEFAULT_LOCAL_EMBEDDING_MODEL): boolean {
  return extractorCache.has(model.trim() || DEFAULT_LOCAL_EMBEDDING_MODEL);
}
