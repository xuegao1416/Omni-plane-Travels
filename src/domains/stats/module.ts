/**
 * 属性模块（stats）：生命/体力、六维与特色属性的变量定义。
 *
 * - 范围：按世界配置的上下限，有成长体系时上限随段位/等级提高；已经超出上限的旧值不会被写回压低。
 * - 有效值：基础值叠加加成（`stat.<id>` 目标的修正器）与装备加成后的数值，检定、派生属性与战斗都读有效值。
 * - 装备（domains/equipment）：穿戴中的装备按 属性加成 计入；生命/体力的装备加成提高上限。
 * - 派生属性：按配置公式计算，结果快照写入 gameplay.stat.derived 供界面显示。
 * - 命令：stats.allocate 分配属性点。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { ProgressionConfig, StatBonuses, StatModuleSchema } from '../../modules/schema';
import type { FactBounds, FactSpec, WriteSource } from '../../core/facts';
import type { GameplayModule, ModuleHookContext } from '../../core/host';
import type { ModifierQuery } from '../../core/modifiers';
import { getCurrentLevelCap } from '../../modules/xpAlgorithm';
import { ensureGameplayRuntime } from '../../core/state';
import type { GameplayStateRoot } from '../../gameplay/types';
import { equipmentStatBonus } from '../equipment/bonus';

export const STATS_MODULE_ID = 'stats';
const WRITERS: readonly WriteSource[] = ['ai', 'event', 'custom'];
const DIMENSIONS = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const;

export interface StatsConfig {
  stat: StatModuleSchema;
  progression?: ProgressionConfig;
  world?: WorldDef;
}

export interface StatDefinition {
  id: string;
  /** 存档里的键（生存状态.<field>）。 */
  field: string;
  name: string;
  kind: 'vital' | 'dimension' | 'special';
  range: [number, number];
  capKey?: keyof StatBonuses;
}

type Ctx = ModuleHookContext<StatsConfig>;

function rangeOf(raw: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(raw) || raw.length !== 2) return fallback;
  const low = Number(raw[0]);
  const high = Number(raw[1]);
  return Number.isFinite(low) && Number.isFinite(high) && high > low ? [low, high] : fallback;
}

export function statDefinitions(config: StatModuleSchema): StatDefinition[] {
  const out: StatDefinition[] = [
    { id: 'attrA', field: '血量', name: config.attrA?.name || '生命', kind: 'vital', range: [0, Math.max(1, Number(config.attrA?.max) || 100)], capKey: 'attrAMax' },
    { id: 'attrB', field: '体力值', name: config.attrB?.name || '体力', kind: 'vital', range: [0, Math.max(1, Number(config.attrB?.max) || 100)], capKey: 'attrBMax' },
  ];
  for (const dim of DIMENSIONS) {
    const entry = config[dim];
    if (entry) out.push({ id: dim, field: dim, name: entry.name || dim, kind: 'dimension', range: rangeOf(entry.range, [0, 100]), capKey: `${dim}Max` as keyof StatBonuses });
  }
  for (const special of config.special ?? []) {
    if (special?.id) out.push({ id: special.id, field: special.id, name: special.name || special.id, kind: 'special', range: rangeOf(special.range, [0, 100]) });
  }
  return out;
}

/** 属性键、存档字段或中文名 → 定义。 */
export function findStat(config: StatModuleSchema, key: string): StatDefinition | undefined {
  const id = key.trim();
  const alias = id === 'hp' ? 'attrA' : id === 'stamina' ? 'attrB' : id;
  return statDefinitions(config).find(def => def.id === alias || def.field === alias || def.name === alias);
}

/** 装备体系随数值属性启用，属性配置里写 equipment.enabled = false 才关闭。 */
export function isEquipmentEnabled(stat: StatModuleSchema | undefined): boolean {
  return Boolean(stat) && stat?.equipment?.enabled !== false;
}

