import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../../schema/variables';
import { buildModuleContextProjection } from './contextRouter';

const world = {
  id: 'all-modules',
  name: '全模块世界',
  modules: [
    { moduleId: 'stat', enabled: true, moduleConfig: { stats: [{ id: 'hp', name: '生命' }] } },
    { moduleId: 'progression', enabled: true },
    { moduleId: 'survival', enabled: true, moduleConfig: { resources: [{ id: 'water', name: '清水' }] } },
    { moduleId: 'business', enabled: true },
    { moduleId: 'dice', enabled: true },
    { moduleId: 'profession', enabled: true, moduleConfig: { packIds: ['fantasy-core'], professionsEnabled: true } },
  ],
} as any;

function richState() {
  const state = createDefaultGameState();
  state.玩家.当前段位索引 = 2;
  state.玩家.当前经验值 = 30;
  state.玩家.生存资源 = { water: { 数量: 3, name: '清水' } };
  state.玩家.经营资产 = { 资金: 800, 资产列表: [] };
  state.玩家.能力系统 = {
    天赋点: 0, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {},
    职业状态: { 职业ID: 'warrior', 职业名称: '战士', 职业等级: 1, 能力点: 1, 已解锁能力: { power_strike: { 名称: '蓄力猛击', 类型: 'active', 等级: 1, 解锁轮次: 1 } } },
  };
  state.玩家.技能系统 = {};
  state.dice = { history: [] };
  return state;
}

describe('ModuleContextRouter', () => {
  test('keeps an ordinary dialogue to bounded summaries without six detailed modules', () => {
    const result = buildModuleContextProjection({ state: richState(), worldDef: world, userText: '和老板聊聊近况', target: 'extraction' });
    expect(result.relevantModuleIds).toEqual([]);
    expect(result.summary.length).toBeLessThanOrEqual(360);
    expect((result.state as any).玩家.生存状态).toBeUndefined();
    expect((result.state as any).玩家.经营资产).toBeUndefined();
    expect((result.state as any).玩家.技能系统).toBeUndefined();
    expect(JSON.stringify(result.state).length).toBeLessThan(JSON.stringify(richState()).length);
  });

  test('loads only survival details when this turn consumes water', () => {
    const result = buildModuleContextProjection({
      state: richState(), worldDef: world, userText: '我喝水缓解口渴', aiText: '你饮下了一瓶清水。', target: 'extraction',
    });
    expect(result.relevantModuleIds).toEqual(['survival']);
    expect(result.state.玩家.生存资源?.water.数量).toBe(3);
    expect((result.state as any).玩家.经营资产).toBeUndefined();
    expect((result.state as any).玩家.能力系统).toBeUndefined();
  });

  test('uses active task requirements as deterministic module signals', () => {
    const state = richState();
    state.玩家.任务系统!.活跃任务.test = {
      任务名: '渡河', 任务类型: '支线', 描述: '', 状态: '进行中', 优先级: '中', $time: 1, 目标: '渡河',
      资源需求: [{ 资源名: 'water', 数量: 1, 消耗: true }],
      技能需求: [{ 技能名: '游泳' }],
    };
    const result = buildModuleContextProjection({ state, worldDef: world, userText: '继续执行任务', target: 'main' });
    expect(result.relevantModuleIds).toEqual(expect.arrayContaining(['survival', 'profession']));
  });

  test('projects only the current profession tree when profession context is relevant', () => {
    const result = buildModuleContextProjection({ state: richState(), worldDef: world, userText: '我使用蓄力猛击', target: 'main' });
    expect(result.professionDetail).toContain('蓄力猛击');
    expect(result.professionDetail).toContain('牺牲速度换取一次强力攻击');
    expect(result.professionDetail).not.toContain('守护姿态');
    expect(result.professionDetail).not.toContain('火焰箭');
  });
});
