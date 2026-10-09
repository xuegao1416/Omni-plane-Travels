import { v4 as uuid } from 'uuid';
import { obtainNovelProduct, novelProductInputHash } from './paidProducts';
import type { ApiConfig } from '../api/types';
import { applyNovelAnalysisPreset, novelPresetFingerprint, readNovelAnalysisPreset, type NovelAnalysisPreset } from './analysisPresets';
import type { EmbeddingClient } from '../memory/embeddingRuntime';
import {
  generateNovelPreparationBatch,
  generateNovelEvidenceNote,
  generateNovelOverview,
  generateNovelSegmentAnalysis,
  resolveNovelArchiveIdentities,
} from './analysisClient';
import type { ParsedNovelSegmentAnalysis } from './analysisSchema';
import { compileNovelArchives, collectNovelStaticObservations } from './archiveCompiler';
import { applyGeneratedMaterial, novelGeneratedMaterial } from './materialDocument';
import { createNovelAnalysisRequest } from './requestScheduler';
import {
  buildNovelTaskPlan,
  NOVEL_ANALYSIS_VERSION,
  novelChapterContext,
  novelAnalysisChannel,
  novelEvidenceInputHash,
  novelEvidenceReusable,
  novelSegmentSource,
  novelStoryInputHash,
} from './taskPlan';
import {
  getNovelDataset,
  listNovelChunks,
  listNovelJobs,
  saveNovelChunks,
  saveNovelAnalysisResult, novelAnalysisSourceIdentity,
  saveNovelJob,
  upsertNovelChunks, getNovelOverviewCheckpoint,
} from './novelStore';
import {
  buildNovelChunks,
  embedNovelChunks,
  renderNovelRetrievedEvidence,
  retrieveNovelChunks,
} from './semanticIndex';
import { mergeNovelEvidence, mergeNovelStories, type NovelRequestBatch, type NovelBatchArtifact } from './preparationModel';
import { estimateNovelTokens, hashNovelText } from './segmentation';
import type {
  NovelAnalysisGoal,
  NovelAnalysisJob,
  NovelChapter,
  NovelDataset,
  NovelEvidenceNote,
  NovelSegment,
  NovelStaticMaterial, NovelArchiveRecord,
} from './types';

export interface NovelAnalysisGenerators {
  prepareBatch?(params: { config: ApiConfig; novelTitle: string; batch: NovelRequestBatch; sourceChapters: NovelChapter[];
    signal?: AbortSignal; onDelta?: (text: string) => void }): Promise<NovelBatchArtifact>;
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
  prepareBatch: generateNovelPreparationBatch,
  evidence: generateNovelEvidenceNote,
  overview: generateNovelOverview,
  segment: generateNovelSegmentAnalysis,
};

export { NOVEL_ANALYSIS_VERSION };

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

async function getOrCreateJob(datasetId: string, startSegmentIndex: number, total: number, goal: NovelAnalysisGoal): Promise<NovelAnalysisJob> {
  const existing = (await listNovelJobs(datasetId)).find(job => (job.goal ?? 'full') === goal && ['queued', 'running', 'paused', 'failed'].includes(job.status));
  const now = Date.now();
  return existing ? {
    ...existing,
    status: 'running',
    goal,
    startSegmentIndex,
    total,
    completed: 0,
    failed: 0,
    lastError: undefined,
    updatedAt: now,
  } : {
    id: uuid(), datasetId, status: 'running', phase: 'evidence', goal, startSegmentIndex,
    total, completed: 0, failed: 0, retryCount: 0, createdAt: now, updatedAt: now,
  };
}

