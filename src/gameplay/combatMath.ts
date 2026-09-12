import type { GameState } from '../schema/variables';
import type { CombatActionDefinition, CombatScalingStatId, StatModuleSchema } from '../modules/schema';
import { getSixDimSemantic } from '../modules/xpAlgorithm';

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
