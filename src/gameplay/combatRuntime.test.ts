import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../schema/variables';
import type { CombatEncounterProposal, CombatEncounterRequest } from './protocols';
import {
  buildValidatedCombatRoster,
  createPreparingCombatSession,
  selectCombatants,
  startPreparedCombat,
} from './combatV2';
import {
  CombatNarrationCoordinator,
  applyV3CombatCommand,
  buildLocalCombatContinuation,
  requestV3CombatEncounter,
  retryV3Combat,
  startV3Combat,
  isCombatInteractionPaused,
  isCombatSaveEnded,
  preserveCombatOwnedState,
  requestManualV3CombatEncounter,
} from './combatRuntime';
import { buildCombatViewModel } from './combatViewModel';
import { extractStructuredAbilityProposals, extractStructuredCombatEncounterRequest, hasResolvedCombatOutcome, inferImmediateCombatEncounterRequest } from '../engine/variableExtraction';

function makeState(): GameState {
  const state = createDefaultGameState();
  state.玩家.姓名 = '旅者';
  state.玩家.生存状态 = { 血量: 100, 体力值: 60, dim1: 10, dim2: 10, dim3: 10, dim4: 10, dim5: 10, dim6: 10 };
  state.人物档案 = {
    ally: { 姓名: '同伴', 种族: '人类', 性别: '女', 年龄: 20, 生存状态: { 血量: 50, 体力值: 40, dim1: 10 }, 社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: 20, 关系类型: '同伴' }, 个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' }, 重要NPC: true, _关注: true, $time: 1, 人物分类: '在场' },
    enemy: { 姓名: '档案敌人', 种族: '兽人', 性别: '男', 年龄: 20, 生存状态: { 血量: 80, 体力值: 40, dim1: 12 }, 社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: -20, 关系类型: '敌对' }, 个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' }, 重要NPC: true, _关注: true, $time: 1, 人物分类: '在场' },
  };
  state.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: 'normal' } };
  return state;
}

function proposal(): CombatEncounterProposal {
  return {
    schemaVersion: 2,
    id: 'typed-encounter',
    context: '结构化敌对行动已经发生',
    threatBand: 'matched',
    allies: [{ id: 'ally', identity: '同伴', temporary: false }],
    enemies: [
      { id: 'untrusted-proposal-id', identity: '档案敌人', temporary: false },
      { id: 'temp-1', identity: '临时怪物', temporary: true },
    ],
    neutrals: [],
  };
}

function request(source: CombatEncounterRequest['source'] = 'event-workflow'): CombatEncounterRequest {
  return { schemaVersion: 2, source, proposal: proposal() };
}

