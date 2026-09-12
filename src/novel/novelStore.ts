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
  const values = await db.getAllFromIndex(storeName, 'datasetId', datasetId) as T[];
  return values.map(clone);
}

async function deleteByDataset(storeName: string, datasetId: string): Promise<void> {
  const db = await getDB();
  const tx = db.transaction(storeName, 'readwrite');
  const keys = await tx.store.index('datasetId').getAllKeys(datasetId);
  await Promise.all(keys.map(key => tx.store.delete(key)));
  await tx.done;
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
  const { chapters: _chapters, segments: _segments, rawText: _rawText, staticMaterial: _material, legacyStaticMaterial: _legacy, overviewCheckpoints: _checkpoints, ...header } = dataset;
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
  if (options.includeMaterial !== false) await tx.objectStore(NOVEL_MATERIALS_STORE).put({ id: dataset.id, staticMaterial: clone(dataset.staticMaterial), legacyStaticMaterial: dataset.legacyStaticMaterial, overviewCheckpoints: dataset.overviewCheckpoints });
  await tx.done;
}

export async function saveNovelDataset(dataset: NovelDataset): Promise<void> {
  const tx = (await getDB()).transaction([NOVEL_DATASETS_STORE, NOVEL_MATERIALS_STORE, NOVEL_SOURCES_STORE, NOVEL_CHAPTERS_STORE, NOVEL_SEGMENTS_STORE], 'readwrite');
  await tx.objectStore(NOVEL_DATASETS_STORE).put(datasetHeader(dataset));
  await tx.objectStore(NOVEL_MATERIALS_STORE).put({ id: dataset.id, staticMaterial: clone(dataset.staticMaterial), legacyStaticMaterial: dataset.legacyStaticMaterial, overviewCheckpoints: dataset.overviewCheckpoints });
  if (dataset.rawText !== undefined) await tx.objectStore(NOVEL_SOURCES_STORE).put({ id: dataset.id, rawText: dataset.rawText });
  for (const [name, rows] of [[NOVEL_CHAPTERS_STORE, dataset.chapters], [NOVEL_SEGMENTS_STORE, dataset.segments]] as const) {
    const store = tx.objectStore(name);
    for (const key of await store.index('datasetId').getAllKeys(dataset.id)) await store.delete(key);
    for (const row of rows) await store.put(withDatasetId(row, dataset.id));
  }
  await tx.done;
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

export async function saveNovelJob(job: NovelAnalysisJob): Promise<void> {
  if (!job.datasetId) throw new Error('保存小说任务失败：缺少 datasetId');
  const db = await getDB();
  await db.put(NOVEL_JOBS_STORE, clone(job));
}

export async function deleteNovelDataset(id: string): Promise<void> {
  if (!id) return;
  const db = await getDB();
  await db.delete(NOVEL_DATASETS_STORE, id);
  await Promise.all([
    deleteByDataset(NOVEL_CHAPTERS_STORE, id),
    deleteByDataset(NOVEL_SEGMENTS_STORE, id),
    deleteByDataset(NOVEL_CHUNKS_STORE, id),
    deleteByDataset(NOVEL_JOBS_STORE, id),
    deleteByDataset(NOVEL_ARCHIVES_STORE, id),
    deleteByDataset(NOVEL_CHECKPOINTS_STORE, id),
    db.delete(NOVEL_SOURCES_STORE, id),
    db.delete(NOVEL_MATERIALS_STORE, id),
  ]);
}
