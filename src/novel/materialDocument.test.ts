import { describe, expect, test } from 'bun:test';
import { applyGeneratedMaterial, editNovelMaterial, novelMaterialConflicts, projectNovelMaterial, readNovelMaterialDocument, resolveNovelMaterialConflict } from './materialDocument';
import { NOVEL_ANALYSIS_VERSION } from './taskPlan';
import type { NovelDataset, NovelStaticMaterial } from './types';

function dataset(material: NovelStaticMaterial): NovelDataset {
  return {
    id: 'material-doc', title: '资料分层', sourceType: 'txt', schemaVersion: 2, rawTextLength: 4,
    chapters: [], segments: [], staticMaterial: material, analysisVersion: NOVEL_ANALYSIS_VERSION, createdAt: 1, updatedAt: 1,
  };
}

const generated: NovelStaticMaterial = { summary: '模型概述', rules: ['旧规则'], characters: [{ name: '沈砚', description: '游侠' }] };

describe('novel material document', () => {
  test('keeps authored fields across regeneration and reports the shadowed change as a conflict', () => {
    const first = applyGeneratedMaterial(dataset(generated), generated);
    expect(first.staticMaterial).toEqual(generated);
    expect(first.materialDocument?.edits).toEqual([]);

    const edited = editNovelMaterial(first, { ...generated, summary: '作者概述', rules: ['自定义规则'] });
    expect(edited.staticMaterial.summary).toBe('作者概述');
    expect(novelMaterialConflicts(edited)).toEqual([]);

    const regenerated = applyGeneratedMaterial(edited, { ...generated, summary: '第二次模型概述', rules: ['自定义规则'] });
    expect(regenerated.staticMaterial.summary).toBe('作者概述');
    // The override now equals the new baseline, so it stops shadowing later generations.
    expect(regenerated.materialDocument?.edits.map(edit => edit.field)).toEqual(['summary']);
    expect(novelMaterialConflicts(regenerated).map(edit => edit.field)).toEqual(['summary']);

    const accepted = resolveNovelMaterialConflict(regenerated, 'summary', 'generated');
    expect(accepted.staticMaterial.summary).toBe('第二次模型概述');
    expect(novelMaterialConflicts(accepted)).toEqual([]);

    const kept = resolveNovelMaterialConflict(regenerated, 'summary', 'author');
    expect(kept.staticMaterial.summary).toBe('作者概述');
    expect(novelMaterialConflicts(kept)).toEqual([]);
  });

  test('deleting a generated field stays an explicit override until it is accepted', () => {
    const base = applyGeneratedMaterial(dataset(generated), generated);
    const removed = editNovelMaterial(base, { ...generated, characters: undefined });
    expect(removed.staticMaterial.characters).toBeUndefined();
    expect(removed.materialDocument?.edits[0]).toMatchObject({ field: 'characters', remove: true, baseline: generated.characters });
    const regenerated = applyGeneratedMaterial(removed, { ...generated, characters: [{ name: '旧铜符持有者', description: '另一人' }] });
    expect(regenerated.staticMaterial.characters).toBeUndefined();
    expect(novelMaterialConflicts(regenerated).map(edit => edit.field)).toEqual(['characters']);
  });

  test('projection clones stored values so callers cannot mutate the baseline', () => {
    const base = applyGeneratedMaterial(dataset(generated), generated);
    const view = projectNovelMaterial(base.materialDocument!);
    view.characters![0].name = '改写';
    expect(base.materialDocument!.generated.characters![0].name).toBe('沈砚');
  });

  test('rejects malformed or duplicated overlays at the storage boundary', () => {
    expect(readNovelMaterialDocument(undefined)).toBeUndefined();
    expect(() => readNovelMaterialDocument({ version: 2, generated: {}, edits: [] })).toThrow();
    expect(() => readNovelMaterialDocument({ version: 1, generated: { summary: 3 }, edits: [] })).toThrow();
    expect(() => readNovelMaterialDocument({ version: 1, generated, edits: [
      { field: 'summary', value: '甲', remove: false },
      { field: 'summary', value: '乙', remove: false },
    ] })).toThrow();
    const valid = { version: 1 as const, generated, edits: [{ field: 'summary' as const, baseline: '模型概述', value: '作者概述', remove: false }] };
    expect(readNovelMaterialDocument(valid)).toEqual(valid);
  });
});
