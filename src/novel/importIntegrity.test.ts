import { describe, expect, test } from 'bun:test';
import { createNovelDatasetFromBytes, createNovelDatasetFromText, decodeNovelText } from './plainText';
import { copyNovelDataset, importNovelDataset } from './datasetImport';
import { buildNovelSegments } from './segmentation';
import { rebuildNovelDatasetSegments } from './workbenchState';

describe('novel import integrity', () => {
  test('decodes BOM and Chinese legacy bytes without replacement characters', () => {
    expect(decodeNovelText(new Uint8Array([0xff, 0xfe, 0x2d, 0x4e])).text).toBe('中');
    expect(decodeNovelText(new Uint8Array([0xd6, 0xd0, 0xce, 0xc4]))).toMatchObject({ text: '中文', encoding: 'gb18030' });
    expect(createNovelDatasetFromBytes('测试', new TextEncoder().encode('第一章开始\n正文。')).chapters[0].title).toBe('第一章开始');
  });
  test('retains introductory text and reports suspicious content instead of deleting it', () => {
    const data = createNovelDatasetFromText('书', '作品简介\n远方的故事。\n第一章 初见\n正文。\n第三章 返回\n另一段正文。');
    expect(data.chapters.map(chapter => chapter.content).join('\n')).toContain('远方的故事');
    expect(data.importIssues?.some(issue => issue.code === 'suspected_gap')).toBe(true);
  });
  test('rejects worlds, empty objects and broken chapter references', () => {
    expect(() => importNovelDataset({})).toThrow();
    expect(() => importNovelDataset({ id: 'world', name: '世界', worldBookEntries: [] })).toThrow(/世界/);
    expect(() => importNovelDataset({ title: '书', chapters: [{ id: 'c', content: '正文' }], segments: [{ chapterIds: ['missing'] }] })).toThrow(/chapterIds/);
  });
  test('copies the entire dataset and remaps references without editing prose', () => {
    const source = createNovelDatasetFromText('书', '正文');
    source.segments[0].events = [{ name: source.chapters[0].id, description: '事件', evidenceRefs: [{ chapterId: source.chapters[0].id, startOffset: 0, endOffset: 2, excerpt: '正文', confidence: 'explicit' }] }];
    const copy = copyNovelDataset(source);
    expect(copy.id).not.toBe(source.id);
    expect(copy.segments[0].events[0].name).toBe(source.chapters[0].id);
    expect(copy.segments[0].events[0].evidenceRefs?.[0].chapterId).toBe(copy.chapters[0].id);
  });
  test('source slices reproduce exact source and rebuild keeps untouched checkpoints', () => {
    const data = createNovelDatasetFromText('书', '第一章\n春雨。\n夜风。\n\n第二章\n山路。');
    data.segments = buildNovelSegments(data.id, data.chapters, { mode: 'single_chapter', maxTokens: 8 });
    for (const segment of data.segments) {
      expect(segment.sourceRanges?.map(range => data.chapters.find(chapter => chapter.id === range.chapterId)!.content.slice(range.startOffset, range.endOffset)).join('\n\n')).toBe(segment.sourceText);
    }
    data.segments[0].status = 'completed';
    data.segments[0].summary = '保留';
    const rebuilt = rebuildNovelDatasetSegments(data, data.chapters, { mode: 'single_chapter', maxTokens: 8 });
    expect(rebuilt.segments[0]).toMatchObject({ id: data.segments[0].id, status: 'completed', summary: '保留' });
  });
  test('source-less static archives are usable and raw whitespace survives native import', () => {
    expect(importNovelDataset({ staticMaterial: { rules: ['海潮每日倒流'] } }).importIssues?.some(issue => issue.code === 'source_unavailable')).toBe(true);
    const data = importNovelDataset({ rawText: '\n正文\n', chapters: [{ id: 'c', index: 0, content: '  正文\n' }] });
    expect(data.rawText).toBe('\n正文\n');
    expect(data.chapters[0].content).toBe('  正文\n');
  });
  test('rebuild rebases kept source evidence after a preceding chapter is changed', () => {
    const data = createNovelDatasetFromText('书', '第一章\n甲。\n\n第二章\n乙。');
    data.segments = buildNovelSegments(data.id, data.chapters, { mode: 'single_chapter' });
    const last = data.chapters[1];
    data.segments[1].evidenceRefs = [{ chapterId: last.id, startOffset: last.startOffset!, endOffset: last.endOffset!, excerpt: last.content, confidence: 'explicit' }];
    data.segments[1].status = 'completed';
    const rebuilt = rebuildNovelDatasetSegments(data, data.chapters.map((chapter, index) => index ? chapter : { ...chapter, content: '加长了的正文。' }), { mode: 'single_chapter' });
    const evidence = rebuilt.segments[1].evidenceRefs![0];
    expect(rebuilt.segments[1].id).toBe(data.segments[1].id);
    expect(rebuilt.rawText?.slice(evidence.startOffset, evidence.endOffset)).toBe(evidence.excerpt);
    expect(evidence.chapterStartOffset).toBe(0);
  });
});
