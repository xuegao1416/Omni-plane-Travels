import { v4 as uuid } from 'uuid';
import type { ApiConfig } from '../api/types';
import type { EmbeddingClient } from '../memory/embeddingRuntime';
import {
  generateNovelEvidenceNote,
  generateNovelOverview,
  generateNovelSegmentAnalysis,
  resolveNovelArchiveIdentities,
} from './analysisClient';
import type { ParsedNovelSegmentAnalysis } from './analysisSchema';
import { compileNovelArchives, collectNovelStaticObservations } from './archiveCompiler';
import { createNovelAnalysisRequest } from './requestScheduler';
import {
  getNovelDataset,
  listNovelChunks,
  listNovelJobs,
  saveNovelChunks,
  saveNovelDatasetHeader,
  saveNovelJob,
  saveNovelSegment,
  upsertNovelChunks, saveNovelArchives, getNovelOverviewCheckpoint, saveNovelOverviewCheckpoint,
} from './novelStore';
import {
  buildNovelChunks,
  embedNovelChunks,
  renderNovelRetrievedEvidence,
  retrieveNovelChunks,
} from './semanticIndex';
import { estimateNovelTokens, hashNovelText } from './segmentation';
import type {
  NovelAnalysisJob,
  NovelChapter,
  NovelDataset,
  NovelEvidenceNote,
  NovelSegment,
  NovelStaticMaterial,
} from './types';

export interface NovelAnalysisGenerators {
  evidence(params: {
    config: ApiConfig;
    novelTitle: string;
    segment: NovelSegment;
    sourceText: string;
    chapterContext: string;
    sourceChapters?: NovelChapter[];
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
  }): Promise<NovelEvidenceNote>;
  overview(params: {
    config: ApiConfig;
    novelTitle: string;
    notes: NovelEvidenceNote[];
    compact?: boolean;
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
  }): Promise<NovelStaticMaterial>;
  segment(params: {
    config: ApiConfig;
    novelTitle: string;
    segment: NovelSegment;
    sourceText: string;
    evidenceNote: NovelEvidenceNote;
    previousEndingFacts: string[];
    retrievedEvidence: string;
    sourceChapters?: NovelChapter[];
    signal?: AbortSignal;
    onDelta?: (text: string) => void;
  }): Promise<ParsedNovelSegmentAnalysis>;
}

export interface NovelAnalysisProgress {
  embeddingStatus?: NovelAnalysisJob['embeddingStatus'];
  embeddedChunks?: number;
  totalChunks?: number;
  phaseCounts?: NovelAnalysisJob['phaseCounts'];
  requestCount?: number;
  phase: NovelAnalysisJob['phase'];
  completed: number;
  total: number;
  segmentTitle?: string;
  message: string;
  streamText?: string;
}

const defaultGenerators: NovelAnalysisGenerators = {
  evidence: generateNovelEvidenceNote,
  overview: generateNovelOverview,
  segment: generateNovelSegmentAnalysis,
};

export const NOVEL_ANALYSIS_VERSION = 4;