export interface NovelAnalysisOptions {
  datasetId: string;
  config: ApiConfig;
  preset?: NovelAnalysisPreset;
  startSegmentIndex?: number;
  embedding?: { client: EmbeddingClient; model: string; identity?: string; rateLimitMs?: number };
  generators?: NovelAnalysisGenerators;
  /** Internal safety budget for hierarchical overview reduction. */
  overviewBatchTokens?: number;
  inputBudget?: number;
  /** Explicit user action: refresh only world materials after versioned evidence extraction. */
  forceOverview?: boolean;
  /** Explicit user action: ignore reusable evidence and extract it again for every segment. */
  reExtractEvidence?: boolean;
  /** 'background' stops after world material; plot compilation stays available later. */
  goal?: NovelAnalysisGoal;
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
  const preset = readNovelAnalysisPreset(params.preset);
  const presetFingerprint = novelPresetFingerprint(preset);
  const initial = await getNovelDataset(params.datasetId);
  if (!initial) throw new Error('未找到小说数据集');
  if (!initial.segments.length) throw new Error('小说没有可分析分段');
  let generators = params.generators ?? defaultGenerators;
  const startSegmentIndex = Math.min(Math.max(0, Math.floor(params.startSegmentIndex ?? 0)), initial.segments.length - 1);
  let dataset: NovelDataset = { ...initial, segments: [...initial.segments], analysisStatus: 'processing' };
  if ((initial.analysisVersion ?? 1) < NOVEL_ANALYSIS_VERSION && initial.staticMaterial.summary && !initial.legacyStaticMaterial) {
    dataset.legacyStaticMaterial = structuredClone(initial.staticMaterial);
  }
  const sourceIdentity = novelAnalysisSourceIdentity(initial);
  const goal: NovelAnalysisGoal = params.goal ?? 'full';
  const total = goal === 'full' ? dataset.segments.length * 2 + 1 : dataset.segments.length + 1;
  let job = await getOrCreateJob(dataset.id, startSegmentIndex, total, goal);
  const forceOverview = Boolean(params.forceOverview || job.overviewRefreshPending);
  job.overviewRefreshPending = forceOverview;
  if (params.forceOverview || params.reExtractEvidence) job.refreshOperationId = uuid();
  const refreshIdentity = job.refreshOperationId ? [{ refreshOperationId: job.refreshOperationId }] : [];
  // Channels already used on this dataset stay readable, so switching models keeps extracted evidence.
  const usedFingerprints = (await listNovelJobs(dataset.id)).map(item => item.configFingerprint).filter((value): value is string => Boolean(value));
  job.runId = uuid(); job.model = params.config.model;
  job.configFingerprint = novelAnalysisChannel(params.config, preset)!;
  job.requestCount = 0;
  job.embeddingMode = params.embedding ? 'enhanced' : 'basic';
  job.embeddingStatus = params.embedding ? 'preparing' : 'off';
  job.phaseCounts = { evidence: { completed: 0, total: dataset.segments.length, failed: 0 }, segments: { completed: 0, total: dataset.segments.length, failed: 0 }, overview: { completed: 0, total: 1, failed: 0 } };
  const transport = createNovelAnalysisRequest((result, message) => {
    if (message === 'request') job.requestCount = (job.requestCount ?? 0) + 1;
    if (result?.usage) job.tokenUsage = { prompt: (job.tokenUsage?.prompt ?? 0) + result.usage.promptTokens, completion: (job.tokenUsage?.completion ?? 0) + result.usage.completionTokens };
    if (message && message !== 'request') progress({ callback: params.onProgress, job, message });
  });
  const request: typeof transport = async (config, messages, options) => {
    const preparedMessages = applyNovelAnalysisPreset(messages, preset);
    return obtainNovelProduct({ datasetId: dataset.id, kind: 'overview',
    inputHash: await novelProductInputHash(['request', NOVEL_ANALYSIS_VERSION, config.baseUrl, config.model, config.provider,
      config.reasoningEffort, config.temperature, config.topP, config.maxTokens, preparedMessages,
      options.temperature, options.maxTokens, options.topP, options.responseFormat,
      ...(presetFingerprint ? [{ preset: presetFingerprint }] : []), ...refreshIdentity]) },
    () => transport(config, preparedMessages, options), { signal: options.signal, refresh: false });
  };
  if (!params.generators) generators = {
    prepareBatch: options => generateNovelPreparationBatch({ ...options, request }),
    evidence: options => generateNovelEvidenceNote({ ...options, request }),
    overview: options => generateNovelOverview({ ...options, request }),
    segment: options => generateNovelSegmentAnalysis({ ...options, request }),
  };
  const unpaid = generators;
  const paid = async <T>(kind: 'evidence' | 'overview' | 'story', input: unknown, generate: () => Promise<T>, refresh = false) =>
    obtainNovelProduct({ datasetId: dataset.id, kind, inputHash: await novelProductInputHash([NOVEL_ANALYSIS_VERSION, job.configFingerprint, input, ...refreshIdentity]) },
      generate, { signal: params.signal, refresh: refreshIdentity.length ? false : refresh });
  if (params.generators) generators = {
    ...(unpaid.prepareBatch ? { prepareBatch: (options: Parameters<NonNullable<NovelAnalysisGenerators['prepareBatch']>>[0]) => paid('evidence', ['batch', options.novelTitle, options.batch.parts, options.sourceChapters.map(c => [c.id, c.title, c.content])], () => unpaid.prepareBatch!(options), params.reExtractEvidence) } : {}),
    evidence: options => paid('evidence', [options.novelTitle, options.segment.id, options.sourceText, options.chapterContext, options.sourceChapters?.map(c => [c.id, c.title, c.content])], () => unpaid.evidence(options), params.reExtractEvidence),
    overview: options => paid('overview', [options.novelTitle, options.notes, options.compact], () => unpaid.overview(options), forceOverview),
    segment: options => paid('story', [options.novelTitle, options.segment.id, options.sourceText, options.evidenceNote, options.previousEndingFacts, options.retrievedEvidence, options.sourceChapters?.map(c => [c.id, c.title, c.content])], () => unpaid.segment(options)),
  };
  const combined = Boolean(generators.prepareBatch);
  const plan = buildNovelTaskPlan(dataset, { goal, config: params.config, preset, channels: usedFingerprints, inputBudget: params.inputBudget,
    forceOverview: forceOverview, reExtractEvidence: params.reExtractEvidence,
    retrieval: params.embedding?.identity ?? params.embedding?.model ?? 'basic' });
  const activePartIds = new Set(plan.batches.flatMap(batch => batch.parts.map(part => part.id)));
  const batchArtifacts = new Map((params.reExtractEvidence ? [] : dataset.preparation?.batches ?? []).filter(batch => batch.presetFingerprint === presetFingerprint && batch.sources?.every(source => plan.units.some(unit => unit.id === source.unitId && unit.sourceHash === source.sourceHash))).map(batch => [batch.batchId, batch]));
  const partNotes = new Map([...batchArtifacts.values()].flatMap(batch => batch.parts.filter(part => activePartIds.has(part.partId)).map(part => [part.partId, part.evidence] as const)));
  const saveHeader = async (generatedMaterial?: NovelStaticMaterial, archives?: NovelArchiveRecord[]) => {
    dataset = await saveNovelAnalysisResult(dataset, sourceIdentity, { generatedMaterial, archives });
  };
  const saveSegment = (segment: NovelSegment) => saveNovelAnalysisResult(dataset, sourceIdentity, { segment, signal: params.signal });
  await saveHeader();
  await saveNovelJob(job, { requireDataset: true });