/** 穿戴中的装备对这一属性的加成（装备体系关闭时为 0）。 */
export function equipmentBonus(config: StatsConfig, state: GameState, def: StatDefinition): number {
  if (!isEquipmentEnabled(config.stat)) return 0;
  return equipmentStatBonus(state.玩家?.装备栏, def);
}

/** 成长体系给的上限（没有成长体系时就是配置范围上限），不含装备。 */
export function baseStatCap(config: StatsConfig, state: GameState, def: StatDefinition): number {
  if (!config.progression || !def.capKey) return def.range[1];
  const caps = getCurrentLevelCap({ ...config.progression, currentTierIndex: Math.max(0, Math.trunc(Number(state.玩家?.当前段位索引) || 0)) } as never);
  const cap = Number(caps?.[def.capKey]);
  return Number.isFinite(cap) && cap > 0 ? cap : def.range[1];
}

/**
 * 当前上限。生命、体力这类槽位属性的装备加成提高上限（不直接加当前值）；
 * 六维与特色属性的上限只随成长变化，装备加成算进有效值、可以越过这个上限。
 */
export function statCap(config: StatsConfig, state: GameState, def: StatDefinition): number {
  const cap = baseStatCap(config, state, def);
  return def.kind === 'vital' ? Math.max(1, cap + equipmentBonus(config, state, def)) : cap;
}

export function statBounds(config: StatsConfig, state: GameState, def: StatDefinition): FactBounds {
  const current = Number(state.玩家?.生存状态?.[def.field]);
  const cap = statCap(config, state, def);
  return { min: def.range[0], max: Number.isFinite(current) ? Math.max(cap, current) : cap };
}

export function baseStat(state: GameState, def: StatDefinition): number {
  const value = Number(state.玩家?.生存状态?.[def.field]);
  return Number.isFinite(value) ? value : def.range[0];
}

/** 旧版属性运行态里的修正（gameplay.stat.modifiers，按回合到期）。 */
function legacyModifiers(state: GameState, id: string): { flat: number; percent: number } {
  const turn = Math.trunc(Number(state.simulationRuntime?.tick) || 0);
  let flat = 0;
  let percent = 0;
  for (const modifier of Object.values(state.gameplay?.stat?.modifiers ?? {})) {
    if (modifier.statId !== id || (modifier.expiresAtTick !== undefined && modifier.expiresAtTick <= turn)) continue;
    if (modifier.mode === 'percent') percent += Number(modifier.delta) || 0;
    else flat += Number(modifier.delta) || 0;
  }
  return { flat, percent };
}

/**
 * 有效值：基础值 + 修正器，钳制在范围内，再加上装备加成（六维、特色属性的装备加成可以越过成长上限）。
 * modifiers 为空时只计存档里的修正器。
 */
export function effectiveStat(config: StatsConfig, state: GameState, def: StatDefinition, modifiers?: ModifierQuery): number {
  const legacy = legacyModifiers(state, def.id);
  const base = (baseStat(state, def) + legacy.flat) * (1 + legacy.percent / 100);
  const boosted = modifiers ? modifiers.apply(`stat.${def.id}`, base) : base + storedFlat(state, `stat.${def.id}`);
  const bounds = statBounds(config, state, def);
  const capped = Math.min(bounds.max ?? Infinity, Math.max(bounds.min ?? -Infinity, boosted));
  const gear = def.kind === 'vital' ? 0 : equipmentBonus(config, state, def);
  return Math.round(Math.max(bounds.min ?? -Infinity, capped + gear) * 100) / 100;
}

function storedFlat(state: GameState, target: string): number {
  const stored = (state.gameplay as { modifiers?: Record<string, { target: string; mode: string; value: number }> } | undefined)?.modifiers ?? {};
  return Object.values(stored).filter(item => item.mode === 'flat' && (target === item.target || target.startsWith(`${item.target}.`)))
    .reduce((sum, item) => sum + (Number(item.value) || 0), 0);
}

