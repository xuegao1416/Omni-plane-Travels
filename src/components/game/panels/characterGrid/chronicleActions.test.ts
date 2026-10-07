import { expect, test } from 'bun:test';
import { createDefaultGameState } from '../../../../schema/variables';
import { mergeCurrentNpcChronicles, updateCurrentNpcChronicles } from './chronicleActions';

function fixture() {
  let state = createDefaultGameState();
  state.人物档案.npc = { 姓名: 'NPC', 人物事迹: ['one', 'two', 'three'] } as any;
  let owner = true, commits = 0;
  return { get state() { return state; }, replace: () => { owner = false; }, host: {
    readState: () => structuredClone(state), isCurrent: () => owner,
    commit: (next: typeof state) => { commits++; state = structuredClone(next); return true; },
  }, get commits() { return commits; } };
}

test('NPC merge rejects changed deeds, replaced journeys and cancellation without a write', async () => {
  for (const mode of ['deeds', 'owner', 'cancel']) {
    const f = fixture(), controller = new AbortController();
    const result = await mergeCurrentNpcChronicles({ host: f.host, npcId: 'npc', startIndex: 0, endIndex: 1,
      signal: controller.signal, generate: async input => {
        expect(input.deeds).toEqual(['one', 'two']);
        expect(input.signal).toBe(controller.signal);
        if (mode === 'deeds') f.state.人物档案.npc.人物事迹 = ['author', 'two', 'three'];
        if (mode === 'owner') f.replace();
        if (mode === 'cancel') controller.abort();
        return 'summary';
      } });
    expect(result.applied).toBe(false);
    expect(f.commits).toBe(0);
  }
});

test('NPC source snapshot rejects stale selected ranges before making a paid request', async () => {
  const f = fixture(); let calls = 0;
  const result = await mergeCurrentNpcChronicles({ host: f.host, npcId: 'npc', startIndex: 0, endIndex: 1,
    expectedChronicles: ['old', 'two', 'three'], generate: async () => { calls++; return 'summary'; } });
  expect(calls).toBe(0); expect(result.applied).toBe(false);
  expect(updateCurrentNpcChronicles(f.host, 'npc', ['old edit'], ['old', 'two', 'three']).applied).toBe(false);
  expect(f.state.人物档案.npc.人物事迹).toEqual(['one', 'two', 'three']);
});

test('NPC merge accepts against latest state and preserves unrelated changes', async () => {
  const f = fixture();
  const result = await mergeCurrentNpcChronicles({ host: f.host, npcId: 'npc', startIndex: 0, endIndex: 1,
    generate: async () => { f.state.玩家.姓名 = 'new player'; return '1. summary'; } });
  expect(result.applied).toBe(true);
  expect(f.state.人物档案.npc.人物事迹).toEqual(['summary', 'three']);
  expect(f.state.玩家.姓名).toBe('new player');
  expect(f.commits).toBe(1);
});
