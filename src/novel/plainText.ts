import { v4 as uuid } from 'uuid';
import { buildNovelSegments, hashNovelText } from './segmentation';
import type { NovelChapter, NovelDataset, NovelStaticMaterial } from './types';

const numeric = '[零〇一二三四五六七八九十百千万两\\d]+';
const volumeHeading = new RegExp(`^第\\s*${numeric}\\s*[卷部篇集](?:\\s+.*|$)`, 'i');
const chapterHeading = new RegExp(`^(?:第\\s*${numeric}\\s*[章节回]|chapter\\s*${numeric})\\s*.*$`, 'i');
const specialHeading = /^(?:序章|序言|序幕|楔子|引子|前言|终章|尾声|后记|番外(?:篇)?)(?:\s+.*|[：:].*|$)/i;

interface SourceLine {
  text: string;
  start: number;
  end: number;
  bodyStart: number;
}

interface Heading {
  kind: 'volume' | 'chapter';
  title: string;
  volumeTitle?: string;
  start: number;
  bodyStart: number;
}

function sourceLines(rawText: string): SourceLine[] {
  const lines: SourceLine[] = [];
  const matcher = /[^\r\n]*(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(rawText)) !== null) {
    if (!match[0] && matcher.lastIndex >= rawText.length) break;
    const newline = match[0].match(/(?:\r\n|\n|\r)$/)?.[0] ?? '';
    const text = match[0].slice(0, match[0].length - newline.length);
    lines.push({ text, start: match.index, end: match.index + text.length, bodyStart: match.index + match[0].length });
    if (matcher.lastIndex >= rawText.length) break;
  }
  return lines;
}

function trimRange(rawText: string, start: number, end: number): { content: string; start: number; end: number } {
  const source = rawText.slice(start, end);
  const leading = source.match(/^\s*/)?.[0].length ?? 0;
  const trailing = source.match(/\s*$/)?.[0].length ?? 0;
  const resolvedStart = start + leading;
  const resolvedEnd = Math.max(resolvedStart, end - trailing);
  return { content: rawText.slice(resolvedStart, resolvedEnd), start: resolvedStart, end: resolvedEnd };
}

function isNoiseOnly(content: string): boolean {
  return /^(?:目录|目\s*录|contents?)$/i.test(content.replace(/\s+/g, ''));
}

export function splitNovelChapters(rawText: string, datasetId = ''): NovelChapter[] {
  const source = String(rawText ?? '');
  const headings: Heading[] = [];
  let currentVolume = '';

  // Some text exports concatenate a chapter heading onto the previous paragraph.
  // Require neighbouring chapter numbers before treating an inline mention as a boundary.
  const inlineCandidates = [...source.matchAll(/第\s*(\d+)\s*章([^\r\n]{1,60})(?=\r?\n|$)/g)];
  const inlineStarts = new Set(inlineCandidates.filter((item, index) => {
    const number = Number(item[1]);
    return Number(inlineCandidates[index - 1]?.[1]) === number - 1
      || Number(inlineCandidates[index + 1]?.[1]) === number + 1;
  }).map(item => item.index));

  let candidateIndex = 0;
  for (const line of sourceLines(source)) {
    while (candidateIndex < inlineCandidates.length && inlineCandidates[candidateIndex].index < line.start) candidateIndex++;
    const candidate = inlineCandidates[candidateIndex];
    const inline = candidate && inlineStarts.has(candidate.index)
      && candidate.index > line.start && candidate.index < line.end
      && source.slice(line.start, candidate.index).trim() ? candidate : undefined;
    if (inline) {
      headings.push({ kind: 'chapter', title: inline[0].trim(), volumeTitle: currentVolume || undefined,
        start: inline.index, bodyStart: line.bodyStart });
      continue;
    }
    const title = line.text.trim().replace(/^[-—\s]+|[-—\s]+$/g, '');
    if (!title) continue;
    if (volumeHeading.test(title)) {
      currentVolume = title;
      headings.push({ kind: 'volume', title, start: line.start, bodyStart: line.bodyStart });
      continue;
    }
    if (chapterHeading.test(title) || specialHeading.test(title)) {
      headings.push({ kind: 'chapter', title, volumeTitle: currentVolume || undefined, start: line.start, bodyStart: line.bodyStart });
    }
  }

  const chapters: NovelChapter[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    if (heading.kind !== 'chapter') continue;
    const next = headings[index + 1];
    const range = trimRange(source, heading.bodyStart, next?.start ?? source.length);
    if (!range.content || isNoiseOnly(range.content)) continue;
    chapters.push({
      id: uuid(),
      ...(datasetId ? { datasetId } : {}),
      index: chapters.length,
      title: heading.title,
      content: range.content,
      ...(heading.volumeTitle ? { volumeTitle: heading.volumeTitle } : {}),
      startOffset: range.start,
      endOffset: range.end,
      wordCount: range.content.replace(/\s+/g, '').length,
      contentHash: hashNovelText(range.content),
    });
  }

  if (chapters.length > 0) {
    // Keep text outside recognized headings. Empty directory entries stay in rawText,
    // while prose before chapter one or after a volume heading remains analyzable.
    const extraRanges = [
      { start: 0, end: headings[0]?.start ?? 0, title: '导入前文' },
      ...headings.filter(heading => heading.kind === 'volume').map(heading => ({
        start: heading.bodyStart,
        end: headings[headings.indexOf(heading) + 1]?.start ?? source.length,
        title: `${heading.title}·卷前文`,
      })),
    ];
    for (const item of extraRanges) {
      const range = trimRange(source, item.start, item.end);
      if (!range.content || isNoiseOnly(range.content)) continue;
      chapters.push({ id: uuid(), datasetId, index: 0, title: item.title, content: range.content,
        startOffset: range.start, endOffset: range.end, wordCount: range.content.replace(/\s+/g, '').length,
        contentHash: hashNovelText(range.content) });
    }
    return chapters.sort((a, b) => (a.startOffset ?? 0) - (b.startOffset ?? 0)).map((chapter, index) => ({ ...chapter, index }));
  }
  const range = trimRange(source, 0, source.length);
  if (!range.content) return [];
  return [{
    id: uuid(),
    ...(datasetId ? { datasetId } : {}),
    index: 0,
    title: '正文',
    content: range.content,
    startOffset: range.start,
    endOffset: range.end,
    wordCount: range.content.replace(/\s+/g, '').length,
    contentHash: hashNovelText(range.content),
  }];
}