describe('v3 combat runtime bridge', () => {
  test('accepts only a typed request, keeps real NPC binding keys, and persists preparing state', () => {
    const initial = makeState();
    const roster = buildValidatedCombatRoster(initial, proposal());
    expect(roster.ok).toBe(true);
    expect(roster.plan?.enemyPool[0].id).toBe('enemy');
    expect(roster.plan?.enemyPool[0].stateBinding?.id).toBe('enemy');

    const started = requestV3CombatEncounter(initial, request(), { seed: 17, now: 1 });
    expect(started.ok).toBe(true);
    expect(started.state.v3?.combatSession?.lifecycle).toBe('preparing');
    expect(requestV3CombatEncounter(initial, { type: 'narrative', text: '普通战斗' }, { seed: 17 }).ok).toBe(false);
    expect(requestV3CombatEncounter({ ...initial, v3: { ...initial.v3!, featureFlags: { ...initial.v3!.featureFlags, combatEnabled: false } } }, request(), { seed: 17 }).ok).toBe(false);
    expect(requestManualV3CombatEncounter(initial, proposal(), { seed: 18, now: 1 }).ok).toBe(true);
    expect(requestV3CombatEncounter(started.state, request(), { seed: 17, now: 1 }).alreadyProcessed).toBe(true);
  });

  test('accepts only explicit cross-faction variable encounters', () => {
    const explicit = extractStructuredCombatEncounterRequest({
      combatEncounterRequest: {
        type: 'variable.hostile-action',
        proposal: proposal(),
        hostileAction: { occurred: true, subjectId: 'player', targetId: 'untrusted-proposal-id' },
      },
    });
    expect(explicit?.source).toBe('variable-hostile-action');
    expect(extractStructuredCombatEncounterRequest({ combatEncounterRequest: { type: 'variable.hostile-action', proposal: proposal(), hostileAction: { occurred: true, subjectId: 'player', targetId: 'ally' } } })).toBeUndefined();
    expect(extractStructuredCombatEncounterRequest({ text: '玩家打了敌人，开始战斗' })).toBeUndefined();
    const abilities = extractStructuredAbilityProposals({ abilityProposals: [{ id: 'learned', name: '习得之技', description: '训练完成', category: 'dynamic', rarity: '传说', target: 'enemy', tags: [], damage: 999999 }] });
    expect(abilities).toHaveLength(1);
    expect(abilities[0]).not.toHaveProperty('damage');
    expect(extractStructuredAbilityProposals({ abilityProposals: [{ id: 'bad', name: '越权职业', description: '非法', category: 'profession', target: 'enemy' }] })).toEqual([]);
  });

  test('falls back only for an immediate hostile action when the auxiliary model omits the contract', () => {
    const state = makeState();
    const chase = inferImmediateCombatEncounterRequest('我躲进暗巷', '追杀者已经堵住出口，拔刀朝你劈来。', state, 7);
    expect(chase?.source).toBe('variable-hostile-action');
    expect(chase?.proposal.enemies[0].identity).toContain('追杀');
    expect(chase?.hostileAction?.occurred).toBe(true);
    expect(inferImmediateCombatEncounterRequest('先打听消息', '听说敌人明天可能会追杀你。', state, 7)).toBeUndefined();
    expect(inferImmediateCombatEncounterRequest('继续训练', '你练习了如何应对伏击。', state, 7)).toBeUndefined();
    expect(hasResolvedCombatOutcome('长枪贯穿了袭击者的咽喉，他当场毙命。')).toBe(true);
    expect(inferImmediateCombatEncounterRequest('我攻击他', '长枪贯穿了袭击者的咽喉，他当场毙命。', state, 7)).toBeUndefined();
    expect(hasResolvedCombatOutcome('袭击者拔刀冲来，刀锋已经逼近你的肩侧。')).toBe(false);
  });

  test('uses the v3 core for roster selection, command persistence, pause gate, and refresh-ready state', () => {
    const initial = makeState();
    const prepared = requestV3CombatEncounter(initial, request(), { seed: 3, now: 1 });
    const selected = startV3Combat(prepared.state, ['player', 'ally']);
    expect(selected.ok).toBe(true);
    expect(selected.state.v3?.combatSession?.lifecycle).toBe('active');
    expect(isCombatInteractionPaused(selected.state)).toBe(true);

    const active = selected.state.v3!.combatSession!;
    const command = applyV3CombatCommand(selected.state, {
      commandId: 'runtime-command-1', unitId: active.activeUnitId, kind: 'attack', targetIds: [],
    });
    expect(command.ok).toBe(true);
    expect(command.state.v3?.combatSession?.actionSequence).toHaveLength(1);
    expect(command.state.v3?.combatSession?.actionSequence[0].transactionId).toContain('runtime-command-1');
  });

  test('retry returns the complete checkpoint restore bundle and preserves inferno guard', () => {
    const initial = makeState();
    const prepared = requestV3CombatEncounter(initial, request(), { seed: 9, now: 1, messages: [{ id: 'm1', role: 'assistant', rawText: 'before', round: 1, timestamp: 1 }] });
    const selected = startV3Combat(prepared.state, ['player']);
    const retried = retryV3Combat(selected.state);
    expect(retried.ok).toBe(true);
    expect(retried.restore?.gameState).toEqual(initial);
    expect(retried.restore?.messages?.[0].rawText).toBe('before');
    expect(retried.state.v3?.combatSession?.lifecycle).toBe('preparing');

    const inferno = requestV3CombatEncounter({ ...initial, v3: { ...initial.v3!, featureFlags: { ...initial.v3!.featureFlags, combatRiskMode: 'inferno' } } }, request(), { seed: 9 }).state;
    const infernoActive = startV3Combat(inferno, ['player']).state;
    expect(retryV3Combat(infernoActive).ok).toBe(false);
  });

  test('narration settlement is local-first, structured, retryable, and de-duplicates concurrent requests', async () => {
    const initial = makeState();
    const prepared = requestV3CombatEncounter(initial, request(), { seed: 5, now: 1 });
    const active = startV3Combat(prepared.state, ['player']).state;
    const terminal = { ...active, v3: { ...active.v3!, combatSession: { ...active.v3!.combatSession!, lifecycle: 'terminal' as const, status: 'victory' as const, result: { status: 'victory' as const, rewardEffects: [], rewardsApplied: false, narration: { status: 'pending' as const, attempts: 0 } } } } };
    const coordinator = new CombatNarrationCoordinator();
    let resolveGateway: ((value: string) => void) | undefined;
    const gateway = (_prompt: string): Promise<string> => new Promise(resolve => { resolveGateway = resolve; });
    const first = coordinator.continue(terminal, gateway);
    const second = coordinator.continue(terminal, gateway);
    expect((await second).duplicate).toBe(true);
    resolveGateway?.('战斗事实承接正文');
    const completed = await first;
    expect(completed.state.v3?.combatResult?.rewardsApplied).toBe(true);
    expect(completed.state.v3?.combatResult?.narration.status).toBe('succeeded');
    expect(completed.state.v3?.combatResult?.report?.finalState).toBeDefined();
  });

  test('persists local settlement before the gateway and retries an empty continuation without duplicating rewards', async () => {
    const initial = makeState();
    const prepared = requestV3CombatEncounter(initial, request(), { seed: 6, now: 1 });
    const active = startV3Combat(prepared.state, ['player']).state;
    const terminal = {
      ...active,
      v3: {
        ...active.v3!,
        combatSession: {
          ...active.v3!.combatSession!,
          lifecycle: 'terminal' as const,
          status: 'victory' as const,
          result: { status: 'victory' as const, rewardEffects: [], rewardsApplied: false, narration: { status: 'pending' as const, attempts: 0 } },
        },
      },
    };
    const order: string[] = [];
    const coordinator = new CombatNarrationCoordinator();
    const empty = await coordinator.continue(terminal, async (_prompt, result, protectedState) => {
      order.push('gateway');
      expect(result.rewardsApplied).toBe(true);
      expect(protectedState.v3?.combatResult?.rewardsApplied).toBe(true);
      return '';
    }, state => {
      order.push('persist');
      expect(state.v3?.combatResult?.narration.status).toBe('pending');
    });
    expect(order).toEqual(['persist', 'gateway']);
    expect(empty.result.narration.status).toBe('failed');
    const retried = await coordinator.continue(empty.state, async () => '战斗后的承接正文');
    expect(retried.result.narration.status).toBe('succeeded');
    expect(retried.result.rewardsApplied).toBe(true);
  });

  test('builds a non-empty local continuation when the provider returns no text', () => {
    expect(buildLocalCombatContinuation({
      status: 'victory', rewardEffects: [], rewardsApplied: true, narration: { status: 'pending', attempts: 1 },
    })).toContain('战斗以我方胜利告终');
  });

  test('detects inferno player death as a sealed save while keeping ordinary defeat active', () => {
    const state = makeState();
    state.v3!.featureFlags.combatRiskMode = 'inferno';
    state.v3!.combatResult = {
      status: 'defeat',
      rewardEffects: [],
      rewardsApplied: true,
      narration: { status: 'pending', attempts: 0 },
      report: {
        encounter: { id: 'fatal', context: '炼狱失败', threatBand: 'matched' },
        riskMode: 'inferno',
        participants: [{ id: 'player', identity: '旅者', side: 'player', source: 'player', hp: 0, maxHp: 100, status: 'dead' }],
        actions: [], skillsUsed: [], itemsUsed: [], injuries: [{ unitId: 'player', hp: 0, status: 'dead' }], deaths: ['player'], rewards: [],
        finalState: { status: 'defeat', round: 1, activeUnitId: 'player', units: [{ id: 'player', hp: 0 }] },
      },
    };
    expect(isCombatSaveEnded(state)).toBe(true);
    state.v3!.featureFlags.combatRiskMode = 'normal';
    expect(isCombatSaveEnded(state)).toBe(false);
  });

  test('seals inferno even when companions win after the player dies', () => {
    const state = makeState();
    state.v3!.featureFlags.combatRiskMode = 'inferno';
    state.v3!.combatResult = {
      status: 'victory',
      rewardEffects: [],
      rewardsApplied: true,
      narration: { status: 'pending', attempts: 0 },
      report: {
        encounter: { id: 'fatal-victory', context: '同伴完成战斗', threatBand: 'matched' },
        riskMode: 'inferno',
        participants: [
          { id: 'player', identity: '旅者', side: 'player', source: 'player', hp: 0, maxHp: 100, status: 'dead' },
          { id: 'ally', identity: '同伴', side: 'ally', source: 'ally', hp: 10, maxHp: 50, status: 'active' },
        ],
        actions: [], skillsUsed: [], itemsUsed: [], injuries: [{ unitId: 'player', hp: 0, status: 'dead' }], deaths: ['player'], rewards: [],
        finalState: { status: 'victory', round: 2, activeUnitId: 'ally', units: [{ id: 'player', hp: 0 }, { id: 'ally', hp: 10 }] },
      },
    };
    expect(isCombatSaveEnded(state)).toBe(true);
  });

  test('combat-owned state survives narrative variable updates and cards expose responsive unit models', () => {
    const before = makeState();
    before.玩家.生存状态.血量 = 31;
    before.v3!.abilityInstances = { strike: { definitionId: 'strike', source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 2, proficiency: 3, cooldownRemaining: 1, equipped: true } } };
    const session = startPreparedCombat(selectCombatants(createPreparingCombatSession(before, buildValidatedCombatRoster(before, proposal()).plan!, { seed: 1 }), ['player', 'ally']).session!);
    before.v3!.combatSession = session;
    const after = structuredClone(before);
    after.玩家.生存状态.血量 = 99;
    after.v3!.abilityInstances!.strike.runtime.uses = 99;
    const protectedState = preserveCombatOwnedState(after, before);
    expect(protectedState.玩家.生存状态.血量).toBe(31);
    expect(protectedState.v3?.abilityInstances?.strike.runtime.uses).toBe(2);
    const view = buildCombatViewModel(session, {});
    expect(view.enemyUnits).toHaveLength(2);
    expect(view.allyUnits).toHaveLength(2);
    expect(view.controls).toEqual(['attack', 'skill', 'item', 'defend', 'flee']);
    expect(view.enemyUnits.every(unit => unit.portrait.kind === 'neutral')).toBe(true);
  });
});
