// 战斗结算接入玩法宿主：奖励走内部事务，「战斗结束」在下一回合开始时交给各模块。
// 战斗契约测试（combatV2.test、combatRuntime.test）保持不变。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { createGameplayHost } from '../core/registry';
import { revertTransaction } from '../core/transaction';
import { buildValidatedCombatRoster, createPreparingCombatSession, selectCombatants, settleCombatResult, startPreparedCombat } from './combatV2';

function makeState(): GameState {
  const state = createDefaultGameState();
  state.玩家.生存状态 = { 血量: 100, 体力值: 100, dim1: 10, dim2: 10, dim3: 10, dim4: 10, dim5: 10, dim6: 10 };
  state.人物档案 = {
    enemy: { 姓名: '敌人', 种族: '兽人', 性别: '', 年龄: 20, 生存状态: { 血量: 80, 体力值: 50, dim1: 12 }, 社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: -20, 关系类型: '敌对' }, 个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' }, 重要NPC: true, _关注: true, $time: 1, 人物分类: '在场' },
  } as GameState['人物档案'];
  return state;
}

function terminalSession(state: GameState, status: 'victory' | 'defeat') {
  const roster = buildValidatedCombatRoster(state, { schemaVersion: 2, id: 'encounter-1', context: '敌人拔刀', threatBand: 'matched', allies: [], enemies: [{ id: 'enemy', identity: '敌人', temporary: false }], neutrals: [] });
  const session = startPreparedCombat(selectCombatants(createPreparingCombatSession(state, roster.plan!, { seed: 4 }), ['player']).session!);
  session.lifecycle = 'terminal';
  session.status = status;
  session.result = { status, rewardEffects: [{ add: { path: '玩家.货币资源.主货币.数量', delta: 5, min: 0 } }], rewardsApplied: false, narration: { status: 'pending', attempts: 0 }, terminalTransactionId: `terminal-${status}` };
  return session;
}

const progressionWorld = (xpPolicy: Record<string, number>) => ({
  id: 'combat_world', name: '战场', description: '',
  modules: [{ moduleId: 'progression', enabled: true, moduleConfig: {
    mode: 'level', xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 }, xpPolicy,
    levelData: { maxLevel: 5, baseStats: { attrAMax: 100, attrBMax: 100, dim1Max: 10, dim2Max: 10, dim3Max: 10, dim4Max: 10, dim5Max: 10, dim6Max: 10 }, growthPerLevel: { attrAMax: 10, attrBMax: 10, dim1Max: 1, dim2Max: 1, dim3Max: 1, dim4Max: 1, dim5Max: 1, dim6Max: 1 } },
  } }],
}) as unknown as WorldDef;

describe('战斗结算接入玩法宿主', () => {
  test('奖励作为一笔内部事务提交，可以从变量面板撤销', () => {
    const state = makeState();
    const settled = settleCombatResult(state, terminalSession(state, 'victory'));
    expect(settled.state.玩家.货币资源.主货币.数量).toBe(state.玩家.货币资源.主货币.数量 + 5);
    const log = settled.state.gameplay?.logs.find(entry => entry.transactionId === 'terminal-victory');
    expect(log?.label).toBe('战斗结算');
    const undone = revertTransaction(settled.state, 'terminal-victory');
    expect(undone.status).toBe('applied');
    expect(undone.state.玩家.货币资源.主货币.数量).toBe(state.玩家.货币资源.主货币.数量);
  });

  test('战斗结束事件在下一回合开始时交给各模块，只投放一次', () => {
    const state = makeState();
    const settled = settleCombatResult(state, terminalSession(state, 'victory'));
    expect(settled.state.gameplay?.pendingEvents.map(event => event.type)).toEqual(['combat.ended']);
    const again = settleCombatResult(settled.state, settled.state.v3!.combatSession!);
    expect(again.alreadyApplied).toBe(true);
    expect(again.state.gameplay?.pendingEvents).toHaveLength(1);

    const host = createGameplayHost(undefined, settled.state);
    const next = host.startTurn(settled.state, { turnId: 'after-combat', round: 2 });
    expect(next.events.find(event => event.type === 'combat.ended')?.payload).toMatchObject({ status: 'victory', sessionId: settled.state.v3!.combatSession!.id });
    expect(next.state.gameplay?.pendingEvents).toHaveLength(0);
  });

  test('战斗胜利默认不给经验；世界在 xpPolicy 写了 combat.victory 才给', () => {
    const state = makeState();
    state.玩家.当前经验值 = 0;
    state.玩家.当前段位索引 = 0;
    const settled = settleCombatResult(state, terminalSession(state, 'victory'));
    const plain = createGameplayHost(progressionWorld({}), settled.state);
    expect(plain.startTurn(plain.prepare(settled.state), { turnId: 'a', round: 2 }).state.玩家.当前经验值).toBe(0);
    const rewarding = createGameplayHost(progressionWorld({ 'combat.victory': 0.1 }), settled.state);
    expect(rewarding.startTurn(rewarding.prepare(settled.state), { turnId: 'a', round: 2 }).state.玩家.当前经验值).toBeGreaterThan(0);

    const defeated = settleCombatResult(state, terminalSession(state, 'defeat'));
    const losing = createGameplayHost(progressionWorld({ 'combat.victory': 0.1 }), defeated.state);
    expect(losing.startTurn(losing.prepare(defeated.state), { turnId: 'a', round: 2 }).state.玩家.当前经验值).toBe(0);
  });
});
