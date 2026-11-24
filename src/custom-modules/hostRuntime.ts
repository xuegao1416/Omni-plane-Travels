import type { GameState } from '../schema/variables';
import { getGameplayPath, stateDiffOps } from '../core/state';
import { commitTransaction } from '../core/transaction';
import type { Op } from '../core/ops';
import type { GameplayCost } from '../gameplay/types';
import { executeCustomModuleActions } from './actionExecutor';
import { buildCustomModuleHostContext, type CustomModuleHostContext } from './context';
import { buildV2Operands, evaluateV2Condition, type CustomModuleLifecycle } from './runtime';
import type { CustomGameplayModuleDefinition, CustomModuleHostAction, V2Action, ViewComponent } from './schema';
import { createInitialCustomModuleState } from './stateStore';
import { validateCustomGameplayModule } from './validator';

export interface CustomModuleGameExecutionOptions {
  eventId: string;
  now?: number;
  context?: CustomModuleHostContext;
  /** Internal fixed-rule entry; ordinary lifecycle calls leave this absent. */
  ruleId?: string;
}
export interface CustomModuleGameExecutionResult { gameState: GameState; applied: number; warnings: string[] }

/** 视图里所有按钮（含卡片上的按钮）的事件名。 */
export function customModuleButtonEvents(components: readonly ViewComponent[] | undefined, out = new Set<string>()): Set<string> {
  for (const component of components ?? []) {
    if (component.type === 'button') out.add(component.event);
    if (component.type === 'card') for (const action of component.actions ?? []) out.add(action.event);
    if ('children' in component && Array.isArray(component.children)) customModuleButtonEvents(component.children, out);
  }
  return out;
}

/**
 * 点按钮时执行哪些规则：id 和视图里某个按钮同名的规则只在点这个按钮时执行；
 * 其余规则每次点按钮都执行（旧行为，作者可用 event.button.event 条件区分）。
 */
export function rulesForButton<R extends { id: string }>(rules: readonly R[], view: { components: readonly ViewComponent[] } | undefined, event: string | undefined): R[] {
  const buttons = customModuleButtonEvents(view?.components);
  return rules.filter(rule => !buttons.has(rule.id) || rule.id === event);
}

