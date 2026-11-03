import { describe, expect, test } from 'bun:test';
import { compileNovelArchives, collectNovelStaticObservations } from './archiveCompiler';
import type { NovelSegment, NovelEvidenceNote } from './types';

function segment(id: string, archives: NovelEvidenceNote['archives']): NovelSegment {
  return { id, index: Number(id.replace(/\D/g, '')) || 0, title: id, chapterIds: [id], summary: '', hardConstraints: [], events: [],
    evidenceNotes: { summary: '', facts: [], characters: [], factions: [], locations: [], items: [], events: [], rules: [], relationships: [], openThreads: [], evidenceRefs: [], archives } };
}

describe('complete novel archive compiler', () => {
  test('merges explicit aliases and exact discoveries while preserving every description and citation', async () => {
    const citation = { chapterId: 'c', startOffset: 0, endOffset: 2, excerpt: '证据', confidence: 'explicit' as const };
    const result = await compileNovelArchives('book', [
      segment('s1', { characters: [{ name: '白昼', aliases: ['阿白'], description: '药铺学徒', details: ['精通药理'], evidenceRefs: [citation] }] }),
      segment('s2', { characters: [{ name: '阿白', description: '常年居住北城', evidenceRefs: [citation] }] }),
      segment('s3', { characters: [{ name: '白昼', aliases: ['阿白'], description: '药铺学徒', details: ['精通药理'], evidenceRefs: [citation] }] }),
    ]);
    expect(result.findingsTotal).toBe(3);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.description).toContain('药铺学徒');
    expect(result.records[0]?.description).toContain('常年居住北城');
    expect(result.records[0]?.evidenceRefs).toHaveLength(1);
    expect(result.records[0]?.sourceFindingIds).toHaveLength(3);
    expect(result.records[0]?.aliases).toContain('阿白');
  });

  test('keeps different people with the same name separate and explains the conflict', async () => {
    const result = await compileNovelArchives('book', [segment('s1', { characters: [
      { name: '林青', role: '东城医师', description: '终生居于东城' },
      { name: '林青', role: '西海船长', description: '出生并长居西海' },
    ] })]);
    expect(result.records).toHaveLength(2);
    expect(result.records.every(record => record.conflict)).toBe(true);
    expect(result.unresolved[0]?.reason).toBe('ambiguous_identity');
  });

  test('retains thousands of entities without asking a model for a whole-book list', async () => {
    const segments = Array.from({ length: 50 }, (_, i) => segment(`s${i}`, {
      items: Array.from({ length: 50 }, (_, j) => ({ name: `物品${i}-${j}`, description: `完整描述${i}-${j}` })),
    }));
    let calls = 0;
    const result = await compileNovelArchives('book', segments, { resolve: async () => { calls++; return []; } });
    expect(result.records).toHaveLength(2500);
    expect(result.findingsTotal).toBe(2500);
    expect(new Set(result.records.flatMap(record => record.sourceFindingIds ?? [])).size).toBe(2500);
    expect(calls).toBe(0);
  });

  test('rejects dropped, duplicated and invented resolver IDs without losing discoveries', async () => {
    for (const invalid of ['missing', 'duplicate', 'unknown']) {
      const result = await compileNovelArchives('book', [segment('s1', { locations: [
        { name: '北城', description: '悬浮在天空的城市' }, { name: '北城', description: '建于海底的城市' },
      ] })], { resolve: async group => invalid === 'missing' ? [[group.findings[0]!.findingId]]
        : invalid === 'duplicate' ? [group.findings.map(finding => finding.findingId), [group.findings[0]!.findingId]]
        : [group.findings.map(finding => finding.findingId), ['invented']] });
      expect(result.records).toHaveLength(2);
      expect(result.records.flatMap(record => record.sourceFindingIds ?? [])).toHaveLength(2);
      expect(result.unresolved.some(issue => issue.reason === 'invalid_resolution')).toBe(true);
    }
  });

  test('bounds ambiguous groups and checkpoints only validated resolutions', async () => {
    let checkpoints = 0;
    const result = await compileNovelArchives('book', [segment('s1', { factions: Array.from({ length: 70 }, (_, i) => ({ name: '公会', description: `分支${i}` })) })], {
      resolve: async group => {
        expect(group.findings.length).toBeLessThanOrEqual(24);
        expect(JSON.stringify(group).length).toBeLessThanOrEqual(14000);
        return group.findings.map(finding => [finding.findingId]);
      }, onCheckpoint: async () => { checkpoints++; },
    });
    expect(checkpoints).toBeGreaterThan(1);
    expect(result.records).toHaveLength(70);
  });

  test('entity IDs survive appending chapters and explicit source identities are honored', async () => {
    const first = segment('s1', { items: [{ id: 'explicit-sword', name: '旧剑', description: '旧铁剑' }], characters: [{ name: '舟客', description: '摆渡人' }] });
    const initial = await compileNovelArchives('book', [first]);
    const extended = await compileNovelArchives('book', [first, segment('s2', { characters: [{ name: '舟客', description: '摆渡人' }] })]);
    expect(extended.records.map(record => record.id)).toEqual(initial.records.map(record => record.id));
    expect(extended.records.find(record => record.category === 'items')?.id).toBe('explicit-sword');
  });

  test('collects only static observations without promoting chronology into rules', () => {
    const source = segment('s1', {});
    source.evidenceNotes!.facts = ['主角死亡'];
    source.evidenceNotes!.staticFindings = { settings: ['城市悬空'], rules: ['法术耗能'], culture: [], powerSystem: [], economy: ['使用银币'], time: [] };
    expect(collectNovelStaticObservations([source, source])).toEqual({ settings: ['城市悬空'], rules: ['法术耗能'], culture: [], powerSystem: [], economy: ['使用银币'], time: [] });
  });
});
