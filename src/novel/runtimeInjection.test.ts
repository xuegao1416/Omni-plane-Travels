import { describe, expect, test } from 'bun:test';
import { buildNovelRuntimeInjection } from './runtimeInjection';
import type { NovelDataset } from './types';

const dataset: NovelDataset = {
  id: 'novel-demo',
  title: '测试小说世界',
  sourceType: 'structured',
  rawTextLength: 0,
  chapters: [],
  staticMaterial: {},
  segments: [
    { id: 's1', index: 0, title: '开场段', chapterIds: [], summary: '主角进入港口。', hardConstraints: ['尚未取得通行证。'], events: [] },
    { id: 's2', index: 1, title: '调查段', chapterIds: [], summary: '主角在档案馆查到线索。', hardConstraints: ['馆长不知道主角目的。'], events: [{
      name: '密函出现', description: '读者看见密函藏在书架后。',
      visibility: { knownBy: [], unknownTo: ['主角'], readerOnly: true },
    }] },
    { id: 's3', index: 2, title: '转折段', chapterIds: [], summary: '线索指向旧塔。', hardConstraints: [], events: [] },
  ],
  createdAt: 1,
  updatedAt: 1,
};

describe('novel runtime injection', () => {
  test('injects only the neighbouring segment window with the current constraints', () => {
    const text = buildNovelRuntimeInjection(dataset, 1, 2000);

    expect(text).toContain('上一阶段：开场段');
    expect(text).toContain('当前阶段：调查段');
    expect(text).toContain('下一阶段：转折段');
    expect(text).toContain('馆长不知道主角目的。');
    expect(text).toContain('仅读者视角，不得写为角色已知');
    expect(text).not.toContain('尚未取得通行证。');
    const withSecret = {
      ...dataset,
      segments: dataset.segments.map(segment => segment.index === 1 ? {
        ...segment,
        constraintDetails: [{ content: '馆长不知道主角目的。', confidence: 'explicit' as const,
          visibility: { knownBy: ['读者'], unknownTo: ['馆长'], readerOnly: true }, evidenceRefs: [] }],
      } : segment),
    };
    expect(buildNovelRuntimeInjection(withSecret, 1)).toContain('未知者：馆长');
  });

  test('lets explicitly adapted worlds resolve source conflicts using selected modules', () => {
    const text = buildNovelRuntimeInjection(dataset, 1, 4000, 'adapted');
    expect(text).toContain('世界改编');
    expect(text).toContain('冲突时以已启用模块规则为准');
    expect(text).toContain('原著约束参考：');
    expect(text).not.toContain('不可违背：');
    expect(text).toContain('仅读者视角，不得写为角色已知');
  });
});
