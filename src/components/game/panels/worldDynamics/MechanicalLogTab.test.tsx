import { expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { createDefaultGameState } from '../../../../schema/variables';
import { createEmptySimState } from '../../../../simulation/types';
import { MechanicalLogTab } from './MechanicalLogTab';

test('mechanical checks and gameplay transactions remain distinct and use Chinese visible labels', () => {
  const state = createDefaultGameState();
  state.gameplay = { logs: [{ id: 'log', sequence: 1, tick: 1, transactionId: 'internal:transaction',
    source: 'ai', label: '第1轮人物关系结算', status: 'applied', changes: [
      { path: '人物档案.NPC_甲.关系数据.好感度', operation: 'add', before: 0, after: 3 },
    ], eventIds: [] }] } as any;
  const sim = createEmptySimState();
  sim.mechanics = { lastTurnId: 'internal:turn', lastRound: 1, tickCount: 1, lastTime: 'day1',
    lastSettlement: { round: 1, turnId: 'internal:turn', time: 'day1', effectCount: 0, notificationCount: 0, origin: 'replay' } };
  const html = renderToStaticMarkup(<MechanicalLogTab gameState={state} simState={sim}/>);
  const visible = html.replace(/<details[\s\S]*?<\/details>/g, '');
  expect(visible).toContain('已检查，无周期资源或事件变化');
  expect(visible).toContain('存档补记');
  expect(visible).toContain('玩法交易');
  expect(visible).toContain('好感度：0 → 3');
  expect(visible).not.toContain('internal:');
  expect(visible).not.toContain('applied');
  expect(state.simulationRuntime?.effectLog ?? []).toEqual([]);
});