  const assertNotAborted = () => {
    if (params.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  };
  let pendingWrite: Promise<void> = Promise.resolve();
  const writeJob = async (patch: Partial<NovelAnalysisJob>) => {
    job = { ...job, ...patch, updatedAt: Date.now() };
    job.phaseCounts!.evidence = { completed: dataset.segments.filter(s => s.evidenceStatus === 'completed' || s.evidenceNotes).length, failed: dataset.segments.filter(s => s.evidenceStatus === 'failed').length, total: dataset.segments.length };
    job.phaseCounts!.segments = { completed: dataset.segments.filter(s => s.status === 'completed').length, failed: dataset.segments.filter(s => s.status === 'failed' && s.evidenceNotes).length, total: dataset.segments.length };
    const snapshot = structuredClone(job);
    pendingWrite = pendingWrite.then(() => saveNovelJob(snapshot, { requireDataset: true }));
    await pendingWrite;
    params.onCheckpoint?.({ ...dataset, segments: [...dataset.segments] });
  };

  try {
    let chunks: ReturnType<typeof buildNovelChunks> = [];
    if (goal === 'full') try {
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
    if (combined) {
      if (params.reExtractEvidence || dataset.segments.some(segment => segment.evidenceNotes && !novelEvidenceReusable(dataset, segment, usedFingerprints, presetFingerprint))) {
        dataset.preparation = { version: 1, batches: [...batchArtifacts.values()] };
        for (let index = 0; index < dataset.segments.length; index++) {
          if (!params.reExtractEvidence && novelEvidenceReusable(dataset, dataset.segments[index], usedFingerprints, presetFingerprint)) continue;
          const segment = { ...dataset.segments[index], status: 'pending' as const, evidenceStatus: 'pending' as const,
            evidenceNotes: undefined, evidenceInputHash: undefined, analysisInputHash: undefined, error: undefined };
          dataset.segments[index] = segment; await saveSegment(segment);
        }
        await saveHeader();
      }
      for (const batch of plan.batches) {
        assertNotAborted();
        const missing = batch.parts.filter(part => !partNotes.has(part.id) && (params.reExtractEvidence || !novelEvidenceReusable(dataset, dataset.segments.find(segment => segment.id === part.unitId)!, usedFingerprints, presetFingerprint)));
        if (!missing.length && batch.evidenceReusable) { job.completed += batch.parts.length; continue; }
        progress({ callback: params.onProgress, job, segmentTitle: batch.parts[0]?.title, message: '正在准备原文证据与背景资料' });
        try {
          if (missing.length) {
            const inputHash = hashNovelText(JSON.stringify(missing.map(part => part.inputHash)));
            const requestBatch = { ...batch, id: `${dataset.id}:batch:${inputHash}`, parts: missing,
              chapterIds: [...new Set(missing.map(part => part.range.chapterId))] };
            if (params.generators) job.requestCount = (job.requestCount ?? 0) + 1;
            const result = await generators.prepareBatch!({ config: params.config, novelTitle: dataset.title, batch: requestBatch,
              sourceChapters: dataset.chapters.filter(chapter => requestBatch.chapterIds.includes(chapter.id)), signal: params.signal,
              onDelta: streamText => progress({ callback: params.onProgress, job, message: '正在准备背景资料', streamText }) });
            assertNotAborted();
            // Reject incomplete injected capabilities as well as malformed production responses.
            if (result.parts.length !== missing.length || new Set(result.parts.map(part => part.partId)).size !== missing.length
              || result.parts.some(part => !missing.some(source => source.id === part.partId))) throw new Error('原文证据窗口不完整或重复，不能接纳批次');
            batchArtifacts.set(result.batchId, { ...result, presetFingerprint, sources: [...new Set(missing.map(part => part.unitId))].map(unitId => ({ unitId, sourceHash: plan.units.find(unit => unit.id === unitId)!.sourceHash })) });
            for (const part of result.parts) partNotes.set(part.partId, part.evidence);
          }
          dataset.preparation = { version: 1, batches: [...batchArtifacts.values()] };
          await saveHeader();
          for (let index = 0; index < dataset.segments.length; index++) {
            const segment = dataset.segments[index];
            if (!params.reExtractEvidence && novelEvidenceReusable(dataset, segment, usedFingerprints, presetFingerprint)) continue;
            const parts = plan.batches.flatMap(batch => batch.parts).filter(part => part.unitId === segment.id);
            if (!parts.length || !parts.every(part => partNotes.has(part.id))) continue;
            const accepted = { ...segment, status: 'pending' as const, error: undefined, analysisInputHash: undefined,
              evidenceNotes: mergeNovelEvidence(parts.map(part => partNotes.get(part.id)!)), evidenceStatus: 'completed' as const,
              evidenceInputHash: novelEvidenceInputHash(dataset, segment, undefined, presetFingerprint), analysisVersion: NOVEL_ANALYSIS_VERSION, updatedAt: Date.now() };
            dataset.segments[index] = accepted;
            await saveSegment(accepted);
          }
          await writeJob({ completed: dataset.segments.filter(segment => segment.evidenceNotes).length });
        } catch (error) {
          if (isFatalChannelError(error) || (error instanceof Error && error.name === 'AbortError')) throw error;
          for (const part of batch.parts) {
            const index = dataset.segments.findIndex(segment => segment.id === part.unitId);
            const segment = dataset.segments[index];
            if (segment.evidenceNotes) continue;
            const failed = { ...segment, status: 'failed' as const, evidenceStatus: 'failed' as const, error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() };
            dataset.segments[index] = failed; await saveSegment(failed);
          }
          await writeJob({ failed: job.failed + 1, lastError: error instanceof Error ? error.message : String(error) });
        }
      }
    } else {
    for (let index = 0; index < dataset.segments.length; index += 1) {
      assertNotAborted();
      let segment = dataset.segments[index];
      const sourceText = novelSegmentSource(dataset, segment);
      const context = novelChapterContext(dataset, segment);
      // Evidence extraction is grounded in the original text, not in the channel, so switching
      // models keeps it; the former per-channel identity stays readable so stored notes are reused.
      const evidenceInputHash = novelEvidenceInputHash(dataset, segment, undefined, presetFingerprint);
      const priorChannels = [...usedFingerprints, job.configFingerprint].filter((value): value is string => Boolean(value));
      if (!params.reExtractEvidence && novelEvidenceReusable(dataset, segment, [job.configFingerprint, ...priorChannels], presetFingerprint)) {
        job.completed += 1;
        continue;
      }
      progress({ callback: params.onProgress, job, segmentTitle: segment.title, message: '正在提取章节证据' });
      try {
        segment = {
          ...segment,
          // A background run never enters the plot lane, so keep the stale unit pending instead of claiming work in flight.
          status: goal === 'background' ? 'pending' : 'processing',
          evidenceStatus: 'processing',
          error: undefined,
          analysisInputHash: undefined,
          evidenceNotes: undefined,
          evidenceInputHash: undefined,
          updatedAt: Date.now(),
        };
        dataset.segments[index] = segment;
        await saveSegment(segment);
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
        await saveSegment(segment);
        await writeJob({ completed: job.completed + 1, currentSegmentId: segment.id });
      } catch (error) {
        if (isFatalChannelError(error) || (error instanceof Error && error.name === 'AbortError')) throw error;
        segment = { ...segment, status: 'failed', evidenceStatus: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() };
        dataset.segments[index] = segment;
        await saveSegment(segment);
        await writeJob({ failed: job.failed + 1, lastError: segment.error, currentSegmentId: segment.id });
      }
    }

    }

    assertNotAborted();
    const notes = dataset.segments.map(segment => segment.evidenceNotes).filter(Boolean) as NovelEvidenceNote[];
    const overviewInputHash = hashNovelText(JSON.stringify({ notes, analysisVersion: NOVEL_ANALYSIS_VERSION, configFingerprint: job.configFingerprint }));
    const compileOverview = async () => {
    await writeJob({ phase: 'overview' });
    if (combined && !forceOverview && notes.length > 0 && dataset.overviewInputHash !== overviewInputHash) {
      const archives = await compileNovelArchives(dataset.id, dataset.segments);
      const observations = collectNovelStaticObservations(dataset.segments);
      const materials = [...batchArtifacts.values()].map(batch => batch.material);
      const generated: NovelStaticMaterial = { ...archives.material,
        summary: [...new Set(materials.map(material => material.summary).filter(Boolean))].join('\n') || notes.map(note => note.summary).join('\n'),
        settings: [...new Set([...materials.flatMap(material => material.settings ?? []), ...observations.settings])],
        rules: [...new Set([...materials.flatMap(material => material.rules ?? []), ...observations.rules])],
        culture: [...new Set([...materials.flatMap(material => material.culture ?? []), ...observations.culture])],
        relations: [...new Set(materials.flatMap(material => material.relations ?? []))],
        powerSystem: [...new Set([...materials.map(material => material.powerSystem ?? ''), ...observations.powerSystem])].filter(Boolean).join('\n') || undefined,
        economy: materials.reduce<NonNullable<NovelStaticMaterial['economy']>>((merged, material) => ({ ...merged, ...material.economy }), {}),
      };
      const merged = supportedStaticMaterial(generated, notes);
      dataset = applyGeneratedMaterial({ ...dataset, overviewInputHash, overviewError: undefined, analysisVersion: NOVEL_ANALYSIS_VERSION }, merged);
      dataset.staticCoverage = assessNovelStaticCoverage(dataset.staticMaterial, notes);
      await saveHeader(merged, archives.records);
      job.phaseCounts!.overview = { completed: 1, total: 1, failed: 0 };
      await writeJob({ completed: job.completed + 1, overviewRefreshPending: false });
      return;
    }
    if (notes.length > 0 && (forceOverview || dataset.overviewInputHash !== overviewInputHash)) {
      const archives = await compileNovelArchives(dataset.id, dataset.segments, !params.generators ? {
        resolve: async group => {
          assertNotAborted();
          const inputHash = hashNovelText(`identity-v1:${presetFingerprint ? `${presetFingerprint}:` : ''}${JSON.stringify(group)}`);
          const cached = await getNovelOverviewCheckpoint(dataset.id, inputHash);
          if (cached?.material.settings) return JSON.parse(cached.material.settings[0]) as string[][];
          return resolveNovelArchiveIdentities(params.config, group, params.signal, request);
        },
      } : {});
      assertNotAborted();
      dataset = applyGeneratedMaterial(dataset, { ...novelGeneratedMaterial(dataset), ...archives.material });
      await saveHeader(novelGeneratedMaterial(dataset), archives.records);
      const groups = partitionNovelEvidenceNotes(notes, params.overviewBatchTokens);
      let overviewNotes = notes;
      if (groups.length > 1) {
        await writeJob({ total: goal === 'full' ? dataset.segments.length * 2 + groups.length + 1 : dataset.segments.length + groups.length + 1 });
        const reduced: NovelEvidenceNote[] = [];
        for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
          assertNotAborted();
          progress({ callback: params.onProgress, job, message: `正在归并全书证据 ${groupIndex + 1}/${groups.length}` });
          const inputHash = hashNovelText(JSON.stringify({ notes: groups[groupIndex], analysisVersion: NOVEL_ANALYSIS_VERSION, ...(presetFingerprint ? { preset: presetFingerprint } : {}) }));
          const checkpoint = !forceOverview && (await getNovelOverviewCheckpoint(dataset.id, inputHash) ?? dataset.overviewCheckpoints?.find(item => item.inputHash === inputHash));
          const partial = checkpoint ? checkpoint.material : await generators.overview({
            config: params.config,
            novelTitle: `${dataset.title}（证据分区 ${groupIndex + 1}/${groups.length}）`,
            notes: groups[groupIndex],
            compact: true,
            signal: params.signal,
            onDelta: streamText => progress({ callback: params.onProgress, job, message: `正在归并全书证据 ${groupIndex + 1}/${groups.length}`, streamText }),
          });
          assertNotAborted();
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
          const cached = !forceOverview && await getNovelOverviewCheckpoint(dataset.id, inputHash);
          const material = cached ? cached.material : await generators.overview({ config: params.config, novelTitle: dataset.title, notes: batch, compact: true, signal: params.signal });
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
      const merged = supportedStaticMaterial({ ...generatedMaterial, ...archives.material,
        settings: [...new Set([...(generatedMaterial.settings ?? []), ...observations.settings])],
        rules: [...new Set([...(generatedMaterial.rules ?? []), ...observations.rules])],
        culture: [...new Set([...(generatedMaterial.culture ?? []), ...observations.culture])],
        powerSystem: [...new Set([generatedMaterial.powerSystem ?? '', ...observations.powerSystem])].filter(Boolean).join('\n') || undefined,
      }, notes);
      assertNotAborted();
      // Authored overrides survive the merge; the baseline moves so changed fields surface as conflicts.
      dataset = applyGeneratedMaterial({ ...dataset, overviewInputHash, overviewError: undefined, analysisVersion: NOVEL_ANALYSIS_VERSION }, merged);
      dataset = { ...dataset, staticCoverage: assessNovelStaticCoverage(dataset.staticMaterial, notes) };
      await saveHeader(merged);
      await writeJob({ completed: job.completed + 1, overviewRefreshPending: false });
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
      const analysisInputHash = novelStoryInputHash(
        dataset,
        index,
        job.configFingerprint,
        job.embeddingMode === 'enhanced' ? params.embedding?.identity ?? params.embedding?.model : 'basic',
      );
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
        const storyParts = plan.batches.flatMap(batch => batch.parts).filter(part => part.unitId === segment.id);
        const stories: ParsedNovelSegmentAnalysis[] = [];
        for (const part of storyParts) {
          assertNotAborted();
          if (params.generators && stories.length) job.requestCount = (job.requestCount ?? 0) + 1;
          stories.push(await generators.segment({
            config: params.config, novelTitle: dataset.title,
            segment: { ...segment, sourceRanges: [part.range] }, sourceText: part.sourceText,
            evidenceNote: segment.evidenceNotes,
            previousEndingFacts: stories.at(-1)?.endingFacts ?? previous?.endingFacts ?? [],
            retrievedEvidence: renderNovelRetrievedEvidence(retrieved),
            sourceChapters: dataset.chapters.filter(chapter => dataset.segments.some(candidate => candidate.chapterIds.includes(chapter.id))),
            signal: params.signal,
            onDelta: streamText => progress({ callback: params.onProgress, job, segmentTitle: segment.title, message: '正在编译正式分段', streamText }),
          }));
        }
        const generated = mergeNovelStories(stories);
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
        await saveSegment(segment);
        await writeJob({ completed: job.completed + 1, currentSegmentId: segment.id });
      } catch (error) {
        if (isFatalChannelError(error) || (error instanceof Error && error.name === 'AbortError')) throw error;
        segment = { ...segment, status: 'failed', error: error instanceof Error ? error.message : String(error), updatedAt: Date.now() };
        dataset.segments[index] = segment;
        await saveSegment(segment);
        await writeJob({ failed: job.failed + 1, lastError: segment.error, currentSegmentId: segment.id });
      }
    }
    };

    // Exactly two LLM lanes: serial static reduction and serial dependent segments.
    // Await both even on failure so no branch writes after this run has returned.
    // Background mode stops after the static lane, so plot compilation is never paid for implicitly.
    const branches = await Promise.allSettled(goal === 'background' ? [compileOverview()] : [compileOverview(), compileSegments()]);
    const overviewResult = branches[0];
    if (overviewResult.status === 'rejected') {
      dataset = { ...dataset, overviewInputHash: undefined, overviewError: overviewResult.reason instanceof Error ? overviewResult.reason.message : String(overviewResult.reason) };
      await saveHeader();
      await writeJob({ failed: job.failed + 1, lastError: dataset.overviewError });
    }
    for (const result of branches) {
      if (result.status === 'rejected' && (isFatalChannelError(result.reason) || result.reason?.name === 'AbortError')) throw result.reason;
    }
    if (branches[1]?.status === 'rejected') throw branches[1].reason;

    const plotReady = goal === 'background' || dataset.segments[startSegmentIndex]?.status === 'completed';
    const worldReady = Boolean(dataset.overviewInputHash === overviewInputHash && dataset.staticMaterial.summary?.trim() && plotReady);
    const selectedChapters = new Set(dataset.segments.flatMap(s => s.chapterIds)).size;
    const totalChapters = dataset.chapters.filter(c => c.included !== false).length;
    const allCompleted = worldReady && dataset.segments.every(segment => segment.status === 'completed') && !dataset.overviewError
      && selectedChapters === totalChapters && !dataset.importIssues?.some(issue => issue.severity === 'error');
    dataset = { ...dataset, analysisStatus: allCompleted ? 'ready' : worldReady ? 'partial' : 'failed', coverage: {
      selectedChapters, totalChapters, evidenceCompleted: notes.length, segmentsCompleted: dataset.segments.filter(s => s.status === 'completed').length, totalSegments: dataset.segments.length,
    } };
    await saveHeader();
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
    const plotReady = goal === 'background' || dataset.segments[startSegmentIndex]?.status === 'completed';
    const worldReady = Boolean(dataset.staticMaterial.summary?.trim() && plotReady);
    dataset = { ...dataset, analysisStatus: worldReady ? 'partial' : aborted ? 'draft' : 'failed' };
    let acceptanceError: unknown;
    try { await saveHeader(); } catch (failure) { acceptanceError = failure; }
    const failure = acceptanceError ?? error;
    await writeJob({ status: acceptanceError ? 'failed' : aborted ? 'paused' : 'failed', lastError: !acceptanceError && aborted ? undefined : (failure instanceof Error ? failure.message : String(failure)) });
    if (acceptanceError) throw acceptanceError;
    progress({ callback: params.onProgress, job, message: aborted ? '已暂停并保存检查点' : `任务已停止：${job.lastError}` });
    if (aborted) {
      const stored = await getNovelDataset(dataset.id);
      return { dataset: stored ?? dataset, job, worldReady };
    }
    throw error;
  }
}
