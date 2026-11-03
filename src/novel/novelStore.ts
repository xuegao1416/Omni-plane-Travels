import {
  getDB,
  NOVEL_CHAPTERS_STORE,
  NOVEL_CHUNKS_STORE,
  NOVEL_DATASETS_STORE,
  NOVEL_JOBS_STORE,
  NOVEL_SEGMENTS_STORE,
  NOVEL_ARCHIVES_STORE, NOVEL_CHECKPOINTS_STORE, NOVEL_SOURCES_STORE, NOVEL_MATERIALS_STORE,
} from '../storage/db';
import type {
  NovelAnalysisJob,
  NovelChapter,
  NovelChunk,
  NovelDataset,
  NovelSegment,
  NovelArchiveRecord, NovelOverviewCheckpoint,
} from './types';
import { applyGeneratedMaterial } from './materialDocument';
import { hashNovelText } from './segmentation';
import { beginNovelPaidProductDeletion, assertNovelPaidProductEpoch, novelPaidProductEpoch, releaseNovelPaidProducts, retainNovelPaidProducts, validateNovelPaidProduct, listNovelPaidProducts, type NovelPaidProduct } from './paidProducts';

type StoredNovelDataset = Omit<NovelDataset, 'chapters' | 'segments'> & {
  /** Legacy prototype records may still contain embedded children. */
  chapters?: NovelChapter[];
  segments?: NovelSegment[];
};

function clone<T>(value: T): T {
  return structuredClone(value);
}

function withDatasetId<T extends { datasetId?: string }>(item: T, datasetId: string): T & { datasetId: string } {
  return { ...clone(item), datasetId };
}

async function getByDataset<T>(storeName: string, datasetId: string): Promise<T[]> {
  if (!datasetId) return [];
  const db = await getDB();
  const tx = db.transaction(storeName, 'readonly');
  const values = await tx.store.index('datasetId').getAll(datasetId) as T[];
  await tx.done;
  return values.map(clone);
}

async function replaceDatasetChildren<T extends { id: string; datasetId?: string }>(
  storeName: string,
  datasetId: string,
  items: T[],
): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  const keys = await tx.store.index('datasetId').getAllKeys(datasetId);
  await Promise.all(keys.map(key => tx.store.delete(key)));
  await Promise.all(items.map(item => tx.store.put(withDatasetId(item, datasetId))));
  await tx.done;
}

export async function listNovelChapters(datasetId: string): Promise<NovelChapter[]> {
  const chapters = await getByDataset<NovelChapter>(NOVEL_CHAPTERS_STORE, datasetId);
  return chapters.sort((left, right) => left.index - right.index);
}

export async function listNovelSegments(datasetId: string): Promise<NovelSegment[]> {
  const segments = await getByDataset<NovelSegment>(NOVEL_SEGMENTS_STORE, datasetId);
  return segments.sort((left, right) => left.index - right.index);
}

export async function listNovelChunks(datasetId: string): Promise<NovelChunk[]> {
  const chunks = await getByDataset<NovelChunk>(NOVEL_CHUNKS_STORE, datasetId);
  return chunks.sort((left, right) => left.index - right.index);
}

export async function listNovelJobs(datasetId: string): Promise<NovelAnalysisJob[]> {
  const jobs = await getByDataset<NovelAnalysisJob>(NOVEL_JOBS_STORE, datasetId);
  return jobs.sort((left, right) => right.updatedAt - left.updatedAt);
}

async function rehydrateDataset(stored: StoredNovelDataset): Promise<NovelDataset> {
  const [partitionedChapters, partitionedSegments] = await Promise.all([
    listNovelChapters(stored.id),
    listNovelSegments(stored.id),
  ]);
  const chapters = partitionedChapters.length > 0 ? partitionedChapters : (stored.chapters ?? []);
  const segments = partitionedSegments.length > 0 ? partitionedSegments : (stored.segments ?? []);
  const source = await (await getDB()).get(NOVEL_SOURCES_STORE, stored.id);
  const material = await (await getDB()).get(NOVEL_MATERIALS_STORE, stored.id);
  return clone({ ...stored, ...(material ?? {}), ...(source ? { rawText: source.rawText } : {}), staticMaterial: material?.staticMaterial ?? stored.staticMaterial ?? {}, chapters, segments } as NovelDataset);
}

