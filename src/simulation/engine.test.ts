import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { DirectorRuntime as WorldSimulationEngine } from './engine';
// 回合结算与事件出卡的测试已移到 src/events/eventsEngine.test.ts（玩法宿主 + 事件导演）。

test('new world snapshots preserve historical snapshots still referenced by messages', () => {
  const engine = new WorldSimulationEngine();
  const ids: string[] = [];
  for (let round = 1; round <= 25; round++) {
    engine.state.mechanics = { lastTurnId: `r${round}`, lastRound: round, tickCount: round, lastTime: `day${round}` };
    ids.push(engine.createSnapshot(round, `day${round}`, false, undefined, ids).id);
  }
  expect(engine.state.snapshots).toHaveLength(25);
  expect(engine.restoreSnapshot(ids[0]!)).toBe(true);
  expect(engine.state.mechanics?.lastRound).toBe(1);
});
