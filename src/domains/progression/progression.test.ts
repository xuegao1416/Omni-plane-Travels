// 成长模块：行动经验、领域事件经验、升级发点、突破关卡、AI 不能改经验。
// 前五条由 gameplay/modules/modules.test 的成长用例与 engine/progressionSettlement.test 移植。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { ProgressionConfig } from '../../modules/schema';
import { createGameplayHost } from '../../core/registry';
import type { GameplayHost } from '../../core/host';

const LEVELS: ProgressionConfig['levelData'] = {
  maxLevel: 5,
  baseStats: { attrAMax: 100, attrBMax: 100, dim1Max: 10, dim2Max: 10, dim3Max: 10, dim4Max: 10, dim5Max: 10, dim6Max: 10 },
  growthPerLevel: { attrAMax: 10, attrBMax: 10, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 },
};

function progression(overrides: Partial<ProgressionConfig> = {}): ProgressionConfig {
  return {
    mode: 'level', xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 }, levelData: LEVELS,
    activityRewards: [{ id: 'study', label: '研习', keywords: ['研习'], rate: 0.2 }],
    ...overrides,
  };
}

function world(config: ProgressionConfig, extra: unknown[] = []): WorldDef {
  return { id: 'growth_world', name: '成长', description: '', modules: [{ moduleId: 'progression', enabled: true, moduleConfig: config }, ...extra] } as unknown as WorldDef;
}

function setup(def: WorldDef, mutate?: (state: GameState) => void) {
  const state = createDefaultGameState();
  state.玩家.当前段位索引 = 0;
  state.玩家.当前经验值 = 90;
  mutate?.(state);
  const host = createGameplayHost(def, state);
  return { host, state: host.prepare(state) };
}

function endTurn(host: GameplayHost, state: GameState, turn: number, userText: string) {
  const started = host.startTurn(state, { turnId: `t${turn}`, round: turn, userText });
  return host.endTurn(started.state, { turnId: `t${turn}`, round: turn, userText });
}