export async function listNovelDatasets(): Promise<NovelDataset[]> {
  const db = await getDB();
  const values = await db.getAll(NOVEL_DATASETS_STORE) as StoredNovelDataset[];
  const datasets = values.map(value => ({ ...value, rawText: undefined,
    chapterCount: value.chapterCount ?? value.chapters?.length ?? 0,
    segmentCount: value.segmentCount ?? value.segments?.length ?? 0,
    chapters: [], segments: [], staticMaterial: {}, overviewCheckpoints: undefined,
  } as NovelDataset));
  return datasets.sort((left, right) => right.updatedAt - left.updatedAt);
}

export async function getNovelDataset(id: string): Promise<NovelDataset | undefined> {
  if (!id) return undefined;
  const db = await getDB();
  const value = await db.get(NOVEL_DATASETS_STORE, id) as StoredNovelDataset | undefined;
  return value ? rehydrateDataset(value) : undefined;
}

/** Gameplay needs three analyses, never the full chapter collection. */
export async function getNovelRuntimeWindow(id: string, cursor = 0): Promise<NovelDataset | undefined> {
  if (!id) return undefined;
  const db = await getDB();
  const stored = await db.get(NOVEL_DATASETS_STORE, id) as StoredNovelDataset | undefined;
  if (!stored) return undefined;
  const index = Math.max(0, Math.floor(cursor) || 0);
  const range = IDBKeyRange.bound([id, Math.max(0, index - 1)], [id, index + 1]);
  const partitioned = await db.getAllFromIndex(NOVEL_SEGMENTS_STORE, 'datasetId_index', range) as NovelSegment[];
  const segments = partitioned.length ? partitioned : (stored.segments ?? []).filter(segment => Math.abs(segment.index - index) <= 1);
  const { rawText: _rawText, chapters: _chapters, segments: _segments, ...header } = stored;
  return {
    ...header, chapters: [],
    segments: segments.map(segment => {
      const { sourceText: _source, evidenceNotes: _notes, ...analysis } = segment;
      return analysis;
    }).sort((left, right) => left.index - right.index),
  };
}

function datasetHeader(dataset: NovelDataset) {
  const now = Date.now();
  const { chapters: _chapters, segments: _segments, rawText: _rawText, staticMaterial: _material, legacyStaticMaterial: _legacy, materialDocument: _document, overviewCheckpoints: _checkpoints, ...header } = dataset;
  return {
    ...clone(header),
    chapterCount: dataset.chapters.length,
    segmentCount: dataset.segments.length,
    completedSegmentCount: dataset.segments.filter(segment => segment.status === 'completed').length,
    schemaVersion: Math.max(2, Number(dataset.schemaVersion) || 2),
    title: dataset.title.trim() || '未命名小说',
    analysisStatus: dataset.analysisStatus ?? 'draft',
    updatedAt: now,
    createdAt: Number.isFinite(dataset.createdAt) ? dataset.createdAt : now,
  };
}

export async function saveNovelDatasetHeader(dataset: NovelDataset, options: { includeMaterial?: boolean } = {}): Promise<void> {
  const tx = (await getDB()).transaction([NOVEL_DATASETS_STORE, NOVEL_MATERIALS_STORE], 'readwrite');
  await tx.objectStore(NOVEL_DATASETS_STORE).put(datasetHeader(dataset));
  if (options.includeMaterial !== false) await tx.objectStore(NOVEL_MATERIALS_STORE).put({ id: dataset.id, staticMaterial: clone(dataset.staticMaterial), materialDocument: dataset.materialDocument, legacyStaticMaterial: dataset.legacyStaticMaterial, overviewCheckpoints: dataset.overviewCheckpoints });
  await tx.done;
}

/** Analysis owns results; authors own source, title and overrides. */
export function novelAnalysisSourceIdentity(dataset: NovelDataset): string {
  return hashNovelText(JSON.stringify([dataset.sourceVersion, dataset.rawText,
    dataset.chapters.map(c => [c.id, c.index, c.title, c.content, c.included, c.startOffset, c.endOffset]),
    dataset.taskPreparation ? [dataset.taskPreparation.mode, dataset.taskPreparation.startChapterIndex, dataset.taskPreparation.endChapterIndex] : null,
    dataset.segments.map(s => [s.id, s.index, s.title, s.chapterIds, s.sourceText, s.inputHash])]));
}

