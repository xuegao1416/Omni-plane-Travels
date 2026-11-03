import { expect, test } from 'bun:test';
import { createDefaultGameState } from '../../../../schema/variables';
import { importCurrentVariableJSON, prepareCurrentVariableJSON, resolveCurrentRollbackIndex } from './currentVariableActions';

function fixture() {
  const state = createDefaultGameState(); let current = true, prepares = 0;
  return { state, replace: () => { current = false; }, host: {
    readState: () => structuredClone(state), isCurrent: () => current,
    prepare: (json: string) => { prepares++; return JSON.parse(json); },
  }, get prepares() { return prepares; } };
}

test('current variable edits reject changed source state before preparing a replacement', () => {
  const f = fixture(), baseline = JSON.stringify(f.state);
  f.state.玩家.姓名 = 'author edit';
  const result = prepareCurrentVariableJSON({ host: f.host, json: baseline, expectedState: baseline });
  expect(result.state).toBeUndefined(); expect(result.reason).toContain('变化'); expect(f.prepares).toBe(0);
});

test('slow file import rejects changed state, replaced owner and cancellation', async () => {
  for (const mode of ['state', 'owner', 'cancel']) {
    const f = fixture(), controller = new AbortController(), json = JSON.stringify(f.state);
    const result = await importCurrentVariableJSON({ host: f.host, signal: controller.signal, readText: async () => {
      if (mode === 'state') f.state.玩家.姓名 = 'new state';
      if (mode === 'owner') f.replace();
      if (mode === 'cancel') controller.abort();
      return json;
    } });
    expect(result.state).toBeUndefined(); expect(f.prepares).toBe(0);
  }
});

test('snapshot layer archives and incomplete objects are not current variable state', async () => {
  const f = fixture();
  for (const data of [{ layers: [{ snapshot: f.state }] }, {}, [], { 玩家: {} }]) {
    const result = await importCurrentVariableJSON({ host: f.host, readText: async () => JSON.stringify(data) });
    expect(result.state).toBeUndefined(); expect(f.prepares).toBe(0);
  }
  const valid = await importCurrentVariableJSON({ host: f.host, readText: async () => JSON.stringify({ snapshot: f.state }) });
  expect(valid.state?.玩家).toEqual(f.state.玩家);
  const exported = await importCurrentVariableJSON({ host: f.host, readText: async () => JSON.stringify({ snapshot: f.state, layers: [{ snapshot: f.state }] }) });
  expect(exported.state?.玩家).toEqual(f.state.玩家);
});

test('rollback confirmation resolves the selected message identity and refuses replaced snapshots', () => {
  const state = createDefaultGameState();
  const message = { id: 'chosen', role: 'assistant' as const, rawText: 'text', round: 1, seq: 1, timestamp: 1, snapshot: state };
  expect(resolveCurrentRollbackIndex({ messages: [message], messageId: 'old journey', snapshot: state, isCurrent: () => true })).toBe(-1);
  expect(resolveCurrentRollbackIndex({ messages: [message], messageId: 'chosen', snapshot: state, isCurrent: () => false })).toBe(-1);
  const changed = { ...message, snapshot: { ...state, 玩家: { ...state.玩家, 姓名: 'new version' } } };
  expect(resolveCurrentRollbackIndex({ messages: [changed], messageId: 'chosen', snapshot: state, isCurrent: () => true })).toBe(-1);
  expect(resolveCurrentRollbackIndex({ messages: [{ ...message, id: 'preceding' }, message], messageId: 'chosen', snapshot: state, isCurrent: () => true })).toBe(1);
});
