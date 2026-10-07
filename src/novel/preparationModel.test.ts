import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { createNovelDatasetFromText } from './plainText';
import { buildNovelTaskPlan } from './taskPlan';
import { rebuildNovelDatasetSegments } from './workbenchState';
import { runNovelAnalysis, type NovelAnalysisGenerators } from './analysisRunner';
import { getNovelDataset, saveNovelDataset } from './novelStore';
import { editNovelMaterial } from './materialDocument';
import { estimateNovelTokens } from './segmentation';
import { importNovelDataset } from './datasetImport';

const config = { baseUrl: 'https://fixture.invalid/v1', model: 'fixture', provider: 'custom' as const, apiKey: '', stream: false };
const evidence = { summary: '旧城', facts: [], characters: [], factions: [], locations: [], items: [], events: [], rules: [], relationships: [], openThreads: [], evidenceRefs: [] };

test('request budgets preserve chapters and semantic units while changing request batches', () => {
  const source = createNovelDatasetFromText('预算', `第一章 城门\n${'甲走入旧城。'.repeat(300)}\n第二章 市集\n${'城中以铜币交易。'.repeat(300)}`);
  const small = buildNovelTaskPlan(source, { goal: 'background', inputBudget: 1000 });
  const large = buildNovelTaskPlan(source, { goal: 'background', inputBudget: 6000 });
  expect(small.units.map(unit => unit.id)).toEqual(large.units.map(unit => unit.id));
  expect(small.batches.length).toBeGreaterThan(large.batches.length);
  expect(small.batches.every(batch => batch.estimatedTokens <= 1000)).toBe(true);
  for (const batch of small.batches) for (const part of batch.parts) {
    const chapter = source.chapters.find(chapter => chapter.id === part.range.chapterId)!;
    expect(chapter.content.slice(part.range.startOffset, part.range.endOffset)).toBe(part.sourceText);
  }
  const rebuilt = rebuildNovelDatasetSegments(source, source.chapters, { maxTokens: 1000 });
  expect(rebuilt.segments.map(segment => segment.id)).toEqual(source.segments.map(segment => segment.id));
});

test('short background has one combined request and no implicit story or index stage', async () => {
  const source = createNovelDatasetFromText('短书', '第一章 起点\n甲居住在旧城。\n第二章 市集\n乙来到旧城。');
  await saveNovelDataset(source);
  const plan = buildNovelTaskPlan(source, { goal: 'background' });
  expect(plan.units).toHaveLength(2);
  expect(plan.requests.min).toBe(1);
  let calls = 0;
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => { calls++; return { batchId: batch.id, inputHash: batch.id,
      material: { summary: '旧城背景' }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) }; },
    evidence: async () => { throw Error('unexpected evidence stage'); },
    overview: async () => { throw Error('unexpected overview stage'); },
    segment: async () => { throw Error('unexpected story stage'); },
  };
  const result = await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  expect(calls).toBe(1);
  expect(result.worldReady).toBe(true);
  expect(result.job.embeddedChunks).toBeUndefined();
  expect(result.dataset.segments.every(segment => segment.evidenceNotes && segment.status !== 'completed')).toBe(true);
});

test('paid background batch survives cancellation; later retry and budget-only change reuse accepted evidence', async () => {
  const source = createNovelDatasetFromText('恢复', '第一章 城门\n甲居住在旧城。\n第二章 市集\n乙来到旧城。');
  await saveNovelDataset(source);
  let calls = 0;
  const controller = new AbortController();
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => { calls++; if (calls === 1) controller.abort(); return { batchId: batch.id, inputHash: batch.id,
      material: { summary: '旧城背景' }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) }; },
    evidence: async () => { throw Error('unused'); }, overview: async () => { throw Error('unused'); }, segment: async () => { throw Error('unused'); },
  };
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background', signal: controller.signal });
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  const stored = (await getNovelDataset(source.id))!;
  await saveNovelDataset(rebuildNovelDatasetSegments(stored, stored.chapters, { maxTokens: 1000 }));
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  expect(calls).toBe(1);
});

