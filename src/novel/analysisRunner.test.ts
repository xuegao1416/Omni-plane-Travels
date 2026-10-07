import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import type { ApiConfig } from '../api/types';
import { getNovelDataset, listNovelJobs, saveNovelDataset, saveNovelJob } from './novelStore';
import { NOVEL_ANALYSIS_VERSION, runNovelAnalysis, type NovelAnalysisGenerators } from './analysisRunner';
import { editNovelMaterial, novelMaterialConflicts } from './materialDocument';
import { hashNovelText } from './segmentation';
import type { NovelDataset, NovelEvidenceNote, NovelStaticMaterial } from './types';
import { listNovelPaidProducts } from './paidProducts';
import { NOVEL_SEGMENTS_STORE } from '../storage/db';

const config: ApiConfig = { apiKey: 'test', baseUrl: 'https://example.invalid/v1', model: 'test', provider: 'custom', stream: false };

function dataset(id: string): NovelDataset {
  return {
    id, title: '任务测试', sourceType: 'txt', schemaVersion: 2, rawTextLength: 10, rawText: '甲章正文乙章正文',
    chapters: [
      { id: `${id}-c1`, datasetId: id, index: 0, title: '第一章', content: '甲章正文', startOffset: 0, endOffset: 4, wordCount: 4, contentHash: 'c1' },
      { id: `${id}-c2`, datasetId: id, index: 1, title: '第二章', content: '乙章正文', startOffset: 4, endOffset: 8, wordCount: 4, contentHash: 'c2' },
    ],
    segments: [
      { id: `${id}-s1`, datasetId: id, index: 0, title: '第一章', chapterIds: [`${id}-c1`], sourceText: '甲章正文', estimatedTokens: 4, inputHash: 's1', status: 'pending', summary: '', hardConstraints: [], events: [], evidenceRefs: [] },
      { id: `${id}-s2`, datasetId: id, index: 1, title: '第二章', chapterIds: [`${id}-c2`], sourceText: '乙章正文', estimatedTokens: 4, inputHash: 's2', status: 'pending', summary: '', hardConstraints: [], events: [], evidenceRefs: [] },
    ],
    staticMaterial: {}, analysisStatus: 'draft', createdAt: 1, updatedAt: 1,
  };
}

const note = (name: string): NovelEvidenceNote => ({
  summary: `${name}证据`, facts: [`${name}事实`], characters: [name], factions: [], locations: [], items: [],
  events: [], rules: [], relationships: [], openThreads: [], evidenceRefs: [],
});

const overview: NovelStaticMaterial = { summary: '全书总览', rules: ['不得编造'] };

