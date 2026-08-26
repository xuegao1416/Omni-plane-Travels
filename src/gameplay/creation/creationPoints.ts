import type { CombatRiskMode } from '../protocols';
import type { InnateTalentDef, ProfessionModuleSchema, StatModuleSchema, TalentDef } from '../../modules/schema';
import type { WorldDef } from '../../data/worlds-schema';

// ═══════════════════════════════════════════════════════════════
// 降临点数体系 —— 常量（唯一调参处）
// ═══════════════════════════════════════════════════════════════

/** 难度 → 降临点数基准。easy 最丰、inferno 最紧。 */
export const CREATION_DIFFICULTY_POINT_BASE: Record<CombatRiskMode, number> = {
  easy: 14,
  normal: 10,
  hard: 7,
  inferno: 4,
};

/** 世界系数缺省值（无 stat 模块 / 未配置 pointScale 时使用）。 */
export const CREATION_POINT_SCALE_DEFAULT = 1;
export const CREATION_POINT_SCALE_MIN = 0.5;
export const CREATION_POINT_SCALE_MAX = 2;

/** 每 1 点属性 = 属性上限的 5%。 */
export const CREATION_STAT_POINT_RATIO = 0.05;

/** 命运抽卡上限（每角色）。 */
export const CREATION_MAX_DRAWS = 5;

/** 单次抽卡基础花费（× 世界系数）。 */
export const CREATION_DRAW_COST_BASE = 1;

/** 神技天赋的 cost 阈值：≥ 此值 = 只能通过命运抽卡获得，无法直选。 */
export const DIVINE_TALENT_COST = 99999;

/** 抽卡稀有度权重（神技 rarity='传说' 自然落入最低档）。 */
export const CREATION_RARITY_WEIGHTS: Record<TalentDef['rarity'], number> = {
  '普通': 55,
  '精良': 25,
  '稀有': 12,
  '史诗': 6,
  '传说': 2,
};

// ═══════════════════════════════════════════════════════════════
// 难度展示字典（DifficultySelector / StepConfirm / RightPanel 共用）
// ═══════════════════════════════════════════════════════════════

export const DIFFICULTY_LABELS: Record<CombatRiskMode, string> = {
  easy: '简单',
  normal: '普通',
  hard: '困难',
  inferno: '炼狱',
};

export const DIFFICULTY_DESCRIPTIONS: Record<CombatRiskMode, string> = {
  easy: '战败自动恢复战前状态，无任何永久损失；降临点数最丰。',
  normal: '可在战前检查点重打，归零后失去战力但可继续。',
  hard: '可重打；战斗可能造成重伤或死亡。',
  inferno: '不可重打或历史回滚；玩家死亡后存档封存为只读；降临点数最紧。',
};

/** 无战斗模块世界的点数向短文案（不提战斗风险）。 */
export const DIFFICULTY_POINT_DESCRIPTIONS: Record<CombatRiskMode, string> = {
  easy: '最丰厚的降临点数，从容塑造开局。',
  normal: '标准降临点数，均衡的开局起点。',
  hard: '点数收紧，开局需要精打细算。',
  inferno: '点数极度匮乏，命运几无余地。',
};

// ═══════════════════════════════════════════════════════════════
// 纯函数
// ═══════════════════════════════════════════════════════════════

/** 非法/缺省 → 1.0；合法值 clamp 到 [0.5, 2]。 */
export function clampPointScale(value: unknown): number {
  const numeric = typeof value === 'number' && Number.isFinite(value) ? value : CREATION_POINT_SCALE_DEFAULT;
  return Math.min(CREATION_POINT_SCALE_MAX, Math.max(CREATION_POINT_SCALE_MIN, numeric));
}

/** 从世界定义读取降临点数系数（stat 模块 moduleConfig.pointScale；缺省 1.0）。 */
export function resolveWorldPointScale(worldDef?: WorldDef | null): number {
  const statModule = worldDef?.modules?.find(m => m.moduleId === 'stat' && m.enabled);
  if (!statModule?.moduleConfig) return CREATION_POINT_SCALE_DEFAULT;
  return clampPointScale((statModule.moduleConfig as Record<string, unknown>).pointScale);
}

/** 点数池总量 = round(难度基准 × 世界系数)，下限 1。 */
export function computeCreationPool(riskMode: CombatRiskMode, pointScale: number): number {
  return Math.max(1, Math.round(CREATION_DIFFICULTY_POINT_BASE[riskMode] * pointScale));
}