test('later failed batches keep prior paid fragments, recover only missing work, and preserve concurrent author edits', async () => {
  const source = createNovelDatasetFromText('局部恢复', `第一章 长街\n${'甲走入旧城。'.repeat(360)}`);
  source.taskPreparation = { mode: 'auto', maxTokens: 1000, startChapterIndex: 0, endChapterIndex: 0 };
  await saveNovelDataset(source);
  const calls: string[] = []; let fail = true;
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => {
      calls.push(batch.id);
      if (calls.length === 2 && fail) { fail = false; throw Error('temporary'); }
      const current = (await getNovelDataset(source.id))!;
      await saveNovelDataset(editNovelMaterial(current, { ...current.staticMaterial, summary: '作者的版本' }));
      return { batchId: batch.id, inputHash: batch.id, material: { summary: '模型背景' }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) };
    },
    evidence: async () => { throw Error('unused'); }, overview: async () => { throw Error('unused'); }, segment: async () => { throw Error('unused'); },
  };
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  const first = calls[0];
  const result = await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  expect(calls.filter(id => id === first)).toHaveLength(1);
  expect(result.dataset.staticMaterial.summary).toBe('作者的版本');
  expect(result.dataset.materialDocument?.generated.summary).toBe('模型背景');
  expect(result.dataset.segments.every(segment => segment.evidenceNotes)).toBe(true);
});

test('story fragments stay within budget and a completed semantic story survives budget-only edits', async () => {
  const source = createNovelDatasetFromText('剧情预算', `第一章 长街\n${'甲走入旧城。'.repeat(360)}`);
  source.taskPreparation = { mode: 'auto', maxTokens: 1000, startChapterIndex: 0, endChapterIndex: 0 };
  await saveNovelDataset(source);
  let storyCalls = 0;
  const story = { summary: '抵达', openingFacts: [], carryFacts: [], endingFacts: ['抵达'], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] };
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => ({ batchId: batch.id, inputHash: batch.id, material: { summary: '旧城背景' }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) }),
    evidence: async () => { throw Error('unused'); }, overview: async () => { throw Error('unused'); },
    segment: async ({ sourceText, previousEndingFacts }) => { storyCalls++; expect(estimateNovelTokens(sourceText)).toBeLessThanOrEqual(1000); if (storyCalls > 1) expect(previousEndingFacts).toEqual(['抵达']); return story; },
  };
  const first = await runNovelAnalysis({ datasetId: source.id, config, generators });
  expect(storyCalls).toBeGreaterThan(1);
  expect(first.dataset.segments).toHaveLength(1);
  const before = storyCalls;
  await saveNovelDataset(rebuildNovelDatasetSegments(first.dataset, first.dataset.chapters, { maxTokens: 6000 }));
  await runNovelAnalysis({ datasetId: source.id, config, generators });
  expect(storyCalls).toBe(before);
});

test('import rejects malformed preparation checkpoints rather than accepting partial task state', () => {
  const source = createNovelDatasetFromText('恢复校验', '第一章 起点\n甲居住在旧城。');
  expect(() => importNovelDataset({ ...source, preparation: { version: 1, batches: 'broken' } })).toThrow('preparation');
  expect(() => importNovelDataset({ ...source, taskPreparation: { mode: 'custom', maxTokens: -1, startChapterIndex: 3, endChapterIndex: 0 } })).toThrow('taskPreparation');
});

test('failed explicit background refresh resumes that intent without paying for evidence again', async () => {
  const source = createNovelDatasetFromText('归并恢复', '第一章 起点\n甲居住在旧城。');
  await saveNovelDataset(source);
  let evidenceCalls = 0, overviewCalls = 0;
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => { evidenceCalls++; return { batchId: batch.id, inputHash: batch.id, material: { summary: '旧背景' }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) }; },
    evidence: async () => { throw Error('unused'); }, segment: async () => { throw Error('unused'); },
    overview: async () => { overviewCalls++; if (overviewCalls === 1) throw Error('temporary'); return { summary: '新背景' }; },
  };
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background', forceOverview: true });
  const continued = await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  expect(evidenceCalls).toBe(1);
  expect(overviewCalls).toBe(2);
  expect(continued.dataset.staticMaterial.summary).toBe('新背景');
});

test('a paid response from an explicit refresh is recovered after cancellation rather than refreshed again', async () => {
  const source = createNovelDatasetFromText('付费归并恢复', '第一章 起点\n甲居住在旧城。');
  await saveNovelDataset(source);
  const controller = new AbortController(); let overviewCalls = 0;
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => ({ batchId: batch.id, inputHash: batch.id, material: { summary: '旧背景' }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) }),
    evidence: async () => { throw Error('unused'); }, segment: async () => { throw Error('unused'); },
    overview: async () => { overviewCalls++; controller.abort(); return { summary: '新背景' }; },
  };
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background', forceOverview: true, signal: controller.signal });
  const continued = await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
  expect(overviewCalls).toBe(1);
  expect(continued.dataset.staticMaterial.summary).toBe('新背景');
});
