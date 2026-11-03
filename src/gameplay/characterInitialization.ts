import type { GameState } from '../schema/variables';

function moduleInitNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return moduleInitNumber(record.current) ?? moduleInitNumber(record.value);
}

export function applyStatModuleInitData(state: GameState, input: unknown): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return;
  const statData = input as Record<string, unknown>;
  const survival = state.玩家.生存状态;

  const attrA = moduleInitNumber(statData.attrA);
  if (attrA !== undefined) survival.血量 = attrA;
  const attrB = moduleInitNumber(statData.attrB);
  if (attrB !== undefined) survival.体力值 = attrB;
  for (let index = 1; index <= 6; index += 1) {
    const value = moduleInitNumber(statData[`dim${index}`]);
    if (value !== undefined) survival[`dim${index}`] = value;
  }

  if (Array.isArray(statData.special)) {
    for (const item of statData.special) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      const special = item as Record<string, unknown>;
      const value = moduleInitNumber(special);
      if (typeof special.id === 'string' && special.id && value !== undefined) survival[special.id] = value;
    }
    return;
  }

  if (statData.special && typeof statData.special === 'object') {
    for (const [id, item] of Object.entries(statData.special as Record<string, unknown>)) {
      const value = moduleInitNumber(item);
      if (id && value !== undefined) survival[id] = value;
    }
  }
}