describe('novel analysis runner', () => {
  test('source edits reject stale analysis while keeping its paid response and failed task record', async () => {
    const source = dataset(crypto.randomUUID()); await saveNovelDataset(source);
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => {
        const current = (await getNovelDataset(source.id))!;
        current.chapters[0].content = '作者的新原文'; current.rawText = '作者的新原文';
        await saveNovelDataset(current); return note(segment.title);
      },
      overview: async () => overview,
      segment: async () => { throw new Error('not reached'); },
    };
    await expect(runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' })).rejects.toThrow('原文或处理范围已修改');
    expect((await getNovelDataset(source.id))!.chapters[0].content).toBe('作者的新原文');
    expect((await listNovelPaidProducts(source.id))).toHaveLength(1);
    expect((await listNovelJobs(source.id))[0].status).toBe('failed');
  });

  test('real request responses survive a failed projection write and resume without another request', async () => {
    const source = dataset(crypto.randomUUID()); source.segments = source.segments.slice(0, 1);
    await saveNovelDataset(source);
    const originalFetch = globalThis.fetch, originalPut = IDBObjectStore.prototype.put;
    let calls = 0, fail = true, responseText = ''; const interrupted = new AbortController();
    globalThis.fetch = (async (_url: string | URL | Request, options?: RequestInit) => {
      calls++;
      const prompt = JSON.parse(String(options?.body)).messages[1].content;
      const parts = JSON.parse(prompt.match(/<source_parts>\n([\s\S]*?)\n<\/source_parts>/)[1]);
      responseText = JSON.stringify({ parts: parts.map((part: { id: string }) => ({ partId: part.id, evidence: note('第一章') })), material: overview });
      return new Response(JSON.stringify({ choices: [{ message: { content: responseText }, finish_reason: 'stop' }] }), { headers: { 'Content-Type': 'application/json' } });
    }) as unknown as typeof fetch;
    IDBObjectStore.prototype.put = function (...args: Parameters<typeof originalPut>) {
      if (this.name === NOVEL_SEGMENTS_STORE && args[0].evidenceStatus === 'completed' && fail) { fail = false; interrupted.abort(); throw new DOMException('write failed', 'QuotaExceededError'); }
      return originalPut.apply(this, args);
    };
    try {
      const cfg = { ...config, baseUrl: `https://${source.id}.invalid/v1`, rateLimitMs: 1000 };
      await runNovelAnalysis({ datasetId: source.id, config: cfg, goal: 'background', signal: interrupted.signal });
      expect(calls).toBe(1);
      const products = await listNovelPaidProducts(source.id);
      expect(products).toHaveLength(1);
      expect(products[0].value).toMatchObject({ text: responseText });
      expect(JSON.stringify(products)).not.toContain(cfg.apiKey + '\"');
      await runNovelAnalysis({ datasetId: source.id, config: cfg, goal: 'background' });
      expect(calls).toBe(1);
      expect((await getNovelDataset(source.id))!.staticMaterial.summary).toBe(overview.summary);
    } finally { globalThis.fetch = originalFetch; IDBObjectStore.prototype.put = originalPut; }
  });

  test('retains a complete paid response on cancellation and resumes without paying twice', async () => {
    const source = dataset(crypto.randomUUID());
    await saveNovelDataset(source);
    const controller = new AbortController();
    let calls = 0;
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => { calls++; if (calls === 1) controller.abort(); return note(segment.title); },
      overview: async () => overview,
      segment: async () => { throw new Error('background does not compile story'); },
    };
    const paused = await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background', signal: controller.signal });
    expect(paused.job.status).toBe('paused');
    await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
    expect(calls).toBe(2);
  });

  test('author edits and title saved while overview is pending survive result acceptance', async () => {
    const source = dataset(crypto.randomUUID());
    await saveNovelDataset(source);
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => note(segment.title),
      overview: async () => {
        const current = (await getNovelDataset(source.id))!;
        await saveNovelDataset({ ...editNovelMaterial(current, { ...current.staticMaterial, summary: '玩家修改' }), title: '玩家新标题' });
        return overview;
      },
      segment: async () => { throw new Error('background does not compile story'); },
    };
    await runNovelAnalysis({ datasetId: source.id, config, generators, goal: 'background' });
    const stored = (await getNovelDataset(source.id))!;
    expect(stored.title).toBe('玩家新标题');
    expect(stored.staticMaterial.summary).toBe('玩家修改');
    expect(stored.materialDocument?.generated.summary).toBe(overview.summary);
  });

  test('keeps later successful segments when an earlier segment fails', async () => {
    const source = dataset(`novel-runner-${Date.now()}-a`);
    await saveNovelDataset(source);
    let failFirstSegment = true;
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => note(segment.title),
      overview: async () => overview,
      segment: async ({ segment }) => {
        if (segment.index === 0 && failFirstSegment) throw new Error('局部解析失败');
        return { summary: '第二段完成', openingFacts: [], carryFacts: [], endingFacts: ['已抵达'], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] };
      },
    };

    const result = await runNovelAnalysis({ datasetId: source.id, config, startSegmentIndex: 0, generators });
    const stored = await getNovelDataset(source.id);

    expect(result.worldReady).toBe(false);
    expect(stored?.segments.map(segment => segment.status)).toEqual(['failed', 'completed']);
    expect(stored?.segments[1].summary).toBe('第二段完成');
    expect((await listNovelJobs(source.id))[0]).toMatchObject({ status: 'failed', failed: 1 });

    failFirstSegment = false;
    const resumed = await runNovelAnalysis({ datasetId: source.id, config, startSegmentIndex: 0, generators });
    expect(resumed.job.completed).toBe(resumed.job.total);
  });

  test('resumes from completed segment checkpoints without spending calls again', async () => {
    const source = dataset(`novel-runner-${Date.now()}-b`);
    await saveNovelDataset(source);
    let evidenceCalls = 0;
    let segmentCalls = 0;
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => { evidenceCalls += 1; return { ...note(segment.title), staticFindings: { settings: [], rules: [], culture: [], powerSystem: [], economy: [], time: [] } }; },
      overview: async () => overview,
      segment: async ({ segment }) => {
        segmentCalls += 1;
        return { summary: `${segment.title}完成`, openingFacts: [], carryFacts: [], endingFacts: ['完成'], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] };
      },
    };

    const first = await runNovelAnalysis({ datasetId: source.id, config, startSegmentIndex: 0, generators });
    const second = await runNovelAnalysis({ datasetId: source.id, config, startSegmentIndex: 0, generators });

    expect(first.worldReady).toBe(true);
    expect(first.dataset.staticMaterial.rules).toEqual([]);
    expect(first.dataset.staticCoverage?.culture).toBe('no_evidence');
    expect(second.worldReady).toBe(true);
    expect(evidenceCalls).toBe(2);
    expect(segmentCalls).toBe(2);
    expect(second.dataset.analysisStatus).toBe('ready');
    expect(second.dataset.segments.map(segment => segment.evidenceRefs)).toEqual([[], []]);

    await saveNovelDataset({
      ...second.dataset,
      chapters: second.dataset.chapters.map((chapter, index) => index === 0 ? { ...chapter, content: '甲章正文已经修改' } : chapter),
      segments: second.dataset.segments.map((segment, index) => index === 0
        ? { ...segment, sourceText: '甲章正文已经修改' }
        : segment),
    });
    await runNovelAnalysis({ datasetId: source.id, config, startSegmentIndex: 0, generators });
    expect(evidenceCalls).toBe(3);
    expect(segmentCalls).toBe(3);
  });

  test('reduces oversized evidence notes in batches before the final overview', async () => {
    const source = dataset(`novel-runner-${Date.now()}-c`);
    await saveNovelDataset(source);
    let overviewCalls = 0;
    let retainedProfiles = false;
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => ({
        ...note(segment.title),
        facts: [`${segment.title}${'证据'.repeat(80)}`],
      }),
      overview: async ({ notes }) => {
        overviewCalls += 1;
        if (overviewCalls === 3) retainedProfiles = notes.every(note => note.archives?.items?.[0]?.description === '完整的力量限制描述');
        return { ...overview, items: [{ name: '剑', description: '完整的力量限制描述', details: ['只能使用三次'] }] };
      },
      segment: async ({ segment }) => ({ summary: `${segment.title}完成`, openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] }),
    };

    await runNovelAnalysis({ datasetId: source.id, config, generators, overviewBatchTokens: 80 });

    expect(overviewCalls).toBe(3);
    expect(retainedProfiles).toBe(true);
  });

  test('overlaps independent branches and retries only failed overview', async () => {
    const source = dataset(`novel-runner-${Date.now()}-parallel`);
    await saveNovelDataset(source);
    let first = true;
    let segments = 0;
    let release!: () => void;
    const started = new Promise<void>(resolve => { release = resolve; });
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => note(segment.title),
      overview: async () => {
        if (first) {
          await Promise.race([started, new Promise((_, reject) => setTimeout(() => reject(new Error('branches did not overlap')), 100))]);
          throw new Error('overview failed');
        }
        return overview;
      },
      segment: async () => {
        segments += 1; release();
        return { summary: '完成', openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] };
      },
    };
    const failed = await runNovelAnalysis({ datasetId: source.id, config, generators });
    expect(failed.dataset.segments.every(segment => segment.status === 'completed')).toBe(true);
    expect(failed.dataset.overviewError).toBe('overview failed');
    first = false;
    const resumed = await runNovelAnalysis({ datasetId: source.id, config, generators });
    expect(segments).toBe(2);
    expect(resumed.worldReady).toBe(true);
    expect(resumed.dataset.analysisVersion).toBe(NOVEL_ANALYSIS_VERSION);
    first = true;
    const failedRefresh = await runNovelAnalysis({ datasetId: source.id, config, generators, forceOverview: true });
    expect(failedRefresh.worldReady).toBe(false);
    first = false;
    const retriedRefresh = await runNovelAnalysis({ datasetId: source.id, config, generators });
    expect(retriedRefresh.dataset.overviewError).toBeUndefined();
    expect(segments).toBe(2);
  });

  test('only indexes chapters covered by the selected analysis segments', async () => {
    const source = dataset(`novel-runner-${Date.now()}-subset`);
    source.segments = [source.segments[1]];
    await saveNovelDataset(source);
    const batchSizes: number[] = [];
    const embedding = { model: 'subset-test', client: { embed: async (texts: string[]) => {
      batchSizes.push(texts.length);
      return texts.map(() => [1, 0]);
    } } };
    const generators: NovelAnalysisGenerators = {
      evidence: async ({ segment }) => note(segment.title),
      overview: async () => overview,
      segment: async ({ segment }) => ({ summary: `${segment.title}完成`, openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] }),
    };

    await runNovelAnalysis({ datasetId: source.id, config, generators, embedding });
    expect(batchSizes[0]).toBe(1);
  });
});

