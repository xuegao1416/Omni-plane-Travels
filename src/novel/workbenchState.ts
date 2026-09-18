import { v4 as uuid } from 'uuid';
import { buildNovelSegments, hashNovelText } from './segmentation';
import type { NovelChapter, NovelDataset } from './types';

function normalizeChapters(chapters: NovelChapter[]): NovelChapter[] {
  return chapters.map((chapter, index) => ({ ...chapter, index }));
}

function chapterWithContent(chapter: NovelChapter, content: string, offsets: { start: number; end: number }): NovelChapter {
  return {
    ...chapter,
    content,
    startOffset: offsets.start,
    endOffset: offsets.end,
    wordCount: content.replace(/\s+/g, '').length,
    contentHash: hashNovelText(content),
  };
}

export function renameNovelChapter(chapters: NovelChapter[], chapterIndex: number, title: string): NovelChapter[] {
  const normalizedTitle = title.trim();
  return normalizeChapters(chapters.map((chapter, index) => index === chapterIndex
    ? { ...chapter, title: normalizedTitle || chapter.title }
    : chapter));
}

export function splitNovelChapter(chapters: NovelChapter[], chapterIndex: number, characterOffset: number): NovelChapter[] {
  const chapter = chapters[chapterIndex];
  if (!chapter) return normalizeChapters(chapters);
  const offset = Math.floor(characterOffset);
  if (offset <= 0 || offset >= chapter.content.length) return normalizeChapters(chapters);
  const firstContent = chapter.content.slice(0, offset).trimEnd();
  const secondRaw = chapter.content.slice(offset);
  const leading = secondRaw.length - secondRaw.trimStart().length;
  const secondContent = secondRaw.trimStart();
  if (!firstContent || !secondContent) return normalizeChapters(chapters);
  const baseStart = chapter.startOffset ?? 0;
  const first = chapterWithContent(chapter, firstContent, { start: baseStart, end: baseStart + firstContent.length });
  const second = chapterWithContent({
    ...chapter,
    id: uuid(),
    title: `${chapter.title}（续）`,
  }, secondContent, {
    start: baseStart + offset + leading,
    end: chapter.endOffset ?? baseStart + chapter.content.length,
  });
  return normalizeChapters([...chapters.slice(0, chapterIndex), first, second, ...chapters.slice(chapterIndex + 1)]);
}

export function mergeNovelChapterWithPrevious(chapters: NovelChapter[], chapterIndex: number): NovelChapter[] {
  if (chapterIndex <= 0 || chapterIndex >= chapters.length) return normalizeChapters(chapters);
  const previous = chapters[chapterIndex - 1];
  const current = chapters[chapterIndex];
  const content = `${previous.content.trimEnd()}\n\n${current.content.trimStart()}`;
  const merged = chapterWithContent(previous, content, {
    start: previous.startOffset ?? 0,
    end: current.endOffset ?? (previous.startOffset ?? 0) + content.length,
  });
  return normalizeChapters([...chapters.slice(0, chapterIndex - 1), merged, ...chapters.slice(chapterIndex + 1)]);
}

/** A world may be created as soon as the stable overview and chosen opening are usable. */
export function canCreateNovelWorld(dataset: NovelDataset | undefined, startSegmentIndex: number): boolean {
  if (!dataset || !Object.values(dataset.staticMaterial).some(value => typeof value === 'string' ? value.trim() : Array.isArray(value) ? value.length : value && Object.keys(value).length)) return false;
  if (dataset.overviewError) return false;
  if (dataset.chapters.length === 0) return true;
  const index = Math.min(Math.max(0, Math.floor(startSegmentIndex) || 0), Math.max(0, dataset.segments.length - 1));
  const segment = dataset.segments[index];
  return segment?.status === 'completed' && (segment.analysisVersion ?? 1) === (dataset.analysisVersion ?? 1);
}

/** Rebuild only invalidated units; exact source/identity matches retain their checkpoints. */
export function rebuildNovelDatasetSegments(
  dataset: NovelDataset,
  chapters: NovelChapter[],
  options: Parameters<typeof buildNovelSegments>[2] = {},
): NovelDataset {
  const version = hashNovelText(chapters.map(chapter => `${chapter.id}|${chapter.title}|${chapter.included !== false}|${chapter.content}`).join('\n'));
  let cursor = 0;
  const rawText = chapters.map(chapter => `${chapter.title}\n${chapter.content}`).join('\n\n');
  const normalized = chapters.map((chapter, index) => {
    const startOffset = cursor + chapter.title.length + 1;
    cursor = startOffset + chapter.content.length + 2;
    return { ...chapter, index, startOffset, endOffset: startOffset + chapter.content.length,
      contentHash: hashNovelText(chapter.content), sourceVersion: version };
  });
  const originals = new Map(dataset.chapters.map(chapter => [chapter.id, chapter]));
  const replacements = new Map(normalized.map(chapter => [chapter.id, chapter]));
  const rebase = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(rebase);
    if (!value || typeof value !== 'object') return value;
    const row = value as Record<string, unknown>;
    if (typeof row.chapterId === 'string' && typeof row.excerpt === 'string') {
      const before = originals.get(row.chapterId); const after = replacements.get(row.chapterId);
      if (before && after) {
        const start = typeof row.chapterStartOffset === 'number' ? row.chapterStartOffset : Number(row.startOffset) - (before.startOffset ?? 0);
        const end = typeof row.chapterEndOffset === 'number' ? row.chapterEndOffset : Number(row.endOffset) - (before.startOffset ?? 0);
        if (after.content.slice(start, end) === row.excerpt) return { ...row, sourceVersion: version,
          chapterStartOffset: start, chapterEndOffset: end, startOffset: after.startOffset + start, endOffset: after.startOffset + end };
      }
    }
    return Object.fromEntries(Object.entries(row).map(([key, item]) => [key, rebase(item)]));
  };
  // Recompute structural identity: older analysis runs overwrote inputHash with
  // the model fingerprint. Evidence/plot caches have their own dedicated hashes.
  const previous = new Map(dataset.segments.map(segment => [
    hashNovelText(`${segment.chapterIds.join('|')}\n${(segment.sourceText ?? '').trim()}`), segment,
  ]));
  const segments = buildNovelSegments(dataset.id, normalized, options).map(segment => {
    const old = segment.inputHash ? previous.get(segment.inputHash) : undefined;
    if (!old || old.title !== segment.title || old.sourceText !== segment.sourceText) return segment;
    return { ...rebase(old) as typeof old, datasetId: dataset.id, index: segment.index, inputHash: segment.inputHash, sourceRanges: segment.sourceRanges,
      status: old.status === 'processing' ? 'pending' as const : old.status };
  });
  const changed = segments.length !== dataset.segments.length || segments.some((segment, index) => segment.id !== dataset.segments[index]?.id);
  return { ...dataset, chapters: normalized, segments, sourceVersion: version, rawText, rawTextLength: rawText.length,
    ...(changed ? { overviewInputHash: undefined, overviewCheckpoints: undefined, analysisStatus: 'draft' as const } : {}),
    updatedAt: Date.now() };
}
