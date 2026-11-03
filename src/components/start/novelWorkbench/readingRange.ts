import type { NovelDataset } from '../../../novel/types';
import { rebuildNovelDatasetSegments } from '../../../novel/workbenchState';

export type ReadingScope = 'sample' | 'all' | 'custom';
export interface ReadingOptions { mode: 'auto' | 'single_chapter' | 'custom'; maxTokens: number; startChapterIndex: number; endChapterIndex: number }
export interface ReadingRange { startChapterIndex: number; endChapterIndex: number; chapterCount: number; selectedCount: number; isPartial: boolean }

export function defaultReadingOptions(dataset: NovelDataset): ReadingOptions {
  if (dataset.taskPreparation) return dataset.taskPreparation;
  const hasResults = dataset.segments.some(segment => segment.evidenceNotes || segment.status === 'completed')
    || Object.values(dataset.staticMaterial).some(value => typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.length : value);
  return { mode: hasResults ? 'auto' : 'custom', maxTokens: 6000, startChapterIndex: 0, endChapterIndex: Math.max(0, hasResults ? dataset.chapters.length - 1 : Math.min(9, dataset.chapters.length - 1)) };
}

export function readingScope(options: ReadingOptions, chapterCount: number): ReadingScope {
  if (options.mode !== 'custom') return 'all';
  return options.startChapterIndex === 0 && options.endChapterIndex === Math.min(9, chapterCount - 1) ? 'sample' : 'custom';
}

export function describeReadingRange(dataset: NovelDataset, options: ReadingOptions): { range?: ReadingRange; error?: string } {
  const chapterCount = dataset.chapters.length;
  const start = options.mode === 'custom' ? options.startChapterIndex : 0;
  const end = options.mode === 'custom' ? options.endChapterIndex : chapterCount - 1;
  if (!Number.isInteger(start) || !Number.isInteger(end)) return { error: '请填写完整的起始章和结束章。' };
  if (start < 0 || end >= chapterCount || start >= chapterCount) return { error: `章节范围应在第 1–${chapterCount} 章内。` };
  if (end < start) return { error: '结束章不能早于起始章。' };
  const selectedCount = dataset.chapters.filter(chapter => chapter.index >= start && chapter.index <= end && chapter.included !== false && chapter.content.trim()).length;
  if (!selectedCount) return { error: '所选章节没有可拆解正文，请更换范围或检查章节是否被排除。' };
  return { range: { startChapterIndex: start, endChapterIndex: end, chapterCount, selectedCount, isPartial: start !== 0 || end !== chapterCount - 1 } };
}

/** Bind the visible selection to the existing range engine; no alternate analysis path. */
export function prepareNovelReading(dataset: NovelDataset, options: ReadingOptions): NovelDataset {
  const selection = describeReadingRange(dataset, options);
  if (selection.error) throw new Error(selection.error);
  return rebuildNovelDatasetSegments(dataset, dataset.chapters, options);
}

export function readingRangeLabel(range: ReadingRange): string {
  return range.startChapterIndex === range.endChapterIndex ? `第 ${range.startChapterIndex + 1} 章` : `第 ${range.startChapterIndex + 1}–${range.endChapterIndex + 1} 章`;
}
