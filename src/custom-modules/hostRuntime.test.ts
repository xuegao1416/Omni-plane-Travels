import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { executeCustomModuleInGame } from './hostRuntime';
import { simulateCustomModule } from './preview';
import { normalizeCustomGameplayModule } from './normalize';
import { createInitialCustomModuleState, migrateCustomModuleState } from './stateStore';
import type { CustomGameplayModuleV3 } from './schema';

export const craftingModule: CustomGameplayModuleV3 = {
  kind: 'custom-gameplay-module', schemaVersion: 3, id: 'crafting-demo', name: '工坊', version: '1.0.0', author: 'test', scope: 'world',
  inputs: {}, capabilities: ['currency', 'inventory', 'survival'],
  items: { ore: { name: '矿石' }, sword: { name: '铁剑', category: '武器' } },
  state: { crafted: { type: 'number', default: 0, min: 0 } },
  permissions: { read: [], write: 'own-state-only' },
  logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [{ id: 'forge', actions: [
    { type: 'currency.consume', amount: 10 }, { type: 'currency.consume', amount: 15 },
    { type: 'item.consume', itemId: 'ore', amount: 2 }, { type: 'item.grant', itemId: 'sword', amount: 1 },
    { type: 'survival.consume', resourceId: 'energy', amount: 3 }, { type: 'add', path: 'crafted', value: 1 },
  ] }] },
};

function state() {
  const game = createDefaultGameState();
  game.玩家.货币资源.主货币.数量 = 30;
  game.玩家.物品栏 = { 矿石: { 数量: 3, 类型: '材料', 品质: '普通', 备注: '' } };
  game.玩家.生存资源 = { energy: { 数量: 10, 最大值: 10 } };
  return game;
}

