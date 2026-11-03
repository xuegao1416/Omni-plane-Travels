import type { GameState, NPCData } from '../schema/variables';
import type { DirectorState, PlotPlan } from './types';
import type { DirectorAuthoredEffect } from './authoredEffectsTypes';
import type { StateFieldDefinition } from '../custom-modules/schema';
import { executeCustomModuleRuleInGame } from '../custom-modules/hostRuntime';
import { validateCustomGameplayModule } from '../custom-modules/validator';
import { createGameplayStateDiff, executeGameplayTransaction, getGameplayPath, setGameplayPath } from '../gameplay/kernel';
import { isNpcDead } from '../utils/npcHelpers';

export interface AuthoredEffectsOptions { eventId: string; now?: number }
export interface AuthoredEffectsResult { state: GameState; success: boolean; reason?: string; summary: string[] }
type ReceiptState = GameState & { authoredEffectReceipts?: Record<string, { planId: string; effectSignature: string }> };
const safe = (value: string) => typeof value === 'string' && !!value.trim() && !value.includes('.') && !['__proto__', 'constructor', 'prototype'].includes(value);
const text = (value: string) => typeof value === 'string' && !!value.trim() && value.length <= 500;

function declaredField(state: Record<string, StateFieldDefinition>, path: string): StateFieldDefinition | undefined {
  const parts = path.split('.');
  if (!parts.every(safe)) return;
  let fields = state;
  let field: StateFieldDefinition | undefined;
  for (let i = 0; i < parts.length; i++) {
    if (!Object.hasOwn(fields, parts[i])) return;
    field = fields[parts[i]];
    if (i < parts.length - 1) { if (field.type !== 'object') return; fields = field.fields; }
  }
  return field;
}

function quantity(npc: NPCData, name: string): number {
  const items = npc.物品列表;
  if (Array.isArray(items)) return items.filter(item => item === name).length;
  const value = items?.[name];
  if (value === undefined) return 0;
  if (value && typeof value === 'object' && '数量' in value && typeof value.数量 === 'number') return value.数量;
  return NaN;
}
function projectNpcItem(npc: NPCData, name: string, count: number) {
  if (Array.isArray(npc.物品列表)) npc.物品列表 = [...npc.物品列表.filter(item => item !== name), ...(count ? [name] : [])];
  else { npc.物品列表 ??= {}; if (count) npc.物品列表[name] = { 数量: count }; else delete npc.物品列表[name]; }
}