export function createNovelDatasetFromText(
  title: string,
  rawText: string,
  staticMaterial: NovelStaticMaterial = {},
): NovelDataset {
  const now = Date.now();
  const id = uuid();
  const sourceVersion = hashNovelText(rawText);
  const chapters = splitNovelChapters(rawText, id).map(chapter => ({ ...chapter, sourceVersion, included: true }));
  return {
    id,
    title: title.trim() || '未命名小说',
    sourceType: 'txt',
    schemaVersion: 2,
    sourceVersion,
    sourceVerified: true,
    importIssues: inspectNovelChapters(chapters),
    rawTextLength: rawText.length,
    rawText,
    chapters,
    staticMaterial,
    segments: buildNovelSegments(id, chapters),
    analysisStatus: 'draft',
    analysisVersion: 1,
    createdAt: now,
    updatedAt: now,
  };
}

export type NovelTextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'gb18030';

/** Decode before presenting a preview; fatal decoding never silently inserts U+FFFD. */
export function decodeNovelText(bytes: ArrayBuffer | Uint8Array, requested?: NovelTextEncoding): {
  text: string; encoding: NovelTextEncoding; preview: string;
} {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let encoding = requested;
  if (!encoding) {
    if (data[0] === 0xff && data[1] === 0xfe) encoding = 'utf-16le';
    else if (data[0] === 0xfe && data[1] === 0xff) encoding = 'utf-16be';
    else {
      try { new TextDecoder('utf-8', { fatal: true }).decode(data); encoding = 'utf-8'; }
      catch { encoding = 'gb18030'; }
    }
  }
  try {
    const text = new TextDecoder(encoding, { fatal: true }).decode(data).replace(/^\uFEFF/, '');
    return { text, encoding, preview: text.slice(0, 3000) };
  } catch { throw new Error(`无法按 ${encoding} 解码文本，请在导入预览中切换编码。`); }
}

export function createNovelDatasetFromBytes(title: string, bytes: ArrayBuffer | Uint8Array, encoding?: NovelTextEncoding): NovelDataset {
  const decoded = decodeNovelText(bytes, encoding);
  if (!decoded.text.trim()) throw new Error('TXT 没有可读取的正文。');
  return { ...createNovelDatasetFromText(title, decoded.text), encoding: decoded.encoding };
}

function chapterNumber(title: string): number | undefined {
  const value = title.match(/^(?:第\s*([零〇一二三四五六七八九十百千万两\d]+)\s*[章节回]|chapter\s*(\d+))/i);
  if (!value) return undefined;
  const token = value[1] ?? value[2];
  if (/^\d+$/.test(token)) return Number(token);
  const digits: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const units: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
  let total = 0; let current = 0;
  for (const ch of token) {
    if (ch in digits) current = digits[ch];
    else if (units[ch]) { total += (current || 1) * units[ch]; current = 0; }
  }
  return total + current;
}

export function inspectNovelChapters(chapters: NovelChapter[]): NonNullable<NovelDataset['importIssues']> {
  const issues: NonNullable<NovelDataset['importIssues']> = [];
  const seen = new Set<string>();
  let previous: number | undefined;
  let volume: string | undefined;
  for (const chapter of chapters) {
    const add = (code: string, message: string) => issues.push({ code, message, chapterId: chapter.id, severity: 'warning' });
    if (chapter.volumeTitle !== volume) { previous = undefined; volume = chapter.volumeTitle; }
    const n = chapterNumber(chapter.title);
    if (n !== undefined && previous !== undefined && n > previous + 1) add('suspected_gap', `${chapter.title} 前可能缺少章节，请核对原文。`);
    if (n !== undefined) previous = n;
    const titleKey = `${volume ?? ''}|${chapter.title}`;
    if (seen.has(titleKey)) add('duplicate_heading', `发现重复章节标题：${chapter.title}`);
    seen.add(titleKey);
    if (chapter.content.replace(/\s/g, '').length < 100) add('short_chapter', `${chapter.title} 正文较短，请检查。`);
    if (/简介|目录|前文|卷前文|后记|感言|广告|完本|作者的话/.test(chapter.title) || /(?:加[入]?书友群|求月票|关注公众号|下载地址)/.test(chapter.content.slice(0, 300))) {
      add('suspected_non_body', `${chapter.title} 可能包含非正文；已保留，可调整是否参与分析。`);
    }
  }
  return issues;
}
