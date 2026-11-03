import { expect, test } from 'bun:test';
import { useMemoryStore } from './memoryStore';
import { applyIngestToRuntime } from './memoryPipeline';
import { formatRuntimeToCompiledText } from './compileFormatter';

test('three chronological writes link to archived predecessors instead of the current stable ID', () => {
  useMemoryStore.getState().resetMemoryRuntime();
  useMemoryStore.getState().initMemoryRuntime('version-chain');
  const runtime = useMemoryStore.getState().getMemoryRuntime();
  for (let round = 1; round <= 3; round++) {
    applyIngestToRuntime(runtime, {
      stateSlotUpserts: [{ id: 'where', scopeType: 'player', scopeId: 'player', slotType: 'location', value: `place-${round}` }],
      entityPatches: [{ id: 'npc', name: '角色', stableFacts: [`fact-${round}`], currentStatus: [`state-${round}`] }],
      threadUpserts: [{ id: 'quest', title: '当前行动', summary: `summary-${round}`, goal: `goal-${round}`, status: 'open', priority: 5 }],
    }, [`turn_${round}`], round);
  }
  for (const list of [runtime.stateSlots, runtime.entityCards]) {
    const current = list.find(item => item.validUntilRound == null)!;
    const previous = list.find(item => item.id === current.previousVersionId)!;
    expect(previous).toBeDefined();
    expect(previous.id).not.toBe(current.id);
    expect(previous.validUntilRound).toBe(3);
    const first = list.find(item => item.id === previous.previousVersionId)!;
    expect(first.validUntilRound).toBe(2);
    expect(first.previousVersionId ?? null).toBeNull();
  }
  const compiled = formatRuntimeToCompiledText(runtime, []);
  expect(compiled.text).toContain('goal-3');
  expect(compiled.text).not.toContain('goal-1');
  expect(compiled.text).not.toContain('goal-2');
});