/** 每 1 点属性增益 = ceil(属性上限 × 5%)，下限 1。 */
export function statPointGain(cap: number): number {
  const safeCap = Number.isFinite(cap) && cap > 0 ? cap : 0;
  return Math.max(1, Math.ceil(safeCap * CREATION_STAT_POINT_RATIO));
}

/** 神技判定：cost ≥ 99999 表示只能抽到，无法直选。 */
export function isDivineTalent(talent: { cost: number }): boolean {
  return talent.cost >= DIVINE_TALENT_COST;
}

/** 天赋直选价：神技 → Infinity（UI 禁用）；否则 max(1, round(cost × 系数))。 */
export function talentDirectCost(cost: number, pointScale: number): number {
  if (cost >= DIVINE_TALENT_COST) return Number.POSITIVE_INFINITY;
  return Math.max(1, Math.round(cost * pointScale));
}

/** 单次抽卡价：max(1, round(基础价 × 系数))。 */
export function creationDrawCost(pointScale: number): number {
  return Math.max(1, Math.round(CREATION_DRAW_COST_BASE * pointScale));
}

/**
 * 命运抽卡：从候选天赋中按稀有度加权随机抽一个。
 * 过滤：已拥有 / 互斥组冲突 / 前置未满足。空池返回 null。
 */
export function drawRandomTalent(
  talents: readonly InnateTalentDef[],
  ownedIds: readonly string[],
): InnateTalentDef | null {
  const owned = new Set(ownedIds);
  const ownedList = talents.filter(t => owned.has(t.id));
  const ownedGroups = new Set(ownedList.map(t => t.exclusiveGroup).filter((g): g is string => Boolean(g)));
  const candidates = talents.filter(talent => {
    if (owned.has(talent.id)) return false;
    if (talent.exclusiveGroup && ownedGroups.has(talent.exclusiveGroup)) return false;
    if (talent.prerequisites?.length && talent.prerequisites.some(p => !owned.has(p))) return false;
    return true;
  });
  if (candidates.length === 0) return null;
  const weights = candidates.map(t => CREATION_RARITY_WEIGHTS[t.rarity ?? '普通'] ?? CREATION_RARITY_WEIGHTS['普通']);
  const total = weights.reduce((sum, w) => sum + w, 0);
  let cursor = Math.random() * total;
  for (let i = 0; i < candidates.length; i++) {
    cursor -= weights[i];
    if (cursor <= 0) return candidates[i];
  }
  return candidates[candidates.length - 1];
}

/** 降临点数花费总账。 */
export interface CreationSpending {
  pool: number;
  talentSpent: number;
  drawSpent: number;
  statSpent: number;
  totalSpent: number;
  remaining: number;
  ok: boolean;
  reason?: string;
}

/**
 * 统一点数池校验：天赋直选 + 抽卡 + 属性加点共享一个池。
 * 神技花费计 0（只能抽到，抽中免费）；超支即 ok:false。
 */
export function computeCreationSpending(
  config: ProfessionModuleSchema,
  plan: {
    riskMode: CombatRiskMode;
    pointScale: number;
    talentIds: readonly string[];
    drawnTalentIds?: readonly string[];
    drawCount: number;
    allocations: Record<string, number>;
  },
): CreationSpending {
  const pool = computeCreationPool(plan.riskMode, plan.pointScale);
  const owned = new Set(plan.talentIds);
  const drawn = new Set(plan.drawnTalentIds ?? []);
  const talentSpent = (config.innateTalents ?? []).reduce((sum, talent) => {
    if (!owned.has(talent.id) || drawn.has(talent.id)) return sum;
    return sum + (isDivineTalent(talent) ? 0 : talentDirectCost(talent.cost, plan.pointScale));
  }, 0);
  const drawSpent = Math.max(0, plan.drawCount) * creationDrawCost(plan.pointScale);
  const statSpent = Object.values(plan.allocations ?? {}).reduce(
    (sum, value) => sum + (typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0),
    0,
  );
  const totalSpent = talentSpent + drawSpent + statSpent;
  const remaining = pool - totalSpent;
  const ok = remaining >= 0;
  return {
    pool,
    talentSpent,
    drawSpent,
    statSpent,
    totalSpent,
    remaining,
    ok,
    reason: ok ? undefined : `降临点数不足：已用 ${totalSpent} / ${pool}。请减少天赋、抽卡或属性分配。`,
  };
}

