import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { createNovelDatasetFromText } from '../../../novel/plainText';
import { runNovelAnalysis, type NovelAnalysisGenerators } from '../../../novel/analysisRunner';
import { saveNovelDataset } from '../../../novel/novelStore';
import { defaultReadingOptions, describeReadingRange, prepareNovelReading } from './readingRange';

const book = (count: number) => createNovelDatasetFromText('试拆测试小说', Array.from({ length: count }, (_, index) => `第${index + 1}章 夜雨\n沈砚来到城门，开始第${index + 1}天的调查。`).join('\n\n'));

describe('小说拆解台章节选择接入现有内核', () => {
  test('三千章新小说默认只准备前十章，原文与后续章节保留', () => {
    const source = book(3000);
    const prepared = prepareNovelReading(source, defaultReadingOptions(source));
    expect(source.chapters).toHaveLength(3000);
    expect(source.segments).toHaveLength(3000);
    expect(prepared.chapters).toHaveLength(3000);
    expect(prepared.segments).toHaveLength(10);
    expect(prepared.segments.flatMap(segment => segment.chapterIds)).toEqual(source.chapters.slice(0, 10).map(chapter => chapter.id));
    expect(prepared.rawText).toContain('第3000章');
  });
  test('不足十章的小说只选实际存在的章节，已有范围原样恢复', () => {
    const source = book(6);
    const options = defaultReadingOptions(source);
    expect(options.endChapterIndex).toBe(5);
    expect(prepareNovelReading(source, options).segments).toHaveLength(6);
    const saved = { ...source, taskPreparation: { ...options, startChapterIndex: 2, endChapterIndex: 4 } };
    expect(defaultReadingOptions(saved)).toEqual(saved.taskPreparation);
  });
  test('自选第100至109章实际只交给这十章的分段', () => {
    const source = book(3000);
    const options = { mode: 'custom' as const, maxTokens: 6000, startChapterIndex: 99, endChapterIndex: 108 };
    const prepared = prepareNovelReading(source, options);
    expect(prepared.segments.flatMap(segment => segment.chapterIds)).toEqual(source.chapters.slice(99, 109).map(chapter => chapter.id));
    expect(describeReadingRange(source, options).range?.selectedCount).toBe(10);
  });
  test('无效范围阻止开始，不能悄悄沿用全书范围', () => {
    const source = book(20), options = defaultReadingOptions(source);
    for (const invalid of [{ startChapterIndex: 9, endChapterIndex: 2 }, { startChapterIndex: NaN, endChapterIndex: 9 }, { startChapterIndex: 0, endChapterIndex: 20 }]) {
      expect(() => prepareNovelReading(source, { ...options, ...invalid })).toThrow();
    }
  });
  test('增加十章保留前十章的完成结果与分段身份', () => {
    const source = book(30), options = defaultReadingOptions(source);
    const first = prepareNovelReading(source, options);
    first.segments = first.segments.map(segment => ({ ...segment, status: 'completed', analysisVersion: 4, summary: '已经拆完，不需要丢弃' }));
    const expanded = prepareNovelReading(first, { ...options, endChapterIndex: 19 });
    expect(expanded.segments).toHaveLength(20);
    expect(expanded.segments.slice(0, 10).map(segment => [segment.id, segment.status, segment.summary])).toEqual(first.segments.map(segment => [segment.id, 'completed', '已经拆完，不需要丢弃']));
    expect(expanded.segments.slice(10).every(segment => segment.status === 'pending')).toBe(true);
  });
  test('实际分析管线只处理十章，并将三千章书标为局部成果', async () => {
    const source = book(3000), prepared = prepareNovelReading(source, defaultReadingOptions(source));
    await saveNovelDataset(prepared);
    const visited: string[] = [];
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => { visited.push(...segment.chapterIds); return { summary: '沈砚开始调查', facts: [], characters: [], factions: [], locations: [], items: [], events: [], rules: [], relationships: [], openThreads: [], evidenceRefs: [] }; },
      overview: async () => ({ summary: '只根据本次十章构建的背景资料' }),
      segment: async () => { throw new Error('自由玩法不应编译原作剧情'); },
    };
    const result = await runNovelAnalysis({ datasetId: prepared.id, goal: 'background', config: { provider: 'custom', model: 'range-test', baseUrl: 'https://example.invalid/v1', apiKey: 'test', stream: false }, generators });
    expect(visited).toEqual(source.chapters.slice(0, 10).map(chapter => chapter.id));
    expect(result.dataset.coverage?.selectedChapters).toBe(10);
    expect(result.dataset.coverage?.totalChapters).toBe(3000);
    expect(result.dataset.analysisStatus).toBe('partial');
    expect(result.job.status).toBe('completed');
  });
});