function derivedValues(config: StatsConfig, state: GameState): Record<string, number> {
  const defs = statDefinitions(config.stat);
  const out: Record<string, number> = {};
  const resolve = (input: string, seen: Set<string>): number => {
    const stat = defs.find(def => def.id === input || def.field === input);
    if (stat) return effectiveStat(config, state, stat);
    const derived = config.stat.derived?.find(item => item.id === input);
    if (!derived || seen.has(input)) return 0;
    return compute(derived, new Set([...seen, input]));
  };
  const compute = (derived: NonNullable<StatModuleSchema['derived']>[number], seen: Set<string>): number => {
    const values = derived.inputs.map(input => resolve(input, seen));
    const formula = derived.formula ?? 'sum';
    const aggregate = formula === 'average' ? (values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0)
      : formula === 'min' ? Math.min(...values)
        : formula === 'max' ? Math.max(...values)
          : formula === 'ratio' ? (values[1] ? values[0] / values[1] : 0)
            : values.reduce((a, b) => a + b, 0);
    const result = aggregate * (derived.scale ?? 1) + (derived.offset ?? 0);
    return Math.round(Math.min(derived.max ?? Infinity, Math.max(derived.min ?? -Infinity, result)) * 100) / 100;
  };
  for (const derived of config.stat.derived ?? []) out[derived.id] = compute(derived, new Set([derived.id]));
  return out;
}

function statFacts(config: StatsConfig): FactSpec[] {
  const defs = statDefinitions(config.stat);
  const facts: FactSpec[] = [];
  for (const def of defs) {
    const storage = `玩家.生存状态.${def.field}`;
    const spec: FactSpec = {
      id: `player.stats.${def.id}`, module: STATS_MODULE_ID, type: 'number', label: def.name,
      description: `范围 ${def.range[0]}~${def.range[1]}${config.progression && def.capKey ? '，上限随成长提高' : ''}`,
      aliases: [`stats.${def.id}`, ...(def.field !== def.id ? [] : [storage])],
      storage, writable: WRITERS, bounds: state => statBounds(config, state, def),
    };
    facts.push(spec);
    facts.push({ id: `player.stats.${def.id}.effective`, module: STATS_MODULE_ID, type: 'number', label: `${def.name}（含加成）`, writable: [],
      read: state => effectiveStat(config, state, def) });
  }
  // 生命、体力沿用内核的规范路径，这里补上范围与名称。
  const vital = (id: 'attrA' | 'attrB', factId: 'player.hp' | 'player.stamina', field: string, extra: string): FactSpec => {
    const def = defs.find(item => item.id === id)!;
    return {
      id: factId, module: STATS_MODULE_ID, type: 'number', label: def.name,
      aliases: [`玩家.生存状态.${field}`, extra], storage: `玩家.生存状态.${field}`, writable: WRITERS,
      bounds: state => statBounds(config, state, def),
    };
  };
  facts.push(vital('attrA', 'player.hp', '血量', 'player.stats.hp'), vital('attrB', 'player.stamina', '体力值', 'player.stats.stamina'));
  facts.push({ id: 'player.statPoints', module: STATS_MODULE_ID, type: 'number', label: '可用属性点', aliases: ['玩家.可用属性点'],
    storage: '玩家.可用属性点', bounds: { min: 0, integer: true }, writable: ['event', 'custom'] });
  for (const derived of config.stat.derived ?? []) {
    facts.push({ id: `player.stats.${derived.id}`, module: STATS_MODULE_ID, type: 'number', label: derived.name || derived.id, writable: [],
      read: state => derivedValues(config, state)[derived.id] ?? 0 });
  }
  return facts;
}

function syncDerived(state: GameState, config: StatsConfig): void {
  if (!config.stat.derived?.length) return;
  const runtime = ensureGameplayRuntime(state as GameState & GameplayStateRoot);
  if (!runtime.stat) return;
  const next = derivedValues(config, state);
  if (JSON.stringify(runtime.stat.derived ?? {}) !== JSON.stringify(next)) runtime.stat.derived = next;
}