/** 宿主能力在这里落成效果；模型给出的路径不会直接进入事务。 */
export function executeCustomModuleInGame(
  source: GameState, definition: CustomGameplayModuleDefinition, lifecycle: CustomModuleLifecycle,
  options: CustomModuleGameExecutionOptions,
): CustomModuleGameExecutionResult {
  let gameState: GameState = JSON.parse(JSON.stringify(source));
  const validation = validateCustomGameplayModule(definition, 'internal');
  if (!validation.valid || !validation.normalized) return { gameState, applied: 0, warnings: validation.errors.map(e => `${e.code}: ${e.message}`) };
  const module = validation.normalized;
  if (!options.eventId?.trim()) return { gameState, applied: 0, warnings: ['缺少稳定游戏事件 ID'] };
  if (options.ruleId && !gameState.customModules?.[module.id]) return { gameState: source, applied: 0, warnings: ['指定规则模块尚未安装'] };
  gameState.customModules ??= {};
  gameState.customModules[module.id] ??= createInitialCustomModuleState(module);
  const initial = gameState.customModules[module.id];
  if (!initial.enabled) return { gameState, applied: 0, warnings: options.ruleId ? ['指定规则模块未启用'] : [] };
  // Version changes must pass the explicit save-application migration gate.
  if (initial.moduleVersion !== module.version || (initial.definition && JSON.stringify(initial.definition) !== JSON.stringify(module))) {
    return { gameState, applied: 0, warnings: ['存档模块定义与请求版本不一致，请先预览并应用更新'] };
  }
  const warnings: string[] = [];
  let applied = 0;
  let remaining = 128;
  const rules = options.ruleId ? module.logic[lifecycle].filter(rule => rule.id === options.ruleId)
    : lifecycle === 'onButton' ? rulesForButton(module.logic.onButton, module.view, options.context?.event.button?.event)
    : module.logic[lifecycle];
  if (options.ruleId && rules.length !== 1) return { gameState: source, applied: 0, warnings: ['指定规则不存在'] };
  for (const rule of rules) {
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
    if (rule.when && !evaluateV2Condition(rule.when, runtimeState.values, operands, 0, 16)) {
      if (options.ruleId) warnings.push('指定规则前置条件不满足');
      continue;
    }
    const own = rule.actions.filter((action): action is V2Action => !('amount' in action));
    const changed = executeCustomModuleActions(module, runtimeState, own, lifecycle, options.now ?? 0, 128, operands);
    if (changed.warnings.length) { warnings.push(...changed.warnings); continue; }
    const costs = new Map<string, GameplayCost>();
    const grants = new Map<string, { amount: number; max?: number }>();
    const effects: Op[] = [];
    const initializedItems = new Set<string>();
    let invalid: string | undefined;
    for (const action of rule.actions.filter((action): action is CustomModuleHostAction => 'amount' in action)) {
      let path: string;
      let max: number | undefined;
      if ('itemId' in action) {
        const item = module.items[action.itemId];
        path = `玩家.物品栏.${item.name}.数量`;
        if (action.type === 'item.grant' && !gameState.玩家.物品栏[item.name] && !initializedItems.has(item.name)) {
          effects.push({ op: 'set', path: `玩家.物品栏.${item.name}`, value: {
            数量: 0, 类型: item.category ?? '物品', 品质: '普通', 备注: item.description ?? '',
            ...(item.weight === undefined ? {} : { 重量: item.weight }),
          } });
          initializedItems.add(item.name);
        }
      } else if ('resourceId' in action) {
        if (gameState.resources) {
          // 资源模块：库存在 resources.stocks，上限在 resources.capacity。
          const ledger = gameState.resources;
          if (!(action.resourceId in ledger.stocks) || ledger.retired?.includes(action.resourceId)) { invalid = `生存资源不存在：${action.resourceId}`; break; }
          path = `resources.stocks.${action.resourceId}`;
          max = ledger.capacity?.[action.resourceId];
        } else {
          path = `玩家.生存资源.${action.resourceId}.数量`;
          const resource = gameState.玩家.生存资源?.[action.resourceId];
          if (!resource) { invalid = `生存资源不存在：${action.resourceId}`; break; }
          max = resource.最大值;
        }
      } else path = '玩家.货币资源.主货币.数量';
      if (action.type.endsWith('.consume')) {
        const label = 'itemId' in action ? module.items[action.itemId]?.name
          : 'resourceId' in action ? action.resourceId
          : gameState.玩家.货币资源?.主货币?.名称 || '钱';
        const cost = costs.get(path) ?? { path, amount: 0, ...(label ? { label } : {}) };
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
      effects.push({ op: 'add', path, value: grant.amount, ...(grant.max === undefined ? {} : { max: grant.max }) });
    }
    if (invalid) { warnings.push(invalid); continue; }
    changed.nextState.runtime.lastLifecycle = lifecycle;
    changed.nextState.runtime.lastRunAt = options.now ?? 0;
    changed.nextState.runtime.processedEvents = [...(runtimeState.runtime.processedEvents ?? []), key];
    // Log only mutable differences. Copying a fixed definition into every before/
    // after entry makes long director histories grow by megabytes per turn.
    const beforeModule: Pick<GameState, 'customModules'> = { customModules: { [module.id]: runtimeState } };
    const afterModule: Pick<GameState, 'customModules'> = { customModules: { [module.id]: changed.nextState } };
    effects.push(...stateDiffOps(beforeModule, afterModule));
    const transaction = commitTransaction(gameState, {
      id: `custom:${module.id}:${key}`, moduleId: module.id, source: 'custom-module',
      costs: [...costs.values()], ops: effects,
    });
    if (transaction.status !== 'applied') { warnings.push(transaction.reason ?? '模块规则执行失败'); continue; }
    gameState = transaction.state;
    applied += rule.actions.length;
  }
  return { gameState, applied, warnings };
}

/** A fixed rule is resolved solely from the installed immutable definition. */
export function executeCustomModuleRuleInGame(
  source: GameState, moduleId: string, moduleVersion: string, lifecycle: CustomModuleLifecycle,
  ruleId: string, options: Omit<CustomModuleGameExecutionOptions, 'ruleId' | 'context'>,
): CustomModuleGameExecutionResult {
  const installed = source.customModules?.[moduleId];
  if (!installed?.definition || installed.moduleVersion !== moduleVersion || installed.definition.version !== moduleVersion || installed.definition.id !== moduleId) {
    return { gameState: source, applied: 0, warnings: ['指定规则模块或版本不匹配'] };
  }
  if (!Object.hasOwn(installed.definition.logic, lifecycle) || !ruleId?.trim()) return { gameState: source, applied: 0, warnings: ['指定规则生命周期无效'] };
  const context = buildCustomModuleHostContext(source, { items: installed.definition.items, event: { type: 'button', moduleId, event: ruleId } });
  return executeCustomModuleInGame(source, installed.definition, lifecycle, { ...options, context, ruleId });
}
