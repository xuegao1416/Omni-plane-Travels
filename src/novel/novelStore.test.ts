import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import type { NovelAnalysisJob, NovelDataset, NovelSegment } from './types';
import {
  deleteNovelDataset,
  getNovelDataset,
  getNovelRuntimeWindow,
  listNovelChapters,
  listNovelJobs,
  listNovelSegments,
  saveNovelDataset,
  saveNovelDatasetHeader,
  saveNovelJob,
  saveNovelSegment,
} from './novelStore';

function sampleDataset(id: string): NovelDataset {
  return {
    id,
    title: '分区存储测试',
    sourceType: 'txt',
    schemaVersion: 2,
    rawTextLength: 12,
    rawText: '第一章\n旧摘要。',
    chapters: [{
      id: `${id}-chapter-1`, datasetId: id, index: 0, title: '第一章', content: '旧摘要。',
      startOffset: 4, endOffset: 8, wordCount: 4, contentHash: 'chapter-hash',
    }],
    staticMaterial: {},
    segments: [{
      id: `${id}-segment-1`, datasetId: id, index: 0, title: '第一章',
      chapterIds: [`${id}-chapter-1`], estimatedTokens: 4, inputHash: 'segment-hash',
      status: 'pending', summary: '', hardConstraints: [], events: [], evidenceRefs: [],
    }],
    analysisStatus: 'draft',
    createdAt: 1,
    updatedAt: 1,
  };
}

describe('novel partitioned storage', () => {
  test('updates one segment while rehydrating the dataset source and chapters', async () => {
    const dataset = sampleDataset(`novel-store-${Date.now()}-a`);
    await saveNovelDataset(dataset);

    const updated: NovelSegment = {
      ...dataset.segments[0], status: 'completed', summary: '新的结构化摘要。', updatedAt: 2,
    };
    await saveNovelSegment(updated);
    await saveNovelDatasetHeader({ ...dataset, title: '重试时修改标题' });

    const stored = await getNovelDataset(dataset.id);
    expect(stored?.rawText).toBe(dataset.rawText);
    expect(stored?.chapters[0].content).toBe('旧摘要。');
    expect(stored?.segments[0]).toMatchObject({ status: 'completed', summary: '新的结构化摘要。' });
  });

  test('loads only the runtime neighbour window without chapter source content', async () => {
    const dataset = sampleDataset(`novel-store-${Date.now()}-window`);
    dataset.segments = Array.from({ length: 20 }, (_, index) => ({
      ...dataset.segments[0], id: `${dataset.id}-s${index}`, index,
      sourceText: '不应带入游戏运行时的原文', summary: `第${index}段摘要`,
    }));
    await saveNovelDataset(dataset);
    const window = await getNovelRuntimeWindow(dataset.id, 10);
    expect(window?.segments.map(segment => segment.index)).toEqual([9, 10, 11]);
    expect(window?.chapters).toEqual([]);
    expect(window?.segments.every(segment => segment.sourceText === undefined)).toBe(true);
  });

  test('deleting a dataset also removes chapters, segments and jobs', async () => {
    const dataset = sampleDataset(`novel-store-${Date.now()}-b`);
    const job: NovelAnalysisJob = {
      id: `${dataset.id}-job`, datasetId: dataset.id, status: 'queued', phase: 'evidence',
      startSegmentIndex: 0, total: 1, completed: 0, failed: 0, retryCount: 0,
      createdAt: 1, updatedAt: 1,
    };
    await saveNovelDataset(dataset);
    await saveNovelJob(job);

    await deleteNovelDataset(dataset.id);

    expect(await getNovelDataset(dataset.id)).toBeUndefined();
    expect(await listNovelChapters(dataset.id)).toEqual([]);
    expect(await listNovelSegments(dataset.id)).toEqual([]);
    expect(await listNovelJobs(dataset.id)).toEqual([]);
  });
});
