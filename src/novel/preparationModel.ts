import { z } from 'zod';
import { novelEvidenceNoteSchema, novelOverviewSchema, parseNovelEvidenceNoteResponse, parseNovelOverviewResponse } from './analysisSchema';
import { estimateNovelTokens, hashNovelText } from './segmentation';
import type { NovelDataset, NovelEvidenceNote, NovelStaticMaterial } from './types';
import type { ParsedNovelSegmentAnalysis } from './analysisSchema';

export const NOVEL_PREPARATION_VERSION = 1;
export interface NovelSourceRange { chapterId: string; startOffset: number; endOffset: number }
export interface NovelSemanticUnit {
  id: string;
  index: number;
  title: string;
  chapterIds: string[];
  range: NovelSourceRange;
  ranges: NovelSourceRange[];
  sourceText: string;
  sourceHash: string;
}
export interface NovelRequestPart {
  id: string;
  unitId: string;
  title: string;
  range: NovelSourceRange;
  sourceText: string;
  inputHash: string;
}
export interface NovelRequestBatch {
  id: string;
  parts: NovelRequestPart[];
  chapterIds: string[];
  estimatedTokens: number;
  evidenceReusable: boolean;
}
export interface NovelBatchArtifact {
  batchId: string;
  sources?: Array<{ unitId: string; sourceHash: string }>;
  inputHash: string;
  parts: Array<{ partId: string; evidence: NovelEvidenceNote }>;
  material: NovelStaticMaterial;
}
export interface NovelPreparationCheckpoint {
  version: 1;
  batches: NovelBatchArtifact[];
}

/** Existing accepted products keep their identity; new imports use fixed semantic windows. */
export function buildNovelSemanticUnits(dataset: NovelDataset): NovelSemanticUnit[] {
  return dataset.segments.map(segment => {
    const sourceText = segment.sourceText?.trim() || dataset.chapters.filter(chapter => segment.chapterIds.includes(chapter.id)).map(chapter => chapter.content.trim()).join('\n\n');
    const ranges = segment.sourceRanges?.length ? segment.sourceRanges.map(({ chapterId, startOffset, endOffset }) => ({ chapterId, startOffset, endOffset })) : segment.chapterIds.flatMap(chapterId => {
      const chapter = dataset.chapters.find(chapter => chapter.id === chapterId);
      if (!chapter) return [];
      const text = segment.chapterIds.length === 1 ? sourceText : chapter.content.trim();
      const startOffset = chapter.content.indexOf(text);
      return startOffset < 0 ? [] : [{ chapterId, startOffset, endOffset: startOffset + text.length }];
    });
    return { id: segment.id, index: segment.index, title: segment.title, chapterIds: segment.chapterIds,
      range: ranges[0], ranges, sourceText, sourceHash: hashNovelText(JSON.stringify([NOVEL_PREPARATION_VERSION, ranges, sourceText])) };
  });
}

/** Exact chapter-relative windows, including internal whitespace. */
export function budgetedSourceSlices(source: string, maxTokens: number): Array<{ text: string; start: number; end: number }> {
  const output: Array<{ text: string; start: number; end: number }> = [];
  let start = 0;
  while (start < source.length) {
    while (start < source.length && /\s/.test(source[start])) start++;
    if (start >= source.length) break;
    let low = start + 1, high = source.length, end = low;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      if (estimateNovelTokens(source.slice(start, mid)) <= maxTokens) { end = mid; low = mid + 1; }
      else high = mid - 1;
    }
    if (end < source.length) {
      const boundary = Math.max(source.lastIndexOf('\n', end - 1), source.lastIndexOf('。', end - 1));
      if (boundary > start + Math.floor((end - start) / 2)) end = boundary + 1;
    }
    while (end > start && /\s/.test(source[end - 1])) end--;
    if (end <= start) end = start + 1;
    output.push({ text: source.slice(start, end), start, end });
    start = end;
  }
  return output;
}

export function packNovelRequestBatches(dataset: NovelDataset, units: NovelSemanticUnit[], budget: number): NovelRequestBatch[] {
  const batches: NovelRequestBatch[] = [];
  let parts: NovelRequestPart[] = [];
  const reusable = new Set(dataset.segments.filter(segment => segment.evidenceNotes).map(segment => segment.id));
  const flush = () => {
    if (!parts.length) return;
    const inputHash = hashNovelText(JSON.stringify(parts.map(part => part.inputHash)));
    batches.push({ id: `${dataset.id}:batch:${inputHash}`, parts,
      chapterIds: [...new Set(parts.map(part => part.range.chapterId))],
      estimatedTokens: estimateNovelTokens(parts.map(part => part.sourceText).join('\n\n')),
      evidenceReusable: parts.every(part => reusable.has(part.unitId)),
    });
    parts = [];
  };
  for (const unit of units) {
    for (const sourceRange of unit.ranges) for (const slice of budgetedSourceSlices(dataset.chapters.find(chapter => chapter.id === sourceRange.chapterId)!.content.slice(sourceRange.startOffset, sourceRange.endOffset), budget)) {
      const range = { chapterId: sourceRange.chapterId, startOffset: sourceRange.startOffset + slice.start, endOffset: sourceRange.startOffset + slice.end };
      const inputHash = hashNovelText(JSON.stringify([NOVEL_PREPARATION_VERSION, unit.id, range, slice.text]));
      const part = { id: `${unit.id}:part:${inputHash}`, unitId: unit.id, title: unit.title, range, sourceText: slice.text, inputHash };
      if (parts.length && (estimateNovelTokens([...parts, part].map(item => item.sourceText).join('\n\n')) > budget
        || (dataset.taskPreparation?.mode === 'single_chapter' && parts[0].range.chapterId !== part.range.chapterId))) flush();
      parts.push(part);
    }
  }
  flush();
  return batches;
}

