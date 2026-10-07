import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import type { GameEngine } from '../../../../engine/types';
import { VariableManager } from '../../../../engine/variableManager';
import { createDefaultGameState } from '../../../../schema/variables';
import type { WorldDef } from '../../../../data/worlds-schema';
import { useSurvivalCraft } from './useSurvivalCraft';

function fixture(readOnly = false) {
  const initial = createDefaultGameState(); initial.玩家.生存资源 = { wood: { 数量: 9, 最大值: 10 } };
  const manager = new VariableManager(initial); let commits = 0; const notices: string[] = [];
  const engine = { variableManager: manager, isGenerating: false, isReadOnly: readOnly,
    commitPlayerState: (state: typeof initial) => { commits++; manager.setState(state); return true; },
  } as unknown as GameEngine;
  const world = { id: 'survival_test', name: '生存世界', modules: [{ moduleId: 'survival', enabled: true, moduleConfig: {
    resources: [{ id: 'wood', name: '木材', max: 10, amount: 9, gatherAmount: 5, gatherStaminaCost: 3, gatherTimeMinutes: 10 }], recipes: [],
  } }] } as unknown as WorldDef;
  let actions!: ReturnType<typeof useSurvivalCraft>;
  renderToString(createElement(() => { actions = useSurvivalCraft(engine, null, world, text => { if (text) notices.push(text); }, () => {}); return null; }));
  return { actions, manager, notices, commits: () => commits };
}
test('the production survival hook commits through the engine gateway and reports actual capacity-limited gathering', () => {
  const fixtureState = fixture(); fixtureState.actions.handleSurvivalGather('wood');
  expect(fixtureState.commits()).toBe(1);
  expect(fixtureState.manager.getState().玩家.生存资源?.wood.数量).toBe(10);
  expect(fixtureState.notices.join('')).toContain('木材 +1');
  expect(fixtureState.notices.join('')).toContain('体力 -3');
  expect(fixtureState.notices.join('')).toContain('容量');
});
test('read-only survival operations never spend resources or enter the commit gateway', () => {
  const fixtureState = fixture(true); fixtureState.actions.handleSurvivalGather('wood');
  expect(fixtureState.manager.getState().玩家.生存资源?.wood.数量).toBe(9);
  expect(fixtureState.commits()).toBe(0); expect(fixtureState.notices.join('')).toContain('只读');
});
test('a stale or forged panel recipe cannot override the world definition', () => {
  const fixtureState = fixture(); fixtureState.actions.handleSurvivalCraft({ id: 'forged', name: '伪造', inputs: {}, output: { resourceId: 'wood', amount: 500 }, description: '' });
  expect(fixtureState.manager.getState().玩家.生存资源?.wood.数量).toBe(9);
  expect(fixtureState.commits()).toBe(0); expect(fixtureState.notices.join('')).toContain('配方');
});
