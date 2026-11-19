/**
 * 骰子模块（dice）：正文里的检定请求由本地掷骰结算。
 *
 * - 随机数取自存档里的种子序列：同一存档、同样的请求顺序结果相同，重放与回滚可复现。
 * - 修正 = 属性有效值换算（0~20 制按 (值-10)/2，0~100 等大量纲按范围折算到 -5~+5；世界配置了 modifierBase/Step 时按配置）
 *   + 天赋/职业加成 + `dice.check` 修正器（缺水、受伤等状态）。
 * - 结果写入 dice.lastRoll / history，发出 dice.resolved，供成长、事件规则与下一段正文使用。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { DiceAdvantageMode, DiceModuleSchema, DiceRoll, ProfessionModuleSchema, StatModuleSchema, TalentModuleSchema } from '../../modules/schema';
import type { FactSpec } from '../../core/facts';
import type { GameplayModule, ModuleHookContext } from '../../core/host';
import { createDefaultDiceModule } from '../../modules/defaults';
import { resolveCheckableAttribute } from '../../modules/xpAlgorithm';
import { createDiceRoll, getTalentDiceBonuses } from '../../gameplay/modules/dice';
import { resolveProfessionBonuses } from '../../gameplay/profession/profession';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import { resolveProfessionBinding } from '../../data/professions';
import { checkModifier } from '../../events/cards';
import { effectiveStat, findStat, type StatsConfig } from '../stats/module';

export const DICE_MODULE_ID = 'dice';

export interface DiceModuleConfig {
  dice: DiceModuleSchema;
  stats?: StatsConfig;
  talent?: TalentModuleSchema;
  profession?: ProfessionModuleSchema;
  world?: WorldDef;
}

type Ctx = ModuleHookContext<DiceModuleConfig>;

const TIER_LABELS: Record<NonNullable<DiceRoll['resultTier']>, string> = {
  'critical-failure': '大失败', failure: '失败', partial: '勉强成功', success: '成功', 'critical-success': '大成功',
};

function signed(value: number): string {
  return `${value >= 0 ? '+' : ''}${value}`;
}

/** 世界的属性配置叠加存档里的当前值（检定按当前值选属性）。 */
function liveStatConfig(config: StatModuleSchema, state: GameState): StatModuleSchema {
  const live = state.玩家?.生存状态 ?? {};
  const out = structuredClone(config) as StatModuleSchema & Record<string, unknown>;
  for (const dim of ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const) {
    if (out[dim] && Number.isFinite(Number(live[dim]))) out[dim] = { ...out[dim]!, value: Number(live[dim]) };
  }
  out.special = (out.special ?? []).map(item => ({ ...item, value: Number.isFinite(Number(live[item.id])) ? Number(live[item.id]) : item.value }));
  return out;
}

export interface ResolvedCheckAttribute { id: string; name: string; value: number; range: [number, number] }

export function resolveCheckAttribute(state: GameState, config: DiceModuleConfig, request: { attributeId?: string; attribute?: string }, context?: Pick<Ctx, 'modifiers'>): ResolvedCheckAttribute | undefined {
  const stats = config.stats;
  if (!stats) return undefined;
  const byId = request.attributeId ? findStat(stats.stat, request.attributeId) : undefined;
  const picked = byId ?? (request.attribute ? findStat(stats.stat, request.attribute) : undefined)
    ?? (() => {
      const guess = resolveCheckableAttribute(liveStatConfig(stats.stat, state), request.attribute ?? request.attributeId ?? '');
      return guess ? findStat(stats.stat, guess.id) : undefined;
    })();
  if (!picked) return undefined;
  return { id: picked.id, name: picked.name, value: effectiveStat(stats, state, picked, context?.modifiers), range: picked.range };
}

/** 属性值 → 修正。 */
export function diceAttributeModifier(dice: DiceModuleSchema, value: number, range: [number, number]): number {
  if (dice.modifierBase !== undefined || dice.modifierStep !== undefined) {
    const base = Number.isFinite(Number(dice.modifierBase)) ? Number(dice.modifierBase) : 10;
    const step = Math.max(1, Number(dice.modifierStep) || 2);
    return Math.floor((value - base) / step);
  }
  if (range[1] - range[0] > 30) return checkModifier(value, range);
  return Math.floor((value - 10) / 2);
}

function bonusesFor(state: GameState, config: DiceModuleConfig, attributeId: string, context: Ctx): Array<{ source: string; value: number }> {
  const out: Array<{ source: string; value: number }> = [];
  if (config.talent) out.push(...getTalentDiceBonuses(state, config.talent));
  if (config.profession) {
    for (const bonus of resolveProfessionBonuses(state, config.profession).checks) {
      if (!bonus.statIds?.length || bonus.statIds.some(id => id === attributeId)) out.push({ source: bonus.source, value: bonus.value });
    }
  }
  for (const modifier of context.modifiers.list(`dice.check.${attributeId}`)) {
    if (modifier.mode === 'flat' && Number(modifier.value)) out.push({ source: modifier.label || modifier.source, value: Number(modifier.value) });
  }
  return out;
}

