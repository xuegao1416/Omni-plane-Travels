import type { StatModuleSchema } from '../modules/schema';
import type { CustomNpc } from '../storage/db';
import { materializeNpcSurvivalStats, materializeNpcTierIndex } from '../utils/npcStats';

function text(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value : fallback;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

export function mergeNpcFillResult(
  previous: CustomNpc,
  input: Record<string, unknown>,
  statConfig?: Partial<StatModuleSchema>,
  hasProgression = false,
): CustomNpc {
  const incomingStats = record(input.survivalStats);
  const mergedStats = statConfig
    ? materializeNpcSurvivalStats({ ...incomingStats, ...previous.survivalStats }, statConfig)
    : previous.survivalStats;
  const incomingTier = Number(input.tierIndex);
  const tierIndex = hasProgression
    ? materializeNpcTierIndex(
      previous.tierIndex ?? (Number.isInteger(incomingTier) && incomingTier >= 0 ? incomingTier : undefined),
      0,
    )
    : previous.tierIndex;

  return {
    ...previous,
    gender: text(input.gender, previous.gender),
    age: text(input.age, previous.age),
    race: text(input.race, previous.race),
    relationshipType: text(input.relationship, previous.relationshipType),
    occupation: text(input.occupation, previous.occupation),
    socialStatus: text(input.socialStatus, previous.socialStatus),
    personality: text(input.personality, previous.personality),
    hiddenPersonality: text(input.hiddenPersonality, previous.hiddenPersonality),
    currentThought: text(input.currentThought, previous.currentThought),
    appearance: text(input.appearance, previous.appearance),
    currentOutfit: text(input.currentOutfit, previous.currentOutfit),
    currentAction: text(input.currentAction, previous.currentAction),
    currentLocation: text(input.currentLocation, previous.currentLocation),
    currentState: text(input.currentState, previous.currentState),
    shortTermGoal: text(input.shortTermGoal, previous.shortTermGoal),
    longTermGoal: text(input.longTermGoal, previous.longTermGoal),
    background: text(input.background, previous.background),
    skillsList: record(input.skillsList) ? input.skillsList as CustomNpc['skillsList'] : previous.skillsList,
    itemsList: record(input.itemsList) ? input.itemsList as CustomNpc['itemsList'] : previous.itemsList,
    ...(mergedStats ? { survivalStats: mergedStats } : {}),
    ...(tierIndex !== undefined ? { tierIndex } : {}),
  };
}
