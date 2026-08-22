import { describe, it, expect } from 'bun:test';
import { VariableManager } from '../engine/variableManager';
import { createDefaultGameState } from '../schema/variables';
import type { ModuleEffects } from '../modules/schema';
import { createWorldClock, formatWorldClock } from '../time/worldClock';

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

describe('VariableManager.applyUpdateVariable atomicity', () => {
  it('prevents cross-round poisoning and repairs the same damage in old saves', () => {
    const vm = freshVM();
    const before = vm.createSafeSnapshotForPrompt().人物档案;

    const applied = vm.applyUpdateVariable(JSON.stringify([
      { op: 'replace', path: '/人物档案', value: null },
    ]));

    expect(applied).toBe(false);
    expect(vm.createSafeSnapshotForPrompt().人物档案).toEqual(before);

    const damagedSave = createDefaultGameState();
    (damagedSave as any).人物档案 = null;
    const recoveredVm = new VariableManager(damagedSave);
    expect(recoveredVm.createSafeSnapshotForPrompt().人物档案).toEqual({});
  });

  it('migrates legacy object-shaped task goals instead of passing objects to React', () => {
    const damagedSave = createDefaultGameState();
    (damagedSave.玩家.任务系统!.活跃任务 as any).旧任务 = {
      任务名: '旧任务',
      任务类型: '支线',
      描述: '调查线索',
      状态: '进行中',
      优先级: '中',
      目标: {
        描述: '抵达钟楼',
        阶段: [{ 名称: '上楼', 描述: '找到楼梯', 状态: '进行中' }],
      },
      $time: 1,
    };

    const recovered = new VariableManager(damagedSave).getState().玩家.任务系统!.活跃任务.旧任务;
    expect(recovered.目标).toBe('抵达钟楼');
    expect(recovered.阶段).toEqual([{ 名称: '上楼', 描述: '找到楼梯', 状态: '进行中' }]);
  });

  it('repairs an object-shaped current goal before the status panel renders it', () => {
    const damagedSave = createDefaultGameState();
    (damagedSave.玩家 as any).当前目标 = {
      描述: '抵达钟楼',
      阶段: [{ 名称: '上楼' }],
    };

    expect(new VariableManager(damagedSave).getState().玩家.当前目标).toBe('抵达钟楼');
  });

  it('restores NPC records from a snapshot together with player variables', () => {
    const before = createDefaultGameState();
    const vm = new VariableManager(before);
    const snapshot = vm.createSnapshot();
    const after = vm.getState();
    (after.人物档案 as any).NPC_旧档 = { 姓名: '旧档角色', 人物分类: '在场', 人物事迹: ['已建立档案'] };
    vm.setState(after);

    vm.restoreSnapshot(snapshot);

    expect(vm.getState().人物档案).toEqual({});
  });
});

describe('VariableManager manual time editing', () => {
  it('persists a manually edited display time by reconciling the authoritative clock', () => {
    const state = createDefaultGameState();
    state.世界.时间系统.时钟 = createWorldClock({ mode: 'gregorian', start: { year: 2026, month: 8, day: 1, hour: 15, minute: 0 } });
    state.世界.时间系统.当前时间 = formatWorldClock(state.世界.时间系统.时钟);
    const vm = new VariableManager(state);
    const edited = vm.getState();
    edited.世界.时间系统.当前时间 = '2026年8月2日上午9点';

    expect(vm.setStateFromJSON(JSON.stringify(edited))).toBe(true);
    expect(vm.getState().世界.时间系统.时钟?.current).toMatchObject({ year: 2026, month: 8, day: 2, hour: 9, minute: 0 });
  });

  it('keeps a formatted display-time edit stable when the same JSON is applied again', () => {
    const state = createDefaultGameState();
    state.世界.时间系统.时钟 = createWorldClock({
      mode: 'gregorian',
      start: { year: 2026, month: 8, day: 1, hour: 15, minute: 0 },
    });
    state.世界.时间系统.当前时间 = formatWorldClock(state.世界.时间系统.时钟);
    const vm = new VariableManager(state);
    const edited = vm.getState();
    edited.世界.时间系统.当前时间 = edited.世界.时间系统.当前时间.replace('15:00', '17:04');
    const json = JSON.stringify(edited);

    expect(vm.setStateFromJSON(json)).toBe(true);
    expect(vm.setStateFromJSON(json)).toBe(true);
    expect(vm.getState().世界.时间系统.时钟?.current).toMatchObject({
      year: 2026, month: 8, day: 1, hour: 17, minute: 4,
    });
  });
});
