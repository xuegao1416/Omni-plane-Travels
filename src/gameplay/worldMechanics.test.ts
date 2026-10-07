import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { MechanicalRuntime } from './mechanicalRuntime';
import { prepareWorldMechanics, commitWorldMechanics } from './worldMechanics';
import { createDefaultGameState } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';

test('a no-effect check has a receipt only after accepted commit; retries cannot duplicate it', async () => {
  const engine = new MechanicalRuntime(createEmptySimState());
  const input = { gameState: createDefaultGameState(), round: 1, turnId: 'turn-1' };
  const settlement = await prepareWorldMechanics(engine, input);
  expect(settlement.nextMechanics?.lastSettlement).toEqual({
    round: 1, turnId: 'turn-1', time: input.gameState.世界.时间系统.当前时间,
    effectCount: 0, notificationCount: 0, origin: 'live',
  });
  let saves = 0;
  const owner = Object.assign(engine, { saveState: () => { saves++; } });
  expect(await commitWorldMechanics(owner, settlement, () => false)).toBe(false);
  expect(engine.state.mechanics).toBeUndefined();
  expect(await commitWorldMechanics(owner, settlement, () => true)).toBe(true);
  expect(engine.state.mechanics?.lastSettlement?.round).toBe(1);
  expect(await commitWorldMechanics(owner, settlement, () => true)).toBe(false);
  expect(saves).toBe(1);
  expect((await prepareWorldMechanics(engine, input)).settled).toBe(false);
});
