/**
 * 资源模块配置（世界里的 `survival` 模块）。
 *
 * 旧配置（v1）只有资源列表和一段「每天消耗什么」的文字，运行时靠关键词猜消耗量。
 * 这里在加载世界时一次性规范成 v2：每种资源有明确的类别、每日消耗、告急线、采集参数，
 * 必需品见底时有对应的匮乏状态。猜测只在规范化时做一次，结果显示在界面上，作者可以改。
 */
import type { SurvivalModuleSchema, SurvivalRecipe, SurvivalResource, ResourceEvolutionStep } from '../../modules/schema';
import type { GameplayCondition } from '../../gameplay/types';
import { gameplayConditionToCore } from '../../core/legacy';
import { periodFromCycleName } from '../../core/cycles';
import type { CoreCondition } from '../../core/conditions';

export type ResourceKind = 'vital' | 'consumable' | 'material' | 'goods';

export interface GatherSpec {
  amount: number;
  minutes: number;
  stamina: number;
}

export interface ResourceDef {
  id: string;
  name: string;
  symbol: string;
  kind: ResourceKind;
  initial: number;
  max: number;
  scarce: boolean;
  description: string;
  /** 每日消耗量；0 表示不消耗。 */
  upkeep: number;
  /** 数量 ≤ lowAt 时告急。 */
  lowAt: number;
  /** 每日腐坏比例 0..1。 */
  spoilage: number;
  /** 见底时进入的状态。 */
  depletedStatus?: string;
  gather?: GatherSpec;
  gatherText?: string;
  usageText?: string;
  /** 交易参考价（经营模块读取）。 */
  value?: number;
}

export interface RecipeDef {
  id: string;
  name: string;
  description: string;
  /** 资源 id 或 `item:物品名`。 */
  inputs: Record<string, number>;
  outputs: Record<string, number>;
  minutes: number;
  stamina: number;
  /** 需要持有的工具（物品名），不消耗。 */
  tool?: string;
  unlockCondition?: CoreCondition;
  unlockCost?: Record<string, number>;
  /** 玩家或 AI 在游戏中创建的配方。 */
  custom?: boolean;
}

export interface StatusModifierSpec {
  target: string;
  mode: 'flat' | 'mult';
  value: number;
}

export interface StatusDef {
  id: string;
  name: string;
  description: string;
  severity: 'minor' | 'major' | 'critical';
  perDay?: { hp?: number; stamina?: number };
  modifiers?: StatusModifierSpec[];
  /** 有时效的状态持续天数；不填表示由条件维持。 */
  days?: number;
}

export interface EvolutionStepDef {
  id: string;
  afterDays?: number;
  afterTurns?: number;
  keywords: string[];
  add: ResourceDef[];
  remove: string[];
  hint?: string;
}

export interface ResourcesConfig {
  version: 2;
  description: string;
  rulesText: string;
  /** 消耗结算周期：按天（默认）、按小时或按回合。 */
  cycle: 'day' | 'hour' | 'turn';
  resources: ResourceDef[];
  recipes: RecipeDef[];
  statuses: StatusDef[];
  evolution: EvolutionStepDef[];
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value.trim() : fallback;
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback;
}

function safeId(value: unknown, fallback: string): string {
  const raw = text(value) || fallback;
  return raw.replace(/[.\s/\\]+/g, '_').slice(0, 48) || fallback;
}

