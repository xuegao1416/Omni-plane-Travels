import { describe, expect, test } from 'bun:test';
import { createDefaultStatModule } from '../modules/defaults';
import { formToWorldDef, injectModuleRuleEntries, worldToForm } from '../components/start/worldEditorForm/types';
import type { WorldDef } from '../data/worlds-schema';
import type { NovelDataset } from './types';
import { createWorldFromNovel, getNovelWorldReadiness, regenerateNovelWorldMaterial } from './worldFactory';

const dataset: NovelDataset = {
  id: 'dataset-native-world',
  title: '北境旧事',
  sourceType: 'txt',
  schemaVersion: 2,
  rawTextLength: 100,
  chapters: [],
  segments: [{
    id: 'segment-0',
    index: 0,
    title: '第一章',
    chapterIds: ['chapter-0'],
    summary: '旅人抵达北境。',
    hardConstraints: [],
    events: [],
    status: 'completed',
    analysisVersion: 3,
  }],
  staticMaterial: {
    summary: '北境诸城围绕旧王遗产彼此争斗。',
    characters: [{ name: '沈砚', role: '游侠', description: '追查旧王遗产。' }],
  },
  analysisStatus: 'ready',
  analysisVersion: 3,
  createdAt: 1,
  updatedAt: 1,
};

describe('novel world native compatibility', () => {
  test('saves untouched rich archives losslessly in the manual branch and protects subsequent edits', () => {
    const initial = createWorldFromNovel({ ...dataset, staticMaterial: { items: [{ id: 'sword', name: '旧剑', description: '原始', aliases: ['剑别名'], details: ['附加资料'] }] } });
    const form = worldToForm(initial);
    const saved = formToWorldDef(form, initial, []);
    expect(saved.worldBookEntries?.find(entry => entry.entryType === 'items')).toEqual(initial.worldBookEntries?.find(entry => entry.entryType === 'items'));
    form.items[0]!.name = '新剑';
    form.items[0]!.description = '手工描述';
    const changed = formToWorldDef(form, initial, []);
    const regenerated = regenerateNovelWorldMaterial(changed, { ...dataset, staticMaterial: { items: [{ id: 'sword', name: '自动新名', description: '模型描述' }] } });
    expect(regenerated.worldBookEntries?.filter(entry => entry.entryType === 'items')).toHaveLength(1);
    expect(regenerated.worldBookEntries?.find(entry => entry.entryType === 'items')).toMatchObject({ comment: '新剑', content: '手工描述', key: ['新剑', '剑别名'] });
  });

  test('distinguishes static-only and partial material and rejects empty worlds', () => {
    expect(getNovelWorldReadiness({ ...dataset, chapters: [], segments: [] }).status).toBe('static_only');
    expect(getNovelWorldReadiness({ ...dataset, analysisStatus: 'partial' }).status).toBe('partial');
    expect(() => createWorldFromNovel({ ...dataset, staticMaterial: {} })).toThrow();
  });
  test('preserves the novel binding and can stack native module rules', () => {
    const initial = createWorldFromNovel(dataset, 0);
    initial.writingStyleRef = 'style-wuxia';
    initial.eventPacks = [{ id: 'novel-events', type: 'rule', rules: [] }];
    (initial as WorldDef & { pluginExtension?: { enabled: boolean } }).pluginExtension = { enabled: true };
    initial.modules = [{
      moduleId: 'stat',
      name: '武学数值',
      enabled: true,
      moduleConfig: createDefaultStatModule() as unknown as Record<string, unknown>,
    }];

    const form = worldToForm(initial);
    const saved = formToWorldDef(form, initial, initial.worldBookEntries ?? []);
    injectModuleRuleEntries(saved, form, initial.worldBookEntries ?? []);

    expect(saved.novelSource).toEqual({
      datasetId: dataset.id,
      startSegmentIndex: 0,
      schemaVersion: dataset.schemaVersion,
      analysisVersion: dataset.analysisVersion,
    });
    expect(saved.novelAdaptationMode).toBe('source_faithful');
    expect(saved.writingStyleRef).toBe('style-wuxia');
    expect(saved.eventPacks?.[0]?.id).toBe('novel-events');
    expect((saved as WorldDef & { pluginExtension?: { enabled: boolean } }).pluginExtension).toEqual({ enabled: true });
    expect(saved.worldBookEntries?.some(entry => entry.comment === '原著世界概览')).toBe(true);
    expect(saved.worldBookEntries?.some(entry => entry.entryType === 'module_rule')).toBe(true);
  });

  test('edits novel rules and items in the native form without discarding other generated entries', () => {
    const initial = createWorldFromNovel({ ...dataset, staticMaterial: { ...dataset.staticMaterial, rules: ['原始规则'], items: [{ name: '旧剑', description: '道具原始描述' }] } });
    const form = worldToForm(initial);
    form.specialRules = '手工修正规则';
    form.items = [{ name: '旧剑', description: '手工道具描述' }];
    const saved = formToWorldDef(form, initial, initial.worldBookEntries ?? []);
    expect(saved.worldBookEntries?.find(entry => entry.entryType === 'rules')?.meta?.specialRules).toEqual(['手工修正规则']);
    expect(saved.worldBookEntries?.find(entry => entry.entryType === 'items')?.content).toBe('手工道具描述');
    expect(saved.worldBookEntries?.some(entry => entry.comment === '沈砚')).toBe(true);
  });
});
