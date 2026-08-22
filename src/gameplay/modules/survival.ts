import type { GameState } from '../../schema/variables';
import type { SurvivalConsumption, SurvivalModuleSchema, SurvivalRecipe } from '../../modules/schema';
import { formatWorldClock, writeWorldClock, type WorldClockState } from '../../time/worldClock';
import {
  executeGameplayTransaction,
  ensureGameplayRuntime,
  type GameplayEffect,
  type GameplayEventInput,
  type GameplayExecutionContext,
  type GameplayExecutionResult,
  type GameplayStateRoot,
} from '../kernel';
import type { GameplayValue } from '../types';

function blockedSurvival(
  state: GameState,
  context: GameplayExecutionContext,
  id: string,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  return executeGameplayTransaction(state, {
    id, moduleId: 'survival', source: 'player',
    conditions: [{ state: { path: '__gameplay.survivalAllowed', op: '==', value: true } }],
  }, context);
}

export function craftSurvivalRecipe(
  state: GameState,
  recipe: SurvivalRecipe,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const resources = state.玩家.生存资源;
  if (!resources || !resources[recipe.output.resourceId]) {
    return blockedSurvival(state, context, `survival:invalid-recipe:${recipe.id}:${context.tick}`);
  }
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  if ((recipe.unlockConditions?.length || recipe.unlockCost?.length) && !runtime.survival?.unlockedRecipes.includes(recipe.id)) {
    return blockedSurvival(state, context, `survival:recipe-locked:${recipe.id}:${context.tick}`);
  }
  const clock = state.世界.时间系统?.时钟 as WorldClockState | undefined;
  const clockConfig = context.worldClockConfig;
  const craftTimeMinutes = Math.max(0, Math.trunc(Number(recipe.craftTimeMinutes) || 0));
  const nextClock = clock && clockConfig && craftTimeMinutes > 0
    ? writeWorldClock(clock, clockConfig, { deltaMinutes: craftTimeMinutes, source: 'manual', reason: `制作${recipe.name}` })
    : undefined;
  return executeGameplayTransaction(state, {
    id: `survival:craft:${recipe.id}:${context.tick}`,
    moduleId: 'survival',
    source: 'player',
    label: `制作「${recipe.name}」`,
    costs: Object.entries(recipe.inputs).map(([resourceId, amount]) => ({
      id: resourceId,
      label: resources[resourceId]?.name ?? resourceId,
      path: `玩家.生存资源.${resourceId}.数量`,
      amount: Math.max(0, Number(amount) || 0),
    })),
    effects: [
      { add: { path: `玩家.生存资源.${recipe.output.resourceId}.数量`, delta: Math.max(0, recipe.output.amount), min: 0 } },
      ...(nextClock ? [
        { set: { path: '世界.时间系统.时钟', value: { ...nextClock } as unknown as GameplayValue } } as GameplayEffect,
        { set: { path: '世界.时间系统.当前时间', value: formatWorldClock(nextClock, clockConfig!) } } as GameplayEffect,
      ] : []),
    ],
    events: [{ type: 'survival.crafted', payload: { recipeId: recipe.id, name: recipe.name, amount: recipe.output.amount } }],
  }, context);
}

export function unlockSurvivalRecipe(
  state: GameState,
  recipe: SurvivalRecipe,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  if (runtime.survival?.unlockedRecipes.includes(recipe.id)) return blockedSurvival(state, context, `survival:recipe-already-unlocked:${recipe.id}:${context.tick}`);
  return executeGameplayTransaction(state, {
    id: `survival:unlock:${recipe.id}:${context.tick}`, moduleId: 'survival', source: 'player', label: `解锁配方「${recipe.name}」`,
    conditions: recipe.unlockConditions,
    costs: recipe.unlockCost,
    effects: [{ set: { path: 'gameplay.survival.unlockedRecipes', value: [...(runtime.survival?.unlockedRecipes ?? []), recipe.id] } }],
    events: [{ type: 'survival.recipe-unlocked', payload: { recipeId: recipe.id, name: recipe.name } }],
  }, context);
}

export function applySurvivalStatus(
  state: GameState,
  status: { id: string; value?: number; durationTicks?: number; source?: string },
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  const expiresAtTick = status.durationTicks && status.durationTicks > 0 ? context.tick + Math.trunc(status.durationTicks) : undefined;
  const statuses = { ...(runtime.survival?.statuses ?? {}), [status.id]: { value: Number(status.value ?? 1), source: status.source, ...(expiresAtTick === undefined ? {} : { expiresAtTick }) } };
  return executeGameplayTransaction(state, {
    id: `survival:status:${status.id}:${context.tick}`, moduleId: 'survival', source: status.source ?? 'system',
    effects: [{ set: { path: 'gameplay.survival.statuses', value: statuses as unknown as Record<string, never> } }],
    events: [{ type: 'survival.status-applied', payload: { statusId: status.id } }],
  }, context);
}

export function expireSurvivalStatuses(
  state: GameState,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  const statuses = Object.fromEntries(Object.entries(runtime.survival?.statuses ?? {}).filter(([, value]) => value.expiresAtTick === undefined || value.expiresAtTick > context.tick));
  if (Object.keys(statuses).length === Object.keys(runtime.survival?.statuses ?? {}).length) return blockedSurvival(state, context, `survival:status-none:${context.tick}`);
  return executeGameplayTransaction(state, {
    id: `survival:status-expire:${context.tick}`, moduleId: 'survival', source: 'system',
    effects: [{ set: { path: 'gameplay.survival.statuses', value: statuses as unknown as Record<string, never> } }],
    events: [{ type: 'survival.status-expired', payload: { tick: context.tick } }],
  }, context);
}