/** Previews every fixed author consequence in one isolated draft; the caller owns commit. */
export function executeAuthoredEffects(source: GameState, plan: PlotPlan, director: DirectorState, options: AuthoredEffectsOptions): AuthoredEffectsResult {
  const fail = (reason: string): AuthoredEffectsResult => ({ state: source, success: false, reason, summary: [] });
  const effects = (plan as PlotPlan & { authorEffects?: DirectorAuthoredEffect[] }).authorEffects ?? [];
  if (!effects.length) return { state: source, success: true, summary: [] };
  const binding = director.sourceBinding;
  if (!binding || !['authored', 'novel'].includes(plan.source) || binding.type !== plan.source || !plan.sourceRef ||
      plan.id !== `source:${binding.definitionId ?? binding.sourceId}:${binding.version}:${plan.sourceRef}` ||
      JSON.stringify(director.plans[plan.id]) !== JSON.stringify(plan)) return fail('untrusted_authored_plan');
  if (!text(options.eventId)) return fail('invalid_authored_event_id');
  if (effects.length > 128) return fail('authored_effect_budget_exceeded');
  const key = encodeURIComponent(JSON.stringify([plan.id, options.eventId])).replace(/\./g, '%2E');
  const signature = JSON.stringify(effects);
  const existing = (source as ReceiptState).authoredEffectReceipts?.[key];
  if (existing) return existing.planId === plan.id && existing.effectSignature === signature ? { state: source, success: true, summary: [] } : fail('authored_event_conflict');
  let draft: ReceiptState = structuredClone(source);
  const summary: string[] = [];
  let actionBudget = 128;
  const resolve = (id: string) => binding.roleBinding?.[id] ?? id;
  // These declared environmental holders have no player/NPC inventory projection.
  const inventoryOwner = (id: string) => ['none', 'ground', 'library'].includes(id) ? 'none' : resolve(id);
  const validNpc = (id: string) => safe(id) && id !== 'player' && id !== draft.playerIdentity?.actorId && Object.hasOwn(draft.人物档案, id) && plan.participants.includes(id);
  const activeCombat = (id: string) => draft.v3?.combatSession?.status === 'active' && draft.v3.combatSession.participants.some(unit => unit.id === id || unit.stateBinding?.hpPath === `人物档案.${id}.生存状态.血量`);
  const transfers: Array<Extract<DirectorAuthoredEffect, { type: 'uniqueItem.transfer' }>> = [];
  for (const effect of effects) {
    const actionCount = effect.type === 'module.rule'
      ? draft.customModules?.[effect.moduleId]?.definition?.logic[effect.lifecycle]?.find(rule => rule.id === effect.ruleId)?.actions.length ?? 1
      : 1;
    actionBudget -= actionCount;
    if (actionBudget < 0) return fail('authored_effect_budget_exceeded');
    if (effect.type === 'npc.move' || effect.type === 'npc.die') {
      // The binder already resolved NPC actor IDs; a second lookup can target another NPC.
      const id = effect.actorId;
      if (!validNpc(id)) return fail('authored_actor_missing');
      const npc = draft.人物档案[id];
      if (npc.人物分类 !== '离场' || isNpcDead(npc) || activeCombat(id)) return fail('authored_actor_present_dead_or_in_combat');
      if (effect.type === 'npc.move') {
        if (!text(effect.location)) return fail('invalid_authored_location');
        npc.个人信息.当前位置 = effect.location;
      } else {
        if (effect.status !== undefined && (!text(effect.status) || /复活/.test(effect.status))) return fail('invalid_authored_death_status');
        npc.生存状态 ??= { 血量: 100, 体力值: 100 };
        npc.生存状态.血量 = 0;
        npc.战斗状态 = '死亡';
        npc.个人信息.当前状态 = effect.status ?? '死亡';
      }
    } else if (effect.type === 'module.rule') {
      if (!safe(effect.moduleId) || !safe(effect.ruleId)) return fail('invalid_authored_rule');
      const result = executeCustomModuleRuleInGame(draft, effect.moduleId, effect.moduleVersion, effect.lifecycle, effect.ruleId, { eventId: `authored:${key}`, now: options.now });
      if (result.warnings.length) return fail(`authored_module_rule_failed:${result.warnings.join(';')}`);
      draft = result.gameState;
    } else if (effect.type === 'uniqueItem.transfer') {
      if (!safe(effect.moduleId) || !safe(effect.itemId)) return fail('invalid_unique_item');
      const installed = draft.customModules?.[effect.moduleId];
      const module = installed?.definition;
      if (!installed?.enabled || !module || installed.moduleVersion !== effect.moduleVersion || module.version !== effect.moduleVersion || module.id !== effect.moduleId) return fail('unique_item_module_version_mismatch');
      const validation = validateCustomGameplayModule(module, 'internal');
      if (!validation.valid || !validation.normalized || JSON.stringify(validation.normalized) !== JSON.stringify(module)) return fail('unique_item_module_invalid');
      const field = declaredField(module.state, effect.ownerField);
      const item = Object.hasOwn(module.items, effect.itemId) ? module.items[effect.itemId] : undefined;
      const oldOwner = inventoryOwner(effect.expectedOwner), newOwner = inventoryOwner(effect.newOwner);
      if (!field || field.type !== 'enum' || !field.values.includes(effect.expectedOwner) || !field.values.includes(effect.newOwner) || !item || !safe(item.name)) return fail('unique_item_undeclared_owner_or_item');
      if (getGameplayPath(installed.values, effect.ownerField) !== effect.expectedOwner) return fail('unique_item_owner_conflict');
      for (const owner of [oldOwner, newOwner]) if (owner !== 'none' && owner !== 'player' && (!safe(owner) || !Object.hasOwn(draft.人物档案, owner))) return fail('unique_item_owner_missing');
      const amounts = [['player', draft.玩家.物品栏[item.name]?.数量 ?? 0], ...Object.entries(draft.人物档案).map(([id, npc]) => [id, quantity(npc, item.name)])] as Array<[string, number]>;
      if (amounts.some(([owner, amount]) => !Number.isInteger(amount) || amount < 0 || amount > 1 || (amount > 0 && owner !== oldOwner)) || (oldOwner !== 'none' && amounts.find(([owner]) => owner === oldOwner)?.[1] !== 1)) return fail('unique_item_inventory_conflict');
      if (oldOwner === 'player') delete draft.玩家.物品栏[item.name];
      else if (oldOwner !== 'none') projectNpcItem(draft.人物档案[oldOwner], item.name, 0);
      if (newOwner === 'player') draft.玩家.物品栏[item.name] = { 数量: 1, 类型: item.category ?? '物品', 品质: '普通', 备注: item.description ?? '', ...(item.weight === undefined ? {} : { 重量: item.weight }) };
      else if (newOwner !== 'none') projectNpcItem(draft.人物档案[newOwner], item.name, 1);
      setGameplayPath(installed.values, effect.ownerField, effect.newOwner, false);
      transfers.push(effect);
    } else return fail('unsupported_authored_effect');
    summary.push(effect.type);
  }
  // Later module rules in the same group must not duplicate a transferred unique item.
  for (const effect of transfers) {
    const installed = draft.customModules![effect.moduleId], item = installed.definition!.items[effect.itemId];
    const owner = inventoryOwner(String(getGameplayPath(installed.values, effect.ownerField)));
    const quantities: Array<[string, number]> = [['player', draft.玩家.物品栏[item.name]?.数量 ?? 0], ...Object.entries(draft.人物档案).map(([id, npc]): [string, number] => [id, quantity(npc, item.name)])];
    if (quantities.some(([id, amount]) => amount !== (owner === id ? 1 : 0))) return fail('unique_item_inventory_conflict');
  }
  draft.authoredEffectReceipts ??= {};
  draft.authoredEffectReceipts[key] = { planId: plan.id, effectSignature: signature };
  // Nested rules only preview costs and actions; publish one aggregate kernel transaction.
  if (source.gameplay) draft.gameplay = structuredClone(source.gameplay); else delete draft.gameplay;
  const transaction = executeGameplayTransaction(source, { id: `authored:${key}`, source: 'director:authored', label: plan.intent, effects: createGameplayStateDiff(source, draft), events: [{ type: 'director.authored.accepted', payload: { planId: plan.id, eventId: options.eventId } }] }, { tick: draft.simulationRuntime?.tick ?? 0, bestEffort: false });
  if (transaction.status !== 'applied') return fail('authored_transaction_rejected');
  return { state: transaction.state, success: true, summary };
}