test('only one writer can analyze the same dataset and late aborted responses cannot commit', async () => {
  const source = dataset('exclusive-run'); await saveNovelDataset(source);
  const controller = new AbortController();
  let release!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const begin = new Promise<void>(resolve => { started = resolve; });
  const run = runNovelAnalysis({ datasetId: source.id, config, signal: controller.signal, generators: {
    evidence: async () => { started(); await hold; return note('迟到证据'); },
    overview: async () => overview,
    segment: async () => { throw new Error('must not run'); },
  } });
  await begin;
  await expect(runNovelAnalysis({ datasetId: source.id, config })).rejects.toThrow('正在');
  controller.abort(); release();
  const result = await run;
  expect(result.job.status).toBe('paused');
  expect(result.dataset.segments[0].evidenceNotes).toBeUndefined();
});

test('full archives survive a summary that omits entities and scope stays partial', async () => {
  const source = dataset('full-archives'); source.segments = [source.segments[0]]; await saveNovelDataset(source);
  const result = await runNovelAnalysis({ datasetId: source.id, config, generators: {
    evidence: async () => ({ ...note('人物'), archives: { items: [{ name: '旧铜符', description: '只能开启北门' }] } }),
    overview: async () => ({ summary: '简短世界总览' }),
    segment: async () => ({ summary: '已完成', openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] }),
  } });
  expect(result.dataset.staticMaterial.items?.[0].name).toBe('旧铜符');
  expect(result.dataset.staticMaterial.items?.[0].id).toBeTruthy();
  expect(result.dataset.analysisStatus).toBe('partial');
});

