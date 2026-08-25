import type { GameState } from '../schema/variables';
import type {
  CombatActionDefinition,
  CombatEnemyDefinition,
  CombatEncounterDefinition,
  CombatModuleSchema,
  CombatScalingStatId,
  CombatStatusDefinition,
  StatModuleSchema,
} from '../modules/schema';
import { getSixDimSemantic } from '../modules/xpAlgorithm';
import {
  executeGameplayTransaction,
  getGameplayPath,
  type GameplayEffect,
  type GameplayExecutionResult,
} from './kernel';

export interface CombatStatusRuntime extends CombatStatusDefinition {
  remainingRounds: number;
  stacks: number;
}

export interface CombatParticipantRuntime {
  id: string;
  name: string;
  side: 'player' | 'enemy';
  hp: number;
  maxHp: number;
  armor: number;
  initiative: number;
  statuses: CombatStatusRuntime[];
  cooldowns: Record<string, number>;
}

export interface CombatLogEntry {
  round: number;
  actorId?: string;
  targetId?: string;
  kind: 'start' | 'action' | 'damage' | 'status' | 'victory' | 'defeat' | 'draw' | 'system';
  text: string;
}

export interface CombatSession {
  encounterId: string;
  encounterName: string;
  status: 'active' | 'victory' | 'defeat' | 'draw';
  round: number;
  activeActorId: string;
  /** Stable initiative order for this encounter; kept in save data for readable replays. */
  turnOrder?: string[];
  actionPoints: number;
  actionPointsPerTurn: number;
  participants: CombatParticipantRuntime[];
  log: CombatLogEntry[];
}

export interface CombatRuntimeState {
  active?: CombatSession;
  history?: CombatSession[];
}

export interface CombatContext {
  tick: number;
  enabledModules?: readonly string[];
  /** Injected by tests or deterministic worlds; normal play uses Math.random. */
  random?: () => number;
}

export type CombatExecutionResult = GameplayExecutionResult<GameState> & { summary?: string };

const BLOCKED_CONDITION = [{ state: { path: 'combat.active.round', op: '<' as const, value: 0 } }];

function randomD20(context: CombatContext, deterministic = false): number {
  if (!context.random && deterministic) return 10;
  return Math.max(1, Math.min(20, 1 + Math.floor((context.random ?? Math.random)() * 20)));
}

function asGameplayEffect(value: unknown): GameplayEffect {
  return value as GameplayEffect;
}

