import { describe, expect, test } from 'bun:test';
import type { NovelChapter } from './types';
import { buildNovelSegments, estimateNovelTokens } from './segmentation';

const chapter = (datasetId: string, index: number, title: string, content: string): NovelChapter => ({
  id: `${datasetId}-c${index}`, datasetId, index, title, content,
  startOffset: index * 100, endOffset: index * 100 + content.length,
  wordCount: content.length, contentHash: `${index}-${content.length}`,
});

describe('novel token segmentation', () => {
  test('combines short chapters without exceeding the requested budget', () => {
    const datasetId = 'segment-a';
    const chapters = [
      chapter(datasetId, 0, '第一章', '甲乙丙丁'),
      chapter(datasetId, 1, '第二章', '戊己庚辛'),
      chapter(datasetId, 2, '第三章', '壬癸子丑寅卯辰巳午未'),
    ];
    const segments = buildNovelSegments(datasetId, chapters, { maxTokens: 12 });

    expect(segments).toHaveLength(2);
    expect(segments[0].chapterIds).toEqual([chapters[0].id, chapters[1].id]);
    expect(segments.every(segment => (segment.estimatedTokens ?? Infinity) <= 12)).toBe(true);
    expect(segments.every(segment => segment.status === 'pending' && segment.summary === '')).toBe(true);
  });

  test('splits one long chapter on paragraph boundaries', () => {
    const datasetId = 'segment-b';
    const content = `甲乙丙丁戊己庚辛。\n\n壬癸子丑寅卯辰巳。\n\n午未申酉戌亥天地。`;
    const segments = buildNovelSegments(datasetId, [chapter(datasetId, 0, '长章', content)], { maxTokens: 12 });

    expect(segments.length).toBeGreaterThan(1);
    expect(segments.every(segment => segment.chapterIds[0] === `${datasetId}-c0`)).toBe(true);
    expect(segments.every(segment => (segment.estimatedTokens ?? Infinity) <= 12)).toBe(true);
  });

  test('estimates Chinese text more conservatively than compact ASCII', () => {
    expect(estimateNovelTokens('天地玄黄')).toBe(4);
    expect(estimateNovelTokens('abcdefghijklmnop')).toBe(4);
  });

  test('can limit automatic segmentation to a custom chapter range', () => {
    const datasetId = 'segment-range';
    const chapters = [
      chapter(datasetId, 0, '第一章', '第一章内容'),
      chapter(datasetId, 1, '第二章', '第二章内容'),
      chapter(datasetId, 2, '第三章', '第三章内容'),
    ];

    const segments = buildNovelSegments(datasetId, chapters, {
      mode: 'custom', startChapterIndex: 1, endChapterIndex: 1,
    });

    expect(segments).toHaveLength(1);
    expect(segments[0].chapterIds).toEqual([chapters[1].id]);
  });
});
