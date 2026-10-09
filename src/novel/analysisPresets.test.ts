import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { applyNovelAnalysisPreset, novelPresetFingerprint, readNovelAnalysisPreset, type NovelAnalysisPreset } from './analysisPresets';
import { runNovelAnalysis, type NovelAnalysisGenerators } from './analysisRunner';
import { createNovelDatasetFromText } from './plainText';
import { saveNovelDataset } from './novelStore';
import { buildNovelTaskPlan } from './taskPlan';
import { importNovelDataset } from './datasetImport';

const config = { baseUrl: 'https://presets.invalid/v1', model: 'fixture', provider: 'custom' as const, apiKey: '', stream: false };
const adult: NovelAnalysisPreset = { id: 'adult_analysis', customInstructions: '' };
const evidence = { summary: '旧城', facts: [], characters: [], factions: [], locations: [], items: [], events: [], rules: [], relationships: [], openThreads: [], evidenceRefs: [] };
const story = { summary: '抵达', openingFacts: [], carryFacts: [], endingFacts: ['抵达'], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] };

test('legacy general prompts stay reusable; inactive drafts do not change the adult fingerprint', () => {
  expect(readNovelAnalysisPreset(undefined)).toEqual({ id: 'general', customInstructions: '' });
  expect(novelPresetFingerprint()).toBeUndefined();
  expect(novelPresetFingerprint(adult)).toBe(novelPresetFingerprint({ ...adult, customInstructions: '未启用的草稿' }));
  expect(novelPresetFingerprint({ id: 'custom', customInstructions: '人物动机' })).not.toBe(novelPresetFingerprint({ id: 'custom', customInstructions: '人物关系' }));
  expect(() => readNovelAnalysisPreset({ id: 'unknown', customInstructions: '' })).toThrow();
});

test('adult and custom preferences keep the output contract and platform boundaries in system instructions', () => {
  const messages = [{ role: 'system' as const, content: '返回 JSON' }, { role: 'user' as const, content: '原文资料' }];
  const prepared = applyNovelAnalysisPreset(messages, adult);
  expect(prepared).toHaveLength(2);
  expect(prepared[0].content).toContain('同意或强迫');
  expect(prepared[0].content).toContain('不续写');
  expect(prepared[0].content).toContain('内容安全限制');
  expect(prepared[0].content).toContain('返回 JSON');
  expect(prepared[1]).toEqual(messages[1]);
  expect(messages[0].content).toBe('返回 JSON');
  const custom = applyNovelAnalysisPreset(messages, { id: 'custom', customInstructions: '重点分析人物动机' });
  expect(custom[0].content).toContain('重点分析人物动机');
  expect(custom[0].content).toContain('不得覆盖');
});

test('preset changes rebuild evidence, background and story; unchanged presets and model-only edits reuse evidence', async () => {
  const source = createNovelDatasetFromText('预设缓存', '第一章 起点\n甲居住在旧城。');
  await saveNovelDataset(source);
  let backgrounds = 0, stories = 0;
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => { backgrounds++; return { batchId: batch.id, inputHash: batch.id,
      material: { summary: `背景${backgrounds}` }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) }; },
    evidence: async () => { throw Error('unused'); }, overview: async () => ({ summary: '归并背景' }),
    segment: async () => { stories++; return story; },
  };
  const run = (preset?: NovelAnalysisPreset, cfg = config) => runNovelAnalysis({ datasetId: source.id, config: cfg, generators, preset });
  const general = await run();
  expect(buildNovelTaskPlan(general.dataset, { goal: 'full', config, preset: adult }).requests.min).toBeGreaterThan(0);
  const changed = await run(adult);
  expect(backgrounds).toBe(2);
  expect(stories).toBe(2);
  expect(changed.dataset.staticMaterial.summary).toBe('背景2');
  expect(changed.dataset.preparation?.batches[0].presetFingerprint).toBe(novelPresetFingerprint(adult));
  expect(importNovelDataset(changed.dataset).preparation?.batches[0].presetFingerprint).toBe(novelPresetFingerprint(adult));
  expect(buildNovelTaskPlan(changed.dataset, { goal: 'full', config, preset: adult }).requests.min).toBe(0);
  await run(adult);
  expect(backgrounds).toBe(2); expect(stories).toBe(2);
  await run(adult, { ...config, model: 'another-model' });
  expect(backgrounds).toBe(2); expect(stories).toBe(3);
  await run({ id: 'custom', customInstructions: '人物动机' });
  await run({ id: 'custom', customInstructions: '人物关系' });
  expect(backgrounds).toBe(4); expect(stories).toBe(5);
});

test('failed extraction after a preset switch cannot compile old evidence as the new result', async () => {
  const source = createNovelDatasetFromText('预设失败', '第一章 起点\n甲居住在旧城。');
  await saveNovelDataset(source);
  let fail = false, stories = 0;
  const generators: NovelAnalysisGenerators = {
    prepareBatch: async ({ batch }) => {
      if (fail) throw Error('模型平台已拦截本段内容');
      return { batchId: batch.id, inputHash: batch.id, material: { summary: '背景' }, parts: batch.parts.map(part => ({ partId: part.id, evidence })) };
    },
    evidence: async () => { throw Error('unused'); }, overview: async () => ({ summary: '背景' }),
    segment: async () => { stories++; return story; },
  };
  await runNovelAnalysis({ datasetId: source.id, config, generators });
  fail = true;
  const result = await runNovelAnalysis({ datasetId: source.id, config, generators, preset: adult });
  expect(result.dataset.segments[0].evidenceNotes).toBeUndefined();
  expect(result.dataset.segments[0].status).toBe('failed');
  expect(result.dataset.preparation?.batches).toHaveLength(0);
  expect(stories).toBe(1);
  expect(result.job.status).toBe('failed');
});

test('production requests apply the preset during batch preparation and JSON repair', async () => {
  const source = createNovelDatasetFromText('预设请求', '第一章 起点\n甲居住在旧城。');
  await saveNovelDataset(source);
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (async (_url: unknown, options?: RequestInit) => {
    calls++;
    const messages = JSON.parse(String(options?.body)).messages;
    expect(messages[0].content).toContain('客观文学分析');
    expect(messages[0].content).toContain('内容安全限制');
    const parts = JSON.parse(messages[1].content.match(/<source_parts>\n([\s\S]*?)\n<\/source_parts>/)[1]);
    const text = calls === 1 ? '{invalid' : JSON.stringify({ material: { summary: '背景' }, parts: parts.map((part: { id: string }) => ({ partId: part.id, evidence })) });
    return new Response(JSON.stringify({ choices: [{ message: { content: text }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  try {
    const result = await runNovelAnalysis({ datasetId: source.id, config: { ...config, baseUrl: `https://${source.id}.invalid/v1`, rateLimitMs: 0 }, preset: adult, goal: 'background' });
    expect(calls).toBe(2);
    expect(result.job.status).toBe('completed');
  } finally { globalThis.fetch = originalFetch; }
});
