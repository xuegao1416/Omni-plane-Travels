import { describe, expect, test } from 'bun:test';
import type { NovelDataset } from './types';
import { canCreateNovelWorld, mergeNovelChapterWithPrevious, renameNovelChapter, splitNovelChapter } from './workbenchState';

const base: NovelDataset = {
  id: 'dataset', title: '小说', sourceType: 'txt', rawTextLength: 10,
  chapters: [], staticMaterial: { summary: '完整世界概览' },
  segments: [
    { id: 's0', index: 0, title: '开局一', chapterIds: [], summary: '一', hardConstraints: [], events: [], status: 'completed' },
    { id: 's1', index: 1, title: '开局二', chapterIds: [], summary: '', hardConstraints: [], events: [], status: 'failed' },
  ],
  analysisStatus: 'partial', createdAt: 1, updatedAt: 1,
};

describe('novel workbench readiness', () => {
  test('allows a partial static world even when its selected plot segment failed', () => {
    expect(canCreateNovelWorld(base, 0)).toBe(true);
    expect(canCreateNovelWorld(base, 1)).toBe(true);
    expect(canCreateNovelWorld({ ...base, staticMaterial: {} }, 0)).toBe(false);
  });

  test('supports correcting chapter titles and boundaries before analysis', () => {
    const chapters = [
      { id: 'c0', datasetId: 'dataset', index: 0, title: '误识别一', content: '甲乙丙', startOffset: 0, endOffset: 3 },
      { id: 'c1', datasetId: 'dataset', index: 1, title: '误识别二', content: '丁戊己庚', startOffset: 3, endOffset: 7 },
    ];
    const renamed = renameNovelChapter(chapters, 0, '序章');
    const split = splitNovelChapter(renamed, 1, 2);
    const merged = mergeNovelChapterWithPrevious(split, 2);

    expect(renamed[0].title).toBe('序章');
    expect(split.map(chapter => chapter.content)).toEqual(['甲乙丙', '丁戊', '己庚']);
    expect(merged.map(chapter => chapter.content)).toEqual(['甲乙丙', '丁戊\n\n己庚']);
    expect(merged.map(chapter => chapter.index)).toEqual([0, 1]);
  });
});