export function partitionNovelEvidenceNotes(notes: NovelEvidenceNote[], maxTokens = 12000): NovelEvidenceNote[][] {
  const budget = Math.max(1, Math.floor(maxTokens) || 12000);
  const groups: NovelEvidenceNote[][] = [];
  let current: NovelEvidenceNote[] = [];
  for (const note of notes) {
    const candidate = [...current, note];
    if (current.length > 0 && estimateNovelTokens(JSON.stringify(candidate)) > budget) {
      groups.push(current);
      current = [note];
    } else {
      current = candidate;
    }
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

function overviewAsEvidenceNote(material: NovelStaticMaterial): NovelEvidenceNote {
  return {
    summary: material.summary ?? '',
    facts: [...(material.settings ?? []), ...(material.rules ?? []), ...(material.relations ?? [])],
    characters: (material.characters ?? []).map(item => item.name),
    factions: (material.factions ?? []).map(item => item.name),
    locations: (material.locations ?? []).map(item => item.name),
    items: (material.items ?? []).map(item => item.name),
    events: [],
    rules: material.rules ?? [],
    relationships: material.relations ?? [],
    openThreads: [...(material.culture ?? []), ...(material.highlights ?? [])],
    evidenceRefs: [],
    staticFindings: {
      settings: material.settings ?? [], rules: material.rules ?? [], culture: material.culture ?? [],
      powerSystem: material.powerSystem ? [material.powerSystem] : [],
      economy: material.economy ? [JSON.stringify(material.economy)] : [],
      time: [material.economy?.calendar, material.economy?.startTime, material.economy?.timeSpeed].filter((item): item is string => Boolean(item)),
    },
    archives: { characters: material.characters, factions: material.factions, locations: material.locations, items: material.items },
  };
}

export function assessNovelStaticCoverage(material: NovelStaticMaterial, notes: NovelEvidenceNote[]): NovelDataset['staticCoverage'] {
  const output = {
    rules: Boolean(material.rules?.length), culture: Boolean(material.culture?.length), powerSystem: Boolean(material.powerSystem),
    economy: Boolean(material.economy?.currencyName || material.economy?.currencyDescription || material.economy?.priceLevel),
    time: Boolean(material.economy?.calendar || material.economy?.startTime || material.economy?.timeSpeed),
  };
  return Object.fromEntries(Object.entries(output).map(([key, available]) => {
    const category = key as keyof NonNullable<NovelEvidenceNote['staticFindings']>;
    const hasEvidence = notes.some(note => note.staticFindings?.[category]?.length);
    const unassessed = notes.some(note => !note.staticFindings);
    return [key, available ? 'available' : hasEvidence || unassessed ? 'missing' : 'no_evidence'];
  }));
}

/** Do not let the overview fill categories that the evidence pass explicitly found empty. */
function supportedStaticMaterial(material: NovelStaticMaterial, notes: NovelEvidenceNote[]): NovelStaticMaterial {
  if (!notes.length || notes.some(note => !note.staticFindings)) return material;
  const has = (key: keyof NonNullable<NovelEvidenceNote['staticFindings']>) => notes.some(note => note.staticFindings?.[key]?.length);
  return {
    ...material,
    rules: has('rules') ? material.rules : [],
    culture: has('culture') ? material.culture : [],
    powerSystem: has('powerSystem') ? material.powerSystem : undefined,
    economy: material.economy ? {
      currencyName: has('economy') ? material.economy.currencyName : undefined,
      currencySymbol: has('economy') ? material.economy.currencySymbol : undefined,
      currencyDescription: has('economy') ? material.economy.currencyDescription : undefined,
      priceLevel: has('economy') ? material.economy.priceLevel : undefined,
      calendar: has('time') ? material.economy.calendar : undefined,
      startTime: has('time') ? material.economy.startTime : undefined,
      timeSpeed: has('time') ? material.economy.timeSpeed : undefined,
    } : undefined,
  };
}

function segmentSource(dataset: NovelDataset, segment: NovelSegment): string {
  if (segment.sourceText?.trim()) return segment.sourceText.trim();
  const chapterIds = new Set(segment.chapterIds);
  return dataset.chapters
    .filter(chapter => chapterIds.has(chapter.id))
    .sort((left, right) => left.index - right.index)
    .map(chapter => chapter.content)
    .join('\n\n')
    .trim();
}

function chapterContext(dataset: NovelDataset, segment: NovelSegment): string {
  const chapterIds = new Set(segment.chapterIds);
  return dataset.chapters
    .filter(chapter => chapterIds.has(chapter.id))
    .map(chapter => `${chapter.id} | ${chapter.title} | ${chapter.startOffset ?? 0}-${chapter.endOffset ?? 0}`)
    .join('\n');
}

function isFatalChannelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /API\s+(?:401|402|403|404)\b|通道暂时不可用|余额不足|额度不足|insufficient_quota|model.+(?:not found|不存在)/i.test(message);
}

function progress(params: {
  callback?: (value: NovelAnalysisProgress) => void;
  job: NovelAnalysisJob;
  segmentTitle?: string;
  message: string;
  streamText?: string;
}) {
  params.callback?.({
    embeddingStatus: params.job.embeddingStatus,
    embeddedChunks: params.job.embeddedChunks,
    totalChunks: params.job.totalChunks,
    phaseCounts: params.job.phaseCounts,
    requestCount: params.job.requestCount,
    phase: params.job.phase,
    completed: params.job.completed,
    total: params.job.total,
    segmentTitle: params.segmentTitle,
    message: params.message,
    streamText: params.streamText,
  });
}

async function prepareChunks(
  dataset: NovelDataset,
  embedding: { client: EmbeddingClient; model: string; identity?: string; rateLimitMs?: number } | undefined,
  selectedChapterIds: Set<string>,
  options: { signal?: AbortSignal; onProgress?: (done: number, total: number) => void } = {},
): Promise<ReturnType<typeof buildNovelChunks>> {
  const chapters = dataset.chapters.filter(chapter => selectedChapterIds.has(chapter.id));
  const base = buildNovelChunks(dataset.id, chapters);
  const existing = await listNovelChunks(dataset.id);
  const existingByHash = new Map(existing.map(chunk => [`${chunk.chapterId}:${chunk.contentHash}`, chunk]));
  const reusable = base.map(chunk => {
    const old = existingByHash.get(`${chunk.chapterId}:${chunk.contentHash}`);
    return old ? { ...old, ...chunk } : chunk;
  });
  options.signal?.throwIfAborted();
  if (!embedding) {
    if (existing.length !== base.length || reusable.some(chunk => !chunk.embedding && !existingByHash.has(`${chunk.chapterId}:${chunk.contentHash}`))) {
      await saveNovelChunks(dataset.id, reusable);
    }
    return reusable;
  }
  await saveNovelChunks(dataset.id, reusable);
  const indexed = await embedNovelChunks(reusable, embedding.client, embedding.model, {
    identity: embedding.identity, signal: options.signal, onProgress: options.onProgress, onBatch: upsertNovelChunks, rateLimitMs: embedding.rateLimitMs,
  });
  return indexed;
}

async function getOrCreateJob(datasetId: string, startSegmentIndex: number, total: number): Promise<NovelAnalysisJob> {
  const existing = (await listNovelJobs(datasetId)).find(job => ['queued', 'running', 'paused', 'failed'].includes(job.status));
  const now = Date.now();
  return existing ? {
    ...existing,
    status: 'running',
    startSegmentIndex,
    total,
    completed: 0,
    failed: 0,
    lastError: undefined,
    updatedAt: now,
  } : {
    id: uuid(), datasetId, status: 'running', phase: 'evidence', startSegmentIndex,
    total, completed: 0, failed: 0, retryCount: 0, createdAt: now, updatedAt: now,
  };
}

export interface NovelAnalysisOptions {
  datasetId: string;
  config: ApiConfig;
  startSegmentIndex?: number;
  embedding?: { client: EmbeddingClient; model: string; identity?: string; rateLimitMs?: number };
  generators?: NovelAnalysisGenerators;
  /** Internal safety budget for hierarchical overview reduction. */
  overviewBatchTokens?: number;
  /** Explicit user action: refresh only world materials after versioned evidence extraction. */
  forceOverview?: boolean;
  /** Explicit user action: ignore reusable evidence and extract it again for every segment. */
  reExtractEvidence?: boolean;
  signal?: AbortSignal;
  onProgress?: (value: NovelAnalysisProgress) => void;
  onCheckpoint?: (dataset: NovelDataset) => void;
}

const activeRuns = new Set<string>();
export async function runNovelAnalysis(params: NovelAnalysisOptions): Promise<{ dataset: NovelDataset; job: NovelAnalysisJob; worldReady: boolean }> {
  if (activeRuns.has(params.datasetId)) throw new Error('这份小说正在拆解，请先暂停当前任务');
  activeRuns.add(params.datasetId);
  try {
    if (typeof navigator !== 'undefined' && navigator.locks) {
      return await navigator.locks.request(`novel:${params.datasetId}`, { ifAvailable: true }, async lock => {
        if (!lock) throw new Error('这份小说正在其他窗口拆解');
        return executeNovelAnalysis(params);
      });
    }
    return await executeNovelAnalysis(params);
  } finally { activeRuns.delete(params.datasetId); }
}

async function executeNovelAnalysis(params: NovelAnalysisOptions): Promise<{ dataset: NovelDataset; job: NovelAnalysisJob; worldReady: boolean }> {
  const initial = await getNovelDataset(params.datasetId);
  if (!initial) throw new Error('未找到小说数据集');
  if (!initial.segments.length) throw new Error('小说没有可分析分段');
  let generators = params.generators ?? defaultGenerators;
  const startSegmentIndex = Math.min(Math.max(0, Math.floor(params.startSegmentIndex ?? 0)), initial.segments.length - 1);
  let dataset: NovelDataset = { ...initial, segments: [...initial.segments], analysisStatus: 'processing' };
  if ((initial.analysisVersion ?? 1) < NOVEL_ANALYSIS_VERSION && initial.staticMaterial.summary && !initial.legacyStaticMaterial) {
    dataset.legacyStaticMaterial = structuredClone(initial.staticMaterial);
  }
  const total = dataset.segments.length * 2 + 1;
  let job = await getOrCreateJob(dataset.id, startSegmentIndex, total);
  // Channels already used on this dataset stay readable, so switching models keeps extracted evidence.
  const usedFingerprints = (await listNovelJobs(dataset.id)).map(item => item.configFingerprint).filter((value): value is string => Boolean(value));
  job.runId = uuid(); job.model = params.config.model;
  job.configFingerprint = hashNovelText(JSON.stringify([params.config.baseUrl, params.config.model, params.config.provider]));
  job.requestCount = 0;
  job.embeddingMode = params.embedding ? 'enhanced' : 'basic';
  job.embeddingStatus = params.embedding ? 'preparing' : 'off';
  job.phaseCounts = { evidence: { completed: 0, total: dataset.segments.length, failed: 0 }, segments: { completed: 0, total: dataset.segments.length, failed: 0 }, overview: { completed: 0, total: 1, failed: 0 } };
  const request = createNovelAnalysisRequest((result, message) => {
    if (message === 'request') job.requestCount = (job.requestCount ?? 0) + 1;
    if (result?.usage) job.tokenUsage = { prompt: (job.tokenUsage?.prompt ?? 0) + result.usage.promptTokens, completion: (job.tokenUsage?.completion ?? 0) + result.usage.completionTokens };
    if (message && message !== 'request') progress({ callback: params.onProgress, job, message });
  });
  if (!params.generators) generators = {
    evidence: options => generateNovelEvidenceNote({ ...options, request }),
    overview: options => generateNovelOverview({ ...options, request }),
    segment: options => generateNovelSegmentAnalysis({ ...options, request }),
  };
  await saveNovelDatasetHeader(dataset);
  await saveNovelJob(job);

  const assertNotAborted = () => {
    if (params.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  let pendingWrite: Promise<void> = Promise.resolve();
  const writeJob = async (patch: Partial<NovelAnalysisJob>) => {
    job = { ...job, ...patch, updatedAt: Date.now() };
    job.phaseCounts!.evidence = { completed: dataset.segments.filter(s => s.evidenceStatus === 'completed' || s.evidenceNotes).length, failed: dataset.segments.filter(s => s.evidenceStatus === 'failed').length, total: dataset.segments.length };
    job.phaseCounts!.segments = { completed: dataset.segments.filter(s => s.status === 'completed').length, failed: dataset.segments.filter(s => s.status === 'failed' && s.evidenceNotes).length, total: dataset.segments.length };
    const snapshot = structuredClone(job);
    pendingWrite = pendingWrite.then(() => saveNovelJob(snapshot));
    await pendingWrite;
    params.onCheckpoint?.({ ...dataset, segments: [...dataset.segments] });
  };

  try {
    let chunks;
    try {
      const selectedChapterIds = new Set(dataset.segments.flatMap(segment => segment.chapterIds));
      chunks = await prepareChunks(dataset, params.embedding, selectedChapterIds, { signal: params.signal, onProgress: (done, total) => {
        job.embeddedChunks = done; job.totalChunks = total;
        progress({ callback: params.onProgress, job: { ...job, phase: 'index' }, message: `索引 ${done}/${total}` });
      } });
      job.embeddingStatus = params.embedding ? 'enhanced' : 'off';
    } catch (error) {
      assertNotAborted();
      const selectedChapterIds = new Set(dataset.segments.flatMap(segment => segment.chapterIds));
      chunks = await prepareChunks(dataset, undefined, selectedChapterIds);
      job.embeddingMode = 'basic';
      job.embeddingStatus = job.embeddedChunks ? 'partial' : 'degraded';
      progress({ callback: params.onProgress, job, message: `Embedding 不可用，已降级为基础召回：${error instanceof Error ? error.message : String(error)}` });
    }

    await writeJob({ phase: 'evidence' });
    for (let index = 0; index < dataset.segments.length; index += 1) {
      assertNotAborted();
      let segment = dataset.segments[index];
      const sourceText = segmentSource(dataset, segment);
      const context = chapterContext(dataset, segment);
      // Evidence extraction is grounded in the original text, not in the channel, so switching
      // models keeps it; the former per-channel identity stays readable so stored notes are reused.
      const evidenceInputHash = hashNovelText(JSON.stringify({ sourceText, chapterContext: context, analysisVersion: NOVEL_ANALYSIS_VERSION }));
      const reusableHashes = new Set([evidenceInputHash]);
      for (const fingerprint of [...usedFingerprints, job.configFingerprint]) {
        if (fingerprint) reusableHashes.add(hashNovelText(JSON.stringify({ sourceText, chapterContext: context, analysisVersion: NOVEL_ANALYSIS_VERSION, model: fingerprint })));
      }
      if (!params.reExtractEvidence && segment.evidenceNotes && segment.analysisVersion === NOVEL_ANALYSIS_VERSION && segment.evidenceInputHash && reusableHashes.has(segment.evidenceInputHash)) {
        job.completed += 1;
        continue;
      }
      progress({ callback: params.onProgress, job, segmentTitle: segment.title, message: '正在提取章节证据' });
      try {
        segment = {
          ...segment,
          status: 'processing',
          evidenceStatus: 'processing',
          error: undefined,
          analysisInputHash: undefined,
          evidenceNotes: undefined,
          evidenceInputHash: undefined,
          updatedAt: Date.now(),
        };
        dataset.segments[index] = segment;
        await saveNovelSegment(segment);
        if (params.generators) job.requestCount = (job.requestCount ?? 0) + 1;
        const evidenceNotes = await generators.evidence({
          config: params.config,
          novelTitle: dataset.title,
          segment,
          sourceText,
          chapterContext: context,
          sourceChapters: dataset.chapters.filter(chapter => segment.chapterIds.includes(chapter.id)),
          signal: params.signal,
          onDelta: streamText => progress({ callback: params.onProgress, job, segmentTitle: segment.title, message: '正在提取章节证据', streamText }),
        });
        assertNotAborted();
        segment = { ...segment, evidenceNotes, evidenceStatus: 'completed', evidenceInputHash, analysisVersion: NOVEL_ANALYSIS_VERSION, updatedAt: Date.now() };
        dataset.segments[index] = segment;
        await saveNovelSegment(segment);
        await writeJob({ completed: job.completed + 1, currentSegmentId: segment.id });
      } catch (error) {
        if (isFatalChannelError(error) || (error instanceof Error && error.name === 'AbortError')) throw error;
        segment = { ...segment, status: 'failed', evidenceStatus: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() };
        dataset.segments[index] = segment;
        await saveNovelSegment(segment);
        await writeJob({ failed: job.failed + 1, lastError: segment.error, currentSegmentId: segment.id });
      }
    }

    assertNotAborted();
    const notes = dataset.segments.map(segment => segment.evidenceNotes).filter(Boolean) as NovelEvidenceNote[];
    const overviewInputHash = hashNovelText(JSON.stringify({ notes, analysisVersion: NOVEL_ANALYSIS_VERSION, configFingerprint: job.configFingerprint }));
    const compileOverview = async () => {
    await writeJob({ phase: 'overview' });
    if (notes.length > 0 && (params.forceOverview || dataset.overviewInputHash !== overviewInputHash)) {
      const archives = await compileNovelArchives(dataset.id, dataset.segments, !params.generators ? {
        resolve: async group => {
          assertNotAborted();
          const inputHash = hashNovelText(`identity-v1:${JSON.stringify(group)}`);
          const cached = await getNovelOverviewCheckpoint(dataset.id, inputHash);
          if (cached?.material.settings) return JSON.parse(cached.material.settings[0]) as string[][];
          return resolveNovelArchiveIdentities(params.config, group, params.signal, request);
        },
        onCheckpoint: async (group, resolution) => {
          const inputHash = hashNovelText(`identity-v1:${JSON.stringify(group)}`);
          await saveNovelOverviewCheckpoint({ id: `${dataset.id}:${inputHash}`, datasetId: dataset.id, inputHash, material: { settings: [JSON.stringify(resolution)] } });
        },
      } : {});
      assertNotAborted();
      await saveNovelArchives(dataset.id, archives.records);
      dataset = { ...dataset, staticMaterial: { ...dataset.staticMaterial, ...archives.material } };
      await saveNovelDatasetHeader(dataset);
      const groups = partitionNovelEvidenceNotes(notes, params.overviewBatchTokens);
      let overviewNotes = notes;
      if (groups.length > 1) {
        await writeJob({ total: dataset.segments.length * 2 + groups.length + 1 });
        const reduced: NovelEvidenceNote[] = [];
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          assertNotAborted();
          progress({ callback: params.onProgress, job, message: `正在归并全书证据 ${groupIndex + 1}/${groups.length}` });
          const inputHash = hashNovelText(JSON.stringify({ notes: groups[groupIndex], analysisVersion: NOVEL_ANALYSIS_VERSION }));
          const checkpoint = !params.forceOverview && (await getNovelOverviewCheckpoint(dataset.id, inputHash) ?? dataset.overviewCheckpoints?.find(item => item.inputHash === inputHash));
          const partial = checkpoint ? checkpoint.material : await generators.overview({
            config: params.config,
            novelTitle: `${dataset.title}（证据分区 ${groupIndex + 1}/${groups.length}）`,
            notes: groups[groupIndex],
            compact: true,
            signal: params.signal,
            onDelta: streamText => progress({ callback: params.onProgress, job, message: `正在归并全书证据 ${groupIndex + 1}/${groups.length}`, streamText }),
          });
          assertNotAborted();
          await saveNovelOverviewCheckpoint({ id: `${dataset.id}:${inputHash}`, datasetId: dataset.id, inputHash, material: partial });
          reduced.push(overviewAsEvidenceNote(partial));
          await writeJob({ completed: job.completed + 1 });
        }
        overviewNotes = reduced;
      }
      // Reduce recursively instead of sending all first-level summaries in one unbounded request.
      const overviewBudget = Math.max(1000, params.overviewBatchTokens ?? 12000);
      for (let level = 0; estimateNovelTokens(JSON.stringify(overviewNotes)) > overviewBudget; level++) {
        if (level >= 8) throw new Error('总览归并仍超出预算，已保留完整档案，请减小分析段后重试');
        const beforeSize = estimateNovelTokens(JSON.stringify(overviewNotes));
        const smaller: NovelEvidenceNote[] = [];
        for (const batch of partitionNovelEvidenceNotes(overviewNotes, overviewBudget)) {
          assertNotAborted();
          const inputHash = hashNovelText(`overview-level:${job.configFingerprint}:${NOVEL_ANALYSIS_VERSION}:${JSON.stringify(batch)}`);
          const cached = !params.forceOverview && await getNovelOverviewCheckpoint(dataset.id, inputHash);
          const material = cached ? cached.material : await generators.overview({ config: params.config, novelTitle: dataset.title, notes: batch, compact: true, signal: params.signal });
          await saveNovelOverviewCheckpoint({ id: `${dataset.id}:${inputHash}`, datasetId: dataset.id, inputHash, material });
          smaller.push(overviewAsEvidenceNote(material));
        }
        if (estimateNovelTokens(JSON.stringify(smaller)) >= beforeSize) throw new Error('模型未能缩短世界总览，完整档案已保留');
        overviewNotes = smaller;
      }
      progress({ callback: params.onProgress, job, message: '正在生成全书总览' });
      const generatedMaterial = await generators.overview({
          config: params.config,
          novelTitle: dataset.title,
          notes: overviewNotes,
          compact: true,
          signal: params.signal,
          onDelta: streamText => progress({ callback: params.onProgress, job, message: '正在生成全书总览', streamText }),
        });
      const observations = collectNovelStaticObservations(dataset.segments);
      const staticMaterial = supportedStaticMaterial({ ...generatedMaterial, ...archives.material,
        settings: [...new Set([...(generatedMaterial.settings ?? []), ...observations.settings])],
        rules: [...new Set([...(generatedMaterial.rules ?? []), ...observations.rules])],
        culture: [...new Set([...(generatedMaterial.culture ?? []), ...observations.culture])],
        powerSystem: [...new Set([generatedMaterial.powerSystem ?? '', ...observations.powerSystem])].filter(Boolean).join('\n') || undefined,
      }, notes);
      assertNotAborted();
      dataset = { ...dataset, staticMaterial, overviewInputHash, overviewError: undefined,
        staticCoverage: assessNovelStaticCoverage(staticMaterial, notes), analysisVersion: NOVEL_ANALYSIS_VERSION };
      await saveNovelDatasetHeader(dataset);
      await writeJob({ completed: job.completed + 1 });
      job.phaseCounts!.overview = { completed: 1, total: 1, failed: 0 };
    } else if (dataset.overviewInputHash === overviewInputHash) {
      job.completed += 1;
    }
    };

    const compileSegments = async () => {
    await writeJob({ phase: 'segments' });
    for (let index = 0; index < dataset.segments.length; index += 1) {
      assertNotAborted();
      let segment = dataset.segments[index];
      if (!segment.evidenceNotes) continue;
      const previous = dataset.segments[index - 1];
      const analysisInputHash = hashNovelText(JSON.stringify({
        source: segmentSource(dataset, segment),
        evidence: segment.evidenceNotes,
        previousEndingFacts: previous?.endingFacts ?? [],
        contextGap: Boolean(previous && previous.status !== 'completed'),
        model: job.configFingerprint,
        retrieval: job.embeddingMode === 'enhanced' ? params.embedding?.identity ?? params.embedding?.model : 'basic',
      }));
      if (segment.status === 'completed' && segment.analysisVersion === NOVEL_ANALYSIS_VERSION && segment.analysisInputHash === analysisInputHash) {
        job.completed += 1;
        continue;
      }
      progress({ callback: params.onProgress, job, segmentTitle: segment.title, message: '正在编译正式分段' });
      try {
        const query = [
          ...segment.evidenceNotes.characters,
          ...segment.evidenceNotes.locations,
          ...segment.evidenceNotes.facts,
          ...segment.evidenceNotes.openThreads,
        ].join(' ');
        let queryDegraded = false;
        const retrieved = await retrieveNovelChunks({
          query: query || segment.title,
          chunks,
          currentChapterIds: segment.chapterIds,
          embeddingClient: params.embedding?.client,
          embeddingModel: job.embeddingMode === 'enhanced' ? params.embedding?.model : undefined,
          embeddingIdentity: params.embedding?.identity,
          signal: params.signal,
          onEmbeddingFailure: () => { job.embeddingStatus = 'degraded'; queryDegraded = true; },
          limit: 8,
        });
        if (params.generators) job.requestCount = (job.requestCount ?? 0) + 1;
        const generated = await generators.segment({
          config: params.config,
          novelTitle: dataset.title,
          segment,
          sourceText: segmentSource(dataset, segment),
          evidenceNote: segment.evidenceNotes,
          previousEndingFacts: previous?.endingFacts ?? [],
          retrievedEvidence: renderNovelRetrievedEvidence(retrieved),
          sourceChapters: dataset.chapters.filter(chapter => dataset.segments.some(candidate => candidate.chapterIds.includes(chapter.id))),
          signal: params.signal,
          onDelta: streamText => progress({ callback: params.onProgress, job, segmentTitle: segment.title, message: '正在编译正式分段', streamText }),
        });
        assertNotAborted();
        segment = {
          ...segment,
          ...generated,
          contextGap: Boolean(previous && previous.status !== 'completed'),
          retrievedEvidenceIds: retrieved.map(item => item.chunk.id),
          events: generated.events.map((event, eventIndex) => ({ ...event, id: event.id ?? `${segment.id}:event:${eventIndex}` })),
          status: 'completed',
          error: undefined,
          analysisInputHash: queryDegraded ? undefined : analysisInputHash,
          analysisVersion: NOVEL_ANALYSIS_VERSION,
          updatedAt: Date.now(),
        };
        dataset.segments[index] = segment;
        await saveNovelSegment(segment);
        await writeJob({ completed: job.completed + 1, currentSegmentId: segment.id });
      } catch (error) {
        if (isFatalChannelError(error) || (error instanceof Error && error.name === 'AbortError')) throw error;
        segment = { ...segment, status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() };
        dataset.segments[index] = segment;
        await saveNovelSegment(segment);
        await writeJob({ failed: job.failed + 1, lastError: segment.error, currentSegmentId: segment.id });
      }
    }
    };

    // Exactly two LLM lanes: serial static reduction and serial dependent segments.
    // Await both even on failure so no branch writes after this run has returned.
    const branches = await Promise.allSettled([compileOverview(), compileSegments()]);
    const overviewResult = branches[0];
    if (overviewResult.status === 'rejected') {
      dataset = { ...dataset, overviewInputHash: undefined, overviewError: overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason) };
      await saveNovelDatasetHeader(dataset);
      await writeJob({ failed: job.failed + 1, lastError: dataset.overviewError });
    }
    for (const result of branches) {
      if (result.status === 'rejected' && (isFatalChannelError(result.reason) || result.reason?.name === 'AbortError')) throw result.reason;
    }
    if (branches[1].status === 'rejected') throw branches[1].reason;

    const worldReady = Boolean(dataset.overviewInputHash === overviewInputHash && dataset.staticMaterial.summary?.trim() && dataset.segments[startSegmentIndex]?.status === 'completed');
    const selectedChapters = new Set(dataset.segments.flatMap(s => s.chapterIds)).size;
    const totalChapters = dataset.chapters.filter(c => c.included !== false).length;
    const allCompleted = worldReady && dataset.segments.every(segment => segment.status === 'completed') && !dataset.overviewError
      && selectedChapters === totalChapters && !dataset.importIssues?.some(issue => issue.severity === 'error');
    dataset = { ...dataset, analysisStatus: allCompleted ? 'ready' : worldReady ? 'partial' : 'failed', coverage: {
      selectedChapters, totalChapters, evidenceCompleted: notes.length, segmentsCompleted: dataset.segments.filter(s => s.status === 'completed').length, totalSegments: dataset.segments.length,
    } };
    await saveNovelDatasetHeader(dataset);
    await writeJob({
      phase: 'completed',
      status: job.failed > 0 ? 'failed' : 'completed',
      completed: job.failed === 0 ? job.total : job.completed,
      currentSegmentId: undefined,
    });
    progress({ callback: params.onProgress, job, message: job.failed ? '任务已结束，失败单元可重试' : '所选范围分析完成，结果已保存' });
    const stored = await getNovelDataset(dataset.id);
    return { dataset: stored ?? dataset, job, worldReady };
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError';
    const worldReady = Boolean(dataset.staticMaterial.summary?.trim() && dataset.segments[startSegmentIndex]?.status === 'completed');
    dataset = { ...dataset, analysisStatus: worldReady ? 'partial' : aborted ? 'draft' : 'failed' };
    await saveNovelDatasetHeader(dataset);
    await writeJob({ status: aborted ? 'paused' : 'failed', lastError: aborted ? undefined : (error instanceof Error ? error.message : String(error)) });
    progress({ callback: params.onProgress, job, message: aborted ? '已暂停并保存检查点' : `任务已停止：${job.lastError}` });
    if (aborted) {
      const stored = await getNovelDataset(dataset.id);
      return { dataset: stored ?? dataset, job, worldReady };
    }
    throw error;
  }
}
