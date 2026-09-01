import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';
import type { AbilityDefinition, AbilityInstance, CombatEncounterProposal } from './protocols';
import {
  applyCombatResultToSave,
  attachCombatItems,
  balanceCombatItemProposal,
  buildCombatItemLoadout,
  buildValidatedCombatRoster,
  captureCombatCheckpoint,
  chooseAutomaticCommand,
  combatHitChanceV2,
  createPreparingCombatSession,
  normalizeCombatItemDefinition,
  normalizeWorldAttribute,
  persistCombatSession,
  prepareCombatEncounterRequest,
  previewCombatAbilityV2,
  resolveCombatCommandV2,
  restoreCombatCheckpoint,
  retryCombatSession,
  selectCombatants,
  settleCombatResult,
  startPreparedCombat,
} from './combatV2';
import { canRollbackCombat, migrateGameStateToV3, normalizeCombatEncounterProposal, normalizeCombatEncounterRequest, normalizeCombatSessionV2 } from './protocols';
import { normalizeSaveLifecycle, type GameSave } from '../storage/db';

function makeState(): GameState {
  const state = createDefaultGameState();
  state.玩家.生存状态 = { 血量: 100, 体力值: 100, dim1: 10, dim2: 10, dim3: 10, dim4: 10, dim5: 10, dim6: 10 };
  state.人物档案 = {
    ally: { 姓名: '友方', 种族: '人类', 性别: '', 年龄: 20, 生存状态: { 血量: 50, 体力值: 50, dim1: 10, dim2: 10, dim3: 10 }, 社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: 20, 关系类型: '友方' }, 个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' }, 重要NPC: true, _关注: true, $time: 1, 人物分类: '在场' },
    neutral: { 姓名: '中立者', 种族: '人类', 性别: '', 年龄: 20, 生存状态: { 血量: 50, 体力值: 50, dim1: 10 }, 社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: 0, 关系类型: '中立' }, 个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' }, 重要NPC: false, _关注: false, $time: 1, 人物分类: '在场' },
    enemy: { 姓名: '敌人', 种族: '兽人', 性别: '', 年龄: 20, 生存状态: { 血量: 80, 体力值: 50, dim1: 12 }, 社会身份: { 职业: '', 社会地位: '' }, 关系数据: { 好感度: -20, 关系类型: '敌对' }, 个人信息: { 外貌: '', 表性格: '', 里性格: '', 当前想法: '', 当前穿着: '', 当前位置: '', 当前状态: '', 备注: '' }, 重要NPC: true, _关注: true, $time: 1, 人物分类: '在场' },
  };
  return state;
}

function proposal(enemyCount = 5): CombatEncounterProposal {
  return {
    schemaVersion: 2,
    id: 'encounter-1',
    context: '敌人已经拔刀围攻',
    threatBand: 'matched',
    allies: [{ id: 'ally', identity: '友方', temporary: false }],
    enemies: Array.from({ length: enemyCount }, (_, index) => ({ id: index === 0 ? 'enemy' : `beast-${index}`, identity: index === 0 ? '敌人' : `临时兽${index}`, temporary: index > 0 })),
    neutrals: [{ id: 'neutral', identity: '中立者', temporary: false }],
  };
}

function attackDefinition(id = 'strike'): AbilityDefinition {
  return {
    schemaVersion: 2, id, name: '打击', description: '一次攻击', category: 'profession', abilityType: 'active', rarity: '普通',
    maxRank: 1, pointCost: 0, prerequisites: [], tags: [],
    mechanics: { combatAction: { id, name: '打击', target: 'enemy', actionCost: 1, accuracy: 10, damage: 8, cooldownRounds: 1 } },
  };
}

function combatSession(state: GameState = makeState(), enemyCount = 1, seed = 11, statLabels?: { health: string; resource: string }) {
  const roster = buildValidatedCombatRoster(state, proposal(enemyCount));
  const preparing = createPreparingCombatSession(state, roster.plan!, { seed, now: 1, statLabels });
  return startPreparedCombat(selectCombatants(preparing, ['player']).session!);
}

function setActive(session: ReturnType<typeof combatSession>, unitId: string): void {
  session.activeUnitId = unitId;
  const actor = session.participants.find(unit => unit.id === unitId);
  if (actor) actor.actedRound = 0;
}