function numericInitValue(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  return numericInitValue(record.value) ?? numericInitValue(record.current);
}

function rangeFloor(value: unknown): number | undefined {
  if (!Array.isArray(value)) return undefined;
  return numericInitValue(value[0]);
}

/**
 * Merge a stat module's static definitions with its runtime initial values so
 * creation-time allocation always starts from the same bases as the engine.
 */
export function resolveCreationStatConfig(
  moduleConfig: Record<string, unknown> = {},
  initialState: Record<string, unknown> = {},
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...moduleConfig };

  for (const key of ['attrA', 'attrB'] as const) {
    const source = moduleConfig[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const attr = source as Record<string, unknown>;
    next[key] = {
      ...attr,
      current: numericInitValue(initialState[key]) ?? numericInitValue(attr.current) ?? 0,
    };
  }

  for (const key of ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const) {
    const source = moduleConfig[key];
    if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
    const dim = source as Record<string, unknown>;
    next[key] = {
      ...dim,
      value: numericInitValue(initialState[key])
        ?? numericInitValue(initialState[`${key}Value`])
        ?? numericInitValue(dim.value)
        ?? rangeFloor(dim.range)
        ?? 0,
    };
  }

  if (Array.isArray(moduleConfig.special)) {
    const initialSpecial = initialState.special && typeof initialState.special === 'object' && !Array.isArray(initialState.special)
      ? initialState.special as Record<string, unknown>
      : {};
    next.special = moduleConfig.special.map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const special = item as Record<string, unknown>;
      const id = typeof special.id === 'string' ? special.id : '';
      return {
        ...special,
        value: numericInitValue(initialSpecial[id])
          ?? numericInitValue(special.value)
          ?? rangeFloor(special.range)
          ?? 0,
      };
    });
  }

  return next;
}

// ═══════════════════════════════════════════════════════════════
// 属性加点 → moduleInitData['数值属性'] 物化
// ═══════════════════════════════════════════════════════════════

function clampRange(value: number, min: number, cap: number): number {
  return Math.max(min, Math.min(cap, value));
}

/**
 * 把属性加点分配物化成与旧 StatsTab 写入完全一致的
 * moduleInitData['数值属性'] 数据形状：
 *   attrA/attrB → { current }
 *   dim1-6      → { value }（仅存在的维度）
 *   special     → { [id]: { value } }（仅存在特色属性时）
 * 值 = 基础值 + 分配点数 × 每点增益（clamp 到上限）。
 */
export function materializeStatInitData(
  statConfig: Record<string, unknown>,
  allocations: Record<string, number>,
): Record<string, unknown> {
  const config = statConfig as Partial<StatModuleSchema> & Record<string, unknown>;
  const alloc = (key: string): number => {
    const value = allocations?.[key];
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  };
  const next: Record<string, unknown> = {};

  for (const key of ['attrA', 'attrB'] as const) {
    const attr = config[key];
    if (!attr || typeof attr !== 'object') continue;
    const cap = attr.max;
    const gain = statPointGain(cap);
    const base = attr.current;
    next[key] = { current: clampRange(base + alloc(key) * gain, 0, cap) };
  }

  for (const key of ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const) {
    const dim = config[key] as { value: number; range: [number, number] } | undefined;
    if (!dim || typeof dim !== 'object') continue;
    const cap = dim.range?.[1];
    const min = dim.range?.[0];
    if (typeof min !== 'number' || !Number.isFinite(min) || typeof cap !== 'number' || !Number.isFinite(cap) || cap <= min) continue;
    const gain = statPointGain(cap);
    next[key] = { value: clampRange(dim.value + alloc(key) * gain, min, cap) };
  }

  const special = config.special;
  if (Array.isArray(special) && special.length > 0) {
    const specialNext: Record<string, { value: number }> = {};
    for (const sp of special) {
      if (!sp || typeof sp !== 'object' || typeof sp.id !== 'string') continue;
      const cap = sp.range?.[1];
      const min = sp.range?.[0];
      if (typeof min !== 'number' || !Number.isFinite(min) || typeof cap !== 'number' || !Number.isFinite(cap) || cap <= min) continue;
      const gain = statPointGain(cap);
      specialNext[sp.id] = { value: clampRange(sp.value + alloc(sp.id) * gain, min, cap) };
    }
    next.special = specialNext;
  }

  return next;
}
