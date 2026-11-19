import { describe,it,expect } from 'bun:test';
import { VariableManager } from '../engine/variableManager';
import { createDefaultGameState } from '../schema/variables';
import { createWorldClock,formatWorldClock,normalizeTimeSystemConfig } from '../time/worldClock';

function freshVM() {
  const vm = new VariableManager(createDefaultGameState());
  const state = vm.getState();
  if (!state.玩家.生存资源) state.玩家.生存资源 = {};
  (state.玩家.生存资源 as any)['water'] = { 数量: 10, name: '清水', symbol: '💧', 最大值: 100 };
  (state.玩家.生存资源 as any)['hp'] = { 数量: 2 };
  vm.setState(state);
  return vm;
}

// applyModuleEffects 的七条用例（跨模块一笔事务、钳制、未知物资、新物资元数据）随旧入口删除，
// 已按现行写入路径移植到 src/domains/resources/resources.test.ts「AI 写入物资」。

describe('VariableManager module partitions', () => {
  it('stores only module revision references in message snapshots and restores them', () => {
    const state = createDefaultGameState();
    state.玩家.生存资源 = { water: { 数量: 3 } };
    const vm = new VariableManager(state);

    const before = vm.createSnapshot();
    vm.setVar('玩家.生存资源.water.数量', 1, true);
    vm.createSnapshot();
    vm.restoreSnapshot(before);

    expect((before as any).玩家.生存状态).toBeUndefined();
    expect((before as any).玩家.生存资源).toBeUndefined();
    expect((before as any).moduleRevisions.survival).toBe(0);
    expect(vm.getState().玩家.生存资源?.water.数量).toBe(3);
  });

  it('exports a core state plus independently revisioned module records', () => {
    const state = createDefaultGameState();
    state.玩家.经营资产 = { 资金: 200, 资产列表: [] };
    const vm = new VariableManager(state);
    vm.createSnapshot();
    vm.setVar('玩家.经营资产.资金', 250, true);

    const bundle = vm.createModulePersistenceBundle('save-a');
    expect((bundle.coreState as any).玩家.经营资产).toBeUndefined();
    expect(bundle.current.find(record => record.moduleId === 'business')?.state).toMatchObject({
      assets: { 资金: 250 },
    });
    expect(bundle.checkpoints.some(record => record.moduleId === 'business')).toBe(true);
  });

  it('does not duplicate unchanged module bodies across 600 message snapshots', () => {
    const state = createDefaultGameState();
    state.玩家.生存资源 = { water: { 数量: 3 } };
    const vm = new VariableManager(state);
    const snapshots = Array.from({ length: 600 }, () => vm.createSnapshot());
    const bundle = vm.createModulePersistenceBundle('save-long');
    expect(snapshots.every(snapshot => !(snapshot as any).玩家.生存资源 && snapshot.moduleRevisions?.survival === 0)).toBe(true);
    expect(bundle.checkpoints.filter(record => record.moduleId === 'survival')).toHaveLength(1);
  });
});