/** 从「每人每天消耗1淡水 + 1食物」这类文字里读出消耗量。 */
export function parseUpkeepText(rules: string, resources: Array<{ id: string; name: string }>): Record<string, number> {
  const out: Record<string, number> = {};
  if (!rules) return out;
  for (const resource of resources) {
    const names = [resource.name, resource.id].filter(Boolean);
    for (const name of names) {
      const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const before = new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:单位|份|个|升|斤|块|口)?\\s*${escaped}`).exec(rules);
      const after = new RegExp(`${escaped}\\s*[×x*]?\\s*(\\d+(?:\\.\\d+)?)`).exec(rules);
      const match = before ?? after;
      if (match && /消耗|每天|每日|吃|喝|需要/.test(rules)) {
        out[resource.id] = Number(match[1]);
        break;
      }
    }
  }
  return out;
}

function upkeepFromDescription(resource: SurvivalResource): number {
  const source = `${resource.usage ?? ''} ${resource.description ?? ''}`;
  const match = /(?:每天|每日)[^。；;,，]*?消耗\s*(\d+(?:\.\d+)?)/.exec(source) ?? /消耗\s*(\d+(?:\.\d+)?)\s*(?:单位)?[^。；;]*?(?:每天|每日)/.exec(source);
  return match ? Number(match[1]) : 0;
}

const DEPRIVATION: Record<string, { name: string; hp: number; stamina: number; dice: number }> = {
  water: { name: '缺水', hp: -15, stamina: -20, dice: -2 },
  food: { name: '饥饿', hp: -8, stamina: -15, dice: -1 },
};

function deprivationStatus(resource: ResourceDef): StatusDef {
  const known = DEPRIVATION[resource.id] ?? (/水|饮/.test(resource.name) ? DEPRIVATION.water : /食|粮|饭|肉/.test(resource.name) ? DEPRIVATION.food : undefined);
  return {
    id: `deprived:${resource.id}`,
    name: known?.name ?? `${resource.name}匮乏`,
    description: `${resource.name}已经用尽，补充之前每天都会付出代价。`,
    severity: known ? 'critical' : 'major',
    perDay: { hp: known?.hp ?? -5, stamina: known?.stamina ?? -10 },
    modifiers: [{ target: 'dice.check', mode: 'flat', value: known?.dice ?? -1 }],
  };
}

function normalizeResource(raw: SurvivalResource & Record<string, unknown>, upkeepHints: Record<string, number>, index: number): ResourceDef {
  const id = safeId(raw.id, `resource_${index + 1}`);
  const max = Math.max(1, num(raw.max, 10, 1, 1_000_000));
  const explicitUpkeep = raw.upkeep === undefined ? undefined : num(raw.upkeep, 0, 0, max);
  const upkeep = explicitUpkeep ?? upkeepHints[id] ?? upkeepFromDescription(raw);
  const kind: ResourceKind = (['vital', 'consumable', 'material', 'goods'] as const).includes(raw.kind as ResourceKind)
    ? raw.kind as ResourceKind
    : upkeep > 0 ? 'vital' : 'material';
  const gatherDisabled = raw.gather === false || kind === 'goods';
  const gatherSpec = raw.gather && typeof raw.gather === 'object' ? raw.gather as Partial<GatherSpec> : {};
  const def: ResourceDef = {
    id,
    name: text(raw.name, id) || id,
    symbol: text(raw.symbol),
    kind,
    initial: num(raw.amount ?? raw.initial, 0, 0, max),
    max,
    scarce: raw.scarce === true,
    description: text(raw.description),
    upkeep,
    lowAt: num(raw.lowAt, upkeep > 0 ? Math.max(1, upkeep * 2) : 0, 0, max),
    spoilage: num(raw.spoilage, 0, 0, 1),
    gather: gatherDisabled ? undefined : {
      amount: Math.max(1, Math.trunc(num(gatherSpec.amount ?? raw.gatherAmount, 1, 1, 1000))),
      minutes: Math.max(1, Math.trunc(num(gatherSpec.minutes ?? raw.gatherTimeMinutes, 30, 1, 24 * 60))),
      stamina: Math.max(0, Math.trunc(num(gatherSpec.stamina ?? raw.gatherStaminaCost, 5, 0, 1000))),
    },
    gatherText: text(raw.gatherRate ?? raw.gatherText) || undefined,
    usageText: text(raw.usage ?? raw.usageText) || undefined,
    value: raw.value === undefined ? undefined : num(raw.value, 0, 0),
  };
  if (def.kind === 'vital') def.depletedStatus = text(raw.depletedStatus) || `deprived:${def.id}`;
  return def;
}

function costRecord(cost: unknown): Record<string, number> | undefined {
  if (!Array.isArray(cost)) return cost && typeof cost === 'object' ? cost as Record<string, number> : undefined;
  const out: Record<string, number> = {};
  for (const item of cost as Array<{ id?: string; path?: string; amount?: number }>) {
    const path = text(item.path);
    const match = /^玩家\.生存资源\.([^.]+)\.数量$/.exec(path);
    const key = match?.[1] ?? (path ? `fact:${path}` : text(item.id));
    if (key) out[key] = Math.max(0, num(item.amount, 0, 0));
  }
  return Object.keys(out).length ? out : undefined;
}

export function normalizeRecipe(raw: SurvivalRecipe & Record<string, unknown>, index: number, custom = false): RecipeDef {
  const outputs: Record<string, number> = {};
  if (raw.outputs && typeof raw.outputs === 'object') {
    for (const [key, value] of Object.entries(raw.outputs as Record<string, unknown>)) outputs[key] = Math.max(0, num(value, 0, 0));
  } else if (raw.output?.resourceId) {
    outputs[raw.output.resourceId] = Math.max(1, num(raw.output.amount, 1, 1));
  }
  const inputs: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw.inputs ?? {})) inputs[key] = Math.max(0, num(value, 0, 0));
  const conditions = Array.isArray(raw.unlockConditions) ? (raw.unlockConditions as GameplayCondition[]) : [];
  return {
    id: safeId(raw.id, `recipe_${index + 1}`),
    name: text(raw.name, `配方 ${index + 1}`),
    description: text(raw.description),
    inputs,
    outputs,
    minutes: Math.max(0, Math.trunc(num(raw.craftTimeMinutes ?? raw.minutes, 30, 0, 24 * 60 * 7))),
    stamina: Math.max(0, Math.trunc(num(raw.stamina, 0, 0, 1000))),
    tool: text(raw.tool) || undefined,
    unlockCondition: conditions.length ? { all: conditions.map(gameplayConditionToCore) } : (raw.unlockCondition as CoreCondition | undefined),
    unlockCost: costRecord(raw.unlockCost),
    ...(custom || raw.custom === true ? { custom: true } : {}),
  };
}

function normalizeStatus(raw: Record<string, unknown>, index: number): StatusDef {
  const perDay = raw.perDay && typeof raw.perDay === 'object' ? raw.perDay as Record<string, unknown> : {};
  const modifiers = Array.isArray(raw.modifiers) ? raw.modifiers as StatusModifierSpec[] : [];
  return {
    id: safeId(raw.id, `status_${index + 1}`),
    name: text(raw.name, `状态 ${index + 1}`),
    description: text(raw.description),
    severity: raw.severity === 'critical' || raw.severity === 'major' ? raw.severity : 'minor',
    perDay: { hp: num(perDay.hp, 0), stamina: num(perDay.stamina, 0) },
    modifiers: modifiers.filter(item => item && typeof item.target === 'string' && Number.isFinite(Number(item.value)))
      .map(item => ({ target: item.target, mode: item.mode === 'mult' ? 'mult' : 'flat', value: Number(item.value) })),
    ...(raw.days !== undefined ? { days: Math.max(1, Math.trunc(num(raw.days, 1, 1))) } : raw.durationTicks !== undefined ? { days: Math.max(1, Math.trunc(num(raw.durationTicks, 1, 1))) } : {}),
  };
}

function normalizeEvolution(raw: ResourceEvolutionStep & Record<string, unknown>, index: number): EvolutionStepDef {
  const turns = raw.afterTurns ?? raw.afterRounds;
  const keywords = Array.isArray(raw.keywords) ? raw.keywords as unknown[] : raw.trigger?.keywords ?? [];
  return {
    id: safeId(raw.id, `evolution_${index + 1}`),
    afterTurns: turns === undefined ? undefined : Math.max(0, Math.trunc(num(turns, 0, 0))),
    afterDays: raw.afterDays === undefined ? undefined : Math.max(0, Math.trunc(num(raw.afterDays, 0, 0))),
    keywords: keywords.map(keyword => text(keyword)).filter(Boolean),
    add: (raw.add ?? []).map((resource, resourceIndex) => normalizeResource(resource as SurvivalResource & Record<string, unknown>, {}, resourceIndex)),
    remove: (raw.remove ?? []).map(id => text(id)).filter(Boolean),
    hint: text(raw.narrateHint ?? raw.hint) || undefined,
  };
}

/** 世界配置（v1 或 v2）→ v2。 */
export function normalizeResourcesConfig(raw: SurvivalModuleSchema | ResourcesConfig | undefined | null): ResourcesConfig {
  const source = (raw ?? {}) as SurvivalModuleSchema & Record<string, unknown>;
  const rawResources = (Array.isArray(source.resources) ? source.resources : []) as Array<SurvivalResource & Record<string, unknown>>;
  const rulesText = text((source.rules as Record<string, unknown> | undefined)?.consumePerCycle) || text(source.rulesText);
  const explicit = source.consumption?.perCycle ?? {};
  const hints: Record<string, number> = { ...parseUpkeepText(rulesText, rawResources.map(item => ({ id: item.id, name: item.name }))) };
  for (const [id, value] of Object.entries(explicit)) hints[id] = Math.max(0, Number(value) || 0);
  const resources: ResourceDef[] = [];
  const seen = new Set<string>();
  rawResources.forEach((resource, index) => {
    const def = normalizeResource(resource, hints, index);
    if (seen.has(def.id)) return;
    seen.add(def.id);
    resources.push(def);
  });
  const penalties = source.consumption?.exhaustionPenalty ?? {};
  const statuses = (Array.isArray(source.statuses) ? source.statuses : []).map((status, index) => normalizeStatus(status as Record<string, unknown>, index));
  for (const resource of resources) {
    if (!resource.depletedStatus || statuses.some(status => status.id === resource.depletedStatus)) continue;
    const status = deprivationStatus(resource);
    const penalty = Number(penalties[resource.id]);
    if (Number.isFinite(penalty) && penalty > 0) status.perDay = { ...status.perDay, stamina: -penalty };
    statuses.push({ ...status, id: resource.depletedStatus });
  }
  const cycleSource = text((source as Record<string, unknown>).cycle) || text((source.rules as Record<string, unknown> | undefined)?.cycleName);
  const period = periodFromCycleName(cycleSource, 'day');
  return {
    version: 2,
    description: text(source.description),
    rulesText,
    cycle: period === 'turn' ? 'turn' : period === 'hour' ? 'hour' : 'day',
    resources,
    recipes: (Array.isArray(source.recipes) ? source.recipes : []).map((recipe, index) => normalizeRecipe(recipe as SurvivalRecipe & Record<string, unknown>, index)),
    statuses,
    evolution: (Array.isArray(source.resourceEvolution) ? source.resourceEvolution : Array.isArray((source as Record<string, unknown>).evolution) ? (source as Record<string, unknown>).evolution as ResourceEvolutionStep[] : [])
      .map((step, index) => normalizeEvolution(step as ResourceEvolutionStep & Record<string, unknown>, index)),
  };
}
