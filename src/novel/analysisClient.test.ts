import { expect, test } from 'bun:test';
import { generateNovelPreparationBatch, generateNovelSegmentAnalysis } from './analysisClient';
import type { NovelRequestBatch } from './preparationModel';
import type { ApiConfig, CompletionResult } from '../api/types';
import type { NovelEvidenceNote } from './types';

const batchConfig: ApiConfig = { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', provider: 'custom' };
const preparationBatch = (sourceTexts: string[]): NovelRequestBatch => ({
  id: 'batch', chapterIds: ['c1'], estimatedTokens: 6000, evidenceReusable: false,
  parts: sourceTexts.map((sourceText, index) => ({ id: `s${index}:part:0`, unitId: `s${index}`, title: `第${index + 1}段`, sourceText,
    range: { chapterId: 'c1', startOffset: sourceTexts.slice(0, index).join('').length, endOffset: sourceTexts.slice(0, index + 1).join('').length }, inputHash: `input-${index}` })),
});

test.each([32768, 65536])('preparation and JSON repair honor a configured response budget of %i', async maxTokens => {
  const limits: Array<number | undefined> = [];
  const batch = preparationBatch(['甲段']);
  const result = await generateNovelPreparationBatch({ config: { ...batchConfig, maxTokens }, novelTitle: '测试', batch,
    sourceChapters: [{ id: 'c1', index: 0, title: '第一章', content: '甲段' }],
    request: async (_config, _messages, options) => {
      limits.push(options.maxTokens);
      return { text: limits.length === 1 ? '{"parts": [],}' : JSON.stringify({ parts: [{ partId: batch.parts[0].id, evidence: { summary: '有效结果' } }], material: { summary: '背景资料' } }), elapsed: 1 };
    },
  });
  expect(limits).toEqual([maxTokens, maxTokens]);
  expect(result.parts[0].evidence.summary).toBe('有效结果');
});

test('malformed preparation batch splits after one repair and retains every original part', async () => {
  const inputs: string[][] = [];
  const batch = preparationBatch(['甲段', '乙段']);
  const result = await generateNovelPreparationBatch({ config: batchConfig, novelTitle: '测试', batch, sourceChapters: [{ id: 'c1', index: 0, title: '第一章', content: '甲段乙段' }],
    request: async (_config, messages) => {
      const parts = JSON.parse(messages[1].content.match(/<source_parts>\n([\s\S]*?)\n<\/source_parts>/)![1]);
      inputs.push(parts.map((part: { id: string }) => part.id));
      return { text: inputs.length <= 2 ? '{"parts": [],}' : JSON.stringify({ parts: parts.map((part: { id: string; sourceText: string }) => ({ partId: part.id, evidence: { summary: part.sourceText } })), material: { summary: parts[0].sourceText, rules: [parts[0].sourceText] } }), elapsed: 1 };
    },
  });
  expect(inputs).toEqual([['s0:part:0', 's1:part:0'], ['s0:part:0', 's1:part:0'], ['s0:part:0'], ['s1:part:0']]);
  expect(result.batchId).toBe(batch.id);
  expect(result.parts.map(part => part.partId)).toEqual(batch.parts.map(part => part.id));
  expect(result.material.rules).toEqual(['甲段', '乙段']);
});

test('truncated single preparation window splits without changing its identity or citation offsets', async () => {
  const sourceText = '甲'.repeat(650) + '乙'.repeat(650), batch = preparationBatch([sourceText]);
  let calls = 0;
  const result = await generateNovelPreparationBatch({ config: batchConfig, novelTitle: '测试', batch, sourceChapters: [{ id: 'c1', index: 0, title: '第一章', content: sourceText }],
    request: async (_config, messages) => {
      calls++;
      const parts = JSON.parse(messages[1].content.match(/<source_parts>\n([\s\S]*?)\n<\/source_parts>/)![1]);
      return { finishReason: calls === 1 ? 'length' : 'stop', text: JSON.stringify({ parts: parts.map((part: { id: string; sourceText: string }) => ({ partId: part.id, evidence: { summary: part.sourceText[0], evidenceRefs: [{ chapterId: 'c1', excerpt: part.sourceText.slice(0, 5), confidence: 'explicit' }] } })), material: { summary: parts[0].sourceText[0] } }), elapsed: 1 };
    },
  });
  expect(calls).toBe(3);
  expect(result.parts).toHaveLength(1);
  expect(result.parts[0].partId).toBe(batch.parts[0].id);
  expect(result.parts[0].evidence.summary).toBe('甲\n乙');
  expect(result.parts[0].evidence.evidenceRefs.map(ref => ref.startOffset)).toEqual([0, 650]);
});

test('preparation retry stops at its split budget and never retries platform refusal', async () => {
  let calls = 0;
  const params = { config: batchConfig, novelTitle: '测试', batch: preparationBatch(['甲'.repeat(12000)]), sourceChapters: [] };
  await expect(generateNovelPreparationBatch({ ...params, request: async () => { calls++; return { text: '', finishReason: 'length', elapsed: 1 }; } })).rejects.toThrow('token 上限');
  expect(calls).toBe(4);
  calls = 0;
  await expect(generateNovelPreparationBatch({ ...params, request: async () => { calls++; return { text: '', finishReason: 'content_filter', elapsed: 1 }; } })).rejects.toThrow('模型平台已拦截');
  expect(calls).toBe(1);
});

test.each(['content_filter', 'content-filter', 'SAFETY', 'RECITATION'])('platform refusal %s stops without JSON repair or split retries', async finishReason => {
  let calls = 0;
  await expect(generateNovelSegmentAnalysis({
    config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', provider: 'custom' },
    novelTitle: '测试', sourceText: '甲'.repeat(1300),
    segment: { id: 's1', index: 0, title: '第一段', chapterIds: [], summary: '', hardConstraints: [], events: [] },
    evidenceNote: {} as NovelEvidenceNote, previousEndingFacts: [], retrievedEvidence: '',
    request: async () => { calls++; return { text: '{"summary":"被截断的结果"}', elapsed: 1, finishReason }; },
  })).rejects.toThrow('模型平台已拦截');
  expect(calls).toBe(1);
});

test('repairs an event without its own evidence instead of borrowing the segment citation', async () => {
  const content = '城门已经关闭。顾澄把密信交给了守卫。';
  const chapter = { id: 'c1', index: 0, title: '第一章', content, startOffset: 100 };
  const unrelated = { chapterId: 'c1', excerpt: '城门已经关闭。', confidence: 'explicit' };
  const eventRef = { chapterId: 'c1', excerpt: '顾澄把密信交给了守卫。', confidence: 'explicit' };
  let calls = 0;
  const result = await generateNovelSegmentAnalysis({
    config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', provider: 'custom' } as ApiConfig,
    novelTitle: '测试', sourceText: content, sourceChapters: [chapter],
    segment: { id: 's1', index: 0, title: '送信', chapterIds: ['c1'], summary: '', hardConstraints: [], events: [] },
    evidenceNote: {} as NovelEvidenceNote, previousEndingFacts: [], retrievedEvidence: '',
    request: async (_config, messages) => {
      calls++;
      if (calls === 2) expect(messages.map(message => message.content).join('\n')).toContain('交信');
      return { text: JSON.stringify({ summary: '交信', events: [{ name: '交信', description: '顾澄交出密信', evidenceRefs: calls === 1 ? [] : [eventRef] }], evidenceRefs: [unrelated] }), elapsed: 1 };
    },
  });
  expect(calls).toBe(2);
  expect(result.events[0]?.evidenceRefs?.[0]).toMatchObject({ excerpt: eventRef.excerpt, startOffset: 107 });
});

test('fails after one repair when the event citation still cannot be found in the original text', async () => {
  let calls = 0;
  await expect(generateNovelSegmentAnalysis({
    config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', provider: 'custom' } as ApiConfig,
    novelTitle: '测试', sourceText: '城门已经关闭。', sourceChapters: [{ id: 'c1', index: 0, title: '第一章', content: '城门已经关闭。' }],
    segment: { id: 's1', index: 0, title: '送信', chapterIds: ['c1'], summary: '', hardConstraints: [], events: [] },
    evidenceNote: {} as NovelEvidenceNote, previousEndingFacts: [], retrievedEvidence: '',
    request: async () => { calls++; return { text: JSON.stringify({ events: [{ name: '交信', description: '顾澄交出密信', evidenceRefs: [{ chapterId: 'c1', excerpt: '原文并没有这句话', confidence: 'explicit' }] }] }), elapsed: 1 }; },
  })).rejects.toThrow('交信');
  expect(calls).toBe(2);
});

test('truncated plot output is recompiled in ordered halves, retaining both results', async () => {
  const prompts: string[] = [];
  const output = await generateNovelSegmentAnalysis({
    config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', provider: 'custom' } as ApiConfig,
    novelTitle: '测试', sourceText: '甲'.repeat(650) + '乙'.repeat(650),
    segment: { id: 's1', index: 0, title: '第一段', chapterIds: [], summary: '', hardConstraints: [], events: [] },
    evidenceNote: {} as NovelEvidenceNote, previousEndingFacts: [], retrievedEvidence: '',
    request: async (_config, messages) => {
      prompts.push(messages.map(message => message.content).join('\n'));
      return { text: JSON.stringify({ summary: `结果${prompts.length}`, openingFacts: [`开始${prompts.length}`], endingFacts: [`结束${prompts.length}`], foreshadowing: [`伏笔${prompts.length}`] }), elapsed: 1,
        finishReason: prompts.length === 1 ? 'length' : 'stop' } as CompletionResult;
    },
  });
  expect(prompts).toHaveLength(3);
  expect(output.summary).toBe('结果2\n结果3');
  expect(output.openingFacts).toEqual(['开始2']);
  expect(output.endingFacts).toEqual(['结束3']);
  expect(output.foreshadowing).toEqual(['伏笔2', '伏笔3']);
  expect(prompts[2]).toContain('结束2');
});

test('invalid JSON after one repair retries smaller plot inputs in order', async () => {
  const prompts: string[] = [];
  const output = await generateNovelSegmentAnalysis({
    config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', provider: 'custom' } as ApiConfig,
    novelTitle: '测试', sourceText: '甲'.repeat(650) + '乙'.repeat(650),
    segment: { id: 's1', index: 0, title: '第一段', chapterIds: [], summary: '', hardConstraints: [], events: [] },
    evidenceNote: {} as NovelEvidenceNote, previousEndingFacts: [], retrievedEvidence: '',
    request: async (_config, messages) => {
      prompts.push(messages.map(message => message.content).join('\n'));
      return { text: prompts.length <= 2 ? '{"summary":"他说"走吧""}' : JSON.stringify({ summary: `结果${prompts.length}`, endingFacts: [`结束${prompts.length}`] }), elapsed: 1 };
    },
  });
  expect(prompts).toHaveLength(4);
  expect(output.summary).toBe('结果3\n结果4');
  expect(output.endingFacts).toEqual(['结束4']);
  expect(prompts[3]).toContain('结束3');
});

test('invalid JSON on a small segment stops after one repair', async () => {
  let calls = 0;
  await expect(generateNovelSegmentAnalysis({
    config: { baseUrl: 'https://example.invalid', model: 'test', apiKey: '', provider: 'custom' } as ApiConfig,
    novelTitle: '测试', sourceText: '短段落',
    segment: { id: 's1', index: 0, title: '第一段', chapterIds: [], summary: '', hardConstraints: [], events: [] },
    evidenceNote: {} as NovelEvidenceNote, previousEndingFacts: [], retrievedEvidence: '',
    request: async () => { calls++; return { text: '{"summary":"他说"走吧""}', elapsed: 1 }; },
  })).rejects.toThrow('AI 返回的 JSON 无法解析');
  expect(calls).toBe(2);
});
