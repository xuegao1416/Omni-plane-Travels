/**
 * 物资面板的界面数据。界面只读这里，不再自己合并配置与存档。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';
import type { ResourceKind, ResourcesConfig } from './config';
import { activeResourceDefs, allRecipes, describeStatus, resourceCapacity, resourceDef, statusDef } from './module';
import { evaluateCondition } from '../../core/conditions';

export type ResourceTone = 'ok' | 'scarce' | 'low' | 'empty';

export interface ResourceRowModel {
  id: string;
  name: string;
  symbol: string;
  kind: ResourceKind;
  kindLabel: string;
  amount: number;
  max: number;
  fill: number;
  upkeep: number;
  upkeepLabel?: string;
  /** 按当前消耗还能撑几个周期。 */
  remainingLabel?: string;
  tone: ResourceTone;
  description: string;
  gatherText?: string;
  usageText?: string;
  gather?: { amount: number; minutes: number; stamina: number; blocked?: string };
}

export interface StatusModel {
  id: string;
  name: string;
  effect: string;
  description: string;
  severity: 'minor' | 'major' | 'critical';
}

export interface RecipeInputModel {
  key: string;
  label: string;
  need: number;
  have: number;
  enough: boolean;
}

export interface RecipeModel {
  id: string;
  name: string;
  description: string;
  inputs: RecipeInputModel[];
  outputs: Array<{ key: string; label: string; amount: number }>;
  minutes: number;
  stamina: number;
  tool?: { name: string; owned: boolean };
  locked: boolean;
  unlockHint?: string;
  canUnlock: boolean;
  craftable: boolean;
  blocked?: string;
  custom: boolean;
}

export interface LedgerModel {
  key: string;
  turn: number;
  reason: string;
  changes: Array<{ id: string; label: string; symbol: string; delta: number; after: number }>;
}

export interface ResourcesViewModel {
  title: string;
  description: string;
  rulesText: string;
  cycleLabel: string;
  stamina: number;
  worldTime: string;
  resources: ResourceRowModel[];
  statuses: StatusModel[];
  recipes: RecipeModel[];
  ledger: LedgerModel[];
  evolution: Array<{ id: string; done: boolean; trigger: string; result: string; hint?: string }>;
  alerts: string[];
}

const KIND_LABELS: Record<ResourceKind, string> = { vital: '必需品', consumable: '消耗品', material: '材料', goods: '商品' };

function cycleWord(config: ResourcesConfig): { per: string; unit: string } {
  if (config.cycle === 'turn') return { per: '每回合', unit: '回合' };
  if (config.cycle === 'hour') return { per: '每小时', unit: '小时' };
  return { per: '每日', unit: '天' };
}