export async function saveNovelAnalysisResult(dataset: NovelDataset, sourceIdentity: string,
  options: { generatedMaterial?: NovelDataset['staticMaterial']; segment?: NovelSegment; archives?: NovelArchiveRecord[]; signal?: AbortSignal } = {}): Promise<NovelDataset> {
  options.signal?.throwIfAborted();
  const tx = (await getDB()).transaction([NOVEL_DATASETS_STORE, NOVEL_MATERIALS_STORE, NOVEL_SOURCES_STORE, NOVEL_CHAPTERS_STORE, NOVEL_SEGMENTS_STORE, NOVEL_ARCHIVES_STORE], 'readwrite');
  try {
    const previous = await tx.objectStore(NOVEL_DATASETS_STORE).get(dataset.id) as StoredNovelDataset | undefined;
    const chapters = await tx.objectStore(NOVEL_CHAPTERS_STORE).index('datasetId').getAll(dataset.id) as NovelChapter[];
    const segments = await tx.objectStore(NOVEL_SEGMENTS_STORE).index('datasetId').getAll(dataset.id) as NovelSegment[];
    const source = await tx.objectStore(NOVEL_SOURCES_STORE).get(dataset.id);
    const material = await tx.objectStore(NOVEL_MATERIALS_STORE).get(dataset.id);
    const current = previous && { ...previous, ...(material ?? {}), rawText: source?.rawText ?? previous.rawText,
      chapters: (chapters.length ? chapters : previous.chapters ?? []).sort((a, b) => a.index - b.index),
      segments: (segments.length ? segments : previous.segments ?? []).sort((a: NovelSegment, b: NovelSegment) => a.index - b.index) } as NovelDataset;
    options.signal?.throwIfAborted();
    if (!current || novelAnalysisSourceIdentity(current) !== sourceIdentity) throw new Error('小说原文或处理范围已修改，旧任务没有覆盖新资料');
    const next = options.generatedMaterial ? applyGeneratedMaterial(current, options.generatedMaterial) : current;
    const { analysisStatus, analysisVersion, coverage, staticCoverage, overviewInputHash, overviewError, preparation } = dataset;
    const accepted = { ...next, analysisStatus, analysisVersion, coverage, staticCoverage, overviewInputHash, overviewError, preparation, updatedAt: Date.now() };
    if (options.segment) {
      await tx.objectStore(NOVEL_SEGMENTS_STORE).put(clone(options.segment));
      accepted.segments = accepted.segments.map(s => s.id === options.segment!.id ? clone(options.segment!) : s);
    }
    if (options.archives) {
      const store = tx.objectStore(NOVEL_ARCHIVES_STORE);
      for (const key of await store.index('datasetId').getAllKeys(dataset.id)) await store.delete(key);
      for (const row of options.archives) await store.put(withDatasetId(row, dataset.id));
    }
    await tx.objectStore(NOVEL_DATASETS_STORE).put(datasetHeader(accepted));
    if (options.generatedMaterial) await tx.objectStore(NOVEL_MATERIALS_STORE).put({ ...material, id: dataset.id,
      staticMaterial: clone(next.staticMaterial), materialDocument: clone(next.materialDocument), legacyStaticMaterial: dataset.legacyStaticMaterial ?? next.legacyStaticMaterial });
    await tx.done;
    // Parallel analysis lanes retain their own completed units, and the latest author fields.
    return { ...accepted, segments: dataset.segments };
  } catch (error) {
    try { tx.abort(); } catch { /* Already complete or aborted. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function saveNovelDataset(dataset: NovelDataset): Promise<void> {
  const tx = (await getDB()).transaction([NOVEL_DATASETS_STORE, NOVEL_MATERIALS_STORE, NOVEL_SOURCES_STORE, NOVEL_CHAPTERS_STORE, NOVEL_SEGMENTS_STORE], 'readwrite');
  await tx.objectStore(NOVEL_DATASETS_STORE).put(datasetHeader(dataset));
  await tx.objectStore(NOVEL_MATERIALS_STORE).put({ id: dataset.id, staticMaterial: clone(dataset.staticMaterial), materialDocument: dataset.materialDocument, legacyStaticMaterial: dataset.legacyStaticMaterial, overviewCheckpoints: dataset.overviewCheckpoints });
  if (dataset.rawText !== undefined) await tx.objectStore(NOVEL_SOURCES_STORE).put({ id: dataset.id, rawText: dataset.rawText });
  for (const [name, rows] of [[NOVEL_CHAPTERS_STORE, dataset.chapters], [NOVEL_SEGMENTS_STORE, dataset.segments]] as const) {
    const store = tx.objectStore(name);
    for (const key of await store.index('datasetId').getAllKeys(dataset.id)) await store.delete(key);
    for (const row of rows) await store.put(withDatasetId(row, dataset.id));
  }
  await tx.done;
}

/** Restore source, author overlays, progress and paid responses together, or change nothing. */
export function novelRecoveryRevision(dataset: NovelDataset): string {
  const canonical = (value: unknown): unknown => Array.isArray(value) ? value.map(canonical)
    : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, canonical(v)])) : value;
  return JSON.stringify(canonical([dataset.title, novelAnalysisSourceIdentity(dataset), dataset.staticMaterial,
    dataset.materialDocument, dataset.legacyStaticMaterial, dataset.segments, dataset.coverage, dataset.overviewInputHash, dataset.updatedAt]));
}