describe('v3 deterministic combat core', () => {
  test('accepts structured encounter triggers, ignores numeric AI fields, and waves excess enemies', () => {
    const normalized = normalizeCombatEncounterProposal({ ...proposal(5), enemies: proposal(5).enemies.map((enemy, index) => ({ ...enemy, hp: 999, damage: 999, armor: 999, ...(index === 0 ? { identity: '敌人' } : {}) })) });
    expect(normalized?.enemies).toHaveLength(5);
    expect(normalized?.enemies[0]).not.toHaveProperty('hp');
    expect(normalizeCombatEncounterRequest({ type: 'narrative', text: '普通战斗' })).toBeUndefined();
    expect(normalizeCombatEncounterRequest({ type: 'manual.attack', proposal: proposal(1) })?.source).toBe('manual');
    expect(prepareCombatEncounterRequest(makeState(), { type: 'variable.hostile-action', proposal: proposal(1), hostileAction: { occurred: true, subjectId: 'enemy', targetId: 'player' } }).ok).toBe(true);
    expect(prepareCombatEncounterRequest(makeState(), { type: 'variable.hostile-action', proposal: proposal(1), hostileAction: { occurred: true, subjectId: 'not-in-proposal', targetId: 'player' } }).ok).toBe(false);
    expect(prepareCombatEncounterRequest(makeState(), { type: 'variable.hostile-action', proposal: proposal(1), hostileAction: { occurred: true, subjectId: 'ally', targetId: 'player' } }).ok).toBe(false);
    expect(prepareCombatEncounterRequest(makeState(), { type: 'variable.hostile-action', proposal: proposal(1), hostileAction: { occurred: true, subjectId: 'enemy', targetId: 'neutral' } }).ok).toBe(false);

    const roster = buildValidatedCombatRoster(makeState(), normalized!);
    expect(roster.ok).toBe(true);
    expect(roster.plan?.enemyWaves).toHaveLength(2);
    expect(roster.plan?.enemyWaves.every(wave => wave.length <= 4)).toBe(true);
    expect(roster.plan?.enemyWaves.flat().every(unit => unit.side === 'enemy')).toBe(true);
  });

  test('enforces selected team limit and prepares then starts a 1v1/4v4 session', () => {
    const state = makeState();
    state.人物档案.offScene = { ...state.人物档案.ally, 姓名: '场外友方' };
    const roster = buildValidatedCombatRoster(state, proposal(1), { selectedAllyIds: ['ally'] });
    expect(roster.plan?.playerPool.length).toBeGreaterThanOrEqual(2);
    expect(roster.plan?.playerPool.some(unit => unit.id === 'offScene')).toBe(false);
    expect(buildValidatedCombatRoster(state, { ...proposal(1), allies: [{ id: 'neutral', identity: '中立者', temporary: false }] }).ok).toBe(false);
    const preparing = createPreparingCombatSession(state, roster.plan!, { seed: 7, selectedAllyIds: ['ally'] });
    expect(preparing.lifecycle).toBe('preparing');
    const selected = selectCombatants(preparing, ['player', 'ally']);
    expect(selected.ok).toBe(true);
    expect(selected.session?.participants.filter(unit => unit.side !== 'enemy')).toHaveLength(2);
    expect(selectCombatants(preparing, ['player', 'ally', 'pet-1', 'summon-1', 'too-many']).ok).toBe(false);
    const active = startPreparedCombat(selected.session!);
    expect(active.lifecycle).toBe('active');
    expect(active.activeUnitId).toBe('player');
    expect(active.initiativeOrder[0]).toBe('player');
    expect(active.participants.length).toBeLessThanOrEqual(8);
    expect(persistCombatSession(makeState(), active).v3?.combatSession?.id).toBe(active.id);
  });

  test('normalizes equivalent 0~20 and 0~100 attributes and supports deterministic actions, passives, states, cooldowns, defense and flee', () => {
    expect(normalizeWorldAttribute(10, [0, 20])).toBeCloseTo(normalizeWorldAttribute(50, [0, 100]));
    const state = makeState();
    const instance: AbilityInstance = { definitionId: 'strike', source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } };
    state.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' }, abilityDefinitions: { strike: attackDefinition() }, abilityInstances: { strike: instance } };
    const roster = buildValidatedCombatRoster(state, proposal(1));
    const preparing = createPreparingCombatSession(state, roster.plan!, { seed: 42, now: 1 });
    const active = startPreparedCombat(selectCombatants(preparing, ['player']).session!);
    const first = resolveCombatCommandV2(active, { commandId: 'command-1', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] });
    expect(first.record.resolved).toBe(true);
    expect(first.record.transactionId).toContain('command-1');
    const duplicate = resolveCombatCommandV2(first.session, { commandId: 'command-1', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] });
    expect(duplicate.alreadyProcessed).toBe(true);
    expect(duplicate.session).toEqual(first.session);
    const replay = startPreparedCombat(selectCombatants(createPreparingCombatSession(state, roster.plan!, { seed: 42, now: 1 }), ['player']).session!);
    expect(resolveCombatCommandV2(replay, { commandId: 'command-1', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] }).session).toEqual(first.session);
    const auto = chooseAutomaticCommand(first.session, 'enemy', 'defensive');
    expect(['attack', 'skill', 'item', 'defend', 'flee']).toContain(auto.kind);
  });

  test('uses range midpoints only for missing legacy NPC dimensions and preserves explicit zero', () => {
    const ranges = {
      attrA: [0, 100] as [number, number], attrB: [0, 100] as [number, number],
      dim1: [0, 20] as [number, number], dim2: [0, 20] as [number, number], dim3: [0, 20] as [number, number],
      dim4: [0, 20] as [number, number], dim5: [0, 20] as [number, number], dim6: [0, 20] as [number, number],
    };
    const legacy = makeState();
    legacy.人物档案.enemy.生存状态 = { 血量: 80, 体力值: 50 };

    const inferred = buildValidatedCombatRoster(legacy, proposal(1), { statRanges: ranges }).plan?.enemyPool[0];
    expect(inferred?.normalizedAttributes?.dim1).toBe(50);
    expect(inferred?.attackPower).toBe(10);

    legacy.人物档案.enemy.生存状态.dim1 = 0;
    const explicitZero = buildValidatedCombatRoster(legacy, proposal(1), { statRanges: ranges }).plan?.enemyPool[0];
    expect(explicitZero?.normalizedAttributes?.dim1).toBe(0);
    expect(explicitZero?.attackPower).toBe(4);
  });

  test('uses the actor accuracy as the baseline and applies a skill accuracy modifier instead of replacing it', () => {
    const session = combatSession(makeState(), 1, 17);
    const player = session.participants.find(unit => unit.id === 'player')!;
    const enemy = session.participants.find(unit => unit.id === 'enemy')!;
    player.accuracy = 10;
    enemy.evasion = 0;
    expect(combatHitChanceV2(player, enemy, 10)).toBeCloseTo(0.7, 5);
    player.accuracy = 16;
    enemy.evasion = 6;
    expect(combatHitChanceV2(player, enemy, 13)).toBeCloseTo(0.85, 5);
  });

  test('previews the same hit, damage and controlled cost formula used by skill resolution without consuming a roll', () => {
    const state = makeState();
    const skill: AbilityDefinition = {
      ...attackDefinition('preview-strike'),
      mechanics: {
        costs: [{ path: 'resource', amount: 3, label: '战斗资源' }],
        combatAction: { id: 'preview-strike', name: '预演打击', target: 'enemy', actionCost: 1, accuracy: 13, damage: 8 },
      },
    };
    state.v3 = {
      schemaVersion: 3,
      featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' },
      abilityDefinitions: { [skill.id]: skill },
      abilityInstances: { [skill.id]: { definitionId: skill.id, source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } } },
    };
    const session = combatSession(state, 1, 23);
    const player = session.participants.find(unit => unit.id === 'player')!;
    const enemy = session.participants.find(unit => unit.id === 'enemy')!;
    player.accuracy = 16;
    enemy.evasion = 6;
    enemy.armor = 2;
    const cursor = session.randomCursor;
    const preview = previewCombatAbilityV2(session, player.id, skill.id, enemy.id);
    expect(preview.hitChance).toBeCloseTo(0.85, 5);
    expect(preview.damage).toBe(16);
    expect(preview.criticalDamage).toBe(34);
    expect(preview.costs).toEqual([{ pool: 'resource', label: '能量', amount: 3 }]);
    expect(session.randomCursor).toBe(cursor);
  });

  test('uses the current world stat names for combat bars, costs and insufficient-energy feedback', () => {
    const state = makeState();
    const skill: AbilityDefinition = {
      ...attackDefinition('world-named-cost'),
      mechanics: {
        costs: [{ path: 'resource', amount: 3, label: '战斗资源' }],
        combatAction: { id: 'world-named-cost', name: '运气一击', target: 'enemy', actionCost: 1, accuracy: 10, damage: 5 },
      },
    };
    state.v3 = {
      schemaVersion: 3,
      featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' },
      abilityDefinitions: { [skill.id]: skill },
      abilityInstances: { [skill.id]: { definitionId: skill.id, source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } } },
    };
    const session = combatSession(state, 1, 29, { health: '气血', resource: '内息' });
    const player = session.participants.find(unit => unit.id === 'player')!;
    player.resource = 2;
    const preview = previewCombatAbilityV2(session, player.id, skill.id, 'enemy');
    expect(session.statLabels).toEqual({ health: '气血', resource: '内息' });
    expect(preview.costs).toEqual([{ pool: 'resource', label: '内息', amount: 3 }]);
    expect(preview.reason).toBe('内息不足（需 3）');
  });

  test('atomically settles controlled combat resource and health costs and never allows a health cost to defeat its caster', () => {
    const state = makeState();
    const bloodArt: AbilityDefinition = {
      ...attackDefinition('blood-art'),
      mechanics: {
        costs: [
          { path: 'resource', amount: 3, label: '战斗资源' },
          { path: 'health', amount: 5, label: '生命' },
        ],
        combatAction: { id: 'blood-art', name: '血术', target: 'enemy', actionCost: 1, accuracy: 100, damage: 8 },
      },
    };
    state.v3 = {
      schemaVersion: 3,
      featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' },
      abilityDefinitions: { [bloodArt.id]: bloodArt },
      abilityInstances: { [bloodArt.id]: { definitionId: bloodArt.id, source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } } },
    };
    const session = combatSession(state, 1, 19);
    setActive(session, 'player');
    const before = session.participants.find(unit => unit.id === 'player')!;
    const resolved = resolveCombatCommandV2(session, { commandId: 'blood-art-1', unitId: 'player', kind: 'skill', abilityId: bloodArt.id, targetIds: ['enemy'] });
    const after = resolved.session.participants.find(unit => unit.id === 'player')!;
    expect(after.resource).toBe((before.resource ?? 0) - 3);
    expect(after.hp).toBe(before.hp - 5);
    expect(resolved.record.resourceChanges).toEqual([
      { unitId: 'player', resource: 'resource', delta: -3 },
      { unitId: 'player', resource: 'health', delta: -5 },
    ]);

    const unsafe = structuredClone(session);
    unsafe.participants.find(unit => unit.id === 'player')!.hp = 5;
    setActive(unsafe, 'player');
    const rejected = resolveCombatCommandV2(unsafe, { commandId: 'blood-art-lethal', unitId: 'player', kind: 'skill', abilityId: bloodArt.id, targetIds: ['enemy'] });
    expect(rejected.record.rejected).toBe(true);
    expect(rejected.session.participants.find(unit => unit.id === 'player')?.hp).toBe(5);
  });

  test('profession abilities and plot-learned skills share the same usable combat action path', () => {
    const state = makeState();
    const professionAbility = { ...attackDefinition('profession-strike'), name: '职业剑技' };
    const storyAbility: AbilityDefinition = { ...attackDefinition('story-flame'), name: '剧情领悟', category: 'free_skill' };
    state.v3 = {
      schemaVersion: 3,
      featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' },
      abilityDefinitions: { [professionAbility.id]: professionAbility, [storyAbility.id]: storyAbility },
      abilityInstances: {
        [professionAbility.id]: { definitionId: professionAbility.id, source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } },
        [storyAbility.id]: { definitionId: storyAbility.id, source: 'free_skill', acquiredAt: 2, runtime: { rank: 2, uses: 3, proficiency: 8, cooldownRemaining: 0, equipped: true } },
      },
    };
    const roster = buildValidatedCombatRoster(state, proposal(1));
    expect(roster.plan?.playerPool[0].abilityDefinitions).toHaveProperty(professionAbility.id);
    expect(roster.plan?.playerPool[0].abilityDefinitions).toHaveProperty(storyAbility.id);

    for (const abilityId of [professionAbility.id, storyAbility.id]) {
      const session = startPreparedCombat(selectCombatants(createPreparingCombatSession(state, roster.plan!, { seed: 73, now: 1 }), ['player']).session!);
      setActive(session, 'player');
      const resolved = resolveCombatCommandV2(session, { commandId: `use-${abilityId}`, unitId: 'player', kind: 'skill', abilityId, targetIds: ['enemy'] });
      expect(resolved.record.resolved).toBe(true);
      expect(resolved.record.input?.abilityId).toBe(abilityId);
    }
  });

  test('applies canonical attribute scaling and area targets through the local formula', () => {
    const state = makeState();
    const sweep: AbilityDefinition = {
      ...attackDefinition('scaled-sweep'),
      maxRank: 3,
      mechanics: {
        combatAction: {
          id: 'scaled-sweep', name: '横扫', target: 'area', actionCost: 1, accuracy: 100, damage: 1,
          scaling: [{ statId: 'dim1', coefficient: 0.1, appliesTo: 'damage' }],
        },
      },
    };
    state.v3 = {
      schemaVersion: 3,
      featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' },
      abilityDefinitions: { [sweep.id]: sweep },
      abilityInstances: { [sweep.id]: { definitionId: sweep.id, source: 'profession', acquiredAt: 1, runtime: { rank: 2, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } } },
    };
    const roster = buildValidatedCombatRoster(state, proposal(2), { statRanges: { dim1: [0, 20] } });
    let session = startPreparedCombat(selectCombatants(createPreparingCombatSession(state, roster.plan!, { seed: 52, now: 1 }), ['player']).session!);
    session.activeUnitId = 'player';
    session.participants.find(unit => unit.id === 'player')!.actedRound = 0;
    const before = session.participants.filter(unit => unit.side === 'enemy').map(unit => unit.hp);
    const result = resolveCombatCommandV2(session, { commandId: 'scaled-area', unitId: 'player', kind: 'skill', abilityId: sweep.id, targetIds: [] });
    expect(result.record.targetIds).toHaveLength(2);
    expect(result.record.damage).toBeGreaterThan(2);
    expect(result.session.participants.filter(unit => unit.side === 'enemy').every((unit, index) => unit.hp < before[index])).toBe(true);
  });

  test('uses controlled item proposals, rejects unknown item mechanics, and consumes quantities once', () => {
    const item = balanceCombatItemProposal({ schemaVersion: 2, id: 'potion', name: '治疗药剂', description: '恢复生命', category: 'combat_item', rarity: '普通', target: 'self', tags: [], itemPurpose: 'heal' });
    expect(item.ability.category).toBe('combat_item');
    expect(item.purpose).toBe('heal');
    expect(normalizeCombatItemDefinition({ id: 'mystery', name: '神秘物', description: '未知', type: 'instant-kill' })?.narrativeOnly).toBe(true);
    const state = makeState();
    const roster = buildValidatedCombatRoster(state, proposal(1));
    const preparing = createPreparingCombatSession(state, roster.plan!, { seed: 3, itemDefinitions: { potion: item }, itemQuantities: { player: { potion: 1 } } });
    const active = startPreparedCombat(selectCombatants(preparing, ['player']).session!);
    const used = resolveCombatCommandV2(active, { commandId: 'item-1', unitId: 'player', kind: 'item', itemId: 'potion', targetIds: ['player'] });
    expect(used.record.itemChanges).toEqual([{ unitId: 'player', itemId: 'potion', delta: -1 }]);
    expect(used.session.participants.find(unit => unit.id === 'player')?.itemQuantities?.potion).toBe(0);
    expect(attachCombatItems(active, { potion: item }, { player: { potion: 2 } }).participants.find(unit => unit.id === 'player')?.itemQuantities?.potion).toBe(2);
  });

  test('captures a detached full checkpoint, restores normal/hard, and blocks inferno retry/rollback', () => {
    const state = makeState();
    const checkpoint = captureCombatCheckpoint('session-1', state, { messages: [{ id: 'm1', role: 'user', rawText: '前情', round: 1, timestamp: 1 }] });
    state.玩家.生存状态.血量 = 1;
    checkpoint.gameState.玩家.生存状态.血量 = 999;
    expect(state.玩家.生存状态.血量).toBe(1);
    const restored = restoreCombatCheckpoint(checkpoint);
    expect(restored.gameState.玩家.生存状态.血量).toBe(999);
    expect(retryCombatSession({ ...startPreparedCombat(selectCombatants(createPreparingCombatSession(state, buildValidatedCombatRoster(state, proposal(1)).plan!, { seed: 2 }), ['player']).session!), riskMode: 'normal', preCombatCheckpoint: checkpoint })).toMatchObject({ ok: true });
    expect(retryCombatSession({ ...startPreparedCombat(selectCombatants(createPreparingCombatSession(state, buildValidatedCombatRoster(state, proposal(1)).plan!, { seed: 2 }), ['player']).session!), riskMode: 'inferno', lifecycle: 'terminal', preCombatCheckpoint: checkpoint })).toMatchObject({ ok: false });
    expect(canRollbackCombat('inferno', 'active')).toBe(false);
    expect(canRollbackCombat('normal', 'active')).toBe(true);
  });

  test('migrates old sessions and saves with safe active/normal defaults; inferno death ends without deletion', () => {
    const migrated = normalizeCombatSessionV2({ id: 'old', encounterId: 'legacy', encounterName: '旧战斗', status: 'active', round: 2, participants: [{ id: 'player', name: '玩家', side: 'player', hp: 5, maxHp: 10 }, { id: 'enemy', name: '敌人', side: 'enemy', hp: 5, maxHp: 5 }], actionSequence: [{ id: 'old-action', commandId: 'old-command', transactionId: 'old-tx', round: 1, unitId: 'player', kind: 'attack', targetIds: ['enemy'], resolved: true }] });
    expect(migrated?.riskMode).toBe('normal');
    expect(migrated?.actionSequence).toHaveLength(1);
    const legacyState = makeState();
    legacyState.combat = { active: { encounterId: 'legacy-active', encounterName: '旧战斗', status: 'active', round: 2, participants: [{ id: 'player', name: '玩家', side: 'player', hp: 5, maxHp: 10 }, { id: 'enemy', name: '敌人', side: 'enemy', hp: 5, maxHp: 5 }] } } as typeof legacyState.combat;
    const migratedState = migrateGameStateToV3(legacyState);
    expect(migratedState.v3?.combatSession?.preCombatCheckpoint.gameState.玩家.生存状态.血量).toBe(100);
    const oldSave = { id: 'save_1_xxxxxx', name: '旧存档', timestamp: 1, messages: [], gameState: makeState(), worldId: 'world' } as GameSave;
    expect(normalizeSaveLifecycle(oldSave).lifecycle).toBe('active');
    const inferno: GameSave = { ...oldSave, gameState: { ...oldSave.gameState, v3: { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: 'inferno' } } } };
    const ended = applyCombatResultToSave(inferno, { riskMode: 'inferno', playerDied: true, sessionId: 's', result: { status: 'defeat', rewardEffects: [], rewardsApplied: false, narration: { status: 'pending', attempts: 0 } } });
    expect(ended.lifecycle).toBe('ended');
    expect(ended.endReason).toContain('炼狱');
  });

  test('does not prepare v3 combat when the explicit combat flag is off', () => {
    const state = makeState();
    state.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: false, combatRiskMode: 'normal' } };
    const result = buildValidatedCombatRoster(state, proposal(1));
    expect(result.ok).toBe(false);
    expect(result.errors[0]).toContain('未启用');
  });

  test('settles terminal rewards through one stable transaction only once', () => {
    const state = makeState();
    const roster = buildValidatedCombatRoster(state, proposal(1));
    const session = startPreparedCombat(selectCombatants(createPreparingCombatSession(state, roster.plan!, { seed: 4 }), ['player']).session!);
    session.lifecycle = 'terminal';
    session.status = 'victory';
    session.result = { status: 'victory', rewardEffects: [{ add: { path: '玩家.货币资源.主货币.数量', delta: 5, min: 0 } }], rewardsApplied: false, narration: { status: 'pending', attempts: 0 }, terminalTransactionId: 'terminal-once' };
    const once = settleCombatResult(state, session);
    const twice = settleCombatResult(once.state, session);
    expect(once.state.玩家.货币资源.主货币.数量).toBe(505);
    expect(twice.state.玩家.货币资源.主货币.数量).toBe(505);
    expect(twice.alreadyApplied).toBe(true);
  });

  test('easy defeat restores the checkpoint while preserving settlement metadata and an active save', () => {
    const checkpointState = makeState();
    const session = combatSession(checkpointState);
    session.riskMode = 'easy';
    session.lifecycle = 'terminal';
    session.status = 'defeat';
    session.participants.find(unit => unit.id === 'player')!.hp = 0;
    session.result = {
      status: 'defeat',
      rewardEffects: [{ add: { path: '玩家.货币资源.主货币.数量', delta: 50, min: 0 } }],
      rewardsApplied: false,
      narration: { status: 'succeeded', attempts: 1, requestId: 'easy-defeat-narration' },
      terminalTransactionId: 'easy-defeat-terminal',
    };

    const postCombatState = makeState();
    postCombatState.玩家.生存状态.血量 = 3;
    postCombatState.玩家.货币资源.主货币.数量 = 17;
    const settled = settleCombatResult(postCombatState, session);

    expect(settled.state.玩家.生存状态.血量).toBe(session.preCombatCheckpoint.gameState.玩家.生存状态.血量);
    expect(settled.state.玩家.货币资源.主货币.数量).toBe(session.preCombatCheckpoint.gameState.玩家.货币资源.主货币.数量);
    expect(settled.result).toMatchObject({
      status: 'defeat',
      rewardsApplied: true,
      narration: { status: 'succeeded', attempts: 1, requestId: 'easy-defeat-narration' },
      terminalTransactionId: 'easy-defeat-terminal',
      report: { riskMode: 'easy', finalState: { status: 'defeat' } },
    });
    expect(settled.state.v3?.combatResult).toEqual(settled.result);

    const save = applyCombatResultToSave({
      id: 'save_1_easyxx', name: '简单存档', timestamp: 1, messages: [],
      gameState: settled.state, worldId: 'world', lifecycle: 'active',
    } as GameSave, {
      sessionId: session.id,
      riskMode: 'easy',
      playerDied: true,
      result: settled.result,
    });
    expect(save.lifecycle).toBe('active');
    expect(save.endedAt).toBeUndefined();
  });

  test('resolves enemy and ally targets relative to the acting unit', () => {
    const enemyAttack = combatSession();
    const enemy = enemyAttack.participants.find(unit => unit.id === 'enemy')!;
    enemy.accuracy = 20;
    const player = enemyAttack.participants.find(unit => unit.id === 'player')!;
    const enemyHp = enemy.hp;
    const playerHp = player.hp;
    setActive(enemyAttack, 'enemy');
    const enemyResult = resolveCombatCommandV2(enemyAttack, { commandId: 'enemy-attack', unitId: 'enemy', kind: 'attack', targetIds: ['player'] });
    expect(enemyResult.record.hit).toBe(true);
    expect(enemyResult.session.participants.find(unit => unit.id === 'player')?.hp).toBeLessThan(playerHp);
    expect(enemyResult.session.participants.find(unit => unit.id === 'enemy')?.hp).toBe(enemyHp);

    const enemySupport = combatSession();
    const support = enemySupport.participants.find(unit => unit.id === 'enemy')!;
    support.hp = 1;
    support.abilityDefinitions = { enemyHeal: { ...attackDefinition('enemyHeal'), mechanics: { combatAction: { id: 'enemyHeal', name: '敌方支援', target: 'ally', healing: 5, accuracy: 20 } } } };
    support.abilityInstances = { enemyHeal: { definitionId: 'enemyHeal', source: 'dynamic', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } } };
    setActive(enemySupport, 'enemy');
    const supportResult = resolveCombatCommandV2(enemySupport, { commandId: 'enemy-support', unitId: 'enemy', kind: 'skill', abilityId: 'enemyHeal', targetIds: ['player'] });
    expect(supportResult.session.participants.find(unit => unit.id === 'enemy')?.hp).toBeGreaterThan(1);
    expect(supportResult.session.participants.find(unit => unit.id === 'player')?.hp).toBe(playerHp);

    const friendlyTarget = combatSession();
    const ally = friendlyTarget.participants.find(unit => unit.id === 'ally');
    expect(ally).toBeUndefined();
    const state = makeState();
    const withAlly = buildValidatedCombatRoster(state, proposal(1), { selectedAllyIds: ['ally'] });
    const allySession = startPreparedCombat(selectCombatants(createPreparingCombatSession(state, withAlly.plan!, { seed: 12, now: 1 }), ['player', 'ally']).session!);
    const allyHp = allySession.participants.find(unit => unit.id === 'ally')!.hp;
    const allyEnemy = allySession.participants.find(unit => unit.id === 'enemy')!.hp;
    allySession.participants.find(unit => unit.id === 'player')!.accuracy = 20;
    setActive(allySession, 'player');
    const noFriendlyHarm = resolveCombatCommandV2(allySession, { commandId: 'no-friendly-fire', unitId: 'player', kind: 'attack', targetIds: ['ally'] });
    expect(noFriendlyHarm.session.participants.find(unit => unit.id === 'ally')?.hp).toBe(allyHp);
    expect(noFriendlyHarm.session.participants.find(unit => unit.id === 'enemy')?.hp).toBeLessThan(allyEnemy);
  });

  test('persists bindings, item consumption, skill runtime and world-scaled injuries exactly once', () => {
    const state = makeState();
    state.玩家.物品栏.potion = { 数量: 2, 类型: '战斗道具', 品质: '普通', 备注: '' };
    const instance: AbilityInstance = { definitionId: 'strike', source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } };
    state.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' }, abilityDefinitions: { strike: attackDefinition() }, abilityInstances: { strike: instance } };
    state.玩家.能力系统 = {
      天赋点: 0,
      技能点: 0,
      已解锁天赋: {},
      已掌握技能: { strike: { 等级: 1, 使用次数: 0, 熟练度: 0, 冷却至轮次: 99 } },
    };
    const roster = buildValidatedCombatRoster(state, proposal(1));
    const potion = balanceCombatItemProposal({ schemaVersion: 2, id: 'potion', name: '药剂', description: '恢复', category: 'combat_item', rarity: '普通', target: 'self', tags: [], itemPurpose: 'heal' });
    let session = createPreparingCombatSession(state, roster.plan!, { seed: 21, now: 1, itemDefinitions: { potion }, itemQuantities: { player: { potion: 2 } } });
    session = startPreparedCombat(selectCombatants(session, ['player']).session!);
    setActive(session, 'player');
    const skill = resolveCombatCommandV2(session, { commandId: 'runtime-skill', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] });
    expect(skill.session.abilityInstances.strike.runtime.uses).toBe(1);
    expect(skill.session.abilityInstances.strike.runtime.proficiency).toBeGreaterThan(0);
    const unavailable = skill.session;
    setActive(unavailable, 'player');
    unavailable.participants.find(unit => unit.id === 'player')!.abilityInstances!.strike.runtime.rank = 0;
    expect(resolveCombatCommandV2(unavailable, { commandId: 'unearned-skill', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] }).record.rejected).toBe(true);
    const unsafeState = makeState();
    unsafeState.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' }, abilityDefinitions: { unsafe: { ...attackDefinition('unsafe'), mechanics: { ...attackDefinition('unsafe').mechanics, costs: [{ path: '玩家.能力系统.技能点', amount: 1 }] } } }, abilityInstances: { unsafe: { definitionId: 'unsafe', source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } } } };
    const unsafeSession = combatSession(unsafeState);
    setActive(unsafeSession, 'player');
    const unsafe = resolveCombatCommandV2(unsafeSession, { commandId: 'unsafe-cost', unitId: 'player', kind: 'skill', abilityId: 'unsafe', targetIds: ['enemy'] });
    expect(unsafe.record.rejected).toBe(true);
    expect(unsafe.session.participants.find(unit => unit.id === 'player')?.resource).toBeGreaterThan(0);
    const itemSession = skill.session;
    setActive(itemSession, 'player');
    const item = resolveCombatCommandV2(itemSession, { commandId: 'runtime-item', unitId: 'player', kind: 'item', itemId: 'potion', targetIds: ['player'] });
    const persistedPlayer = item.session.participants.find(unit => unit.id === 'player')!;
    persistedPlayer.hp = 20;
    persistedPlayer.resource = 5;
    item.session.lifecycle = 'terminal';
    item.session.status = 'victory';
    item.session.result = { status: 'victory', rewardEffects: [{ add: { path: '玩家.货币资源.主货币.数量', delta: 5, min: 0 } }], rewardsApplied: false, narration: { status: 'pending', attempts: 0 }, terminalTransactionId: 'binding-terminal' };
    const once = settleCombatResult(state, item.session);
    expect(once.state.玩家.生存状态.血量).toBe(20);
    expect(once.state.玩家.生存状态.体力值).toBe(5);
    expect(once.state.玩家.物品栏.potion.数量).toBe(1);
    expect(once.state.v3?.abilityInstances?.strike?.runtime.uses).toBe(1);
    expect(once.state.v3?.abilityInstances?.strike?.runtime.proficiency).toBeGreaterThan(0);
    expect(once.state.v3?.abilityInstances?.strike?.runtime.cooldownRemaining).toBe(0);
    expect(once.state.玩家.能力系统?.已掌握技能.strike.冷却至轮次).toBe(99);
    const twice = settleCombatResult(once.state, item.session);
    expect(twice.alreadyApplied).toBe(true);
    expect(twice.state).toEqual(once.state);
  });

  test('holds cooldown through the next round and resolves DOT terminal state', () => {
    const state = makeState();
    const instance: AbilityInstance = { definitionId: 'strike', source: 'profession', acquiredAt: 1, runtime: { rank: 1, uses: 0, proficiency: 0, cooldownRemaining: 0, equipped: true } };
    state.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: true, combatEnabled: true, combatRiskMode: 'normal' }, abilityDefinitions: { strike: { ...attackDefinition(), mechanics: { combatAction: { ...attackDefinition().mechanics!.combatAction!, cooldownRounds: 1 } } } }, abilityInstances: { strike: instance } };
    let session = combatSession(state);
    setActive(session, 'player');
    const first = resolveCombatCommandV2(session, { commandId: 'cooldown-1', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] });
    expect(first.session.participants.find(unit => unit.id === 'player')?.cooldowns.strike).toBe(2);
    setActive(first.session, 'enemy');
    const endRound = resolveCombatCommandV2(first.session, { commandId: 'cooldown-enemy-1', unitId: 'enemy', kind: 'defend', targetIds: ['enemy'] });
    setActive(endRound.session, 'player');
    const blocked = resolveCombatCommandV2(endRound.session, { commandId: 'cooldown-2', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] });
    expect(blocked.record.rejected).toBe(true);
    blocked.session.participants.find(unit => unit.id === 'player')!.actedRound = blocked.session.round;
    setActive(blocked.session, 'enemy');
    const nextRound = resolveCombatCommandV2(blocked.session, { commandId: 'cooldown-enemy-2', unitId: 'enemy', kind: 'defend', targetIds: ['enemy'] });
    setActive(nextRound.session, 'player');
    const available = resolveCombatCommandV2(nextRound.session, { commandId: 'cooldown-3', unitId: 'player', kind: 'skill', abilityId: 'strike', targetIds: ['enemy'] });
    expect(available.record.resolved).toBe(true);

    const dot = combatSession(makeState(), 1, 31);
    dot.participants.find(unit => unit.id === 'enemy')!.hp = 1;
    dot.participants.find(unit => unit.id === 'enemy')!.typedStatuses = [{ id: 'poison', name: '毒', remainingRounds: 2, stacks: 1, damagePerRound: 99 }];
    setActive(dot, 'player');
    const playerWait = resolveCombatCommandV2(dot, { commandId: 'dot-player', unitId: 'player', kind: 'defend', targetIds: ['player'] });
    setActive(playerWait.session, 'enemy');
    const enemyWait = resolveCombatCommandV2(playerWait.session, { commandId: 'dot-enemy', unitId: 'enemy', kind: 'defend', targetIds: ['enemy'] });
    expect(enemyWait.session.lifecycle).toBe('terminal');
    expect(enemyWait.session.status).toBe('victory');
  });

  test('returns complete checkpoint restore bundles and protects inferno', () => {
    const checkpoint = captureCombatCheckpoint('restore-session', makeState(), {
      messages: [{ id: 'restore-message', role: 'user', rawText: 'x', round: 1, timestamp: 1 }],
      memoryRuntime: { revision: 2 },
      vectorMemory: [{ id: 'vector-1' }],
      worldSimulationState: createEmptySimState(),
      moduleStates: [{ saveId: 'save', moduleId: 'stat', revision: 2, schemaVersion: 1, updatedAt: 1, state: { hp: 10 } }],
      moduleCheckpoints: [{ saveId: 'save', moduleId: 'stat', revision: 1, schemaVersion: 1, updatedAt: 1, state: { hp: 100 } }],
    });
    const session = combatSession();
    session.preCombatCheckpoint = checkpoint;
    const normal = retryCombatSession(session);
    expect(normal.ok).toBe(true);
    expect(normal.restore).toMatchObject({ messages: checkpoint.messages, memoryRuntime: checkpoint.memoryRuntime, vectorMemory: checkpoint.vectorMemory, worldSimulationState: checkpoint.worldSimulationState, moduleStates: checkpoint.moduleStates, moduleCheckpoints: checkpoint.moduleCheckpoints });
    expect(normal.restore).not.toBe(checkpoint);
    const hard = retryCombatSession({ ...session, riskMode: 'hard' });
    expect(hard.ok).toBe(true);
    const inferno = retryCombatSession({ ...session, riskMode: 'inferno', lifecycle: 'terminal' });
    expect(inferno.ok).toBe(false);
  });

  test('normalizes only controlled semantic item templates and reports terminal facts', () => {
    const malicious = normalizeCombatItemDefinition({ schemaVersion: 2, id: 'unsafe', name: '治疗药剂', description: '治疗', purpose: 'heal', target: 'self', rarity: '传说', amount: 999999, ability: { mechanics: { combat: { healing: 999999 } } }, status: { id: 'poison', name: '毒', remainingRounds: 999, stacks: 99, damagePerRound: 999999 } });
    expect(malicious?.narrativeOnly).toBe(false);
    expect(malicious?.amount).toBeLessThan(999999);
    expect(malicious?.ability.mechanics?.combat?.healing).toBeLessThan(999999);
    expect(malicious?.status).toBeUndefined();
    for (const purpose of ['heal', 'resource', 'damage', 'cleanse', 'buff'] as const) {
      const item = balanceCombatItemProposal({ schemaVersion: 2, id: `item-${purpose}`, name: purpose, description: purpose, category: 'combat_item', rarity: '普通', target: purpose === 'damage' ? 'enemy' : 'self', tags: [], itemPurpose: purpose });
      expect(item.narrativeOnly).toBe(false);
      expect(item.purpose).toBe(purpose);
      expect(item.amount).toBeGreaterThanOrEqual(0);
      if (purpose === 'buff') expect(item.status?.modifiers).toBeDefined();
    }
    const controlledItems = Object.fromEntries((['heal', 'resource', 'damage', 'cleanse', 'buff'] as const).map(purpose => [
      `item-${purpose}`,
      balanceCombatItemProposal({ schemaVersion: 2, id: `item-${purpose}`, name: purpose, description: purpose, category: 'combat_item', rarity: '普通', target: purpose === 'damage' ? 'enemy' : 'self', tags: [], itemPurpose: purpose }),
    ]));
    for (const purpose of ['heal', 'resource', 'damage', 'cleanse', 'buff'] as const) {
      const itemSession = attachCombatItems(combatSession(), controlledItems, { player: Object.fromEntries(Object.keys(controlledItems).map(id => [id, 1])) });
      const itemPlayer = itemSession.participants.find(unit => unit.id === 'player')!;
      itemPlayer.accuracy = 20;
      itemPlayer.hp = 50;
      itemPlayer.resource = 1;
      itemPlayer.typedStatuses = [{ id: 'poison', name: '毒', remainingRounds: 2, stacks: 1, damagePerRound: 1 }];
      setActive(itemSession, 'player');
      const targetId = purpose === 'damage' ? 'enemy' : 'player';
      const used = resolveCombatCommandV2(itemSession, { commandId: `controlled-${purpose}`, unitId: 'player', kind: 'item', itemId: `item-${purpose}`, targetIds: [targetId] });
      expect(used.record.resolved).toBe(true);
      expect(used.record.itemChanges).toEqual([{ unitId: 'player', itemId: `item-${purpose}`, delta: -1 }]);
      if (purpose === 'heal') expect(used.record.healing).toBeGreaterThan(0);
      if (purpose === 'resource') expect(used.record.resourceChanges.some(change => change.delta > 0)).toBe(true);
      if (purpose === 'damage') expect(used.record.damage).toBeGreaterThan(0);
      if (purpose === 'cleanse') expect(used.record.statusChanges.some(change => change.operation === 'removed')).toBe(true);
      if (purpose === 'buff') expect(used.record.statusChanges.some(change => change.operation === 'applied')).toBe(true);
    }
    const session = combatSession();
    session.lifecycle = 'terminal';
    session.status = 'victory';
    session.actionSequence.push({ id: 'report-action', commandId: 'report-command', transactionId: 'report-tx', round: 1, unitId: 'player', kind: 'item', targetIds: ['enemy'], damage: 2, healing: 0, statusChanges: [], resourceChanges: [], itemChanges: [{ unitId: 'player', itemId: 'item-damage', delta: -1 }], resolved: true, input: { commandId: 'report-command', unitId: 'player', kind: 'item', itemId: 'item-damage', targetIds: ['enemy'] } });
    session.result = { status: 'victory', rewardEffects: [], rewardsApplied: false, narration: { status: 'pending', attempts: 0 }, terminalTransactionId: 'report-terminal' };
    const settled = settleCombatResult(makeState(), session);
    expect(settled.result.report).toMatchObject({ encounter: { id: 'encounter-1', context: expect.any(String) }, riskMode: session.riskMode, participants: expect.any(Array), actions: expect.any(Array), skillsUsed: expect.any(Array), itemsUsed: ['item-damage'], injuries: expect.any(Array), deaths: expect.any(Array), rewards: [], finalState: { status: 'victory', round: expect.any(Number) } });
  });

  test('preserves pre-combat health ratios and derives only semantic inventory mechanics', () => {
    const state = makeState();
    state.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: 'normal' } };
    state.玩家.生存状态.血量 = 40;
    state.玩家.生存状态.血量上限 = 100;
    state.玩家.物品栏 = {
      安全药剂: { 数量: 2, 类型: '普通物品', 品质: '精良', 备注: '明确恢复用途', 战斗用途: { 类型: 'heal', 目标: 'self' } },
      华丽长剑: { 数量: 1, 类型: '收藏品', 品质: '传说', 备注: '名称不能自动获得伤害' },
      下品零食: { 数量: 1, 类型: '普通物品', 品质: '普通', 备注: '' },
      口粮: { 数量: 1, 类型: '普通物品', 品质: '普通', 备注: '' },
      缺口铁剑: { 数量: 1, 类型: '普通物品', 品质: '普通', 备注: '' },
      显式优先: { 数量: 1, 类型: '普通物品', 品质: '普通', 备注: '下品零食', 战斗用途: { 类型: 'heal', 目标: 'self' } },
    };
    const roster = buildValidatedCombatRoster(state, proposal(1), { statRanges: { attrA: [0, 100], attrB: [0, 100] } });
    expect(roster.ok).toBe(true);
    const player = roster.plan!.playerPool.find(unit => unit.id === 'player')!;
    expect(player.hp / player.maxHp).toBeCloseTo(0.4, 1);
    const loadout = buildCombatItemLoadout(state, roster.plan!.playerPool);
    expect(loadout.definitions.安全药剂.narrativeOnly).toBe(false);
    expect(loadout.definitions.华丽长剑.narrativeOnly).toBe(true);
    expect(loadout.definitions.下品零食.purpose).toBe('resource');
    expect(loadout.definitions.口粮.purpose).toBe('resource');
    expect(loadout.definitions.缺口铁剑.narrativeOnly).toBe(true);
    expect(loadout.definitions.显式优先.purpose).toBe('heal');
    expect(loadout.quantities.player).toEqual({ 安全药剂: 2, 华丽长剑: 1, 下品零食: 1, 口粮: 1, 缺口铁剑: 1, 显式优先: 1 });
  });

  test('advances from a defeated enemy wave to a living legal actor', () => {
    const state = makeState();
    state.v3 = { schemaVersion: 3, featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: 'normal' } };
    const roster = buildValidatedCombatRoster(state, proposal(5));
    let session = startPreparedCombat(selectCombatants(createPreparingCombatSession(state, roster.plan!, { seed: 41, now: 1 }), ['player']).session!);
    const player = session.participants.find(unit => unit.id === 'player')!;
    player.attackPower = 999;
    player.accuracy = 100;
    const firstWaveEnemies = session.participants.filter(unit => unit.side === 'enemy');
    firstWaveEnemies.forEach(unit => { unit.hp = unit === firstWaveEnemies[0] ? 1 : 0; unit.armor = 0; });
    session.activeUnitId = 'player';
    player.actedRound = 0;
    session = resolveCombatCommandV2(session, { commandId: 'finish-wave-one', unitId: 'player', kind: 'attack', targetIds: [firstWaveEnemies[0].id] }).session;
    expect(session.lifecycle).toBe('active');
    expect(session.waves).toHaveLength(1);
    expect(session.participants.some(unit => unit.side === 'enemy' && unit.hp > 0)).toBe(true);
    expect(session.participants.find(unit => unit.id === session.activeUnitId)?.hp).toBeGreaterThan(0);
  });
});