describe('V3 atomic host runtime', () => {
  test('reserved module identity fails visibly before host execution', () => {
    const result = executeCustomModuleInGame(state(), { ...craftingModule, id: 'constructor' }, 'onButton', { eventId: 'reserved' });
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.gameState).toEqual(state());
  });
  test('spends resources, awards items, commits own state and deduplicates the event', () => {
    const original = state();
    const result = executeCustomModuleInGame(original, craftingModule, 'onButton', { eventId: 'click-1' });
    expect(result.warnings).toEqual([]);
    expect(result.gameState.玩家.货币资源.主货币.数量).toBe(5);
    expect(result.gameState.玩家.物品栏.矿石.数量).toBe(1);
    expect(result.gameState.玩家.物品栏.铁剑.数量).toBe(1);
    expect(result.gameState.玩家.生存资源!.energy.数量).toBe(7);
    expect(result.gameState.customModules![craftingModule.id].values.crafted).toBe(1);
    expect(original).toEqual(state());
    const duplicate = executeCustomModuleInGame(result.gameState, craftingModule, 'onButton', { eventId: 'click-1' });
    expect(duplicate.applied).toBe(0);
    expect(duplicate.gameState).toEqual(result.gameState);
    expect(simulateCustomModule(craftingModule, original, 'onButton', { eventId: 'click-1' }).gameState).toEqual(result.gameState);
  });
  test('aggregates duplicate costs before validation and leaves all rule changes unapplied', () => {
    const original = state();
    original.玩家.货币资源.主货币.数量 = 20;
    const result = executeCustomModuleInGame(original, craftingModule, 'onButton', { eventId: 'poor' });
    expect(result.applied).toBe(0);
    expect(result.gameState.玩家).toEqual(original.玩家);
    expect(result.gameState.customModules![craftingModule.id].values.crafted).toBe(0);
    expect(result.warnings.join(' ')).toContain('不足');
  });
  test('rejects undeclared capabilities and items', () => {
    const result = executeCustomModuleInGame(state(), { ...craftingModule, capabilities: [] }, 'onButton', { eventId: 'bad' });
    expect(result.applied).toBe(0);
    expect(result.warnings.join(' ')).toContain('capability');
    const missingItem = executeCustomModuleInGame(state(), { ...craftingModule, items: {} }, 'onButton', { eventId: 'bad-item' });
    expect(missingItem.applied).toBe(0);
    expect(missingItem.warnings.join(' ')).toContain('undeclared-item');
  });
  test('rejects an invalid own-state reference without consuming resources', () => {
    const module: CustomGameplayModuleV3 = { ...craftingModule,
      inputs: { amount: 'player.currency.primary' }, permissions: { ...craftingModule.permissions, read: ['player.currency.primary'] },
      state: { crafted: { type: 'number', default: 0, max: 2 } },
      logic: { ...craftingModule.logic, onButton: [{ id: 'bounded', actions: [
        { type: 'currency.consume', amount: 10 }, { type: 'set', path: 'crafted', value: { source: 'input', path: 'amount' } },
      ] }] },
    };
    const result = executeCustomModuleInGame(state(), module, 'onButton', { eventId: 'bounded' });
    expect(result.applied).toBe(0);
    expect(result.gameState.玩家).toEqual(state().玩家);
    expect(result.gameState.customModules![module.id].runtime.processedEvents).toBeUndefined();
  });
  test('reads declared inventory quantities, refreshes resource inputs per rule and persists dedup across reload', () => {
    const module: CustomGameplayModuleV3 = { ...craftingModule,
      inputs: { oreCount: 'player.inventory.ore.amount' }, permissions: { ...craftingModule.permissions, read: ['player.inventory.ore.amount'] },
      logic: { ...craftingModule.logic, onButton: [craftingModule.logic.onButton[0], {
        id: 'read-remaining', actions: [{ type: 'set', path: 'crafted', value: { source: 'input', path: 'oreCount' } }],
      }] },
    };
    const result = executeCustomModuleInGame(state(), module, 'onButton', { eventId: 'persist' });
    expect(result.gameState.customModules![module.id].values.crafted).toBe(1);
    const reloaded = JSON.parse(JSON.stringify(result.gameState));
    expect(executeCustomModuleInGame(reloaded, module, 'onButton', { eventId: 'persist' }).gameState).toEqual(reloaded);
  });
  test('a missing survival resource cannot grant an item or spend currency', () => {
    const original = state();
    original.玩家.生存资源 = {};
    const result = executeCustomModuleInGame(original, craftingModule, 'onButton', { eventId: 'missing' });
    expect(result.applied).toBe(0);
    expect(result.gameState.玩家).toEqual(original.玩家);
  });
  test('deduplicates aliased item costs by the actual inventory entry', () => {
    const module: CustomGameplayModuleV3 = { ...craftingModule, items: { ...craftingModule.items, oreAlias: craftingModule.items.ore },
      logic: { ...craftingModule.logic, onButton: [{ id: 'alias-cost', actions: [
        { type: 'item.consume', itemId: 'ore', amount: 2 }, { type: 'item.consume', itemId: 'oreAlias', amount: 2 },
        { type: 'item.grant', itemId: 'sword', amount: 1 },
      ] }] },
    };
    const result = executeCustomModuleInGame(state(), module, 'onButton', { eventId: 'alias' });
    expect(result.applied).toBe(0);
    expect(result.gameState.玩家).toEqual(state().玩家);
  });
  test('retains compatible values but rejects a stricter incompatible state bound', () => {
    const current = createInitialCustomModuleState(craftingModule);
    current.values.crafted = 5;
    expect(migrateCustomModuleState(current, { ...craftingModule, version: '1.1.0' }).state!.values.crafted).toBe(5);
    expect(migrateCustomModuleState(current, { ...craftingModule, state: { crafted: { type: 'number', default: 0, max: 2 } } }).conflicts).toContain('crafted');
  });
  test('upgrades V2 once into canonical V3 with stable rule ids', () => {
    const { capabilities, items, ...base } = craftingModule;
    const v2 = { ...base, schemaVersion: 2, logic: { ...base.logic, onButton: [{ actions: [{ type: 'add', path: 'crafted', value: 1 }] }] } };
    const result = normalizeCustomGameplayModule(v2);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.schemaVersion).toBe(3);
      expect(result.data.logic.onButton[0].id).toBe('onButton-1');
    }
  });
});