function compileGenerators(onEvidence: () => void): NovelAnalysisGenerators {
  return {
    evidence: async ({ segment }) => { onEvidence(); return note(segment.title); },
    overview: async () => overview,
    segment: async ({ segment }) => ({ summary: `${segment.title}完成`, openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] }),
  };
}

test('keeps extracted evidence when only the analysis channel changes', async () => {
  const source = dataset(`novel-runner-${Date.now()}-channel`);
  await saveNovelDataset(source);
  let evidenceCalls = 0;
  const generators = compileGenerators(() => { evidenceCalls += 1; });

  await runNovelAnalysis({ datasetId: source.id, config, startSegmentIndex: 0, generators });
  expect(evidenceCalls).toBe(2);

  await runNovelAnalysis({ datasetId: source.id, config: { ...config, model: 'other-channel' }, startSegmentIndex: 0, generators });
  expect(evidenceCalls).toBe(2);

  await runNovelAnalysis({ datasetId: source.id, config: { ...config, model: 'other-channel' }, startSegmentIndex: 0, generators, reExtractEvidence: true });
  expect(evidenceCalls).toBe(4);
});

test('recognizes evidence extracted by the superseded per-channel identity', async () => {
  const source = dataset(`novel-runner-${Date.now()}-legacy`);
  const fingerprint = hashNovelText(JSON.stringify([config.baseUrl, 'earlier-channel', config.provider]));
  source.segments = source.segments.map(segment => {
    const chapter = source.chapters.find(item => item.id === segment.chapterIds[0])!;
    // Identity written before evidence became channel-independent.
    const legacy = hashNovelText(JSON.stringify({
      sourceText: segment.sourceText,
      chapterContext: `${chapter.id} | ${chapter.title} | ${chapter.startOffset}-${chapter.endOffset}`,
      analysisVersion: NOVEL_ANALYSIS_VERSION,
      model: fingerprint,
    }));
    return { ...segment, evidenceNotes: note(segment.title), evidenceStatus: 'completed' as const, evidenceInputHash: legacy, analysisVersion: NOVEL_ANALYSIS_VERSION };
  });
  await saveNovelDataset(source);
  await saveNovelJob({ id: 'legacy-job', datasetId: source.id, status: 'failed', phase: 'evidence', startSegmentIndex: 0, total: 1, completed: 0, failed: 0, retryCount: 0, configFingerprint: fingerprint, createdAt: 1, updatedAt: 1 });

  let evidenceCalls = 0;
  await runNovelAnalysis({ datasetId: source.id, config, startSegmentIndex: 0, generators: compileGenerators(() => { evidenceCalls += 1; }) });
  expect(evidenceCalls).toBe(0);
});