describe('VariableManager.applyUpdateVariable atomicity', () => {
  it('accepts only canonical gameplay transactions for AI/runtime variable writes', () => {
    const vm = freshVM();

    expect(vm.applyAiUpdateVariable(JSON.stringify({
      id: 'set-goal', source: 'ai', effects: [{ set: { path: '玩家.当前目标', value: '寻找药材' } }],
    }))).toBe(true);
    expect(vm.getState().玩家.当前目标).toBe('寻找药材');

    expect(vm.applyAiUpdateVariable(JSON.stringify({ 玩家: { 当前目标: '旧对象写法' } }))).toBe(false);
    expect(vm.applyAiUpdateVariable(JSON.stringify({ before: { 玩家: { 当前目标: '旧值' } }, after: {} }))).toBe(false);

    expect(vm.applyAiUpdateVariable(JSON.stringify({
      id: 'bad-root', source: 'ai', effects: [{ set: { path: 'gameplay.logs', value: [] } }],
    }))).toBe(false);
    expect(vm.applyAiUpdateVariable(JSON.stringify({
      id: 'nested-audit', source: 'ai', effects: [{ set: { path: '玩家.before', value: '旧值' } }],
    }))).toBe(false);
    expect(vm.applyAiUpdateVariable(JSON.stringify({
      id: 'allowed-schedule', source: 'ai',
      effects: [{ schedule: { after: 1, event: { type: 'narrative.follow-up' } } }],
    }))).toBe(true);

    expect(vm.applyUpdateVariable(JSON.stringify({ arbitraryEnvelope: { kept: true } }))).toBe(false);
    expect((vm.getState() as any).arbitraryEnvelope).toBeUndefined();
  });

  it('applies gameplay transactions through the shared kernel log', () => {
    const vm = freshVM();
    const state = vm.getState();
    state.玩家.经营资产 = { 资金: 20, 资产列表: [], 交易日志: [] };
    state.玩家.当前经验值 = 4;
    vm.setState(state);

    const applied = vm.applyUpdateVariable(JSON.stringify({
      id: 'ai-reward',
      moduleId: 'progression',
      source: 'ai',
      label: '任务奖励',
      costs: [{ path: '玩家.经营资产.资金', amount: 3 }],
      effects: [{ add: { path: '玩家.当前经验值', delta: 5 } }],
      events: [{ type: 'progression.rewarded' }],
    }));

    expect(applied).toBe(true);
    expect(vm.getState().玩家.经营资产?.资金).toBe(17);
    expect(vm.getState().玩家.当前经验值).toBe(9);
    expect(vm.getState().gameplay?.logs.at(-1)).toMatchObject({
      transactionId: 'ai-reward', status: 'applied', source: 'ai',
    });
  });

  it('applies AI transaction in best-effort mode and skips invalid effects', () => {
    const vm = freshVM();
    const state = vm.getState();
    state.玩家.经营资产 = { 资金: 20, 资产列表: [], 交易日志: [] };
    state.玩家.当前经验值 = 0;
    vm.setState(state);

    const applied = vm.applyUpdateVariable(JSON.stringify({
      id: 'ai-partial', source: 'ai',
      costs: [{ path: '玩家.经营资产.资金', amount: 3 }],
      effects: [
        { add: { path: '玩家.当前经验值', delta: 5 } },
        { add: { path: '玩家.经营资产', delta: 1 } }, // 无效：目标是对象而非数值
      ],
    }));

    expect(applied).toBe(true);
    // bestEffort 下消耗仍会扣除，有效 effect 仍会应用
    expect(vm.getState().玩家.经营资产?.资金).toBe(17);
    expect(vm.getState().玩家.当前经验值).toBe(5);
    const lastLog = vm.getState().gameplay?.logs.at(-1);
    expect(lastLog).toMatchObject({
      transactionId: 'ai-partial', status: 'applied',
    });
    expect(lastLog?.warnings?.some((w: string) => w.includes('数值路径无效'))).toBe(true);
  });

  it('prevents cross-round poisoning and repairs the same damage in old saves', () => {
    const vm = freshVM();
    const before = vm.createSafeSnapshotForPrompt().人物档案;

    const applied = vm.applyUpdateVariable(JSON.stringify([
      { op: 'replace', path: '/人物档案', value: null },
    ]));

    expect(applied).toBe(false);
    expect(vm.createSafeSnapshotForPrompt().人物档案).toEqual(before);
    expect(vm.getState().gameplay?.logs.at(-1)).toBeUndefined();

    const damagedSave = createDefaultGameState();
    (damagedSave as any).人物档案 = null;
    const recoveredVm = new VariableManager(damagedSave);
    expect(recoveredVm.createSafeSnapshotForPrompt().人物档案).toEqual({});
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

  it('rejects non-canonical merge and RFC patch payloads', () => {
    const vm = freshVM();
    const before = vm.getState().玩家.生存资源?.water?.数量;
    expect(vm.applyUpdateVariable(JSON.stringify({
      玩家: { 生存资源: { water: { 数量: 8 } } },
    }))).toBe(false);
    expect(vm.applyUpdateVariable(JSON.stringify([
      { op: 'replace', path: '/玩家/生存资源/water/数量', value: 6 },
    ]))).toBe(false);
    expect(vm.getState().玩家.生存资源?.water?.数量).toBe(before);
    expect(vm.getState().gameplay?.logs.at(-1)).toBeUndefined();
  });
});

describe('VariableManager manual time editing', () => {
  it('persists a manually edited display time by reconciling the authoritative clock', () => {
    const state = createDefaultGameState();
    const config = normalizeTimeSystemConfig({
      mode: 'gregorian',
      start: { year: 2026, month: 8, day: 1, hour: 15, minute: 0 },
    });
    state.世界.时间系统.时钟 = createWorldClock(config);
    state.世界.时间系统.当前时间 = formatWorldClock(state.世界.时间系统.时钟, config);
    const vm = new VariableManager(state, undefined, config);
    const edited = vm.getState();
    edited.世界.时间系统.当前时间 = '2026年8月2日上午9点';

    expect(vm.setStateFromJSON(JSON.stringify(edited))).toBe(true);
    expect(vm.getState().世界.时间系统.时钟?.elapsedMinutes).toBe(18 * 60);
    expect(vm.getState().世界.时间系统.当前时间).toContain('2026年·八月·第2日 09:00');
  });

  it('keeps a formatted display-time edit stable when the same JSON is applied again', () => {
    const state = createDefaultGameState();
    const config = normalizeTimeSystemConfig({
      mode: 'gregorian',
      start: { year: 2026, month: 8, day: 1, hour: 15, minute: 0 },
    });
    state.世界.时间系统.时钟 = createWorldClock(config);
    state.世界.时间系统.当前时间 = formatWorldClock(state.世界.时间系统.时钟, config);
    const vm = new VariableManager(state, undefined, config);
    const edited = vm.getState();
    edited.世界.时间系统.当前时间 = edited.世界.时间系统.当前时间.replace('15:00', '17:04');
    const json = JSON.stringify(edited);

    expect(vm.setStateFromJSON(json)).toBe(true);
    expect(vm.setStateFromJSON(json)).toBe(true);
    expect(vm.getState().世界.时间系统.时钟?.elapsedMinutes).toBe(124);
    expect(vm.getState().世界.时间系统.当前时间).toContain('2026年·八月·第1日 17:04');
  });
});


describe('VariableManager.removeNpc — NPC 删除', () => {
  it('删除存在的 NPC 后再次调用返回 false，且不抛错', () => {
    const state = createDefaultGameState();
    state.人物档案 = {
      路人甲: { 姓名: '路人甲', 关系数据: { 好感度: 0, 关系类型: '路人' } } as any,
      店小二: { 姓名: '店小二', 关系数据: { 好感度: 5, 关系类型: '熟识' } } as any,
    };
    const vm = new VariableManager(state);

    expect(vm.removeNpc('路人甲')).toBe(true);
    expect(vm.getState().人物档案).not.toHaveProperty('路人甲');
    expect(vm.getState().人物档案).toHaveProperty('店小二');

    // 二次删除已不存在的 NPC：返回 false 且不抛错
    expect(vm.removeNpc('路人甲')).toBe(false);
    expect(vm.getState().人物档案).toHaveProperty('店小二');
  });

  it('空 id 与空档案的场景下安全短路', () => {
    const state = createDefaultGameState();
    const vm = new VariableManager(state);

    expect(vm.removeNpc('')).toBe(false);
    expect(vm.removeNpc('随便一个')).toBe(false);
    expect(vm.getState().人物档案).toEqual({});
  });
});
