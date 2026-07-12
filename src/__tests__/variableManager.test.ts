import { describe, it, expect } from 'bun:test';
import { VariableManager } from '../engine/variableManager';
import { createDefaultGameState } from '../schema/variables';
import type { ModuleEffects } from '../modules/schema';

function freshVM() {
  const vm = new VariableManager(createDefaultGameState());
  const state = vm.getState();
  if (!state.玩家.生存资源) state.玩家.生存资源 = {};
  (state.玩家.生存资源 as any)['water'] = { 数量: 10, name: '清水', symbol: '💧', 最大值: 100 };
  (state.玩家.生存资源 as any)['hp'] = { 数量: 2 };
  vm.setState(state);
  return vm;
}

describe('VariableManager.applyModuleEffects — 资源更新与元数据', () => {
  it('应用 delta 并在下限钳制，保留已有元数据', () => {
    const vm = freshVM();
    const effects = { survival: { resources: { water: { delta: -3, min: 0 } } } } as any as ModuleEffects;
    const log = vm.applyModuleEffects(effects, 'rule', ['survival']);
    expect(log.length).toBe(1);
    const r = vm.getState().玩家.生存资源!['water'];
    expect(r.数量).toBe(7);
    expect(r.name).toBe('清水'); // 元数据保留
    expect(r.symbol).toBe('💧');
  });

  it('数量不低于 0 且不低于 min', () => {
    const vm = freshVM();
    const effects = { survival: { resources: { hp: { delta: -10, min: 0 } } } } as any as ModuleEffects;
    vm.applyModuleEffects(effects, 'rule', ['survival']);
    expect(vm.getState().玩家.生存资源!['hp'].数量).toBe(0);
  });

  it('跳过未知资源 id，不创建幽灵资源', () => {
    const vm = freshVM();
    const effects = { survival: { resources: { ghost: { delta: 5 } } } } as any as ModuleEffects;
    const log = vm.applyModuleEffects(effects, 'rule', ['survival']);
    expect(log.some((l) => l.variable === 'ghost')).toBe(true);
    expect(vm.getState().玩家.生存资源!['ghost']).toBeUndefined();
  });

  it('动态新增资源时写入完整元数据', () => {
    const vm = freshVM();
    const effects = {
      survival: {
        addResources: [
          { id: 'crystal', amount: 3, name: '水晶', symbol: '🔷', max: 50, scarce: false },
        ],
      },
    } as any as ModuleEffects;
    vm.applyModuleEffects(effects, 'rule', ['survival']);
    const r = vm.getState().玩家.生存资源!['crystal'];
    expect(r).toBeDefined();
    expect(r.数量).toBe(3);
    expect(r.name).toBe('水晶');
    expect(r.symbol).toBe('🔷');
  });

  it('addResources 保留全部可选元数据字段', () => {
    const vm = freshVM();
    const effects = {
      survival: {
        addResources: [
          { id: 'ore', amount: 1, name: '矿石', symbol: '⛏️', max: 99, scarce: true, description: '罕见', gatherRate: 2, usage: '锻造' },
        ],
      },
    } as any as ModuleEffects;
    vm.applyModuleEffects(effects, 'rule', ['survival']);
    const r = vm.getState().玩家.生存资源!['ore'] as any;
    expect(r.description).toBe('罕见');
    expect(r.gatherRate).toBe(2);
    expect(r.usage).toBe('锻造');
    expect(r.scarce).toBe(true);
  });
});

describe('VariableManager.addResources 元数据', () => {
  it('合并路径也保留资源元数据', () => {
    const vm = freshVM();
    const effects = {
      survival: {
        addResources: [
          { id: 'gold', amount: 5, name: '金币', symbol: '🪙', max: 9999, scarce: false },
        ],
      },
    } as any as ModuleEffects;
    vm.applyModuleEffects(effects, 'rule', ['survival']);
    expect(vm.getState().玩家.生存资源!['gold'].name).toBe('金币');
  });
});