test('background goal builds world material without touching the plot lane', async () => {
  const source = dataset(`novel-runner-${Date.now()}-background`);
  await saveNovelDataset(source);
  let evidenceCalls = 0;
  let segmentCalls = 0;
  const generators: NovelAnalysisGenerators = {
    evidence: async ({ segment }) => { evidenceCalls += 1; return note(segment.title); },
    overview: async () => overview,
    segment: async ({ segment }) => {
      segmentCalls += 1;
      return { summary: `${segment.title}完成`, openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] };
    },
  };

  const background = await runNovelAnalysis({ datasetId: source.id, config, goal: 'background', generators });
  expect(evidenceCalls).toBe(2);
  expect(segmentCalls).toBe(0);
  expect(background.worldReady).toBe(true);
  expect(background.dataset.staticMaterial.summary).toBe('全书总览');
  expect(background.dataset.segments.map(segment => segment.status)).toEqual(['pending', 'pending']);
  expect(background.dataset.analysisStatus).toBe('partial');
  expect((await listNovelJobs(source.id))[0]).toMatchObject({ goal: 'background', total: 3, status: 'completed' });

  const full = await runNovelAnalysis({ datasetId: source.id, config, generators });
  expect(evidenceCalls).toBe(2);
  expect(segmentCalls).toBe(2);
  expect(full.dataset.analysisStatus).toBe('ready');
});

test('regenerated overview keeps authored overrides and reports the shadowed field', async () => {
  const source = dataset(`novel-runner-${Date.now()}-author`);
  await saveNovelDataset(source);
  let summary = '模型第一版';
  const generators: NovelAnalysisGenerators = {
    evidence: async ({ segment }) => note(segment.title),
    overview: async () => ({ summary, rules: ['世界规则'] }),
    segment: async ({ segment }) => ({ summary: `${segment.title}完成`, openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [], hardConstraints: [], constraintDetails: [], foreshadowing: [], events: [], characterProgress: [], worldRules: [], relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [] }),
  };

  const first = await runNovelAnalysis({ datasetId: source.id, config, generators });
  await saveNovelDataset(editNovelMaterial(first.dataset, { ...first.dataset.staticMaterial, summary: '作者撰写的概述' }));
  summary = '模型第二版';
  const second = await runNovelAnalysis({ datasetId: source.id, config, generators, forceOverview: true });

  expect(second.dataset.staticMaterial.summary).toBe('作者撰写的概述');
  expect(second.dataset.staticMaterial.rules).toEqual(['世界规则']);
  expect(novelMaterialConflicts(second.dataset).map(edit => edit.field)).toEqual(['summary']);
});
