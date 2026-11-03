import { expect, test } from 'bun:test';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import { createEmptyDirectorState, type PlotPlan } from './types';
import { createInitialCustomModuleState } from '../custom-modules/stateStore';
import type { CustomGameplayModuleV3 } from '../custom-modules/schema';
import type { DirectorAuthoredEffect } from './authoredEffectsTypes';
import { executeAuthoredEffects } from './authoredEffects';

export function authoredFixture(effects: DirectorAuthoredEffect[]) {
  const state = createDefaultGameState();
  state.人物档案.n = { 姓名: '甲', 人物分类: '离场', 物品列表: ['唯一钥匙'], 生存状态: { 血量: 100, 体力值: 100 }, 个人信息: { 当前状态: '正常', 当前位置: '旧城' } } as NPCData;
  const module: CustomGameplayModuleV3 = {
    kind: 'custom-gameplay-module', schemaVersion: 3, id: 'gate', name: '门禁', version: '1.0.0', author: 'test', scope: 'world',
    inputs: {}, capabilities: ['currency', 'inventory'], items: { key: { name: '唯一钥匙' } },
    state: { open: { type: 'boolean', default: false }, owner: { type: 'enum', values: ['none', 'ground', 'library', 'n', 'player'], default: 'n' } },
    permissions: { read: [], write: 'own-state-only' },
    logic: { onGameStart: [], onTick: [], onTurnEnd: [], onButton: [], onChoice: [{ id: 'open', actions: [{ type: 'set', path: 'open', value: true }] }] },
  };
  state.customModules = { gate: createInitialCustomModuleState(module) };
  const director = createEmptyDirectorState();
  director.sourceBinding = { type: 'authored', sourceId: 'book', definitionId: 'book', version: '1', boundAt: 1 };
  const plan = { id: 'source:book:1:death', sourceRef: 'death', intent: '死亡开门', participants: ['n'], dependencies: [], status: 'ready', priority: 80, source: 'authored', visibility: 'reader_only', createdAt: 1, updatedAt: 1, authorEffects: effects } as PlotPlan;
  director.plans[plan.id] = plan;
  return { state, director, plan, module };
}
const gate: DirectorAuthoredEffect = { type: 'module.rule', moduleId: 'gate', moduleVersion: '1.0.0', lifecycle: 'onChoice', ruleId: 'open' };
test('atomic authored death and fixed gate rule, with stable retry', () => {
  const f = authoredFixture([{ type: 'npc.die', actorId: 'n' }, gate]);
  const result = executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'death' });
  expect(result.success).toBe(true);
  expect(result.state.人物档案.n.战斗状态).toBe('死亡');
  expect(result.state.人物档案.n.生存状态?.血量).toBe(0);
  expect(result.state.customModules!.gate.values.open).toBe(true);
  expect(f.state.人物档案.n.生存状态?.血量).toBe(100);
  expect(executeAuthoredEffects(result.state, f.plan, f.director, { eventId: 'death' }).state).toEqual(result.state);
});

test('environmental unique owners preserve registry without inventing NPC inventories', () => {
  const effect: DirectorAuthoredEffect = { type: 'uniqueItem.transfer', moduleId: 'gate', moduleVersion: '1.0.0', itemId: 'key', ownerField: 'owner', expectedOwner: 'ground', newOwner: 'n' };
  const f = authoredFixture([effect]);
  f.state.customModules!.gate.values.owner = 'ground';
  f.state.人物档案.n.物品列表 = [];
  const picked = executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'pick' });
  expect(picked.success).toBe(true);
  expect(picked.state.人物档案.n.物品列表).toEqual(['唯一钥匙']);
  f.plan.authorEffects = [{ ...effect, expectedOwner: 'n', newOwner: 'library' }];
  const shelved = executeAuthoredEffects(picked.state, f.plan, f.director, { eventId: 'shelf' });
  expect(shelved.success).toBe(true);
  expect(shelved.state.customModules!.gate.values.owner).toBe('library');
  expect(shelved.state.人物档案.n.物品列表).toEqual([]);
  expect(shelved.state.人物档案.library).toBeUndefined();
});

test('a declared NPC owner cannot transfer a missing unique item', () => {
  const f = authoredFixture([{ type: 'uniqueItem.transfer', moduleId: 'gate', moduleVersion: '1.0.0', itemId: 'key', ownerField: 'owner', expectedOwner: 'n', newOwner: 'player' }]);
  f.state.人物档案.n.物品列表 = [];
  const result = executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'missing' });
  expect(result.success).toBe(false);
  expect(result.state).toBe(f.state);
});
test('cost failure rolls back death and does not record success', () => {
  const f = authoredFixture([{ type: 'npc.die', actorId: 'n' }, gate]);
  f.state.customModules!.gate.definition!.logic.onChoice[0].actions.push({ type: 'currency.consume', amount: 99999 });
  const result = executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'poor' });
  expect(result.success).toBe(false);
  expect(result.state).toBe(f.state);
});
test('rejects dynamic plan, module version, unknown rule and unsatisfied rule', () => {
  const f = authoredFixture([gate]);
  f.plan.source = 'director';
  expect(executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'dynamic' }).success).toBe(false);
  f.plan.source = 'authored';
  for (const effect of [{ ...gate, moduleVersion: '2' }, { ...gate, ruleId: 'absent' }]) {
    (f.plan as PlotPlan & { authorEffects: DirectorAuthoredEffect[] }).authorEffects = [effect];
    expect(executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'invalid' }).success).toBe(false);
  }
  (f.plan as PlotPlan & { authorEffects: DirectorAuthoredEffect[] }).authorEffects = [gate];
  f.state.customModules!.gate.definition!.logic.onChoice[0].when = { type: 'compare', source: 'state', path: 'open', operator: 'eq', value: true };
  expect(executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'condition' }).success).toBe(false);
});
test('rejects present actors and current combat participants', () => {
  const f = authoredFixture([{ type: 'npc.die', actorId: 'n' }]);
  f.state.人物档案.n.人物分类 = '在场';
  expect(executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'present' }).success).toBe(false);
  f.state.人物档案.n.人物分类 = '离场';
  f.state.v3 = { schemaVersion: 3, combatSession: { status: 'active', participants: [{ id: 'n' }] } } as typeof f.state.v3;
  expect(executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'combat' }).success).toBe(false);
});
test('unique transfer commits owner with inventory and rejects conflicts', () => {
  const effect: DirectorAuthoredEffect = { type: 'uniqueItem.transfer', moduleId: 'gate', moduleVersion: '1.0.0', itemId: 'key', ownerField: 'owner', expectedOwner: 'n', newOwner: 'player' };
  const f = authoredFixture([effect]);
  const result = executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'key' });
  expect(result.success).toBe(true);
  expect(result.state.customModules!.gate.values.owner).toBe('player');
  expect(result.state.玩家.物品栏.唯一钥匙.数量).toBe(1);
  f.state.玩家.物品栏.唯一钥匙 = { 数量: 1, 类型: '物品', 品质: '普通', 备注: '' };
  expect(executeAuthoredEffects(f.state, f.plan, f.director, { eventId: 'conflict' }).success).toBe(false);
});
