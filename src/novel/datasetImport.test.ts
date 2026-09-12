import { describe, expect, test } from 'bun:test';
import { importNovelDataset } from './datasetImport';

describe('novel dataset import', () => {
  test('preserves the source decomposition segment order and constraints', () => {
    const dataset = importNovelDataset({
      id: 'source-set',
      标题: '旧档案',
      原始文本: '第1章\n夜雨。',
      章节列表: [{ id: 'c1', 序号: 1, 标题: '第一章', 内容: '夜雨。' }],
      分段列表: [{
        id: 's1', 组号: 1, 标题: '抵达', 章节标题: ['第一章'], 本组概括: '调查员在暴雨中抵达港口。',
        原著硬约束: [{ 内容: '调查员尚未取得通行证。' }],
        关键事件: [{ 事件名: '入港', 事件说明: '调查员进入浮空港。', 触发条件: ['暴雨'], 事件结果: ['暂住驿站'] }],
      }],
    });

    expect(dataset.title).toBe('旧档案');
    expect(dataset.chapters).toHaveLength(1);
    expect(dataset.segments[0]).toMatchObject({
      index: 0,
      summary: '调查员在暴雨中抵达港口。',
      hardConstraints: ['调查员尚未取得通行证。'],
    });
  });

  test('creates chapter records when a structured file only contains raw text', () => {
    const dataset = importNovelDataset({
      标题: '只有原文',
      原始文本: '第一章 初遇\n山门初见。\n\n第二章 夜谈\n二人秉烛夜谈。',
    });

    expect(dataset.chapters.map(chapter => chapter.title)).toEqual(['第一章 初遇', '第二章 夜谈']);
    expect(dataset.segments.length).toBeGreaterThan(0);
  });

  test('preserves completed native analysis when importing a dataset JSON', () => {
    const imported = importNovelDataset({
      id: 'native', title: '原生拆解', sourceType: 'epub', schemaVersion: 2, analysisStatus: 'ready', analysisVersion: 1,
      staticMaterial: { summary: '既有总览' },
      chapters: [{ id: 'c1', index: 0, title: '第一章', content: '原文', startOffset: 3, endOffset: 5 }],
      segments: [{ id: 's1', index: 0, chapterIds: ['c1'], sourceText: '原文', summary: '已经拆解', status: 'completed',
        hardConstraints: ['已知约束'], evidenceInputHash: 'evidence', analysisInputHash: 'analysis', analysisVersion: 1,
        events: [{ name: '相遇', description: '雨中相遇', trigger: '天降大雨', result: '结识同伴', visibility: 'reader_only', blockers: ['道路封闭'],
          evidenceRefs: [{ chapterId: 'c1', startOffset: 3, endOffset: 5, excerpt: '原文', confidence: 'explicit' }] }] }],
    });
    expect(imported.segments[0]).toMatchObject({ status: 'completed', sourceText: '原文', hardConstraints: ['已知约束'], analysisInputHash: 'analysis' });
    expect(imported.segments[0].events[0]).toMatchObject({ trigger: '天降大雨', result: '结识同伴', visibility: 'reader_only' });
    expect(imported.segments[0].events[0].blockers).toEqual(['道路封闭']);
    expect(imported.segments[0].events[0].evidenceRefs?.[0].chapterId).toBe('c1');
    expect(imported.chapters[0].startOffset).toBe(3);
    expect(imported.sourceType).toBe('epub');
  });
});