export function mergeNovelEvidence(notes: NovelEvidenceNote[]): NovelEvidenceNote {
  const first = structuredClone(notes[0]);
  const unique = (values: string[]) => [...new Set(values)];
  first.summary = unique(notes.map(note => note.summary)).join('\n');
  for (const key of ['facts', 'characters', 'factions', 'locations', 'items', 'rules', 'relationships', 'openThreads'] as const) {
    first[key] = unique(notes.flatMap(note => note[key]));
  }
  first.events = notes.flatMap(note => note.events);
  first.evidenceRefs = notes.flatMap(note => note.evidenceRefs);
  if (notes.some(note => note.staticFindings)) {
    first.staticFindings = { settings: [], rules: [], culture: [], powerSystem: [], economy: [], time: [] };
    for (const key of Object.keys(first.staticFindings) as Array<keyof NonNullable<NovelEvidenceNote['staticFindings']>>) {
      first.staticFindings[key] = unique(notes.flatMap(note => note.staticFindings?.[key] ?? []));
    }
  }
  first.archives = {
    characters: notes.flatMap(note => note.archives?.characters ?? []), factions: notes.flatMap(note => note.archives?.factions ?? []),
    locations: notes.flatMap(note => note.archives?.locations ?? []), items: notes.flatMap(note => note.archives?.items ?? []),
  };
  return first;
}

export function mergeNovelStories(stories: ParsedNovelSegmentAnalysis[]): ParsedNovelSegmentAnalysis {
  const first = structuredClone(stories[0]);
  const last = stories.at(-1)!;
  first.summary = stories.map(story => story.summary).join('\n');
  first.endingFacts = last.endingFacts;
  first.timelineEnd = last.timelineEnd;
  for (const key of ['carryFacts', 'nextReference', 'hardConstraints', 'foreshadowing', 'worldRules', 'relationships'] as const) {
    first[key] = [...new Set(stories.flatMap(story => story[key]))];
  }
  first.events = stories.flatMap(story => story.events);
  first.characterProgress = stories.flatMap(story => story.characterProgress);
  first.constraintDetails = stories.flatMap(story => story.constraintDetails);
  first.evidenceRefs = stories.flatMap(story => story.evidenceRefs);
  return first;
}

/** Recovery input is validated before any task or storage consumer reads it. */
export function readNovelPreparationCheckpoint(value: unknown): NovelPreparationCheckpoint | undefined {
  if (value === undefined) return undefined;
  const identity = z.string().min(1);
  const schema = z.object({ version: z.literal(1), batches: z.array(z.object({
    batchId: identity, inputHash: identity,
    sources: z.array(z.object({ unitId: identity, sourceHash: identity })).min(1),
    parts: z.array(z.object({ partId: identity, evidence: novelEvidenceNoteSchema })).min(1), material: novelOverviewSchema,
  })) });
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('preparation: 小说批次检查点格式无效');
  const checkpoint = parsed.data;
  if (new Set(checkpoint.batches.map(batch => batch.batchId)).size !== checkpoint.batches.length
    || checkpoint.batches.some(batch => new Set(batch.parts.map(part => part.partId)).size !== batch.parts.length
      || new Set(batch.sources.map(source => source.unitId)).size !== batch.sources.length
      || batch.parts.some(part => !batch.sources.some(source => part.partId.startsWith(`${source.unitId}:part:`))))) throw new Error('preparation: 小说批次身份重复或无法匹配来源');
  return { version: 1, batches: checkpoint.batches.map(batch => ({ ...batch,
    parts: batch.parts.map(part => ({ partId: part.partId, evidence: parseNovelEvidenceNoteResponse(JSON.stringify(part.evidence)) })),
    material: parseNovelOverviewResponse(JSON.stringify(batch.material)),
  })) };
}

export function readNovelTaskPreparation(value: unknown): NovelDataset['taskPreparation'] {
  if (value === undefined) return undefined;
  const index = z.number().int().nonnegative();
  const schema = z.object({ mode: z.enum(['auto', 'single_chapter', 'custom']), maxTokens: z.number().int().min(1000).max(12000),
    startChapterIndex: index, endChapterIndex: index }).refine(row => row.endChapterIndex >= row.startChapterIndex);
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new Error('taskPreparation: 处理范围或请求预算无效');
  return parsed.data;
}
