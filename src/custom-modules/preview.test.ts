import { describe, expect, test } from 'bun:test';
import { createCustomModulePreview, createCustomModulePreviewState } from './preview';
import type { CustomGameplayModuleV3 } from './schema';

const startModule: CustomGameplayModuleV3 = {
  kind: 'custom-gameplay-module', schemaVersion: 3, id: 'preview-start', name: '开局礼包', version: '1.0.0', author: 'test', scope: 'world',
  inputs: {}, capabilities: ['currency', 'inventory', 'survival'],
  items: { ore: { name: '矿石' } },
  state: { stage: { type: 'number', default: 0 } },
  permissions: { read: [], write: 'own-state-only' },
  logic: { onGameStart: [{ id: 'welcome', actions: [
    { type: 'item.grant', itemId: 'ore', amount: 3 },
    { type: 'survival.consume', resourceId: 'energy', amount: 10 },
    { type: 'add', path: 'stage', value: 1 },
  ] }], onTurnEnd: [], onTick: [], onChoice: [], onButton: [] },
};

describe('standalone workshop preview', () => {
  test('seeds a spendable state, applies onGameStart and never mutates the draft', () => {
    const snapshot = JSON.stringify(startModule);
    const preview = createCustomModulePreview(startModule);
    expect(preview.warnings).toEqual([]);
    expect(preview.applied).toBeGreaterThan(0);
    expect(preview.gameState.玩家.货币资源.主货币.数量).toBe(100);
    expect(preview.gameState.玩家.物品栏['矿石'].数量).toBe(13);
    expect(preview.gameState.玩家.生存资源!.energy).toEqual({ 数量: 90, 最大值: 100 });
    expect(preview.gameState.customModules![startModule.id].values.stage).toBe(1);
    expect(JSON.stringify(startModule)).toBe(snapshot);
    expect(createCustomModulePreviewState(startModule)).toEqual(preview.gameState);
  });

  test('an invalid draft reports warnings instead of throwing or spending anything', () => {
    const broken: CustomGameplayModuleV3 = { ...startModule,
      logic: { ...startModule.logic, onGameStart: [{ id: 'bad', actions: [{ type: 'item.grant', itemId: 'missing', amount: 1 }] }] } };
    const preview = createCustomModulePreview(broken);
    expect(preview.applied).toBe(0);
    expect(preview.warnings.length).toBeGreaterThan(0);
    expect(preview.gameState.玩家.货币资源.主货币.数量).toBe(100);
  });
});
