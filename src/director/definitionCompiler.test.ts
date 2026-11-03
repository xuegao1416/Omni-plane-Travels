import { describe, expect, test } from 'bun:test';
import { compileDirectorDefinition, createDirectorCompileJob } from './definitionCompiler';
import { validateDirectorDraft, type DirectorDraft } from './definitionSchema';
import type { NovelDataset } from '../novel/types';

export const sampleDraft = () => ({ title: '失踪案', coreConflict: '寻找失踪者', anchors: ['保持调查冲突'], characters: [{ id: 'a', name: '证人', aliases: [] }], stages: [{ id: 's', title: '调查', description: '寻找线索', nodeIds: ['n'] }], nodes: [{ id: 'n', stageId: 's', title: '求助', intent: '证人寻求帮助', actorIds: ['a'], execution: 'foreground', conditions: [{ id: 'c', description: '证人能够接触玩家' }], dependsOn: [], constraints: [], sourceRefs: ['author:0:6'] }], coverage: { complete: false, gaps: ['后续未提供'], boundary: '到求助为止' } });

describe('director definition compilation', () => {
  test('does not use a segment citation as evidence for an uncited event', () => {
    const ref = { chapterId: 'c1', startOffset: 0, endOffset: 4, excerpt: '城门关闭', confidence: 'explicit' as const };
    const dataset = { id: 'novel-source', title: '来源测试', chapters: [{ id: 'c1', index: 0, title: '章一', content: '城门关闭' }], segments: [{ id: 's1', status: 'completed', evidenceRefs: [ref], events: [{ name: '交信', description: '顾澄交出密信', evidenceRefs: [] }] }], staticMaterial: {}, analysisStatus: 'ready' } as unknown as NovelDataset;
    expect(() => createDirectorCompileJob({ kind: 'novel', dataset })).toThrow('交信');
    dataset.segments[0]!.events[0] = { name: '关门', description: '城门关闭', evidenceRefs: [ref] };
    expect(createDirectorCompileJob({ kind: 'novel', dataset }).units[0]?.sourceRefs).toEqual(['novel:c1:0:4']);
  });
  test('rejects dangling references, fabricated sources and causal cycles', () => {
    const draft: DirectorDraft = sampleDraft() as DirectorDraft;
    expect(() => validateDirectorDraft(draft, ['author:0:6'])).not.toThrow();
    draft.nodes[0]!.dependsOn = ['n'];
    expect(() => validateDirectorDraft(draft, ['author:0:6'])).toThrow();
    draft.nodes[0]!.dependsOn = [];
    expect(() => validateDirectorDraft(draft, [])).toThrow();
    draft.nodes[0]!.actorIds = ['missing'];
    expect(() => validateDirectorDraft(draft, ['author:0:6'])).toThrow();
  });
  test('compiles non-streaming, retains source and stable identity', async () => {
    const job = createDirectorCompileJob({ kind: 'author', text: '证人前来求助' });
    const request = async (input: { stream: false }) => { expect(input.stream).toBe(false); return JSON.stringify(sampleDraft()); };
    const a = await compileDirectorDefinition(job, { request });
    const b = await compileDirectorDefinition(createDirectorCompileJob({ kind: 'author', text: '证人前来求助' }), { request });
    expect(a.definition?.source.text).toBe('证人前来求助');
    expect(a.definition?.version).toBe(b.definition?.version);
    expect(a.definition?.nodes[0]?.id).toBe(b.definition?.nodes[0]?.id);
  });
  test('failed unit keeps completed checkpoints and resumes without replay', async () => {
    const job = createDirectorCompileJob({ kind: 'author', text: '证人前来求助证人前来求助' }, { unitChars: 6 });
    let calls = 0;
    const failed = await compileDirectorDefinition(job, { request: async () => { if (++calls === 2) throw new Error('offline'); return JSON.stringify(sampleDraft()); } });
    expect(failed.status).toBe('failed');
    expect(Object.keys(failed.checkpoints)).toHaveLength(1);
    const resumed = await compileDirectorDefinition(failed, { request: async input => {
      const d = sampleDraft();
      d.nodes[0]!.sourceRefs = input.phase === 'extract' ? ['author:6:12'] : ['author:0:6', 'author:6:12'];
      return JSON.stringify(d);
    } });
    expect(resumed.status).toBe('completed');
    expect(Object.keys(resumed.checkpoints)).toHaveLength(3);
  });
  test('repairs invalid field types once using validation feedback without coercing content', async () => {
    const job = createDirectorCompileJob({ kind: 'author', text: '证人前来求助' });
    let calls = 0;
    const result = await compileDirectorDefinition(job, { request: async input => {
      if (++calls === 1) return JSON.stringify({ ...sampleDraft(), coverage: { complete: 'false', gaps: '后续未提供', boundary: '到求助为止' } });
      expect(input.prompt).toContain('validationError');
      expect(input.system).toContain('"boolean"');
      return JSON.stringify(sampleDraft());
    } });
    expect(calls).toBe(2);
    expect(result.status).toBe('completed');
    expect(result.definition?.coverage.gaps).toEqual(['后续未提供']);
  });
  test('persistent invalid output fails after one repair and saves no bad checkpoint', async () => {
    let calls = 0;
    const result = await compileDirectorDefinition(createDirectorCompileJob({ kind: 'author', text: '证人前来求助' }), { request: async () => { calls++; return '{}'; } });
    expect(calls).toBe(2);
    expect(result.status).toBe('failed');
    expect(Object.keys(result.checkpoints)).toHaveLength(0);
  });
});