export async function restoreNovelRecoveryState(dataset: NovelDataset, jobs: NovelAnalysisJob[], products: NovelPaidProduct[], expectedRevision?: string, chunks: NovelChunk[] = []): Promise<void> {
  const epoch = novelPaidProductEpoch(dataset.id);
  await assertNovelPaidProductEpoch(dataset.id, epoch);
  const existing = new Map((await listNovelPaidProducts(dataset.id)).map(product => [product.id, product]));
  for (const product of products) if (existing.has(product.id) && JSON.stringify(existing.get(product.id)!.value) !== JSON.stringify(product.value)) throw new Error('付费成果身份冲突，已有资料未修改');
  const tx = (await getDB()).transaction([NOVEL_DATASETS_STORE, NOVEL_MATERIALS_STORE, NOVEL_SOURCES_STORE,
    NOVEL_CHAPTERS_STORE, NOVEL_SEGMENTS_STORE, NOVEL_JOBS_STORE, NOVEL_CHUNKS_STORE, NOVEL_ARCHIVES_STORE, NOVEL_CHECKPOINTS_STORE], 'readwrite');
  try {
    const previous = await tx.objectStore(NOVEL_DATASETS_STORE).get(dataset.id);
    if (previous) {
      const material = await tx.objectStore(NOVEL_MATERIALS_STORE).get(dataset.id);
      const source = await tx.objectStore(NOVEL_SOURCES_STORE).get(dataset.id);
      const chapters = await tx.objectStore(NOVEL_CHAPTERS_STORE).index('datasetId').getAll(dataset.id) as NovelChapter[];
      const segments = await tx.objectStore(NOVEL_SEGMENTS_STORE).index('datasetId').getAll(dataset.id) as NovelSegment[];
      const current = { ...previous, ...(material ?? {}), ...(source ? { rawText: source.rawText } : {}), staticMaterial: material?.staticMaterial ?? previous.staticMaterial ?? {},
        chapters: (chapters.length ? chapters : previous.chapters ?? []).sort((a: NovelChapter, b: NovelChapter) => a.index - b.index),
        segments: (segments.length ? segments : previous.segments ?? []).sort((a: NovelSegment, b: NovelSegment) => a.index - b.index) } as NovelDataset;
      if (expectedRevision === undefined || novelRecoveryRevision(current) !== expectedRevision) throw new Error('已有资料或资料再次修改，未覆盖；请重新选择恢复');
    }
    for (const product of products) {
      validateNovelPaidProduct(product, dataset.id);
      const stored = await tx.objectStore(NOVEL_CHECKPOINTS_STORE).get(product.id);
      if (stored && JSON.stringify(stored.value) !== JSON.stringify(product.value)) throw new Error('付费成果身份冲突，已有资料未修改');
    }
    await tx.objectStore(NOVEL_DATASETS_STORE).put(datasetHeader(dataset));
    await tx.objectStore(NOVEL_MATERIALS_STORE).put({ id: dataset.id, staticMaterial: clone(dataset.staticMaterial), materialDocument: clone(dataset.materialDocument), legacyStaticMaterial: dataset.legacyStaticMaterial, overviewCheckpoints: dataset.overviewCheckpoints });
    await tx.objectStore(NOVEL_SOURCES_STORE).put({ id: dataset.id, rawText: dataset.rawText });
    for (const [name, rows] of [[NOVEL_CHAPTERS_STORE, dataset.chapters], [NOVEL_SEGMENTS_STORE, dataset.segments], [NOVEL_JOBS_STORE, jobs], [NOVEL_CHUNKS_STORE, chunks], [NOVEL_ARCHIVES_STORE, []]] as const) {
      const store = tx.objectStore(name);
      for (const key of await store.index('datasetId').getAllKeys(dataset.id)) await store.delete(key);
      for (const row of rows) await store.put(withDatasetId(row, dataset.id));
    }
    for (const product of products) await tx.objectStore(NOVEL_CHECKPOINTS_STORE).put(clone(product));
    await tx.done;
    releaseNovelPaidProducts(products);
  } catch (error) {
    try { tx.abort(); } catch { /* Already failed. */ }
    await tx.done.catch(() => undefined); if (error instanceof DOMException && error.name === 'QuotaExceededError') {
      await assertNovelPaidProductEpoch(dataset.id, epoch);
      retainNovelPaidProducts(products);
      throw new Error('恢复保存失败，完整付费成果已保留在当前窗口，可重试或导出备份');
    }
    throw error;
  }
}