/**
 * Resolve one explicit player gathering action through the shared gameplay kernel.
 * Resource quantity, stamina and the authoritative world clock are committed as
 * one transaction so a blocked action cannot partially consume anything.
 */
export function gatherSurvivalResource(
  state: GameState,
  config: SurvivalModuleSchema,
  resourceId: string,
  context: GameplayExecutionContext,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const resource = config.resources?.find(item => item.id === resourceId);
  const runtimeResource = state.玩家.生存资源?.[resourceId];
  if (!resource || !runtimeResource) {
    return blockedSurvival(state, context, `survival:gather:invalid-resource:${resourceId}:${context.tick}`);
  }

  const max = Math.max(0, Number(runtimeResource.最大值 ?? resource.max) || 0);
  const amount = Math.max(1, Math.trunc(Number(resource.gatherAmount) || 1));
  const timeMinutes = Math.max(1, Math.trunc(Number(resource.gatherTimeMinutes) || 30));
  const staminaCost = Math.max(0, Math.trunc(Number(resource.gatherStaminaCost) || 5));
  const clock = state.世界.时间系统?.时钟 as WorldClockState | undefined;
  const clockConfig = context.worldClockConfig;
  const nextClock = clock && clockConfig
    ? writeWorldClock(clock, clockConfig, { deltaMinutes: timeMinutes, source: 'manual', reason: `采集${resource.name}` })
    : undefined;
  const conditions = [{ state: { path: `玩家.生存资源.${resourceId}.数量`, op: '<' as const, value: max } }];

  return executeGameplayTransaction(state, {
    id: `survival:gather:${resourceId}:${context.tick}`,
    moduleId: 'survival',
    source: 'player',
    label: `采集「${resource.name}」`,
    conditions,
    costs: staminaCost > 0 ? [{
      id: 'stamina', label: '体力', path: '玩家.生存状态.体力值', amount: staminaCost,
    }] : undefined,
    effects: [
      { add: { path: `玩家.生存资源.${resourceId}.数量`, delta: amount, min: 0, max } },
      ...(nextClock ? [
        { set: { path: '世界.时间系统.时钟', value: { ...nextClock } as unknown as GameplayValue } } as GameplayEffect,
        { set: { path: '世界.时间系统.当前时间', value: formatWorldClock(nextClock, clockConfig!) } } as GameplayEffect,
      ] : []),
    ],
    events: [{
      type: 'survival.gathered',
      payload: { resourceId, name: resource.name, amount, timeMinutes, staminaCost },
    }],
  }, context);
}

export function resolveSurvivalConsumption(config: SurvivalModuleSchema): SurvivalConsumption {
  if (config.consumption?.perCycle) return config.consumption;
  const perCycle: Record<string, number> = {};
  const keywords = ['消耗', '每天', '需要', '食用', '饮用', '吃', '喝'];
  for (const resource of config.resources ?? []) {
    const text = `${resource.usage ?? ''} ${resource.description ?? ''}`;
    if (keywords.some(keyword => text.includes(keyword))) perCycle[resource.id] = 1;
  }
  if (Object.keys(perCycle).length === 0 && config.resources?.[0]) perCycle[config.resources[0].id] = 1;
  return { perCycle };
}

export function settleSurvivalCycle(
  state: GameState,
  config: SurvivalModuleSchema,
  context: GameplayExecutionContext,
  periodKey?: string,
): GameplayExecutionResult<GameState & GameplayStateRoot> {
  const resources = state.玩家.生存资源;
  if (!resources) return blockedSurvival(state, context, `survival:no-state:${context.tick}`);
  const consumption = resolveSurvivalConsumption(config);
  const effects: GameplayEffect[] = [];
  const events: GameplayEventInput[] = [];
  const threshold = Math.max(0, config.rules?.criticalThreshold ?? 2);

  for (const [resourceId, rawAmount] of Object.entries(consumption.perCycle)) {
    const resource = resources[resourceId];
    const amount = Math.max(0, Number(rawAmount) || 0);
    if (!resource || amount <= 0) continue;
    const before = Math.max(0, Number(resource.数量) || 0);
    const after = Math.max(0, before - amount);
    effects.push({ add: { path: `玩家.生存资源.${resourceId}.数量`, delta: -amount, min: 0 } });
    if (after <= threshold) {
      events.push({ type: after === 0 ? 'survival.depleted' : 'survival.critical', payload: { resourceId, amount: after } });
    }
    const penalty = Math.max(0, Number(consumption.exhaustionPenalty?.[resourceId]) || 0);
    if (after === 0 && penalty > 0) {
      effects.push({ add: { path: '玩家.生存状态.体力值', delta: -penalty, min: 0 } });
    }
  }
  if (effects.length === 0) return blockedSurvival(state, context, `survival:no-consumption:${context.tick}`);
  return executeGameplayTransaction(state, {
    id: `survival:cycle:${periodKey ?? context.tick}`,
    moduleId: 'survival',
    source: 'system',
    label: `${config.rules?.cycleName ?? '周期'}生存结算`,
    conditions: periodKey ? [{ state: { path: 'gameplay.settlementKeys.survival', op: '!=', value: periodKey } }] : undefined,
    effects: [
      ...effects,
      ...(periodKey ? [{ set: { path: 'gameplay.settlementKeys.survival', value: periodKey } } as GameplayEffect] : []),
    ],
    events,
  }, context);
}
