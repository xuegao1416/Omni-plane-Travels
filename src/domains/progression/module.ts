/**
 * 成长模块（progression）：经验、段位/等级、突破。
 *
 * 经验只由本地规则发放，AI 不能直接改经验（变量不对 AI 开放）：
 * - 回合结束：正文里的战斗/训练/探索等行动按关键词给固定比例经验（沿用旧规则）。
 * - 领域事件：检定成功、事件卡结算、任务完成、交付订单、制作物品等按比例给经验，每回合有上限。
 * - 其他模块与事件卡可以用命令 progression.gain 发放经验（任务奖励、奇遇）。
 * 升级自动发放属性点/天赋点/技能点/职业能力点；配置了突破关卡的段位停在关口，由玩家手动突破（检查条件、扣除代价、发放奖励）。
 */
import type { GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { ProgressionConfig, TalentModuleSchema } from '../../modules/schema';
import type { FactSpec } from '../../core/facts';
import type { DomainEvent, GameplayModule, ModuleHookContext } from '../../core/host';
import { hostRuntime } from '../../core/host';
import type { Op } from '../../core/ops';
import { evaluateCondition } from '../../core/conditions';
import { gameplayConditionToCore, gameplayEffectToOp } from '../../core/legacy';
import { calculateXpForLevel } from '../../modules/xpAlgorithm';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import { resolveProfessionBinding } from '../../data/professions';

export const PROGRESSION_MODULE_ID = 'progression';

/** 世界没配置行动经验时的默认来源（占升到下一阶所需经验的比例）。 */
export const DEFAULT_ACTIVITY_REWARDS: NonNullable<ProgressionConfig['activityRewards']> = [
  { id: 'combat', label: '战斗', rate: 0.1, keywords: ['攻击', '战斗', '迎战', '交战', '反击', '击杀'] },
  { id: 'training', label: '训练', rate: 0.08, keywords: ['训练', '修炼', '练习', '学习', '研习', '锻炼'] },
  { id: 'exploration', label: '探索', rate: 0.05, keywords: ['探索', '调查', '解谜', '追踪', '采集', '制作', '交涉'] },
];

export function maxTierIndex(config: ProgressionConfig): number {
  return config.mode === 'level'
    ? Math.max(0, Math.trunc(config.levelData?.maxLevel ?? 0))
    : Math.max(0, (config.tiers?.length ?? 1) - 1);
}

/** 从 tierIndex 升到下一阶需要的经验；满级为 Infinity。 */
export function thresholdFor(tierIndex: number, config: ProgressionConfig): number {
  if (tierIndex >= maxTierIndex(config)) return Infinity;
  if (config.mode === 'tiered') {
    const explicit = Number(config.tiers?.[tierIndex + 1]?.xpRequired);
    if (Number.isFinite(explicit) && explicit > 0) return explicit;
  }
  const formula = config.xpFormula;
  if (!formula || formula.baseXP <= 0 || formula.exponent <= 0 || formula.scaleFactor <= 0) return Infinity;
  return Math.max(1, calculateXpForLevel(tierIndex + 1, formula));
}

/** 领域事件 → 经验（占当前阶段升级所需经验的比例）。世界可在 progression 配置的 xpPolicy 里覆盖。 */
export const DEFAULT_XP_POLICY: Record<string, number> = {
  'check.success': 0.04,
  'check.failure': 0.01,
  'dice.success': 0.03,
  'dice.critical': 0.06,
  'events.resolved': 0.02,
  'quest.completed': 0.1,
  'economy.contractFulfilled': 0.05,
  'resources.crafted': 0.02,
  'map.discovered': 0.01,
  'map.firstVisit': 0.03,
};

/** 领域事件每回合最多给出的经验比例（行动经验与命令发放不计入）。 */
export const EVENT_XP_CAP_PER_TURN = 0.3;

export interface ProgressionModuleConfig {
  config: ProgressionConfig;
  policy: Record<string, number>;
  professionAbilityPointsPerTier?: number;
  world?: WorldDef;
}

type Ctx = ModuleHookContext<ProgressionModuleConfig>;

type RuntimeWithXp = ReturnType<typeof hostRuntime> & { progressionXp?: { turn: number; rate: number } };

function tierOf(state: GameState): number {
  return Math.max(0, Math.trunc(Number(state.玩家?.当前段位索引) || 0));
}

function xpOf(state: GameState): number {
  return Math.max(0, Number(state.玩家?.当前经验值) || 0);
}

export function tierName(config: ProgressionConfig, tier: number): string {
  if (config.mode === 'tiered') return config.tiers?.[tier]?.name || `第 ${tier + 1} 阶`;
  return `Lv.${tier}`;
}

function gateFor(config: ProgressionConfig, tier: number) {
  return config.breakthroughs?.find(item => item.tierIndex === tier);
}

function pointOps(state: GameState, context: Ctx, promoted: number, tierAfter: number): Op[] {
  if (promoted <= 0) return [];
  const points = context.config.config.pointsPerTier ?? {};
  const ops: Op[] = [];
  if (points.attribute) ops.push({ op: 'add', path: '玩家.可用属性点', value: points.attribute * promoted, min: 0 });
  const ability = state.玩家.能力系统;
  const profession = ability?.职业状态;
  if (profession) {
    ops.push({ op: 'set', path: '玩家.能力系统.职业状态.职业等级', value: Math.max(1, tierAfter + 1) });
    const perTier = profession.职业ID ? Math.max(0, Number(context.config.professionAbilityPointsPerTier ?? points.skill) || 0) : 0;
    if (perTier) ops.push({ op: 'add', path: '玩家.能力系统.职业状态.能力点', value: perTier * promoted, min: 0 });
  } else if (ability) {
    if (points.talent) ops.push({ op: 'add', path: '玩家.能力系统.天赋点', value: points.talent * promoted, min: 0 });
    if (points.skill) ops.push({ op: 'add', path: '玩家.能力系统.技能点', value: points.skill * promoted, min: 0 });
  }
  return ops;
}

export interface XpGrant { gained: number; tierBefore: number; tierAfter: number; xpAfter: number; ready?: number }

/** 发放经验并处理升级；有突破关卡的段位停在关口。 */
export function grantXp(state: GameState, context: Ctx, amount: number, label: string): XpGrant | null {
  const config = context.config.config;
  const tierBefore = tierOf(state);
  const xpBefore = xpOf(state);
  const gained = Math.max(0, Math.round(amount));
  if (gained <= 0 || !Number.isFinite(thresholdFor(tierBefore, config))) return null;
  let tier = tierBefore;
  let xp = xpBefore + gained;
  let ready: number | undefined;
  const max = maxTierIndex(config);
  while (tier < max) {
    const threshold = thresholdFor(tier, config);
    if (!Number.isFinite(threshold) || xp < threshold) break;
    if (gateFor(config, tier + 1)) {
      xp = Math.min(xp, threshold);
      ready = tier + 1;
      break;
    }
    xp -= threshold;
    tier += 1;
  }
  const promoted = tier - tierBefore;
  const ops: Op[] = [
    { op: 'set', path: '玩家.当前段位索引', value: tier },
    { op: 'set', path: '玩家.当前经验值', value: Math.round(xp) },
    ...pointOps(state, context, promoted, tier),
  ];
  context.apply(ops, 'system');
  context.emit(promoted > 0 ? 'progression.promoted' : 'progression.gained', { xp: gained, label, tierBefore, tierAfter: tier, xpAfter: Math.round(xp) });
  if (promoted > 0) context.note(`你的境界提升到了「${tierName(config, tier)}」。`, 'fact');
  if (ready !== undefined && xpBefore < thresholdFor(tierBefore, config)) {
    context.emit('progression.ready', { targetTier: ready });
    context.note(`经验已满，可以尝试突破到「${tierName(config, ready)}」。`, 'hint');
  }
  return { gained, tierBefore, tierAfter: tier, xpAfter: Math.round(xp), ...(ready !== undefined ? { ready } : {}) };
}

function eventXp(state: GameState, context: Ctx, key: string, label: string): void {
  const rate = Number(context.config.policy[key]);
  if (!(rate > 0)) return;
  const runtime = hostRuntime(state) as RuntimeWithXp;
  const used = runtime.progressionXp?.turn === context.turn ? runtime.progressionXp.rate : 0;
  const allowed = Math.max(0, Math.min(rate, EVENT_XP_CAP_PER_TURN - used));
  if (allowed <= 0) return;
  const threshold = thresholdFor(tierOf(state), context.config.config);
  if (!Number.isFinite(threshold)) return;
  if (grantXp(state, context, Math.max(1, threshold * allowed), label)) {
    runtime.progressionXp = { turn: context.turn, rate: used + allowed };
  }
}

const XP_EVENTS: Record<string, (event: DomainEvent) => [string, string] | undefined> = {
  'check.rolled': event => event.payload.success ? ['check.success', '检定成功'] : ['check.failure', '检定失利'],
  'dice.resolved': event => event.payload.criticalSuccess ? ['dice.critical', '检定大成功'] : event.payload.success ? ['dice.success', '检定成功'] : undefined,
  'events.resolved': () => ['events.resolved', '经历事件'],
  'quest.completed': event => ['quest.completed', `完成任务「${String(event.payload.name ?? '')}」`],
  'economy.contractFulfilled': () => ['economy.contractFulfilled', '交付订单'],
  'resources.crafted': () => ['resources.crafted', '制作物品'],
  // 地图：发现新地点（含听说、望见）与初到某地。
  'map.discovered': event => event.payload.source === 'nearby' ? undefined : ['map.discovered', `发现「${String(event.payload.name ?? '')}」`],
  'map.arrived': event => event.payload.firstVisit ? ['map.firstVisit', `初到「${String(event.payload.name ?? '')}」`] : undefined,
  // 默认不给经验；世界在 xpPolicy 里写 'combat.victory' 才生效。
  'combat.ended': event => event.payload.status === 'victory' ? ['combat.victory', '战斗胜利'] : undefined,
};

function onXpEvent(state: GameState, event: DomainEvent, context: Ctx): void {
  const mapped = XP_EVENTS[event.type]?.(event);
  if (mapped) eventXp(state, context, mapped[0], mapped[1]);
}

function progressionFacts(config: ProgressionModuleConfig): FactSpec[] {
  return [
    { id: 'player.level', module: PROGRESSION_MODULE_ID, type: 'number', label: config.config.mode === 'tiered' ? '当前段位（序号）' : '当前等级',
      aliases: ['玩家.当前段位索引'], storage: '玩家.当前段位索引', writable: [] },
    { id: 'player.xp', module: PROGRESSION_MODULE_ID, type: 'number', label: '当前经验', aliases: ['玩家.当前经验值'], storage: '玩家.当前经验值', writable: [],
      description: '经验由本地规则发放；奖励经验请用命令 progression.gain' },
    { id: 'player.xpToNext', module: PROGRESSION_MODULE_ID, type: 'number', label: '升到下一阶所需经验', writable: [],
      read: state => { const value = thresholdFor(tierOf(state), config.config); return Number.isFinite(value) ? value : 0; } },
    { id: 'player.tierName', module: PROGRESSION_MODULE_ID, type: 'string', label: '当前境界', writable: [],
      read: state => tierName(config.config, tierOf(state)) },
  ];
}

function resolveModuleConfig(world: WorldDef | undefined): ProgressionModuleConfig | undefined {
  const module = world?.modules?.find(item => item.moduleId === 'progression' && item.enabled);
  const base = module?.moduleConfig as (ProgressionConfig & { xpPolicy?: Record<string, number> }) | undefined;
  if (!base) return undefined;
  const talent = world?.modules?.find(item => item.moduleId === 'talent' && item.enabled)?.moduleConfig as TalentModuleSchema | undefined;
  const professionEnabled = isProfessionModuleEnabled(world);
  const profession = professionEnabled ? world?.modules?.find(item => item.moduleId === 'profession' && item.enabled) : undefined;
  const config: ProgressionConfig = {
    ...base,
    pointsPerTier: {
      ...base.pointsPerTier,
      ...(!profession && talent ? {
        talent: base.pointsPerTier?.talent ?? talent.pointRules?.talentPointsPerTier ?? 1,
        skill: base.pointsPerTier?.skill ?? talent.pointRules?.skillPointsPerTier ?? ((talent.skills?.length ?? 0) > 0 ? 1 : 0),
      } : {}),
    },
  };
  const professionConfig = profession ? resolveProfessionBinding(profession.moduleConfig) : undefined;
  return {
    config,
    policy: { ...DEFAULT_XP_POLICY, ...(base.xpPolicy ?? {}) },
    ...(professionConfig?.abilityPointsPerTier !== undefined ? { professionAbilityPointsPerTier: professionConfig.abilityPointsPerTier } : {}),
    world,
  };
}

export const progressionModule: GameplayModule<ProgressionModuleConfig> = {
  id: PROGRESSION_MODULE_ID,
  label: '成长',
  order: 20,
  resolveConfig: world => resolveModuleConfig(world),
  facts: progressionFacts,
  domainEvents: () => [
    { type: 'progression.gained', label: '获得经验', payload: 'xp、label' },
    { type: 'progression.promoted', label: '升级（升阶）', payload: 'tierBefore、tierAfter' },
    { type: 'progression.ready', label: '经验已满、可以突破', payload: 'targetTier' },
    { type: 'progression.breakthrough', label: '完成突破', payload: 'targetTier' },
  ],
  commands: {
    gain: (state, args, context) => {
      const threshold = thresholdFor(tierOf(state), context.config.config);
      const amount = args.xp !== undefined ? Number(args.xp) : Number(args.rate) * threshold;
      if (!Number.isFinite(amount) || amount <= 0) return { ok: false, reason: '经验数值无效' };
      // 单次发放不超过当前阶段所需经验，避免一条奖励连升数级。
      const capped = Number.isFinite(threshold) ? Math.min(amount, threshold) : amount;
      const result = grantXp(state, context, capped, String(args.reason ?? '获得经验'));
      return result ? { ok: true, message: `经验 +${result.gained}` } : { ok: false, reason: '已经满级' };
    },
    breakthrough: (state, args, context) => {
      const config = context.config.config;
      const target = Math.trunc(Number(args.targetTier ?? args.tier));
      const current = tierOf(state);
      const gate = gateFor(config, target);
      if (!gate || target !== current + 1) return { ok: false, reason: '这一阶不需要手动突破' };
      const required = thresholdFor(current, config);
      const xp = xpOf(state);
      if (Number.isFinite(required) && xp < required) return { ok: false, reason: `经验不足：${xp}/${required}` };
      const conditions = (gate.conditions ?? []).map(item => gameplayConditionToCore(item));
      if (!conditions.every(condition => evaluateCondition(condition, { state, facts: context.facts, events: context.events() }))) {
        return { ok: false, reason: gate.description ? `突破条件未满足：${gate.description}` : '突破条件未满足' };
      }
      for (const cost of gate.costs ?? []) {
        const have = Number(context.facts.read(state, cost.path) ?? 0);
        const need = Math.abs(Number(cost.amount) || 0);
        if (!(have >= need)) return { ok: false, reason: `突破代价不足：${cost.label || context.facts.label(cost.path)}需要 ${need}，现有 ${Number.isFinite(have) ? have : 0}` };
      }
      const ops: Op[] = [
        ...(gate.costs ?? []).map(cost => ({ op: 'add' as const, path: cost.path, value: -Math.abs(Number(cost.amount) || 0), strict: true, label: cost.label })),
        { op: 'set', path: '玩家.当前段位索引', value: target },
        { op: 'set', path: '玩家.当前经验值', value: Number.isFinite(required) ? Math.max(0, xp - required) : xp },
        ...pointOps(state, context, 1, target),
        ...(gate.rewards ?? []).map(effect => gameplayEffectToOp(effect)).filter((op): op is Op => Boolean(op)),
      ];
      context.apply(ops, 'system');
      context.emit('progression.breakthrough', { targetTier: target });
      context.note(`你突破到了「${tierName(config, target)}」。`, 'fact');
      return { ok: true, message: `突破至${tierName(config, target)}` };
    },
  },
  on: Object.fromEntries(Object.keys(XP_EVENTS).map(type => [type, onXpEvent])) as Record<string, (state: GameState, event: DomainEvent, context: Ctx) => void>,
  onTurnEnd: (state, context, input) => {
    const config = context.config.config;
    const text = `${input.userText ?? ''}`.toLowerCase();
    if (!text.trim()) return;
    const reward = (config.activityRewards?.length ? config.activityRewards : DEFAULT_ACTIVITY_REWARDS)
      .find(item => item.keywords.some(keyword => text.includes(keyword.toLowerCase())));
    if (!reward) return;
    const threshold = thresholdFor(tierOf(state), config);
    if (!Number.isFinite(threshold)) return;
    const rate = Math.min(1, Math.max(0, Number(reward.rate) || 0));
    grantXp(state, context, Math.max(1, threshold * rate), `${reward.label}成长`);
  },
  summarize: (state, context, audience) => {
    const config = context.config.config;
    const tier = tierOf(state);
    const threshold = thresholdFor(tier, config);
    if (audience === 'extraction') {
      return '经验与段位由本地规则结算，不要写 玩家.当前经验值 / 玩家.当前段位索引；任务完成时把任务移到 玩家.任务系统.已完成任务，经验会自动发放。';
    }
    if (audience !== 'main') return undefined;
    const gate = gateFor(config, tier + 1);
    const progress = Number.isFinite(threshold) ? `经验 ${xpOf(state)}/${threshold}${gate && xpOf(state) >= threshold ? '（已到突破关口）' : ''}` : '已到顶';
    return `${tierName(config, tier)}，${progress}`;
  },
};
