import { expect, test } from 'bun:test';
import { PipelineExecutor } from './pipelineExecutor';
import { createPipelineStatus } from './pipelineTypes';
import { readTurnRecovery, recoveryVersion, matchesRecoveryVersion, memoryRecoveryVersion, matchesMemoryRecoveryVersion } from './turnRecovery';

const legacyVersion = (value: unknown) => JSON.stringify(value, (key, item) => key === 'moduleRevisions' ? undefined
  : item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

test('previous JSON recovery versions remain valid, while compact versions detect changed facts', () => {
  const state = { player: { hp: 10 }, moduleRevisions: { npc: 1 } };
  const changedRevision = { ...state, moduleRevisions: { npc: 2 } };
  expect(matchesRecoveryVersion(changedRevision, legacyVersion(state))).toBe(true);
  expect(matchesRecoveryVersion(changedRevision, recoveryVersion(state))).toBe(true);
  expect(matchesRecoveryVersion({ ...state, player: { hp: 9 } }, recoveryVersion(state))).toBe(false);
  const memory = { memoryRuntime: { sourceEvents: [{ id: 'first' }], checkpoints: [{ id: 'cp1' }] }, vectorMemory: [{ fact: 'known' }] };
  const nextCheckpoint = { ...memory, memoryRuntime: { ...memory.memoryRuntime, checkpoints: [{ id: 'cp2' }] } };
  expect(matchesMemoryRecoveryVersion(memory, legacyVersion(memory))).toBe(true);
  expect(matchesMemoryRecoveryVersion(nextCheckpoint, legacyVersion(memory))).toBe(false);
  expect(matchesMemoryRecoveryVersion(nextCheckpoint, memoryRecoveryVersion(memory))).toBe(true);
  expect(matchesMemoryRecoveryVersion({ ...memory, vectorMemory: [] }, memoryRecoveryVersion(memory))).toBe(false);
  expect(memoryRecoveryVersion(memory)).toHaveLength(71);
});

test('malformed imported recovery never throws during ordinary save loading', () => {
  const invalid = { version: 1, worldId: 'default', saveId: 'save', aiMsgId: 'ai', round: 1,
    userText: '', rawText: '', stateVersion: '', memoryVersion: '',
    result: { mainResult: { parsed: { content: 123 } }, status: createPipelineStatus(1) } };
  expect(() => readTurnRecovery(invalid)).not.toThrow();
  expect(readTurnRecovery(invalid)).toBeNull();
});

test('retry timing excludes time spent outside the interrupted pipeline', async () => {
  const now = Date.now;
  let clock = 1000;
  Date.now = () => clock;
  try {
    const status = createPipelineStatus(1);
    status.stages.main = { label: '正文生成', status: 'success', startTime: 1000, endTime: 1100 };
    status.stages.settlement.status = 'error';
    const executor = new PipelineExecutor(1, { onUpdate: () => {} }, { status, mainResult: null });
    clock = 60000;
    await executor.retryStage('settlement', async () => { clock += 20; });
    expect(executor.getStatus().endTime! - executor.getStatus().startTime).toBe(120);
  } finally { Date.now = now; }
});
