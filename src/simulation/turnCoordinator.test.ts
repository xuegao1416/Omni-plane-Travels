import { describe, expect, test } from 'bun:test';
import { EvolutionTurnCoordinator } from './turnCoordinator';
import { trimSaveData } from '../stores/cloudSaveStore';

const turn = { saveId: 'save-a', worldId: 'world-a', factVersion: 'facts-1', turnId: 'turn-1' };

describe('演化回合提交边界', () => {
  test('冻结下一轮或回滚后，旧请求不能写回，即使恢复到相同事实', () => {
    const gate = new EvolutionTurnCoordinator();
    const ticket = gate.open(turn);
    expect(gate.accepts(ticket, turn)).toBe(true);
    gate.invalidate();
    expect(ticket.signal.aborted).toBe(true);
    expect(gate.accepts(ticket, turn)).toBe(false);
    gate.open(turn);
    expect(gate.accepts(ticket, turn)).toBe(false);
  });

  test('两条分支只能提交同一存档、世界、回合的相同事实版本', () => {
    const gate = new EvolutionTurnCoordinator();
    const ticket = gate.open(turn);
    for (const key of ['saveId', 'worldId', 'factVersion', 'turnId'] as const) {
      expect(gate.accepts(ticket, { ...turn, [key]: 'changed' })).toBe(false);
    }
    expect(gate.accepts(ticket, turn)).toBe(true);
  });

  test('云存档保留主线、后台事实与消息关联的演化快照', () => {
    const simulationState = {
      config: { enabled: true }, tickCount: 3, lastTickTimestamp: 1,
      mainline: { enabled: true, datasetId: 'novel', currentSegmentIndex: 2 },
      events: { e: { id: 'e' } }, resolvedEvents: {}, storylines: {}, pendingInteractions: [],
      mechanics: { lastTurnId: 'turn-1' },
      snapshots: [{ id: 'snap', snapshot: { mainline: { currentSegmentIndex: 1 } } }],
    };
    const save = { simulationState, messages: [{ id: 'm', simulationSnapshotId: 'snap' }] };
    const restored = trimSaveData(save);
    expect(restored.simulationState.mainline).toEqual(simulationState.mainline);
    expect(restored.simulationState.events).toEqual(simulationState.events);
    expect(restored.simulationState.snapshots).toEqual(simulationState.snapshots);
    expect(save.simulationState).toEqual(simulationState);
  });
});
