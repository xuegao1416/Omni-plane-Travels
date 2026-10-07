import type { ApiConfig } from '../api/types';
import { hashNovelText } from './segmentation';
import { buildNovelSemanticUnits, packNovelRequestBatches, type NovelSemanticUnit, type NovelRequestBatch } from './preparationModel';
import type { NovelAnalysisGoal, NovelDataset, NovelSegment } from './types';

export const NOVEL_ANALYSIS_VERSION = 4;

export interface NovelTaskPlan {
  goal: NovelAnalysisGoal;
  units: NovelSemanticUnit[];
  batches: NovelRequestBatch[];
  inputBudget: number;
  stages: Array<{ kind: 'background' | 'evidence' | 'overview' | 'segments'; label: string; total: number; reusable: number }>;
  requests: { min: number; max: number };
}

/** Exact text the model is given for one segment; also the basis of every reuse hash. */
export function novelSegmentSource(dataset: NovelDataset, segment: NovelSegment): string {
  if (segment.sourceText?.trim()) return segment.sourceText.trim();
  const ids = new Set(segment.chapterIds);
  return dataset.chapters.filter(chapter => ids.has(chapter.id)).sort((a, b) => a.index - b.index).map(chapter => chapter.content).join('\n\n').trim();
}

export function novelChapterContext(dataset: NovelDataset, segment: NovelSegment): string {
  const ids = new Set(segment.chapterIds);
  return dataset.chapters.filter(chapter => ids.has(chapter.id)).map(chapter => `${chapter.id} | ${chapter.title} | ${chapter.startOffset ?? 0}-${chapter.endOffset ?? 0}`).join('\n');
}

export function novelAnalysisChannel(config?: ApiConfig): string | undefined {
  return config ? hashNovelText(JSON.stringify([config.baseUrl, config.model, config.provider])) : undefined;
}

export function novelEvidenceInputHash(dataset: NovelDataset, segment: NovelSegment, channel?: string): string {
  return hashNovelText(JSON.stringify({
    sourceText: novelSegmentSource(dataset, segment),
    chapterContext: novelChapterContext(dataset, segment),
    analysisVersion: NOVEL_ANALYSIS_VERSION,
    ...(channel ? { model: channel } : {}),
  }));
}

/** Evidence is grounded in the source text, so results from earlier channels stay usable. */
export function novelEvidenceReusable(dataset: NovelDataset, segment: NovelSegment, channels: string[] = []): boolean {
  if (!segment.evidenceNotes || segment.analysisVersion !== NOVEL_ANALYSIS_VERSION || !segment.evidenceInputHash) return false;
  return [undefined, ...channels].map(channel => novelEvidenceInputHash(dataset, segment, channel)).includes(segment.evidenceInputHash);
}

export function novelStoryInputHash(dataset: NovelDataset, index: number, channel?: string, retrieval = 'basic'): string {
  const segment = dataset.segments[index];
  const previous = dataset.segments[index - 1];
  return hashNovelText(JSON.stringify({
    source: novelSegmentSource(dataset, segment),
    evidence: segment.evidenceNotes,
    previousEndingFacts: previous?.endingFacts ?? [],
    contextGap: Boolean(previous && previous.status !== 'completed'),
    model: channel,
    retrieval,
  }));
}

export function buildNovelTaskPlan(dataset: NovelDataset, options: {
  goal: NovelAnalysisGoal;
  inputBudget?: number;
  config?: ApiConfig;
  channels?: string[];
  forceOverview?: boolean;
  reExtractEvidence?: boolean;
  retrieval?: string;
}): NovelTaskPlan {
  const channel = novelAnalysisChannel(options.config);
  const channels = [...new Set([...(options.channels ?? []), ...(channel ? [channel] : [])])];
  const reusableEvidence = options.reExtractEvidence ? 0 : dataset.segments.filter(segment => novelEvidenceReusable(dataset, segment, channels)).length;
  const notesReady = !options.reExtractEvidence && reusableEvidence === dataset.segments.length;
  const overviewReusable = !options.forceOverview && notesReady && Boolean(dataset.overviewInputHash && !dataset.overviewError && dataset.staticMaterial.summary?.trim()) ? 1 : 0;
  const units = buildNovelSemanticUnits(dataset);
  const inputBudget = Math.max(1000, Math.min(12000, Math.floor(options.inputBudget ?? dataset.taskPreparation?.maxTokens ?? 6000)));
  const reusableIds = new Set(options.reExtractEvidence ? [] : dataset.segments.filter(segment => novelEvidenceReusable(dataset, segment, channels)).map(segment => segment.id));
  const batches = packNovelRequestBatches(dataset, units, inputBudget).map(batch => ({ ...batch, evidenceReusable: batch.parts.every(part => reusableIds.has(part.unitId)) }));
  const stages: NovelTaskPlan['stages'] = [
    { kind: 'background', label: '证据与背景批次', total: batches.length, reusable: batches.filter(batch => batch.evidenceReusable).length },
  ];
  // New evidence includes usable background. Old evidence without material or explicit refresh needs a separate merge.
  if (options.forceOverview || (notesReady && !overviewReusable)) stages.push({ kind: 'overview', label: '世界归并', total: 1, reusable: overviewReusable });
  if (options.goal === 'full') {
    let previousReady = true;
    let reusable = 0;
    if (notesReady) for (let index = 0; index < dataset.segments.length; index += 1) {
      const segment = dataset.segments[index];
      const matches: boolean = previousReady && segment.status === 'completed' && segment.analysisVersion === NOVEL_ANALYSIS_VERSION
        && segment.analysisInputHash === novelStoryInputHash(dataset, index, channel, options.retrieval ?? 'basic');
      if (matches) reusable += 1;
      previousReady = matches;
    }
    const parts = batches.flatMap(batch => batch.parts);
    const reusableIds = new Set(dataset.segments.slice(0, reusable).map(segment => segment.id));
    stages.push({ kind: 'segments', label: '剧情编译', total: parts.length, reusable: parts.filter(part => reusableIds.has(part.unitId)).length });
  }
  const min = stages.reduce((sum, stage) => sum + stage.total - stage.reusable, 0);
  return { goal: options.goal, units, batches, inputBudget, stages, requests: { min, max: min * 3 } };
}
