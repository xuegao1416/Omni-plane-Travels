import type { GameState } from '../schema/variables';
import { executeGameplayTransaction, getGameplayPath } from '../gameplay/kernel';
import type { GameplayCost, GameplayEffect, GameplayValue } from '../gameplay/types';
import { executeCustomModuleActions } from './actionExecutor';
import { buildCustomModuleHostContext, type CustomModuleHostContext } from './context';
import { buildV2Operands, evaluateV2Condition, type CustomModuleLifecycle } from './runtime';
import type { CustomGameplayModuleDefinition, CustomModuleHostAction, V2Action } from './schema';
import { createInitialCustomModuleState } from './stateStore';
import { validateCustomGameplayModule } from './validator';

export interface CustomModuleGameExecutionOptions {
  eventId: string;
  now?: number;
  context?: CustomModuleHostContext;
}
export interface CustomModuleGameExecutionResult { gameState: GameState; applied: number; warnings: string[] }

/** Host capabilities are lowered here; model-provided paths never enter the gameplay kernel. */
export function executeCustomModuleInGame(
  source: GameState, definition: CustomGameplayModuleDefinition, lifecycle: CustomModuleLifecycle,
  options: CustomModuleGameExecutionOptions,
): CustomModuleGameExecutionResult {
  let gameState: GameState = JSON.parse(JSON.stringify(source));
  const validation = validateCustomGameplayModule(definition, 'internal');
  if (!validation.valid || !validation.normalized) return { gameState, applied: 0, warnings: validation.errors.map(e => `${e.code}: ${e.message}`) };
  const module = validation.normalized;
  if (!options.eventId?.trim()) return { gameState, applied: 0, warnings: ['缺少稳定游戏事件 ID'] };
  gameState.customModules ??= {};
  gameState.customModules[module.id] ??= createInitialCustomModuleState(module);
  const initial = gameState.customModules[module.id];
  if (!initial.enabled) return { gameState, applied: 0, warnings: [] };
  // Version changes must pass the explicit save-application migration gate.
  if (initial.moduleVersion !== module.version || (initial.definition && JSON.stringify(initial.definition) !== JSON.stringify(module))) {
    return { gameState, applied: 0, warnings: ['存档模块定义与请求版本不一致，请先预览并应用更新'] };
  }
  const warnings: string[] = [];
  let applied = 0;
  let remaining = 128;
  for (const rule of module.logic[lifecycle]) {
    const runtimeState = gameState.customModules![module.id];
    const key = JSON.stringify([options.eventId, rule.id]);
    if (runtimeState.runtime.processedEvents?.includes(key)) continue;
    if (rule.actions.length > remaining) { warnings.push('生命周期动作预算已耗尽'); break; }
    remaining -= rule.actions.length;
    // Rebuild resource inputs after each committed rule, retaining only event/clock context.
    const context = buildCustomModuleHostContext(gameState, { items: module.items,
      round: options.context?.game.round, time: options.context?.game.time });
    if (options.context) context.event = options.context.event;
    const operands = buildV2Operands(module, context);
    if (rule.when && !evaluateV2Condition(rule.when, runtimeState.values, operands, 0, 16)) continue;
    const own = rule.actions.filter((action): action is V2Action => !('amount' in action));
    const changed = executeCustomModuleActions(module, runtimeState, own, lifecycle, options.now ?? 0, 128, operands);
    if (changed.warnings.length) { warnings.push(...changed.warnings); continue; }
    const costs = new Map<string, GameplayCost>();
    const grants = new Map<string, { amount: number; max?: number }>();
    const effects: GameplayEffect[] = [];
    const initializedItems = new Set<string>();
    let invalid: string | undefined;
    for (const action of rule.actions.filter((action): action is CustomModuleHostAction => 'amount' in action)) {
      let path: string;
      let max: number | undefined;
      if ('itemId' in action) {
        const item = module.items[action.itemId];
        path = `玩家.物品栏.${item.name}.数量`;
        if (action.type === 'item.grant' && !gameState.玩家.物品栏[item.name] && !initializedItems.has(item.name)) {
          effects.push({ set: { path: `玩家.物品栏.${item.name}`, value: {
            数量: 0, 类型: item.category ?? '物品', 品质: '普通', 备注: item.description ?? '',
            ...(item.weight === undefined ? {} : { 重量: item.weight }),
          } } });
          initializedItems.add(item.name);
        }
      } else if ('resourceId' in action) {
        path = `玩家.生存资源.${action.resourceId}.数量`;
        const resource = gameState.玩家.生存资源?.[action.resourceId];
        if (!resource) { invalid = `生存资源不存在：${action.resourceId}`; break; }
        max = resource.最大值;
      } else path = '玩家.货币资源.主货币.数量';
      if (action.type.endsWith('.consume')) {
        const cost = costs.get(path) ?? { path, amount: 0 };
        cost.amount += action.amount;
        costs.set(path, cost);
      } else {
        const grant = grants.get(path) ?? { amount: 0, max };
        grant.amount += action.amount;
        grants.set(path, grant);
      }
    }
    if (invalid) { warnings.push(invalid); continue; }
    for (const [path, grant] of grants) {
      const current = Number(getGameplayPath(gameState, path) ?? 0);
      if (!Number.isFinite(current + grant.amount)) { invalid = `资源数量溢出：${path}`; break; }
      effects.push({ add: { path, delta: grant.amount, ...(grant.max === undefined ? {} : { max: grant.max }) } });
    }
    if (invalid) { warnings.push(invalid); continue; }
    changed.nextState.runtime.lastLifecycle = lifecycle;
    changed.nextState.runtime.lastRunAt = options.now ?? 0;
    changed.nextState.runtime.processedEvents = [...(runtimeState.runtime.processedEvents ?? []), key];
    effects.push({ set: { path: `customModules.${module.id}`, value: changed.nextState as unknown as GameplayValue } });
    const transaction = executeGameplayTransaction(gameState, {
      id: `custom:${module.id}:${key}`, moduleId: module.id, source: 'custom-module',
      costs: [...costs.values()], effects,
    }, { tick: gameState.simulationRuntime?.tick ?? 0, bestEffort: false });
    if (transaction.status !== 'applied') { warnings.push(transaction.reason ?? '模块规则执行失败'); continue; }
    gameState = transaction.state;
    applied += rule.actions.length;
  }
  return { gameState, applied, warnings };
}