describe('成长', () => {
  test('回合结束按行动给经验，升级时发放天赋点与技能点', () => {
    const { host, state } = setup(world(progression({ pointsPerTier: { talent: 1, skill: 2 } })), draft => {
      draft.玩家.能力系统 = { 天赋点: 0, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    });
    const outcome = endTurn(host, state, 1, '研习账册');
    expect(outcome.state.玩家.当前段位索引).toBe(1);
    expect(outcome.state.玩家.当前经验值).toBe(10);
    expect(outcome.state.玩家.能力系统?.天赋点).toBe(1);
    expect(outcome.state.玩家.能力系统?.技能点).toBe(2);
    expect(outcome.events.some(event => event.type === 'progression.promoted')).toBe(true);
    expect(outcome.notes.some(note => note.text.includes('Lv.1'))).toBe(true);
  });

  test('有职业时发职业能力点，不再发旧的技能点', () => {
    const { host, state } = setup(world(progression({ pointsPerTier: { skill: 2 } })), draft => {
      draft.玩家.能力系统 = { 天赋点: 0, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {}, 职业状态: { 职业ID: 'warrior', 职业名称: '战士', 职业等级: 1, 能力点: 1, 已解锁能力: {} } };
    });
    const outcome = endTurn(host, state, 1, '研习');
    expect(outcome.state.玩家.能力系统?.职业状态).toMatchObject({ 职业等级: 2, 能力点: 3 });
    expect(outcome.state.玩家.能力系统?.技能点).toBe(0);
  });

  test('职业世界按职业包的每级能力点发放，不会漏到天赋点或技能点', () => {
    // 武侠内置职业包：每级 1 点职业能力点。
    const profession = { moduleId: 'profession', enabled: true, moduleConfig: { packIds: ['wuxia-core'], professionsEnabled: true } };
    const { host, state } = setup(world(progression({ pointsPerTier: { talent: 9, skill: 9 } }), [profession]), draft => {
      draft.玩家.能力系统 = { 天赋点: 0, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {}, 职业状态: { 职业ID: 'warrior', 职业名称: '战士', 职业等级: 1, 能力点: 0, 已解锁能力: {} } };
    });
    const next = endTurn(host, state, 1, '研习战技').state.玩家.能力系统!;
    expect(next.职业状态).toMatchObject({ 职业等级: 2, 能力点: 1 });
    expect(next.天赋点).toBe(0);
    expect(next.技能点).toBe(0);
  });

  test('结算记入玩法日志', () => {
    const { host, state } = setup(world(progression()));
    const outcome = endTurn(host, state, 1, '研习古籍');
    expect(outcome.state.玩家.当前段位索引).toBe(1);
    expect(outcome.state.gameplay?.logs.at(-1)?.changes.some(change => change.path === '玩家.当前段位索引')).toBe(true);
  });

  test('突破关卡：经验停在关口，手动突破时检查条件、扣代价、发奖励', () => {
    const config = progression({
      breakthroughs: [{ tierIndex: 1, conditions: [{ state: { path: '玩家.当前目标', op: '==', value: '突破' } }], costs: [{ path: '玩家.经营资产.资金', amount: 5 }], rewards: [{ set: { path: '玩家.性格', value: '觉醒' } }] }],
    });
    const { host, state } = setup(world(config), draft => { draft.玩家.经营资产 = { 资金: 20, 资产列表: [], 交易日志: [] }; });
    const filled = endTurn(host, state, 1, '研习');
    expect(filled.state.玩家.当前段位索引).toBe(0);
    expect(filled.state.玩家.当前经验值).toBe(100);
    expect(filled.events.some(event => event.type === 'progression.ready')).toBe(true);
    expect(host.dispatch(filled.state, 'progression.breakthrough', { targetTier: 1 }).reason).toContain('突破条件未满足');
    const ready = structuredClone(filled.state);
    ready.玩家.当前目标 = '突破';
    const done = host.dispatch(ready, 'progression.breakthrough', { targetTier: 1 });
    expect(done.status).toBe('applied');
    expect(done.state.玩家.当前段位索引).toBe(1);
    expect(done.state.玩家.经营资产?.资金).toBe(15);
    expect(done.state.玩家.性格).toBe('觉醒');
  });

  test('领域事件给经验：检定成功、任务完成都会成长，每回合有上限', () => {
    const { host, state } = setup(world(progression()), draft => { draft.玩家.当前经验值 = 0; });
    const checked = host.apply(state, [{ op: 'emit', event: 'check.rolled', payload: { success: true } }], { source: 'event', label: '检定' });
    expect(checked.state.玩家.当前经验值).toBe(4);
    let current = checked.state;
    for (let index = 0; index < 20; index++) {
      current = host.apply(current, [{ op: 'emit', event: 'check.rolled', payload: { success: true } }], { source: 'event', label: '检定' }).state;
    }
    expect(current.玩家.当前经验值).toBe(30);
  });

  test('AI 完成任务（直接改任务状态）也会触发任务完成经验；AI 不能直接改经验', () => {
    const { host, state } = setup(world(progression()), draft => {
      draft.玩家.当前经验值 = 0;
      draft.玩家.任务系统 = { 活跃任务: { 寻人: { 描述: '找到失踪的人', 进度: 90 } as never }, 已完成任务: {}, 已失败任务: {} } as never;
    });
    const done = host.apply(state, [
      { op: 'remove', path: '玩家.任务系统.活跃任务.寻人' },
      { op: 'set', path: '玩家.任务系统.已完成任务.寻人', value: { 描述: '找到失踪的人' } },
    ], { source: 'ai', label: 'AI 更新' });
    expect(done.events.some(event => event.type === 'quest.completed' && event.payload.name === '寻人')).toBe(true);
    expect(done.state.玩家.当前经验值).toBe(10);
    const cheat = host.apply(done.state, [{ op: 'set', path: '玩家.当前经验值', value: 9999 }], { source: 'ai', label: 'AI 更新' });
    expect(cheat.state.玩家.当前经验值).toBe(10);
  });

  test('命令发放经验：单次不超过当前阶段所需经验', () => {
    const { host, state } = setup(world(progression()), draft => { draft.玩家.当前经验值 = 0; });
    const granted = host.dispatch(state, 'progression.gain', { xp: 500, reason: '奇遇' });
    expect(granted.state.玩家.当前段位索引).toBe(1);
    expect(granted.state.玩家.当前经验值).toBe(0);
  });
});