function runBlocked(state: GameState, source: string, context: CombatContext, reason: string): CombatExecutionResult {
  const result = executeGameplayTransaction(state, {
    id: `combat-blocked-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    moduleId: 'combat',
    source,
    conditions: BLOCKED_CONDITION,
  }, { tick: context.tick, enabledModules: context.enabledModules ?? ['combat'] });
  return { ...result, reason, summary: reason };
}

function activeSession(state: GameState): CombatSession | undefined {
  const value = state.combat?.active;
  return value && value.status === 'active' ? value : undefined;
}

function findAction(actions: CombatActionDefinition[] | undefined, actionId: string): CombatActionDefinition | undefined {
  return actions?.find(action => action.id === actionId);
}

function findEncounter(config: CombatModuleSchema, encounterId: string): CombatEncounterDefinition | undefined {
  return config.encounters.find(encounter => encounter.id === encounterId);
}

function resolvePlayerHpPath(state: GameState, config: CombatModuleSchema): string {
  if (config.playerHpPath) return config.playerHpPath;
  const blood = getGameplayPath(state, '玩家.生存状态.血量');
  return Number.isFinite(Number(blood)) ? '玩家.生存状态.血量' : '玩家.生存状态.attrA';
}

function readPlayerHp(state: GameState, config: CombatModuleSchema): number {
  const configured = getGameplayPath(state, resolvePlayerHpPath(state, config));
  if (Number.isFinite(Number(configured))) return Math.max(0, Number(configured));
  const fallback = getGameplayPath(state, '玩家.生存状态.血量');
  return Math.max(0, Number.isFinite(Number(fallback)) ? Number(fallback) : 0);
}

function livingEnemies(session: CombatSession): CombatParticipantRuntime[] {
  return session.participants.filter(participant => participant.side === 'enemy' && participant.hp > 0);
}

function livingParticipantsInTurnOrder(session: CombatSession): CombatParticipantRuntime[] {
  const byId = new Map(session.participants.map(participant => [participant.id, participant]));
  const order = session.turnOrder?.length ? session.turnOrder : session.participants
    .slice()
    .sort((left, right) => right.initiative - left.initiative || (left.side === 'player' ? -1 : 1))
    .map(participant => participant.id);
  return order.map(id => byId.get(id)).filter((participant): participant is CombatParticipantRuntime => Boolean(participant && participant.hp > 0));
}

function statusModifier(participant: CombatParticipantRuntime, key: 'armor' | 'accuracy' | 'damage' | 'healing'): number {
  return participant.statuses.reduce((total, status) => {
    const amount = Number(status.modifiers?.[key] ?? 0);
    return total + (Number.isFinite(amount) ? amount * Math.max(1, status.stacks) : 0);
  }, 0);
}

function canonicalStatValue(state: GameState, statId: CombatScalingStatId): number {
  const survival = state.玩家.生存状态 as Record<string, number>;
  const key = statId === 'attrA' ? '血量' : statId === 'attrB' ? '体力值' : statId;
  const value = Number(survival?.[key] ?? 0);
  return Number.isFinite(value) ? value : 0;
}

export function resolveCombatActionScaling(
  state: GameState,
  action: CombatActionDefinition,
  target: 'damage' | 'healing' | 'accuracy',
): number {
  const raw = (action.scaling ?? []).reduce((sum, scaling) => {
    if ((scaling.appliesTo ?? 'damage') !== target) return sum;
    const coefficient = Number(scaling.coefficient);
    return sum + (Number.isFinite(coefficient) ? canonicalStatValue(state, scaling.statId) * coefficient : 0);
  }, 0);
  // 低数值世界（如 0~20）也必须能从百分比成长中得到实际收益。
  return raw > 0 ? Math.max(1, Math.round(raw)) : raw < 0 ? Math.min(-1, Math.round(raw)) : 0;
}

export function combatStatLabel(statId: CombatScalingStatId, config?: StatModuleSchema): string {
  if (statId === 'attrA') return config?.attrA?.name || '生命类';
  if (statId === 'attrB') return config?.attrB?.name || '能量类';
  const definition = config?.[statId];
  return definition?.name
    ? `${definition.name}（${getSixDimSemantic(statId, definition).label}）`
    : getSixDimSemantic(statId).label;
}

export function describeCombatActionFormula(action: CombatActionDefinition, config?: StatModuleSchema, state?: GameState): string {
  const parts: string[] = [];
  if ((action.damage ?? 0) > 0) parts.push(`基础伤害 ${action.damage}`);
  if ((action.healing ?? 0) > 0) parts.push(`基础治疗 ${action.healing}`);
  for (const scaling of action.scaling ?? []) {
    const target = (scaling.appliesTo ?? 'damage') === 'healing' ? '治疗' : (scaling.appliesTo ?? 'damage') === 'accuracy' ? '命中' : '伤害';
    parts.push(`${target}追加 ${combatStatLabel(scaling.statId, config)} × ${Math.round(scaling.coefficient * 100)}%`);
  }
  if (state) {
    const damage = Math.max(0, Math.trunc((action.damage ?? 0) + resolveCombatActionScaling(state, action, 'damage')));
    const healing = Math.max(0, Math.trunc((action.healing ?? 0) + resolveCombatActionScaling(state, action, 'healing')));
    if (damage > 0) parts.push(`当前面板伤害 ${damage}`);
    if (healing > 0) parts.push(`当前面板治疗 ${healing}`);
  }
  parts.push(`行动点 ${Math.max(1, action.actionCost ?? 1)}`);
  if ((action.cooldownRounds ?? 0) > 0) parts.push(`冷却 ${action.cooldownRounds} 回合`);
  return parts.join(' · ');
}

function effectiveArmor(participant: CombatParticipantRuntime): number {
  return Math.max(0, participant.armor + statusModifier(participant, 'armor'));
}

function enemyActionTarget(session: CombatSession, actor: CombatParticipantRuntime, targetMode: CombatActionDefinition['target']): CombatParticipantRuntime | undefined {
  if (targetMode === 'self') return actor;
  if (targetMode !== 'ally') return session.participants.find(participant => participant.side === 'player' && participant.hp > 0);
  const allies = livingParticipantsInTurnOrder(session)
    .filter(participant => participant.side === actor.side && participant.id !== actor.id)
    .sort((left, right) => (left.hp / left.maxHp) - (right.hp / right.maxHp));
  return allies[0] ?? actor;
}

function appendLog(session: CombatSession, entry: CombatLogEntry): void {
  session.log.push(entry);
  if (session.log.length > 100) session.log = session.log.slice(-100);
}

function defaultPlayerActions(config: CombatModuleSchema): CombatActionDefinition[] {
  return config.playerActions?.length ? config.playerActions : [{
    id: 'basic-attack', name: '普通攻击', description: '以当前属性进行一次基础攻击。', target: 'enemy', actionCost: 1, accuracy: 10, damage: 1,
  }];
}

function buildEnemy(enemy: CombatEnemyDefinition): CombatParticipantRuntime {
  const maxHp = Math.max(1, Math.trunc(enemy.maxHp));
  return {
    id: enemy.id,
    name: enemy.name,
    side: 'enemy',
    hp: maxHp,
    maxHp,
    armor: Math.max(0, Number(enemy.armor ?? 0)),
    initiative: Number(enemy.initiative ?? 0),
    statuses: (enemy.statuses ?? []).map(status => ({ ...status, remainingRounds: status.durationRounds ?? 1, stacks: 1 })),
    cooldowns: {},
  };
}

/** Start a configured encounter through the shared transaction/event language. */
export function startCombat(state: GameState, config: CombatModuleSchema, encounterId: string, context: CombatContext): CombatExecutionResult {
  if (activeSession(state)) return runBlocked(state, 'combat.start', context, '已有进行中的战斗');
  const encounter = findEncounter(config, encounterId);
  if (!encounter || encounter.enemies.length === 0) return runBlocked(state, 'combat.start', context, '战斗遭遇不存在或没有敌人');
  const playerHp = readPlayerHp(state, config);
  if (playerHp <= 0) return runBlocked(state, 'combat.start', context, '玩家已无法战斗');
  const participants: CombatParticipantRuntime[] = [
    { id: 'player', name: '玩家', side: 'player', hp: playerHp, maxHp: Math.max(playerHp, Number(config.playerMaxHp ?? playerHp)), armor: Math.max(0, Number(config.playerArmor ?? 0)), initiative: Number(config.playerInitiative ?? 0), statuses: [], cooldowns: {} },
    ...encounter.enemies.map(buildEnemy),
  ];
  const turnOrder = [...participants]
    .sort((left, right) => right.initiative - left.initiative || (left.side === 'player' ? -1 : 1) || left.id.localeCompare(right.id))
    .map(participant => participant.id);
  const turnNames = turnOrder.map(id => participants.find(participant => participant.id === id)?.name ?? id).join(' → ');
  const session: CombatSession = {
    encounterId: encounter.id,
    encounterName: encounter.name,
    status: 'active',
    round: 1,
    activeActorId: 'player',
    actionPoints: Math.max(1, Math.trunc(config.actionPointsPerTurn ?? 1)),
    actionPointsPerTurn: Math.max(1, Math.trunc(config.actionPointsPerTurn ?? 1)),
    turnOrder,
    participants,
    log: [{ round: 1, kind: 'start', text: `遭遇 ${encounter.name}，战斗开始。行动顺序：${turnNames}。` }],
  };
  resolveEnemyTurns(session, config, context, 'before-player');
  const player = session.participants.find(participant => participant.id === 'player')!;
  const currentHistory = state.combat?.history ?? [];
  const immediatelyDefeated = player.hp <= 0;
  if (immediatelyDefeated) {
    session.status = 'defeat';
    appendLog(session, { round: session.round, kind: 'defeat', text: '玩家在取得行动机会前失去全部生命，战斗失败。' });
  }
  const history = immediatelyDefeated ? [...currentHistory, session] : currentHistory;
  const combatValue = immediatelyDefeated ? { history } : { active: session, history };
  const events: GameplayEffect[] = [
    asGameplayEffect({ emit: { type: 'combat.started', payload: { encounterId: encounter.id, name: encounter.name } } }),
  ];
  if (immediatelyDefeated) events.push(asGameplayEffect({ emit: { type: 'combat.defeat', payload: { encounterId: encounter.id, round: session.round } } }));
  const result = executeGameplayTransaction(state, {
    id: `combat-start-${encounter.id}-${Date.now()}`,
    moduleId: 'combat',
    source: 'combat.start',
    label: `开始战斗：${encounter.name}`,
    effects: [
      asGameplayEffect({ set: { path: 'combat', value: combatValue } }),
      asGameplayEffect({ set: { path: resolvePlayerHpPath(state, config), value: Math.max(0, Math.round(player.hp)) } }),
      ...events,
    ],
  }, { tick: context.tick, enabledModules: context.enabledModules ?? ['combat'] });
  return { ...result, summary: result.status === 'applied' ? (immediatelyDefeated ? '战斗失败：敌方取得先手' : `战斗开始：${encounter.name}`) : result.reason };
}

function applyStatuses(session: CombatSession, round: number): string[] {
  const notes: string[] = [];
  for (const participant of session.participants) {
    const next: CombatStatusRuntime[] = [];
    for (const status of participant.statuses) {
      if (status.damagePerRound && participant.hp > 0) {
        participant.hp = Math.max(0, participant.hp - Math.max(0, status.damagePerRound * Math.max(1, status.stacks)));
        notes.push(`${participant.name}受到${status.name}持续伤害。`);
      }
      const remaining = status.remainingRounds - 1;
      if (remaining > 0) next.push({ ...status, remainingRounds: remaining });
      else notes.push(`${participant.name}的${status.name}已结束。`);
    }
    participant.statuses = next;
  }
  return notes;
}

function resolveEnemyTurns(session: CombatSession, config: CombatModuleSchema, context: CombatContext, phase: 'before-player' | 'after-player' | 'all' = 'all'): void {
  const player = session.participants.find(participant => participant.id === 'player');
  if (!player || player.hp <= 0) return;
  const ordered = livingParticipantsInTurnOrder(session);
  const playerIndex = ordered.findIndex(participant => participant.id === 'player');
  const enemies = ordered.filter((participant, index) => participant.side === 'enemy' && (
    phase === 'all'
      || (phase === 'before-player' && playerIndex >= 0 && index < playerIndex)
      || (phase === 'after-player' && (playerIndex < 0 || index > playerIndex))
  ));
  for (const enemy of enemies) {
    const definition = config.encounters.find(item => item.id === session.encounterId)?.enemies.find(item => item.id === enemy.id);
    const action = definition?.actions?.find(candidate => (enemy.cooldowns[candidate.id] ?? 0) <= 0) ?? { id: 'enemy-attack', name: '攻击', target: 'enemy' as const, accuracy: 10, damage: 1 };
    const roll = randomD20(context, config.deterministic);
    const targetMode = action.target ?? 'enemy';
    const target = enemyActionTarget(session, enemy, targetMode);
    if (!target) continue;
    const isOffensive = targetMode === 'enemy' && (action.damage ?? 0) > 0;
    const hit = !isOffensive || roll === 20 || roll + (action.accuracy ?? 10) + statusModifier(enemy, 'accuracy') >= 10 + effectiveArmor(target);
    const damage = isOffensive && hit ? Math.max(0, Math.trunc((action.damage ?? 1) + statusModifier(enemy, 'damage'))) : 0;
    const healing = hit && (action.healing ?? 0) > 0 ? Math.max(0, Math.trunc((action.healing ?? 0) + statusModifier(enemy, 'healing'))) : 0;
    if (damage > 0) target.hp = Math.max(0, target.hp - damage);
    if (healing > 0) target.hp = Math.min(target.maxHp, target.hp + healing);
    if (hit && action.appliesStatus) {
      const existing = target.statuses.find(status => status.id === action.appliesStatus!.id);
      if (existing) existing.stacks += 1;
      else target.statuses.push({ ...action.appliesStatus, remainingRounds: action.appliesStatus.durationRounds ?? 1, stacks: 1 });
    }
    enemy.cooldowns[action.id] = Math.max(0, Math.trunc(action.cooldownRounds ?? 0));
    const text = !hit
      ? `${enemy.name}的${action.name}未命中。`
      : healing > 0 ? `${enemy.name}使用${action.name}，为${target.name}恢复 ${healing} 点生命。`
        : `${enemy.name}使用${action.name}，造成 ${damage} 点伤害。`;
    appendLog(session, { round: session.round, actorId: enemy.id, targetId: target.id, kind: damage > 0 ? 'damage' : 'action', text });
    if (player.hp <= 0) break;
  }
}

/** Resolve one player action, enemy responses, status ticks, and terminal outcome atomically. */
export function performCombatAction(state: GameState, config: CombatModuleSchema, actionId: string, targetId: string, context: CombatContext): CombatExecutionResult {
  const current = activeSession(state);
  if (!current) return runBlocked(state, 'combat.action', context, '当前没有进行中的战斗');
  if (current.activeActorId !== 'player') return runBlocked(state, 'combat.action', context, '当前不是玩家回合');
  const encounter = findEncounter(config, current.encounterId);
  const action = findAction(defaultPlayerActions(config), actionId);
  const targetMode = action?.target ?? 'enemy';
  const target = current.participants.find(participant => {
    if (participant.hp <= 0 || participant.id !== targetId) return false;
    if (targetMode === 'enemy') return participant.side === 'enemy';
    return participant.side === 'player';
  });
  if (!encounter || !action || !target) return runBlocked(state, 'combat.action', context, '行动或目标无效');
  const cost = Math.max(1, Math.trunc(action.actionCost ?? 1));
  const cooldown = current.participants.find(item => item.id === 'player')?.cooldowns[action.id] ?? 0;
  if (cost > current.actionPoints) return runBlocked(state, 'combat.action', context, '行动点不足');
  if (cooldown > 0) return runBlocked(state, 'combat.action', context, `行动冷却中（${cooldown} 回合）`);

  const session: CombatSession = structuredClone(current);
  if (!Array.isArray(session.turnOrder) || session.turnOrder.length === 0) {
    session.turnOrder = session.participants.slice().sort((left, right) => right.initiative - left.initiative).map(participant => participant.id);
  }
  const player = session.participants.find(participant => participant.id === 'player')!;
  const sessionTarget = session.participants.find(participant => participant.id === targetId)!;
  session.actionPoints -= cost;
  const roll = randomD20(context, config.deterministic);
  const attackPath = config.playerAttackPath ?? '玩家.生存状态.dim1';
  const attackBonus = Math.floor((Number(getGameplayPath(state, attackPath) ?? 0) - 10) / 2);
  // 有明确职业倍率的行动完全按自身公式结算，避免法术等能力再暗中叠加默认 dim1 修正。
  const fallbackAttackBonus = action.scaling?.length ? 0 : attackBonus;
  const scalingDamage = resolveCombatActionScaling(state, action, 'damage');
  const scalingHealing = resolveCombatActionScaling(state, action, 'healing');
  const scalingAccuracy = resolveCombatActionScaling(state, action, 'accuracy');
  const isOffensive = targetMode === 'enemy' && ((action.damage ?? 0) > 0 || scalingDamage > 0);
  const hit = !isOffensive || roll === 20 || (roll !== 1 && roll + (action.accuracy ?? 10) + fallbackAttackBonus + scalingAccuracy + statusModifier(player, 'accuracy') >= 10 + effectiveArmor(sessionTarget));
  const damage = isOffensive && hit ? Math.max(0, Math.trunc((action.damage ?? 0) + scalingDamage + Math.max(0, fallbackAttackBonus) + statusModifier(player, 'damage'))) : 0;
  if (damage > 0) sessionTarget.hp = Math.max(0, sessionTarget.hp - damage);
  const healing = hit && ((action.healing ?? 0) > 0 || scalingHealing > 0) ? Math.max(0, Math.trunc((action.healing ?? 0) + scalingHealing + statusModifier(player, 'healing'))) : 0;
  if (healing > 0) sessionTarget.hp = Math.min(sessionTarget.maxHp, sessionTarget.hp + healing);
  if (hit && action.appliesStatus) {
    const existing = sessionTarget.statuses.find(status => status.id === action.appliesStatus!.id);
    if (existing) existing.stacks += 1;
    else sessionTarget.statuses.push({ ...action.appliesStatus, remainingRounds: action.appliesStatus.durationRounds ?? 1, stacks: 1 });
  }
  player.cooldowns[action.id] = Math.max(0, Math.trunc(action.cooldownRounds ?? 0));
  const resultText = !hit
    ? `玩家使用${action.name}但未命中${sessionTarget.name}。`
    : healing > 0
      ? `玩家使用${action.name}，使${sessionTarget.name}恢复 ${healing} 点生命。`
      : `玩家使用${action.name}，对${sessionTarget.name}造成 ${damage} 点伤害。`;
  appendLog(session, { round: session.round, actorId: 'player', targetId, kind: damage > 0 ? 'damage' : 'action', text: resultText });
  if (hit && action.appliesStatus) appendLog(session, { round: session.round, actorId: 'player', targetId, kind: 'status', text: `${sessionTarget.name}获得${action.appliesStatus.name}。` });

  let outcome: CombatSession['status'] = 'active';
  if (livingEnemies(session).length === 0) {
    outcome = 'victory';
    session.status = outcome;
    appendLog(session, { round: session.round, kind: 'victory', text: `战斗胜利：${encounter.name}已被击败。` });
  } else {
    const turnEnded = session.actionPoints <= 0;
    if (turnEnded) {
      resolveEnemyTurns(session, config, context, 'after-player');
      const statusNotes = applyStatuses(session, session.round);
      statusNotes.forEach(text => appendLog(session, { round: session.round, kind: 'status', text }));
      for (const participant of session.participants) {
        participant.cooldowns = Object.fromEntries(Object.entries(participant.cooldowns).flatMap(([id, value]) => value > 1 ? [[id, value - 1]] : []));
      }
    }
    if (player.hp <= 0) {
      outcome = 'defeat';
      session.status = outcome;
      appendLog(session, { round: session.round, kind: 'defeat', text: '玩家失去全部生命，战斗失败。' });
    } else if (livingEnemies(session).length === 0) {
      outcome = 'victory';
      session.status = outcome;
      appendLog(session, { round: session.round, kind: 'victory', text: `战斗胜利：${encounter.name}已被击败。` });
    } else if (turnEnded && session.round >= (encounter.roundLimit ?? 100)) {
      outcome = 'draw';
      session.status = outcome;
      appendLog(session, { round: session.round, kind: 'draw', text: '战斗超过回合上限，双方暂时脱离战斗。' });
    } else if (turnEnded) {
      session.round += 1;
      session.actionPoints = session.actionPointsPerTurn;
      resolveEnemyTurns(session, config, context, 'before-player');
      if (player.hp <= 0) {
        outcome = 'defeat';
        session.status = outcome;
        appendLog(session, { round: session.round, kind: 'defeat', text: '敌方抢先行动，玩家失去全部生命，战斗失败。' });
      }
    }
  }
  const history = [...(state.combat?.history ?? [])];
  if (outcome !== 'active') history.push(session);
  const professionAbilityId = actionId.startsWith('profession:') ? actionId.slice('profession:'.length) : '';
  const professionAbility = professionAbilityId
    ? state.玩家.能力系统?.职业状态?.已解锁能力?.[professionAbilityId]
    : undefined;
  const effects: GameplayEffect[] = [
    asGameplayEffect({ set: { path: 'combat', value: outcome === 'active' ? { active: session, history } : { history } } }),
    asGameplayEffect({ set: { path: resolvePlayerHpPath(state, config), value: Math.max(0, Math.round(player.hp)) } }),
    ...(professionAbility ? [asGameplayEffect({ set: {
      path: `玩家.能力系统.职业状态.已解锁能力.${professionAbilityId}.使用次数`,
      value: (professionAbility.使用次数 ?? 0) + 1,
    } })] : []),
    asGameplayEffect({ emit: { type: `combat.${outcome === 'active' ? 'action' : outcome}`, payload: { encounterId: encounter.id, actionId, targetId, round: session.round, damage } } }),
  ];
  if (outcome === 'victory') effects.push(...(encounter as CombatEncounterDefinition & { rewards?: GameplayEffect[] }).rewards ?? []);
  const result = executeGameplayTransaction(state, {
    id: `combat-action-${current.encounterId}-${current.round}-${Date.now()}`,
    moduleId: 'combat', source: 'combat.action', label: action.name, effects,
  }, { tick: context.tick, enabledModules: context.enabledModules ?? ['combat'] });
  return { ...result, summary: session.log.at(-1)?.text };
}

export function endCombat(state: GameState, context: CombatContext): CombatExecutionResult {
  if (!state.combat?.active) return runBlocked(state, 'combat.end', context, '当前没有进行中的战斗');
  const result = executeGameplayTransaction(state, {
    id: `combat-end-${Date.now()}`, moduleId: 'combat', source: 'combat.end',
    effects: [asGameplayEffect({ remove: { path: 'combat.active' } }), asGameplayEffect({ emit: { type: 'combat.ended' } })],
  }, { tick: context.tick, enabledModules: context.enabledModules ?? ['combat'] });
  return { ...result, summary: '已退出战斗' };
}

/** Stable, plain-text fallback used by prompts, accessibility and non-graphical clients. */
export function summarizeCombatSession(session: CombatSession): string {
  const player = session.participants.find(participant => participant.id === 'player');
  const enemies = session.participants
    .filter(participant => participant.side === 'enemy')
    .map(participant => `${participant.name} ${Math.max(0, participant.hp)}/${participant.maxHp}${participant.statuses.length ? `（${participant.statuses.map(status => status.name).join('、')}）` : ''}`)
    .join('；');
  const outcome = session.status === 'active' ? '进行中' : session.status === 'victory' ? '胜利' : session.status === 'defeat' ? '失败' : '平局';
  return `【${session.encounterName}】${outcome}｜第 ${session.round} 回合｜玩家 ${Math.max(0, player?.hp ?? 0)}/${player?.maxHp ?? 0}｜敌方：${enemies || '无'}`;
}