export const statsModule: GameplayModule<StatsConfig> = {
  id: STATS_MODULE_ID,
  label: '属性',
  order: 10,
  resolveConfig: world => {
    const module = world?.modules?.find(item => item.moduleId === 'stat' && item.enabled);
    if (!module?.moduleConfig) return undefined;
    const progression = world?.modules?.find(item => item.moduleId === 'progression' && item.enabled)?.moduleConfig as ProgressionConfig | undefined;
    return { stat: module.moduleConfig as unknown as StatModuleSchema, ...(progression ? { progression } : {}), world };
  },
  facts: statFacts,
  domainEvents: () => [
    { type: 'stat.changed', label: '属性变化', payload: 'id、name、before、after' },
    { type: 'player.downed', label: '生命归零', payload: 'name 为生命属性名' },
  ],
  commands: {
    allocate: (state, args, context: Ctx) => {
      const def = findStat(context.config.stat, String(args.stat ?? args.statId ?? ''));
      if (!def) return { ok: false, reason: `没有这个属性：${String(args.stat ?? args.statId ?? '')}` };
      const amount = Math.max(1, Math.trunc(Number(args.amount) || 1));
      const points = Math.max(0, Math.trunc(Number(state.玩家.可用属性点) || 0));
      if (points < amount) return { ok: false, reason: `属性点不足（剩余 ${points}）` };
      const cap = statCap(context.config, state, def);
      const current = baseStat(state, def);
      if (current + amount > cap) return { ok: false, reason: `${def.name}已到当前上限 ${cap}` };
      const ok = context.apply([
        { op: 'add', path: 'player.statPoints', value: -amount, strict: true },
        { op: 'add', path: `player.stats.${def.id}`, value: amount },
      ], 'system');
      if (!ok) return { ok: false, reason: '属性点分配失败' };
      context.emit('stat.points-allocated', { stat: def.id, amount });
      return { ok: true, message: `${def.name} +${amount}` };
    },
  },
  onSettle: (state, context, before) => {
    for (const def of statDefinitions(context.config.stat)) {
      const previous = Number(before.玩家?.生存状态?.[def.field]);
      const now = Number(state.玩家?.生存状态?.[def.field]);
      if (!Number.isFinite(now) || previous === now) continue;
      context.emit('stat.changed', { id: def.id, name: def.name, before: Number.isFinite(previous) ? previous : null, after: now });
      if (def.id === 'attrA' && now <= 0 && previous > 0) context.emit('player.downed', { name: def.name });
    }
    syncDerived(state, context.config);
  },
  prepare: (state, context) => syncDerived(state, context.config),
  summarize: (state, context, audience) => {
    const defs = statDefinitions(context.config.stat);
    if (audience === 'extraction') {
      const geared = isEquipmentEnabled(context.config.stat) ? '这里写的是基础值，装备加成由本地另算，不要把装备加成写进属性。' : '';
      return `属性变量 player.stats.<id>：${defs.map(def => `${def.id}=${def.name}（${def.range[0]}~${statCap(context.config, state, def)}）`).join('，')}。受伤、消耗、恢复用 add 增减，超出范围会被钳制。${geared}`;
    }
    if (audience !== 'main') return undefined;
    const parts = defs.map(def => {
      const base = baseStat(state, def);
      const effective = effectiveStat(context.config, state, def, context.modifiers);
      const cap = statCap(context.config, state, def);
      const shown = effective !== base ? `${effective}（基础 ${base}）` : `${base}`;
      return def.kind === 'vital' ? `${def.name} ${shown}/${cap}` : `${def.name} ${shown}`;
    });
    const derived = Object.entries(derivedValues(context.config, state)).map(([id, value]) => `${context.config.stat.derived?.find(item => item.id === id)?.name ?? id} ${value}`);
    return [...parts, ...derived].join('，');
  },
};
