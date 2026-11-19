/**
 * 事件卡的展示与选项结算数据。
 * 卡片工作流仍由旧卡片引擎解释（读取旧中文路径），这里给它一份旧结构的只读视图，
 * 并把选项（含新的多效果、检定、后续事件）整理成界面与结算共用的模型。
 */
import type { GameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { FactRegistry } from '../core/facts';
import type { CardExecutionContext, CardWorkflowDefinition, DynamicChoiceConfig, StatModuleSchema } from '../modules/schema';
import { executeCardWorkflow } from '../modules/cardWorkflowEngine';
import { evaluateCondition } from '../core/conditions';
import type { ModifierQuery } from '../core/modifiers';
import { describeCardEffect, legacyChoiceEffectToOps, statPath } from './effects';
import type { CardOptionSpec } from './types';

export interface CardBlock {
  type: 'title' | 'text' | 'image' | 'dialog';
  title?: string;
  text?: string;
  imageUrl?: string;
  npcName?: string;
  npcEmotion?: string;
}

export interface CardOptionModel {
  index: number;
  label: string;
  hint: string;
  check?: { stat: string; label: string; dc: number; chance: number };
  available: boolean;
  reason?: string;
}

export interface CardPresentation {
  key: string;
  packId: string;
  eventId: string;
  title: string;
  blocks: CardBlock[];
  options: CardOptionModel[];
  specs: CardOptionSpec[];
  sharedEffects: Array<{ statId?: string; resourcePath?: string; flagPath?: string; delta?: number; value?: unknown }>;
  dynamic?: { instruction: string; countRange: [number, number]; fallbackChoices: CardOptionSpec[]; config: DynamicChoiceConfig };
}

/** 旧卡片引擎读取的视图：资源与经营按旧字段投影出来。 */
export function legacyReadView(state: GameState, facts: FactRegistry): Record<string, unknown> {
  const view = structuredClone(state) as unknown as Record<string, any>;
  if (state.resources) {
    view.玩家 ??= {};
    view.玩家.生存资源 = Object.fromEntries(Object.keys(state.resources.stocks).map(id => [id, facts.read(state, `player.resources.${id}.entry`) ?? { 数量: state.resources!.stocks[id] }]));
  }
  if (state.economy) {
    view.玩家 ??= {};
    view.玩家.经营资产 = facts.read(state, 'economy.legacy');
  }
  return view;
}

const DIMENSIONS = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const;

interface StatInfo { key: string; name?: string; range?: [number, number] }

/** 属性键或中文名 → 存档里的键（生存状态.<key>）、显示名与取值范围。 */
export function statInfo(world: WorldDef | undefined, stat: string): StatInfo {
  const id = stat.trim();
  const config = world?.modules?.find(module => module.moduleId === 'stat' && module.enabled)?.moduleConfig as StatModuleSchema | undefined;
  if (!config) return { key: id };
  const vital = (key: 'attrA' | 'attrB', field: string): StatInfo => {
    const entry = config[key];
    return { key: field, ...(entry?.name ? { name: entry.name } : {}), ...(entry?.max ? { range: [0, Number(entry.max)] as [number, number] } : {}) };
  };
  if (['attrA', 'hp', '血量'].includes(id) || config.attrA?.name === id) return vital('attrA', 'attrA');
  if (['attrB', 'stamina', '体力值'].includes(id) || config.attrB?.name === id) return vital('attrB', 'attrB');
  for (const key of DIMENSIONS) {
    const entry = config[key];
    if (entry && (key === id || entry.name === id)) return { key, name: entry.name, ...(Array.isArray(entry.range) ? { range: [Number(entry.range[0]), Number(entry.range[1])] as [number, number] } : {}) };
  }
  const special = config.special?.find(item => item.id === id || item.name === id);
  if (special) return { key: special.id, name: special.name, ...(Array.isArray(special.range) ? { range: [Number(special.range[0]), Number(special.range[1])] as [number, number] } : {}) };
  return { key: id };
}

export function statRange(world: WorldDef | undefined, stat: string): [number, number] | undefined {
  return statInfo(world, stat).range;
}

export function statLabel(world: WorldDef | undefined, stat: string): string | undefined {
  return statInfo(world, stat).name;
}

/** 检定自带的换算范围（用于 flags、声望等非属性变量）。 */
export function checkRange(check: { range?: unknown }): [number, number] | undefined {
  const range = check.range;
  if (!Array.isArray(range) || range.length !== 2) return undefined;
  const low = Number(range[0]);
  const high = Number(range[1]);
  return Number.isFinite(low) && Number.isFinite(high) && high > low ? [low, high] : undefined;
}

/** 属性值 → d20 修正（-5..+5），兼容 0-20、0-100 等不同量纲。 */
export function checkModifier(value: number, range?: [number, number]): number {
  if (!Number.isFinite(value)) return 0;
  const raw = range && range[1] > range[0]
    ? Math.floor(Math.min(1, Math.max(0, (value - range[0]) / (range[1] - range[0]))) * 10 - 5)
    : value <= 30 ? Math.floor((value - 10) / 2) : Math.floor((value - 50) / 10);
  return Math.max(-5, Math.min(5, raw));
}

/** 检定读取的数值：变量缺失时按范围下限（或 10）处理。 */
export function checkValue(raw: unknown, range?: [number, number]): number {
  const value = Number(raw);
  if (raw !== undefined && raw !== null && raw !== '' && Number.isFinite(value)) return value;
  return range ? range[0] : 10;
}

export function checkChance(dc: number, modifier: number): number {
  const needed = dc - modifier;
  return Math.max(0.05, Math.min(0.95, (21 - needed) / 20));
}

function parseOptions(raw: unknown): CardOptionSpec[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(item => item && typeof item === 'object' && typeof (item as CardOptionSpec).label === 'string') as CardOptionSpec[];
}

/** 选项效果的简短说明（「生命 -5，铜钱 +20」）。 */
export function optionHint(spec: CardOptionSpec, facts: FactRegistry, world: WorldDef | undefined): string {
  const name = (stat: string) => statLabel(world, stat);
  const parts = (spec.effects ?? []).map(effect => describeCardEffect(effect, facts, name)).filter(Boolean);
  if (spec.effect?.delta) {
    const delta = `${spec.effect.delta > 0 ? '+' : ''}${spec.effect.delta}`;
    if (spec.effect.resourcePath?.trim()) {
      const op = legacyChoiceEffectToOps(spec.effect, facts)[0];
      if (op?.op === 'add') parts.push(`${op.path === 'player.currency' ? '钱' : facts.label(op.path).replace(/^(物资|仓库)·/, '')} ${delta}`);
    } else if (spec.effect.statId?.trim()) {
      parts.push(`${name(spec.effect.statId) ?? spec.effect.statId} ${delta}`);
    }
  }
  return parts.join('，');
}

export function presentCard(input: {
  state: GameState;
  world?: WorldDef;
  facts: FactRegistry;
  modifiers: ModifierQuery;
  key: string;
  packId: string;
  eventId: string;
  name: string;
  workflow: CardWorkflowDefinition;
  turn: number;
}): CardPresentation {
  const view = legacyReadView(input.state, input.facts);
  const context: CardExecutionContext = { tick: input.turn, events: [], permissions: ['modify_world_state', 'add_card'], gameState: view, limits: { maxWallMs: 250 } };
  const result = executeCardWorkflow(input.workflow, context);
  const blocks = (result.renderData ?? []).filter(Boolean).map(item => ({ ...item })) as CardBlock[];
  const specs = parseOptions(result.choices);
  const options = specs.map((spec, index) => {
    let available = true;
    let reason: string | undefined;
    if (spec.requires && !evaluateCondition(spec.requires, { state: input.state, facts: input.facts })) {
      available = false;
      reason = spec.requiresText?.trim() || '条件不足';
    }
    let check: CardOptionModel['check'];
    if (spec.check?.stat && Number.isFinite(Number(spec.check.dc))) {
      const range = checkRange(spec.check) ?? statRange(input.world, spec.check.stat);
      const value = checkValue(input.facts.read(input.state, statPath(statInfo(input.world, spec.check.stat).key)), range);
      const modifier = checkModifier(value, range)
        + Math.round(input.modifiers.apply(`dice.check.${spec.check.stat}`, 0));
      check = {
        stat: spec.check.stat,
        label: spec.check.label || statLabel(input.world, spec.check.stat) || input.facts.label(statPath(spec.check.stat)).replace(/^属性·/, ''),
        dc: Number(spec.check.dc),
        chance: Math.round(checkChance(Number(spec.check.dc), modifier) * 100),
      };
    }
    return { index, label: spec.label, hint: optionHint(spec, input.facts, input.world), ...(check ? { check } : {}), available, ...(reason ? { reason } : {}) };
  });
  return {
    key: input.key,
    packId: input.packId,
    eventId: input.eventId,
    title: input.workflow.name || input.name,
    blocks,
    options,
    specs,
    sharedEffects: (result.pendingEffects ?? []).map(effect => ({ ...effect })),
    ...(result.dynamicConfig ? { dynamic: {
      instruction: result.dynamicConfig.instruction,
      countRange: result.dynamicConfig.countRange ?? [2, 4],
      fallbackChoices: parseOptions(result.dynamicConfig.fallbackChoices),
      config: structuredClone(result.dynamicConfig),
    } } : {}),
  };
}
