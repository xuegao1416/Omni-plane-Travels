import type { CombatActionKind, CombatParticipantV2, CombatSessionV2 } from './protocols';

export const COMBAT_CONTROLS: readonly CombatActionKind[] = ['attack', 'skill', 'item', 'defend', 'flee'];

export interface CombatPortraitModel {
  kind: 'male' | 'female' | 'neutral';
  src?: string;
  label: string;
}

export interface CombatUnitCardModel {
  id: string;
  name: string;
  side: 'ally' | 'enemy';
  hp: number;
  maxHp: number;
  resource: number;
  maxResource: number;
  hpPercent: number;
  resourcePercent: number;
  statuses: string[];
  cooldowns: Record<string, number>;
  itemQuantities: Record<string, number>;
  actedThisRound: boolean;
  isActive: boolean;
  isTargetable: boolean;
  initiativeIndex: number;
  feedback?: 'hit' | 'healed' | 'missed' | 'acted';
  feedbackText?: string;
  feedbackEventId?: string;
  portrait: CombatPortraitModel;
}

export interface CombatViewModel {
  lifecycle: CombatSessionV2['lifecycle'];
  round: number;
  threatBand: CombatSessionV2['encounter']['threatBand'];
  activeUnitId: string;
  allyUnits: CombatUnitCardModel[];
  enemyUnits: CombatUnitCardModel[];
  controls: readonly CombatActionKind[];
  hasNoAllies: boolean;
  hasNoEnemies: boolean;
  emptyState: string | null;
}

function portraitFor(unit: CombatParticipantV2, portraits: Record<string, { src?: string; gender?: string }>): CombatPortraitModel {
  const supplied = portraits[unit.id];
  const gender = supplied?.gender?.toLowerCase();
  const kind: CombatPortraitModel['kind'] = gender?.includes('女') || gender === 'female' ? 'female' : gender?.includes('男') || gender === 'male' ? 'male' : 'neutral';
  return { kind, ...(supplied?.src ? { src: supplied.src } : {}), label: `${kind} portrait placeholder` };
}

function card(unit: CombatParticipantV2, session: CombatSessionV2, portraits: Record<string, { src?: string; gender?: string }>): CombatUnitCardModel {
  const maxHp = Math.max(1, unit.maxHp);
  const maxResource = Math.max(1, unit.maxResource ?? 0);
  const initiativeIndex = session.initiativeOrder.indexOf(unit.id);
  const recent = [...session.actionSequence].reverse().find(action => action.resolved && (action.unitId === unit.id || action.targetIds.includes(unit.id)));
  const feedback = recent
    ? recent.targetIds.includes(unit.id) && recent.hit === false ? 'missed' as const
      : recent.targetIds.includes(unit.id) && recent.healing > 0 ? 'healed' as const
      : recent.targetIds.includes(unit.id) && recent.damage > 0 ? 'hit' as const
        : recent.unitId === unit.id ? 'acted' as const
          : undefined
    : undefined;
  const feedbackText = recent
    ? feedback === 'hit' ? `受到 ${recent.damage} 点伤害${recent.critical ? '（暴击）' : ''}`
      : feedback === 'healed' ? `恢复 ${recent.healing} 点生命`
        : feedback === 'missed' ? '攻击未命中'
          : feedback === 'acted' ? '已行动' : undefined
    : undefined;
  return {
    id: unit.id,
    name: unit.identity,
    side: unit.side === 'enemy' ? 'enemy' : 'ally',
    hp: Math.max(0, unit.hp),
    maxHp,
    resource: Math.max(0, unit.resource ?? 0),
    maxResource,
    hpPercent: Math.round(Math.max(0, Math.min(1, unit.hp / maxHp)) * 100),
    resourcePercent: Math.round(Math.max(0, Math.min(1, (unit.resource ?? 0) / maxResource)) * 100),
    statuses: [...new Set([
      ...(unit.statuses ?? []),
      ...(unit.typedStatuses ?? []).map(status => `${status.name}${status.stacks > 1 ? ` ×${status.stacks}` : ''}`),
    ])],
    cooldowns: { ...unit.cooldowns },
    itemQuantities: { ...(unit.itemQuantities ?? {}) },
    actedThisRound: unit.actedRound === session.round,
    isActive: unit.id === session.activeUnitId,
    isTargetable: unit.hp > 0,
    portrait: portraitFor(unit, portraits),
    initiativeIndex,
    ...(feedback ? { feedback } : {}),
    ...(feedbackText ? { feedbackText } : {}),
    ...(recent ? { feedbackEventId: recent.id } : {}),
  };
}

export function buildCombatViewModel(
  session: CombatSessionV2,
  portraits: Record<string, { src?: string; gender?: string }> = {},
): CombatViewModel {
  const units = session.lifecycle === 'preparing'
    ? [...session.availableAllyPool, ...session.availableEnemyPool.filter(unit => session.waves[0]?.unitIds.includes(unit.id))]
    : session.participants;
  const allyUnits = units.filter(unit => unit.side !== 'enemy').map(unit => card(unit, session, portraits));
  const enemyUnits = units.filter(unit => unit.side === 'enemy').map(unit => card(unit, session, portraits));
  const emptyState = allyUnits.length === 0 ? '暂无友方出战单位' : enemyUnits.length === 0 ? '暂无敌方单位' : null;
  return {
    lifecycle: session.lifecycle,
    round: session.round,
    threatBand: session.encounter.threatBand,
    activeUnitId: session.activeUnitId,
    allyUnits,
    enemyUnits,
    controls: COMBAT_CONTROLS,
    hasNoAllies: allyUnits.length === 0,
    hasNoEnemies: enemyUnits.length === 0,
    emptyState,
  };
}
