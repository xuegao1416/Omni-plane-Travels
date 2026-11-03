import { describe, expect, test } from 'bun:test';
import type { ApiConfig } from '../api/types';
import { NOVEL_ANALYSIS_VERSION, buildNovelTaskPlan, novelAnalysisChannel, novelEvidenceInputHash, novelStoryInputHash } from './taskPlan';
import type { NovelDataset, NovelEvidenceNote, NovelSegment } from './types';

const config: ApiConfig = { apiKey: 'test', baseUrl: 'https://example.invalid/v1', model: 'test', provider: 'custom', stream: false };
const note: NovelEvidenceNote = { summary: '证据', facts: [], characters: [], factions: [], locations: [], items: [], events: [], rules: [], relationships: [], openThreads: [], evidenceRefs: [] };

function dataset(id: string): NovelDataset {
  const chapters = [
    { id: `${id}-c1`, datasetId: id, index: 0, title: '第一章', content: '甲章正文', startOffset: 0, endOffset: 4 },
    { id: `${id}-c2`, datasetId: id, index: 1, title: '第二章', content: '乙章正文', startOffset: 4, endOffset: 8 },
  ];
  const segments: NovelSegment[] = chapters.map((chapter, index) => ({
    id: `${id}-s${index + 1}`, datasetId: id, index, title: chapter.title, chapterIds: [chapter.id], sourceText: chapter.content,
    status: 'pending', summary: '', hardConstraints: [], events: [], evidenceRefs: [],
  }));
  return { id, title: '计划测试', sourceType: 'txt', schemaVersion: 2, rawTextLength: 8, chapters, segments, staticMaterial: {}, analysisVersion: NOVEL_ANALYSIS_VERSION, createdAt: 1, updatedAt: 1 };
}

describe('novel task plan', () => {
  test('a fresh dataset pays for evidence and world material before any plot', () => {
    const source = dataset('plan-fresh');
    const background = buildNovelTaskPlan(source, { goal: 'background', config });
    expect(background.stages.map(stage => stage.kind)).toEqual(['background']);
    expect(background.requests).toEqual({ min: 1, max: 3 });

    const full = buildNovelTaskPlan(source, { goal: 'full', config });
    expect(full.stages.map(stage => stage.kind)).toEqual(['background', 'segments']);
    expect(full.requests.min).toBe(3);
  });

  test('counts finished work as reusable and stops counting plot for a background goal', () => {
    const base = dataset('plan-done');
    const finished: NovelSegment[] = base.segments.map(segment => ({
      ...segment, evidenceNotes: note, evidenceStatus: 'completed', analysisVersion: NOVEL_ANALYSIS_VERSION, status: 'completed', endingFacts: ['已确认'],
    }));
    const context = { ...base, segments: finished };
    const channel = novelAnalysisChannel(config)!;
    base.segments = finished.map((segment, index): NovelSegment => ({
      ...segment,
      evidenceInputHash: novelEvidenceInputHash(context, segment),
      analysisInputHash: novelStoryInputHash(context, index, channel, 'basic'),
    }));
    base.staticMaterial = { summary: '已有概述' };
    base.overviewInputHash = 'stored-overview';

    expect(buildNovelTaskPlan(base, { goal: 'full', config, channels: [channel], retrieval: 'basic' }).requests.min).toBe(0);
    const background = buildNovelTaskPlan(base, { goal: 'background', config, retrieval: 'basic' });
    expect(background.stages.map(stage => stage.kind)).toEqual(['background']);
    expect(background.requests.min).toBe(0);
  });

  test('an explicit refresh ignores every cached stage it invalidates', () => {
    const base = dataset('plan-refresh');
    base.segments = base.segments.map(segment => ({
      ...segment, evidenceNotes: note, evidenceStatus: 'completed', evidenceInputHash: novelEvidenceInputHash(base, segment), analysisVersion: NOVEL_ANALYSIS_VERSION,
    }));
    base.staticMaterial = { summary: '已有概述' };
    base.overviewInputHash = 'stored-overview';

    expect(buildNovelTaskPlan(base, { goal: 'full', config, forceOverview: true }).requests.min).toBe(3);
    expect(buildNovelTaskPlan(base, { goal: 'full', config, reExtractEvidence: true }).requests.min).toBe(3);
    expect(buildNovelTaskPlan(base, { goal: 'background', config, forceOverview: true }).requests.min).toBe(1);
  });

  test('evidence extracted by an earlier channel still counts as reusable', () => {
    const base = dataset('plan-channel');
    const legacy = `${novelAnalysisChannel(config)}-legacy`;
    base.segments = base.segments.map(segment => ({
      ...segment, evidenceNotes: note, evidenceStatus: 'completed', evidenceInputHash: novelEvidenceInputHash(base, segment, legacy), analysisVersion: NOVEL_ANALYSIS_VERSION,
    }));
    const plan = buildNovelTaskPlan(base, { goal: 'background', config, channels: [legacy] });
    expect(plan.stages[0].reusable).toBe(1);
    expect(plan.requests.min).toBe(1);
  });
});
