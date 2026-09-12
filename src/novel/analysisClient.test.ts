import { expect, test } from 'bun:test';
import { generateNovelSegmentAnalysis } from './analysisClient';
import type { ApiConfig, CompletionResult } from '../api/types';
import type { NovelEvidenceNote } from './types';

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