function diceFacts(): FactSpec[] {
  return [
    { id: 'dice.last.total', module: DICE_MODULE_ID, type: 'number', label: '最近一次检定总值', writable: [], read: state => state.dice?.lastRoll?.total },
    { id: 'dice.last.success', module: DICE_MODULE_ID, type: 'boolean', label: '最近一次检定是否成功', writable: [], read: state => state.dice?.lastRoll?.success },
    { id: 'dice.last.attribute', module: DICE_MODULE_ID, type: 'string', label: '最近一次检定的属性', writable: [], read: state => state.dice?.lastRoll?.attributeId },
  ];
}

export const diceModule: GameplayModule<DiceModuleConfig> = {
  id: DICE_MODULE_ID,
  label: '骰子',
  order: 30,
  resolveConfig: world => {
    const module = world?.modules?.find(item => item.moduleId === 'dice' && item.enabled);
    if (!module) return undefined;
    const stat = world?.modules?.find(item => item.moduleId === 'stat' && item.enabled)?.moduleConfig as StatModuleSchema | undefined;
    const progression = world?.modules?.find(item => item.moduleId === 'progression' && item.enabled)?.moduleConfig;
    const talent = world?.modules?.find(item => item.moduleId === 'talent' && item.enabled)?.moduleConfig as TalentModuleSchema | undefined;
    const professionModule = isProfessionModuleEnabled(world) ? world?.modules?.find(item => item.moduleId === 'profession' && item.enabled) : undefined;
    return {
      dice: { ...createDefaultDiceModule(), ...((module.moduleConfig ?? {}) as DiceModuleSchema) },
      ...(stat ? { stats: { stat, ...(progression ? { progression: progression as never } : {}), world } } : {}),
      ...(talent ? { talent } : {}),
      ...(professionModule ? { profession: resolveProfessionBinding(professionModule.moduleConfig) } : {}),
      world,
    };
  },
  facts: diceFacts,
  domainEvents: () => [
    { type: 'dice.resolved', label: '正文检定出结果', payload: 'success、criticalSuccess、attributeId、resultTier' },
  ],
  prepare: state => {
    if (!state.dice || typeof state.dice !== 'object') state.dice = { history: [] };
    if (!Array.isArray(state.dice.history)) state.dice.history = [];
  },
  commands: {
    roll: (state, args, context: Ctx) => {
      const config = context.config;
      const requestId = typeof args.requestId === 'string' ? args.requestId : undefined;
      if (requestId && state.dice?.history?.some(item => item.requestId === requestId)) return { ok: false, reason: '这次检定已经结算过了' };
      const attribute = resolveCheckAttribute(state, config, {
        ...(typeof args.attributeId === 'string' ? { attributeId: args.attributeId } : {}),
        ...(typeof args.attribute === 'string' ? { attribute: args.attribute } : {}),
      }, context);
      if (!attribute) return { ok: false, reason: '这个世界没有可用于检定的属性' };
      const dc = Math.max(1, Math.min(100, Math.trunc(Number(args.dc) || Number(config.dice.defaultDC) || 10)));
      const mode = (['advantage', 'disadvantage'].includes(String(args.advantageMode)) ? args.advantageMode : 'normal') as DiceAdvantageMode;
      const roll = createDiceRoll(config.dice, {
        ...(requestId ? { requestId } : {}),
        attributeId: attribute.id,
        attributeName: attribute.name,
        attributeValue: attribute.value,
        dc,
        timestamp: Number(args.timestamp) || Date.now(),
        advantageMode: mode,
        bonuses: bonusesFor(state, config, attribute.id, context),
        attributeModifier: diceAttributeModifier(config.dice, attribute.value, attribute.range),
      }, context.rng.asFunction());
      const limit = Math.max(1, Math.min(100, Math.trunc(Number(config.dice.historyLimit) || 10)));
      state.dice = { ...(state.dice ?? {}), lastRoll: roll, history: [...(state.dice?.history ?? []), roll].slice(-limit) };
      const tier = roll.resultTier ?? (roll.success ? 'success' : 'failure');
      context.emit('dice.resolved', {
        attributeId: roll.attributeId ?? '', attributeName: roll.attributeName, die: roll.d20, modifier: roll.modifier,
        total: roll.total, dc: roll.dc, success: roll.success, criticalSuccess: roll.isNatural20, criticalFailure: roll.isNatural1, resultTier: tier,
        ...(requestId ? { requestId } : {}),
      });
      context.note(`${roll.attributeName}检定：d20=${roll.d20}${signed(roll.modifier)}=${roll.total}，难度 ${roll.dc}，${TIER_LABELS[tier]}。`, 'fact');
      return { ok: true, message: `${roll.attributeName}检定${TIER_LABELS[tier]}（${roll.total}/${roll.dc}）` };
    },
  },
};
