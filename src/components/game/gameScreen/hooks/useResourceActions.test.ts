import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { GameEngine } from '../../../../engine/types';
import { VariableManager } from '../../../../engine/variableManager';
import { createDefaultGameState } from '../../../../schema/variables';
import type { WorldDef } from '../../../../data/worlds-schema';
import { useResourceActions } from './useResourceActions';

// 由 useSurvivalCraft.test.ts 迁移：同样三个场景，经资源模块结算。
function fixture(readOnly = false) {
  const initial = createDefaultGameState(); initial.玩家.生存资源 = { wood: { 数量: 9, 最大值: 10 } };
  const manager = new VariableManager(initial); let commits = 0; const notices: string[] = [];
  const engine = { variableManager: manager, isGenerating: false, isReadOnly: readOnly,
    commitPlayerState: (state: typeof initial) => { commits++; manager.setState(state); return true; },
  } as unknown as GameEngine;
  const world = { id: 'survival_test', name: '生存世界', modules: [{ moduleId: 'survival', enabled: true, moduleConfig: {
    resources: [{ id: 'wood', name: '木材', max: 10, amount: 9, gatherAmount: 5, gatherStaminaCost: 3, gatherTimeMinutes: 10 }], recipes: [],
  } }] } as unknown as WorldDef;
  let actions!: ReturnType<typeof useResourceActions>;
  renderToString(createElement(() => { actions = useResourceActions(engine, null, world, text => { if (text) notices.push(text); }, () => {}); return null; }));
  const wood = () => manager.getState().resources?.stocks.wood ?? manager.getState().玩家.生存资源?.wood.数量;
  return { actions, manager, notices, wood, commits: () => commits };
}
test('the production resource hook commits through the engine gateway and reports actual capacity-limited gathering', () => {
  const fixtureState = fixture(); fixtureState.actions.gather('wood');
  expect(fixtureState.commits()).toBe(1);
  expect(fixtureState.wood()).toBe(10);
  expect(fixtureState.notices.join('')).toContain('木材 +1');
  expect(fixtureState.notices.join('')).toContain('体力 -3');
  expect(fixtureState.notices.join('')).toContain('容量');
});
test('read-only resource operations never spend resources or enter the commit gateway', () => {
  const fixtureState = fixture(true); fixtureState.actions.gather('wood');
  expect(fixtureState.wood()).toBe(9);
  expect(fixtureState.commits()).toBe(0); expect(fixtureState.notices.join('')).toContain('只读');
});
test('a stale or forged panel recipe cannot override the world definition', () => {
  const fixtureState = fixture(); fixtureState.actions.craft('forged');
  expect(fixtureState.wood()).toBe(9);
  expect(fixtureState.commits()).toBe(0); expect(fixtureState.notices.join('')).toContain('配方');
});