export async function saveNovelChapter(chapter: NovelChapter): Promise<void> {
  if (!chapter.datasetId) throw new Error('保存小说章节失败：缺少 datasetId');
  const db = await getDB();
  await db.put(NOVEL_CHAPTERS_STORE, clone(chapter));
}

export async function saveNovelSegment(segment: NovelSegment): Promise<void> {
  if (!segment.datasetId) throw new Error('保存小说分段失败：缺少 datasetId');
  const db = await getDB();
  await db.put(NOVEL_SEGMENTS_STORE, clone(segment));
}

export async function saveNovelChunks(datasetId: string, chunks: NovelChunk[]): Promise<void> {
  await replaceDatasetChildren(NOVEL_CHUNKS_STORE, datasetId, chunks);
}

/** Persist successful embedding batches without replacing the full index. */
export async function upsertNovelChunks(chunks: NovelChunk[]): Promise<void> {
  const tx = (await getDB()).transaction(NOVEL_CHUNKS_STORE, 'readwrite');
  for (const chunk of chunks) await tx.store.put(clone(chunk));
  await tx.done;
}

export async function saveNovelArchives(datasetId: string, records: NovelArchiveRecord[]): Promise<void> {
  await replaceDatasetChildren(NOVEL_ARCHIVES_STORE, datasetId, records);
}

export async function listNovelArchives(datasetId: string): Promise<NovelArchiveRecord[]> {
  return getByDataset(NOVEL_ARCHIVES_STORE, datasetId);
}

export async function getNovelOverviewCheckpoint(datasetId: string, inputHash: string): Promise<NovelOverviewCheckpoint | undefined> {
  return (await getDB()).get(NOVEL_CHECKPOINTS_STORE, `${datasetId}:${inputHash}`);
}

export async function saveNovelOverviewCheckpoint(checkpoint: NovelOverviewCheckpoint): Promise<void> {
  await (await getDB()).put(NOVEL_CHECKPOINTS_STORE, clone(checkpoint));
}

export async function getNovelPlotRange(datasetId: string, start: number, end: number): Promise<NovelSegment[]> {
  const range = IDBKeyRange.bound([datasetId, Math.max(0, start)], [datasetId, Math.max(start, end)]);
  return (await getDB()).getAllFromIndex(NOVEL_SEGMENTS_STORE, 'datasetId_index', range);
}

export async function saveNovelJob(job: NovelAnalysisJob, options: { requireDataset?: boolean } = {}): Promise<void> {
  if (!job.datasetId) throw new Error('保存小说任务失败：缺少 datasetId');
  const db = await getDB();
  const tx = db.transaction([NOVEL_JOBS_STORE, NOVEL_DATASETS_STORE], 'readwrite');
  try {
    if (options.requireDataset && !await tx.objectStore(NOVEL_DATASETS_STORE).get(job.datasetId)) throw new Error('小说资料已删除，任务未重新写入');
    await tx.objectStore(NOVEL_JOBS_STORE).put(clone(job));
    await tx.done;
  } catch (error) {
    try { tx.abort(); } catch { /* Already failed. */ }
    await tx.done.catch(() => undefined);
    throw error;
  }
}

export async function deleteNovelDataset(id: string): Promise<void> {
  if (!id) return;
  const finishDeletion = beginNovelPaidProductDeletion(id);
  let committed = false;
  try {
    const children = [NOVEL_CHAPTERS_STORE, NOVEL_SEGMENTS_STORE, NOVEL_CHUNKS_STORE,
      NOVEL_JOBS_STORE, NOVEL_ARCHIVES_STORE, NOVEL_CHECKPOINTS_STORE];
    const tx = (await getDB()).transaction([NOVEL_DATASETS_STORE, NOVEL_SOURCES_STORE, NOVEL_MATERIALS_STORE, ...children], 'readwrite');
    try {
      for (const name of [NOVEL_DATASETS_STORE, NOVEL_SOURCES_STORE, NOVEL_MATERIALS_STORE]) await tx.objectStore(name).delete(id);
      for (const name of children) {
        const store = tx.objectStore(name);
        for (const key of await store.index('datasetId').getAllKeys(id)) await store.delete(key);
      }
      await tx.done;
      committed = true;
    } catch (error) {
      try { tx.abort(); } catch { /* Transaction already failed. */ }
      await tx.done.catch(() => undefined);
      throw error;
    }
  } finally { finishDeletion(committed); }
}
