import { describe, expect, test } from 'bun:test';
import {
  parseNovelEvidenceNoteResponse,
  parseNovelOverviewResponse,
  parseNovelSegmentAnalysisResponse,
} from './analysisSchema';

describe('novel analysis response contracts', () => {
  test('parses fenced evidence notes and removes unusable evidence locations', () => {
    const parsed = parseNovelEvidenceNoteResponse(`\n\`\`\`json\n${JSON.stringify({
      summary: '雨夜入城。', facts: ['主角尚无通行证'], characters: ['沈砚'], factions: [], locations: ['北门'], items: [],
      rules: [], relationships: [], openThreads: ['谁在跟踪沈砚'],
      events: [{ name: '入城', description: '沈砚抵达北门', evidenceRefs: [] }],
      evidenceRefs: [
        { chapterId: 'c1', startOffset: 0, endOffset: 4, excerpt: '雨夜入城', confidence: 'explicit' },
        { chapterId: 'c1', startOffset: 8, endOffset: 2, excerpt: '倒置位置', confidence: 'explicit' },
      ],
    })}\n\`\`\``);

    expect(parsed.summary).toBe('雨夜入城。');
    expect(parsed.evidenceRefs).toHaveLength(1);
    expect(parsed.events[0].name).toBe('入城');
  });

  test('keeps weak inferences out of hard constraints', () => {
    const parsed = parseNovelSegmentAnalysisResponse(JSON.stringify({
      summary: '主角调查城门。', openingFacts: [], carryFacts: [], endingFacts: [], nextReference: [],
      hardConstraints: [
        { content: '主角不会武功', confidence: 'weak_inference', visibility: { knownBy: [], unknownTo: [], readerOnly: true }, evidenceRefs: [] },
        { content: '主角尚无通行证', confidence: 'explicit', visibility: { knownBy: ['主角'], unknownTo: ['守卫'], readerOnly: false }, evidenceRefs: [{ chapterId: 'c1', startOffset: 0, endOffset: 6, excerpt: '尚无通行证', confidence: 'explicit' }] },
        { content: '无证据却自称明确的结论', confidence: 'explicit', evidenceRefs: [] },
      ],
      foreshadowing: [], events: [{ name: '', description: '' }], characterProgress: [], worldRules: [],
      relationships: [], timelineStart: '', timelineEnd: '', evidenceRefs: [],
    }));

    expect(parsed.hardConstraints).toEqual(['主角尚无通行证']);
    expect(parsed.constraintDetails).toHaveLength(1);
    expect(parsed.events).toEqual([]);
  });

  test('normalizes a reusable overview instead of copying markdown prose', () => {
    const parsed = parseNovelOverviewResponse(JSON.stringify({
      summary: '群雄争夺失落剑谱。', settings: ['架空江湖'], rules: ['内力不可凭空恢复'],
      factions: [{ name: '听雨楼', description: '情报组织' }],
      characters: [{ name: '沈砚', role: '游侠', description: '追查旧案' }],
      locations: [{ name: '北门', description: '边城入口' }], relations: ['沈砚与听雨楼互相利用'],
      events: [{ name: '剑谱失窃', description: '剑谱从藏阁消失' }],
    }));

    expect(parsed.summary).toBe('群雄争夺失落剑谱。');
    expect(parsed.characters?.[0]).toMatchObject({ name: '沈砚', role: '游侠' });
    expect(parsed.rules).toEqual(['内力不可凭空恢复']);
  });

  test('accepts object-shaped evidence lists returned by richer models', () => {
    const parsed = parseNovelEvidenceNoteResponse(JSON.stringify({
      summary: '巨像现身。',
      facts: [{ content: '巨像在城门出现', evidenceRefs: [] }],
      characters: [{ name: '白发身影', role: '未知' }],
      factions: [{ name: '万机神殿', description: '机械势力' }],
      locations: [], items: [], rules: [], relationships: [], openThreads: [], events: [], evidenceRefs: [],
    }));

    expect(parsed.facts).toEqual(['巨像在城门出现']);
    expect(parsed.characters).toEqual(['白发身影']);
    expect(parsed.factions).toEqual(['万机神殿']);
  });

  test('drops incomplete event evidence without failing the whole segment', () => {
    const parsed = parseNovelEvidenceNoteResponse(JSON.stringify({
      summary: '巨像现身。', facts: [], characters: [], factions: [], locations: [], items: [],
      rules: [], relationships: [], openThreads: [],
      events: [{ name: '巨像现身', description: '巨像在城门出现', visibility: 'reader_only',
        evidenceRefs: ['ref-1', { chapterId: 'c501', excerpt: '巨像在城门出现', confidence: 'explicit' }] }],
      evidenceRefs: [],
    }));

    expect(parsed.events[0]).toMatchObject({ name: '巨像现身', visibility: { readerOnly: true } });
    expect(parsed.events[0].evidenceRefs).toEqual([]);
    const segment = parseNovelSegmentAnalysisResponse(JSON.stringify({
      summary: '证据尚不完整', hardConstraints: [{ content: '不能升级为硬约束', evidenceRefs: ['ref-1'] }],
    }));
    expect(segment.hardConstraints).toEqual([]);
  });

  test('locates quoted evidence in the source instead of trusting model offsets', () => {
    const sourceChapters = [{ id: 'c1', index: 0, title: '第一章', content: '雨停了。城门已经关闭。守卫离开。', startOffset: 100 }];
    const ref = { chapterId: 'c1', excerpt: '城门已经关闭。', confidence: 'explicit' };
    const note = parseNovelEvidenceNoteResponse(JSON.stringify({ summary: '夜晚关门', evidenceRefs: [ref] }), sourceChapters);
    expect(note.evidenceRefs[0]).toMatchObject({ startOffset: 104, endOffset: 111 });
    const segment = parseNovelSegmentAnalysisResponse(JSON.stringify({ summary: '关门', hardConstraints: [
      { content: '城门关闭', evidenceRefs: [{ ...ref, startOffset: 999, endOffset: 1000 }] },
      { content: '无原文支撑', evidenceRefs: [{ ...ref, excerpt: '从未出现的句子', startOffset: 0, endOffset: 3 }] },
    ] }), sourceChapters);
    expect(segment.hardConstraints).toEqual(['城门关闭']);
    expect(segment.constraintDetails[0].evidenceRefs[0].startOffset).toBe(104);
  });
});