export function buildResourcesViewModel(stateInput: GameState, world: WorldDef | undefined, title?: string): ResourcesViewModel | null {
  const host = createGameplayHost(world, stateInput);
  const holder = host.configOf<{ config: ResourcesConfig }>('resources');
  if (!holder) return null;
  const config = holder.config;
  const state = host.prepare(stateInput);
  const stamina = Number(host.facts.read(state, 'player.stamina') ?? 0);
  const words = cycleWord(config);
  const modifiers = host.modifierQuery(state);
  const alerts: string[] = [];

  const resources: ResourceRowModel[] = activeResourceDefs(config, state).map(def => {
    const amount = Number(state.resources?.stocks?.[def.id] ?? 0);
    const max = resourceCapacity(config, state, def.id);
    const upkeep = Math.max(0, modifiers.apply(`resources.upkeep.${def.id}`, def.upkeep));
    const remaining = upkeep > 0 ? Math.floor(amount / upkeep) : undefined;
    const tone: ResourceTone = amount <= 0 && def.kind === 'vital' ? 'empty' : def.lowAt > 0 && amount <= def.lowAt ? 'low' : def.scarce ? 'scarce' : 'ok';
    if (tone === 'empty') alerts.push(`${def.name}已经用尽`);
    else if (remaining !== undefined && remaining <= 1) alerts.push(`${def.name}只够 ${remaining} ${words.unit}`);
    const gatherCost = def.gather ? Math.round(modifiers.apply(`resources.gatherCost.${def.id}`, def.gather.stamina)) : 0;
    return {
      id: def.id,
      name: def.name,
      symbol: def.symbol,
      kind: def.kind,
      kindLabel: KIND_LABELS[def.kind],
      amount,
      max,
      fill: max > 0 ? Math.max(0, Math.min(1, amount / max)) : 0,
      upkeep,
      upkeepLabel: upkeep > 0 ? `${words.per} -${Math.round(upkeep * 100) / 100}` : undefined,
      remainingLabel: remaining !== undefined ? (amount <= 0 ? '已耗尽' : `约 ${remaining} ${words.unit}`) : undefined,
      tone,
      description: def.description,
      gatherText: def.gatherText,
      usageText: def.usageText,
      gather: def.gather ? {
        amount: Math.max(1, Math.round(modifiers.apply(`resources.gather.${def.id}`, def.gather.amount))),
        minutes: def.gather.minutes,
        stamina: gatherCost,
        blocked: amount >= max ? '已满' : gatherCost > stamina ? '体力不足' : undefined,
      } : undefined,
    };
  });

  const statuses: StatusModel[] = Object.keys(state.resources?.statuses ?? {}).map(id => {
    const def = statusDef(config, id);
    return { id, name: def?.name ?? id, effect: def ? describeStatus(def) : '', description: def?.description ?? '', severity: def?.severity ?? 'minor' };
  });

  const label = (key: string) => key.startsWith('item:') ? key.slice(5) : resourceDef(config, state, key)?.name ?? key;
  const have = (key: string) => key.startsWith('item:') ? Number(state.玩家.物品栏?.[key.slice(5)]?.数量 ?? 0) : Number(state.resources?.stocks?.[key] ?? 0);
  const unlocked = new Set(state.resources?.unlockedRecipes ?? []);
  const recipes: RecipeModel[] = allRecipes(config, state).map(recipe => {
    const inputs = Object.entries(recipe.inputs).map(([key, need]) => ({ key, label: label(key), need, have: have(key), enough: have(key) >= need }));
    const locked = Boolean(recipe.unlockCondition || recipe.unlockCost) && !unlocked.has(recipe.id);
    const canUnlock = locked && (!recipe.unlockCondition || evaluateCondition(recipe.unlockCondition, { state, facts: host.facts }))
      && Object.entries(recipe.unlockCost ?? {}).every(([key, amount]) => (key.startsWith('fact:') ? Number(host.facts.read(state, key.slice(5)) ?? 0) : have(key)) >= amount);
    const toolOwned = recipe.tool ? Number(state.玩家.物品栏?.[recipe.tool]?.数量 ?? 0) > 0 : true;
    const outputs = Object.entries(recipe.outputs).map(([key, amount]) => ({ key, label: label(key), amount }));
    const full = outputs.length > 0 && outputs.every(output => !output.key.startsWith('item:')
      && have(output.key) - Number(recipe.inputs[output.key] ?? 0) >= resourceCapacity(config, state, output.key));
    const blocked = locked ? '未解锁' : !toolOwned ? `缺少工具「${recipe.tool}」` : inputs.some(input => !input.enough) ? '材料不足'
      : recipe.stamina > stamina ? '体力不足' : full ? '产物已满' : undefined;
    return {
      id: recipe.id,
      name: recipe.name,
      description: recipe.description,
      inputs,
      outputs,
      minutes: recipe.minutes,
      stamina: recipe.stamina,
      ...(recipe.tool ? { tool: { name: recipe.tool, owned: toolOwned } } : {}),
      locked,
      unlockHint: locked
        ? [recipe.unlockCondition ? '满足前置条件' : '', ...Object.entries(recipe.unlockCost ?? {}).map(([key, amount]) => `${label(key.replace(/^fact:/, ''))}×${amount}`)].filter(Boolean).join('、')
        : undefined,
      canUnlock,
      craftable: !blocked,
      blocked,
      custom: recipe.custom === true,
    };
  });

  const ledger: LedgerModel[] = [...(state.resources?.ledger ?? [])].reverse().slice(0, 12).map((entry, index) => ({
    key: `${entry.turn}:${entry.minute}:${index}`,
    turn: entry.turn,
    reason: entry.reason,
    changes: entry.changes.map(change => {
      const def = resourceDef(config, state, change.id);
      return { id: change.id, label: def?.name ?? change.id, symbol: def?.symbol ?? '', delta: change.delta, after: change.after };
    }),
  }));

  const evolved = new Set(state.resources?.evolved ?? []);
  const evolution = config.evolution.map(step => ({
    id: step.id,
    done: evolved.has(step.id),
    trigger: [
      step.afterDays !== undefined ? `第 ${step.afterDays} 天` : '',
      step.afterTurns !== undefined ? `第 ${step.afterTurns} 回合` : '',
      step.keywords.length ? `剧情提到「${step.keywords.slice(0, 3).join('」「')}」` : '',
    ].filter(Boolean).join(' 或 ') || '剧情推进',
    result: [...step.add.map(item => `出现${item.name}`), ...step.remove.map(id => `${label(id)}消失`)].join('，') || '局势变化',
    hint: step.hint,
  }));

  for (const status of statuses) if (status.severity === 'critical') alerts.unshift(`${status.name}：${status.effect}`);

  return {
    title: title || '物资',
    description: config.description,
    rulesText: config.rulesText,
    cycleLabel: `${words.per}结算`,
    stamina,
    worldTime: state.世界?.时间系统?.当前时间 ?? '',
    resources,
    statuses,
    recipes,
    ledger,
    evolution,
    alerts: [...new Set(alerts)].slice(0, 4),
  };
}
