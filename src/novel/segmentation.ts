import { v4 as uuid } from 'uuid';
import type { NovelChapter, NovelSegment } from './types';

export function estimateNovelTokens(source: string): number {
  const text = String(source ?? '').trim();
  if (!text) return 0;
  const cjk = (text.match(/[\u3400-\u9fff\uf900-\ufaff]/g) ?? []).length;
  const compactOther = text.replace(/[\u3400-\u9fff\uf900-\ufaff]/g, '').replace(/\s+/g, '');
  return Math.max(1, cjk + Math.ceil(compactOther.length / 4));
}

export function hashNovelText(source: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

interface SegmentPart {
  chapterIds: string[];
  titles: string[];
  text: string;
  ranges?: NonNullable<NovelSegment['sourceRanges']>;
}

function splitLongText(source: string, maxTokens: number): string[] {
  const normalized = source.trim();
  if (!normalized) return [];
  if (estimateNovelTokens(normalized) <= maxTokens) return [normalized];
  const paragraphs = normalized.split(/\n{2,}/).map(item => item.trim()).filter(Boolean);
  const units = paragraphs.length > 1
    ? paragraphs
    : normalized.split(/(?<=[。！？!?])\s*/).map(item => item.trim()).filter(Boolean);
  const output: string[] = [];
  let current = '';

  const pushOversized = (unit: string) => {
    let cursor = 0;
    const safeChars = Math.max(8, maxTokens);
    while (cursor < unit.length) {
      let end = Math.min(unit.length, cursor + safeChars);
      while (end > cursor + 1 && estimateNovelTokens(unit.slice(cursor, end)) > maxTokens) end -= 1;
      output.push(unit.slice(cursor, end).trim());
      cursor = end;
    }
  };

  for (const unit of units) {
    if (estimateNovelTokens(unit) > maxTokens) {
      if (current) output.push(current);
      current = '';
      pushOversized(unit);
      continue;
    }
    const merged = current ? `${current}\n\n${unit}` : unit;
    if (estimateNovelTokens(merged) <= maxTokens) current = merged;
    else {
      if (current) output.push(current);
      current = unit;
    }
  }
  if (current) output.push(current);
  return output.filter(Boolean);
}

function titleForPart(part: SegmentPart, pieceIndex = 0, pieceCount = 1): string {
  const base = part.titles.length <= 1
    ? part.titles[0] || '未命名分段'
    : `${part.titles[0]} — ${part.titles[part.titles.length - 1]}`;
  return pieceCount > 1 ? `${base}（${pieceIndex + 1}/${pieceCount}）` : base;
}

function segmentFromPart(datasetId: string, index: number, part: SegmentPart, pieceIndex = 0, pieceCount = 1): NovelSegment {
  const text = part.text.trim();
  return {
    id: uuid(), datasetId, index,
    title: titleForPart(part, pieceIndex, pieceCount),
    chapterIds: [...part.chapterIds],
    sourceText: text,
    sourceRanges: part.ranges,
    estimatedTokens: estimateNovelTokens(text),
    inputHash: hashNovelText(`${part.chapterIds.join('|')}\n${text}`),
    status: 'pending',
    summary: '',
    hardConstraints: [],
    events: [],
    evidenceRefs: [],
  };
}

export function buildNovelSegments(
  datasetId: string,
  chapters: NovelChapter[],
  options: {
    maxTokens?: number;
    mode?: 'auto' | 'single_chapter' | 'custom';
    startChapterIndex?: number;
    endChapterIndex?: number;
  } = {},
): NovelSegment[] {
  const maxTokens = Math.max(8, Math.floor(options.maxTokens ?? 6000));
  const allChapters = [...chapters].sort((left, right) => left.index - right.index);
  const startIndex = Math.max(0, Math.floor(options.startChapterIndex ?? 0));
  const endIndex = Math.max(startIndex, Math.floor(options.endChapterIndex ?? Math.max(0, allChapters.length - 1)));
  const ordered = options.mode === 'custom'
    ? allChapters.filter(chapter => chapter.index >= startIndex && chapter.index <= endIndex)
    : allChapters;
  const parts: SegmentPart[] = [];
  let current: SegmentPart | null = null;

  const flush = () => {
    if (current?.text.trim()) parts.push(current);
    current = null;
  };

  for (const chapter of ordered) {
    if (chapter.included === false) continue;
    const chapterText = chapter.content.trim();
    if (!chapterText) continue;
    const chapterTokens = estimateNovelTokens(chapterText);
    if (options.mode === 'single_chapter' || chapterTokens > maxTokens) {
      flush();
      parts.push({ chapterIds: [chapter.id], titles: [chapter.title], text: chapterText });
      continue;
    }
    const merged = current ? `${current.text}\n\n${chapterText}` : chapterText;
    if (current && estimateNovelTokens(merged) > maxTokens) flush();
    if (!current) current = { chapterIds: [], titles: [], text: '' };
    current.chapterIds.push(chapter.id);
    current.titles.push(chapter.title);
    current.text = current.text ? `${current.text}\n\n${chapterText}` : chapterText;
  }
  flush();

  const segments: NovelSegment[] = [];
  const chapterById = new Map(chapters.map(chapter => [chapter.id, chapter]));
  for (const part of parts) {
    // Slice original chapter strings instead of normalizing paragraph separators.
    // Every analysis character therefore has an exact chapter-relative origin.
    const pieces = exactSlices(part.text, maxTokens);
    let pieceCursor = 0;
    for (let pieceIndex = 0; pieceIndex < pieces.length; pieceIndex += 1) {
      const piece = pieces[pieceIndex];
      const start = part.text.indexOf(piece, pieceCursor);
      const end = start + piece.length;
      pieceCursor = end;
      let chapterCursor = 0;
      const ranges: NonNullable<NovelSegment['sourceRanges']> = [];
      for (const chapterId of part.chapterIds) {
        const chapter = chapterById.get(chapterId)!;
        const trimmed = chapter.content.trim();
        const leading = chapter.content.indexOf(trimmed);
        const relativeStart = Math.max(start, chapterCursor);
        const relativeEnd = Math.min(end, chapterCursor + trimmed.length);
        if (relativeStart < relativeEnd) ranges.push({ chapterId,
          startOffset: leading + relativeStart - chapterCursor,
          endOffset: leading + relativeEnd - chapterCursor, sourceVersion: chapter.sourceVersion });
        chapterCursor += trimmed.length + 2;
      }
      segments.push(segmentFromPart(datasetId, segments.length, { ...part, text: piece, chapterIds: ranges.map(range => range.chapterId), ranges }, pieceIndex, pieces.length));
    }
  }
  return segments;
}

/** Budgeted slices retain the exact internal whitespace of the original. */
function exactSlices(source: string, maxTokens: number): string[] {
  const result: string[] = [];
  let start = 0;
  while (start < source.length) {
    while (start < source.length && /\s/.test(source[start])) start++;
    if (start >= source.length) break;
    let low = start + 1; let high = source.length; let end = low;
    while (low <= high) {
      const middle = Math.floor((low + high) / 2);
      if (estimateNovelTokens(source.slice(start, middle)) <= maxTokens) { end = middle; low = middle + 1; }
      else high = middle - 1;
    }
    if (end < source.length) {
      const prefix = source.slice(start, end);
      const boundary = [...prefix.matchAll(/\n\s*\n|[。！？.!?](?:\s|$)/g)].at(-1);
      if (boundary && boundary.index! > prefix.length / 2) end = start + boundary.index! + boundary[0].length;
    }
    const piece = source.slice(start, end).trimEnd();
    if (piece) result.push(piece);
    start = end;
  }
  return result;
}
