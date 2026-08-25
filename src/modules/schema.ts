// ============================================================
//  世界模块化系统 v2 — Schema 类型定义
//  框架层零指向性，所有世界相关内容由AI生成时注入
// ============================================================

import type { WorldBookEntryDef } from '../data/worlds-schema';
import type {
  GameplayComparator,
  GameplayCondition,
  GameplayCost,
  GameplayEffect,
  GameplayLiteral,
  GameplayReward,
} from '../gameplay/types';
import type { NarrativeDecisionAction } from '../gameplay/narrativeDecision';
import type { CombatEncounterRequest } from '../gameplay/protocols';

// ─── 数值属性模块 ───

/** 六维单个属性 */
export interface SixDimStat {
  name: string;           // AI生成的中文名
  value: number;          // 当前值
  range: [number, number]; // [最小值, 最大值]
  /** 面向职业公式与自动检定的稳定语义；显示名仍可随世界变化。 */
  semanticRole?: SixDimSemanticRole;
  description?: string;
}

export type SixDimSemanticRole = 'power' | 'guard' | 'agility' | 'intellect' | 'social' | 'perception';

/** 特色属性 */
export interface SpecialStat {
  id: string;             // 英文标识
  name: string;           // AI生成的中文名
  value: number;          // 当前值
  range: [number, number];
  description: string;    // AI生成的描述
}

export interface StatModifierDefinition {
  id: string;
  statId: string;
  delta: number;
  mode?: 'flat' | 'percent';
  source?: string;
  durationTicks?: number;
  permanent?: boolean;
}

export interface DerivedStatDefinition {
  id: string;
  name: string;
  inputs: string[];
  formula?: 'sum' | 'average' | 'min' | 'max' | 'ratio';
  scale?: number;
  offset?: number;
  min?: number;
  max?: number;
}

/** 完整的数值属性模块 */
export interface StatModuleSchema {
  /** 底层必选 - 生命类属性 */
  attrA: { name: string; current: number; max: number };
  /** 底层必选 - 能量类属性 */
  attrB: { name: string; current: number; max: number };
  /** 六维属性（可选，经营/日常等世界可以不要） */
  dim1?: SixDimStat;
  dim2?: SixDimStat;
  dim3?: SixDimStat;
  dim4?: SixDimStat;
  dim5?: SixDimStat;
  dim6?: SixDimStat;
  /** 特色属性（0~4个） */
  special: SpecialStat[];
  derived?: DerivedStatDefinition[];
  modifiers?: StatModifierDefinition[];
}

// ─── 成长体系模块 ───

/** 属性上限（段位制和等级制共用） */
export interface StatBonuses {
  attrAMax: number;
  attrBMax: number;
  dim1Max: number;
  dim2Max: number;
  dim3Max: number;
  dim4Max: number;
  dim5Max: number;
  dim6Max: number;
}

/** 单个段位定义（段位制专用） */
export interface TierDef {
  name: string;           // AI生成的段位名
  description: string;    // AI生成的描述
  xpRequired: number;     // 升到此段累计需要的XP（由算法计算）
  statBonuses: StatBonuses; // 该段位的属性上限
}

/** 等级制专用数据 */
export interface LevelData {
  maxLevel: number;           // 等级上限（如100）
  baseStats: StatBonuses;     // 0级属性天花板
  growthPerLevel: StatBonuses; // 每级属性增长量
}

/** XP计算公式参数 */
export interface XpFormula {
  baseXP: number;         // 基础XP（如100）
  exponent: number;       // 指数（1.0=线性，1.5=递增，2.0=快速递增）
  scaleFactor: number;    // 缩放系数（默认1.0）
}

/**
 * 成长体系配置（静态，存放在世界系统中）
 * 创建世界时设定，不频繁变化
 */
export interface ProgressionConfig {
  mode: 'tiered' | 'level';
  xpFormula: XpFormula;
  // ── 二选一（OR 关系，由 mode 决定读哪个） ──
  /** 段位制：命名段位列表 */
  tiers?: TierDef[];
  /** 等级制：公式化等级数据 */
  levelData?: LevelData;
  /** 叙事风格（仅段位制，用于描述突破时的表现） */
  narrativeStyle?: {
    upgradeDesc: string;
    keywords: string[];
  };
  /** 本地确定性成长来源；未配置时由模块适配器提供保守默认值。 */
  activityRewards?: Array<{
    id: string;
    label: string;
    keywords: string[];
    /** 占升到下一阶段所需经验的比例（0~1）。 */
    rate: number;
  }>;
  /** 每次升段/升级时发放的通用点数。 */
  pointsPerTier?: {
    attribute?: number;
    talent?: number;
    skill?: number;
  };
  breakthroughs?: Array<{
    tierIndex: number;
    conditions?: GameplayCondition[];
    costs?: GameplayCost[];
    rewards?: GameplayEffect[];
    description?: string;
  }>;
}

/**
 * 成长体系状态（动态，存放在变量系统中）
 * AI 每次回复可能更新
 */
export interface ProgressionState {
  currentTierIndex: number;   // 当前段位/等级索引
  currentXP: number;          // 当前经验值
}

/**
 * 完整的成长体系模块（兼容旧格式）
 * @deprecated 新代码请使用 ProgressionConfig + ProgressionState 分离读取
 */
export interface ProgressionModuleSchema extends ProgressionConfig, ProgressionState {}

// ─── 生存资源模块 ───

/** 单个生存资源 */
export interface SurvivalResource {
  id: string;             // 英文标识 (如 'water', 'food')
  name: string;           // 资源名（如"淡水"、"木材"）
  symbol: string;         // 符号（如💧🪵）
  amount: number;         // 当前数量
  max: number;            // 上限（生存资源必须有上限）
  scarce: boolean;        // 是否稀缺
  gatherRate?: string;    // 采集速率描述（AI参考，如"每天可采集3单位"）
  usage?: string;         // 消耗速率描述（AI参考，如"每天消耗1单位"）
  /** 一次手动采集的产量；缺省为 1。 */
  gatherAmount?: number;
  /** 一次手动采集推进的世界分钟数；缺省为 30。 */
  gatherTimeMinutes?: number;
  /** 一次手动采集消耗的体力；缺省为 5。 */
  gatherStaminaCost?: number;
  description: string;    // 获取方式与用途
}

/** 制作配方 */
export interface SurvivalRecipe {
  id: string;
  name: string;           // 制作结果名称
  inputs: Record<string, number>;  // 输入资源 { "木材": 2, "石头": 1 }
  output: { resourceId: string; amount: number };
  /** 明确的制作耗时；缺失的旧配方不会被机械加时。 */
  craftTimeMinutes?: number;
  description: string;
  unlockConditions?: GameplayCondition[];
  unlockCost?: GameplayCost[];
}

/** 资源演化蓝图条目 */
export interface ResourceEvolutionStep {
  /** 唯一标识 */
  id: string;
  /**
   * 触发条件（两层机制）：
   * - 层A 游戏内动态新增：trigger.keywords 命中当前活跃事件文本或玩家本轮对话时触发
   * - 层B 轮次兜底：afterRounds 设置后，到达该轮次强制触发（即使关键词未命中）
   * 两层满足其一即触发；触发后仅执行一次（记录在 simulationRuntime.evolvedSteps）。
   */
  trigger: { keywords: string[] };
  /** 层B：强制触发的轮次（>= 该轮次即触发，用于"到后期出现 X 资源"） */
  afterRounds?: number;
  /** 新增的资源 */
  add?: SurvivalResource[];
  /** 移除的资源 id（枯竭/被替代，如石器时代后期淘汰木头） */
  remove?: string[];
  /** 叙事提示（喂给 AI 做渲染） */
  narrateHint?: string;
}

/** 结构化消耗规则（运行时确定性执行，不依赖 AI 解读文字） */
export interface SurvivalConsumption {
  /** 每周期自动消耗的资源 { resourceId: 消耗量 } */
  perCycle: Record<string, number>;
  /** 资源耗尽时的属性惩罚 { 属性id: 每轮扣减值 } */
  exhaustionPenalty?: Record<string, number>;
}

/** 完整的生存资源模块 */
export interface SurvivalModuleSchema {
  description: string;
  resources: SurvivalResource[];
  recipes?: SurvivalRecipe[];
  rules: {
    cycleName: string;          // 结算周期名（"一天"/"一个回合"）
    consumePerCycle: string;    // 每周期自动消耗描述（AI参考）
    criticalThreshold: number;  // 低于此值触发危机（默认2）
  };
  /** 结构化消耗规则（运行时确定性执行） */
  consumption?: SurvivalConsumption;
  statuses?: Array<{ id: string; name: string; description?: string; durationTicks?: number; statEffects?: GameplayEffect[] }>;
  /** 资源演化蓝图（世界创建时 AI 生成） */
  resourceEvolution?: ResourceEvolutionStep[];
  /** AI可添加自定义字段 */
  [key: string]: unknown;
}

// ─── 经营资产模块 ───

/** 单个经营资产 */
export interface BusinessAsset {
  id: string;              // 英文标识 (如 'tavern', 'mine')
  name: string;            // AI 生成名称（如"酒馆"/"灵田"）
  type: string;            // AI 生成类别（如"餐饮"/"修炼"/"回收"）
  level: number;           // 当前等级 (1~maxLevel)
  maxLevel: number;        // 最大等级
  description: string;     // AI 生成描述
  /** 缺省为 true 以兼容旧世界；false 时需要玩家在经营面板购置。 */
  initiallyOwned?: boolean;

  /** 收益（每周期） */
  income: {
    base: number;          // 基础收益
    perLevel: number;      // 每级额外收益
    resource?: string;     // 产出资源名（可选）
    cycle: string;         // 结算周期："天"/"周"/"回合"
    inputs?: Record<string, number>;
    outputs?: Record<string, number>;
  };

  /** 每周期维护费 */
  maintenance: number;
  /** 升级费用（资金） */
  upgradeCost?: number;
  purchaseCost?: number;
  purchaseMaterials?: Record<string, number>;
  /** 升级所需材料 */
  upgradeMaterials?: Record<string, number>;

  /** 员工（可选） */
  staff?: {
    current: number;
    max: number;
    efficiency: number;    // 效率系数 0.5~2.0
  };

  /** 风险（可选） */
  risk?: {
    level: 'low' | 'medium' | 'high';
    description: string;
  };

  /** 可选市场标签，用于匹配行情；缺省时回退到 type/name。 */
  marketTags?: string[];

  status: 'active' | 'idle' | 'damaged' | 'destroyed';
  /** AI可添加自定义字段 */
  [key: string]: unknown;
}

/** 市场行情条目 */
export interface MarketItem {
  name: string;
  basePrice: number;
  trend: 'up' | 'down' | 'stable';
  changePercent: number;
}

/** 经营日志条目 */
export interface TransactionEntry {
  cycle: number;
  type: 'income' | 'expense' | 'acquire' | 'upgrade' | 'event';
  description: string;
  amount?: number;
}

/** 完整的经营资产模块 */
export interface BusinessModuleSchema {
  description: string;      // 经济环境描述
  funds: number;            // 总资金
  cycleName: string;        // 结算周期名（"天"/"周"/"回合"）
  assets: BusinessAsset[];  // 资产列表
  inventory?: Record<string, number>;
  /** 市场行情（可选） */
  market?: {
    items: MarketItem[];
  };
  /** 经营日志（可选） */
  transactionLog?: TransactionEntry[];
  /** 确定性经营规则；不配置时使用保守默认值。 */
  economy?: {
    /** 市场涨跌对资产营收的最大影响比例（0~1）。 */
    marketWeight?: number;
    /** 资金不足时是否自动暂停高维护资产。 */
    autoIdleOnDeficit?: boolean;
    /** 最多保留的经营日志条数。 */
    logLimit?: number;
    production?: Array<{
      id: string;
      name: string;
      inputs: Record<string, number>;
      outputs: Record<string, number>;
      cycles?: number;
      unlockConditions?: GameplayCondition[];
    }>;
  };
  /** AI可添加自定义字段 */
  [key: string]: unknown;
}

// ─── 骰子检定模块 ───

export type DiceAdvantageMode = 'normal' | 'advantage' | 'disadvantage';

/** 骰子检定结果 */
export interface DiceRoll {
  /** 对应触发该检定的消息与占位符；用于自动检定防重放。 */
  requestId?: string;
  attributeId?: string;
  attributeName: string;  // 使用的属性名称
  attributeValue: number; // 属性当前值
  modifier: number;       // 属性修正值
  d20: number;            // 骰出的d20值
  total: number;          // 总值 = d20 + modifier
  dc: number;             // 难度等级
  success: boolean;       // 是否成功
  isNatural20: boolean;   // 是否大成功
  isNatural1: boolean;    // 是否大失败
  timestamp: number;      // 掷骰时间
  /** 进行优势/劣势检定时保留两次骰面，d20 为最终采用的骰面。 */
  diceRolls?: number[];
  advantageMode?: DiceAdvantageMode;
  resultTier?: 'critical-failure' | 'failure' | 'partial' | 'success' | 'critical-success';
  talentModifier?: number;
  bonuses?: Array<{ source: string; value: number }>;
}

/** 由已拥有职业能力/先天天赋动态投影出的检定加成，不写回世界定义。 */
export interface DiceRuntimeBonus {
  source: string;
  value: number;
  /** 缺省表示适用于所有属性；通常应限制到具体规范属性。 */
  statIds?: CombatScalingStatId[];
}

/** 完整的骰子检定模块 */
export interface DiceModuleSchema {
  lastRoll?: DiceRoll;    // 最近一次掷骰结果
  history?: DiceRoll[];   // 掷骰历史（最多保留10次）
  sides?: number;
  defaultDC?: number;
  historyLimit?: number;
  modifierBase?: number;
  modifierStep?: number;
  criticalSuccess?: number;
  criticalFailure?: number;
  partialSuccessMargin?: number;
  resultTiers?: { criticalFailure?: string; failure?: string; partial?: string; success?: string; criticalSuccess?: string };
  runtimeBonuses?: DiceRuntimeBonus[];
}

// ─── 天赋体系模块 ───

/** 天赋条目 */
export interface TalentDef {
  id: string;              // 英文标识
  name: string;            // 天赋名
  description: string;     // 描述
  rarity: '普通' | '精良' | '稀有' | '史诗' | '传说';  // 品质
  effects?: string[];      // 效果描述（纯文本，供AI参考）
  maxRank?: number;
  pointCost?: number;
  unlockConditions?: GameplayCondition[];
  /** 可选机械效果；可读写任意合法玩法路径，因此也能作用于经营等模块。 */
  mechanics?: {
    passive?: GameplayEffect[];
    onUnlock?: GameplayEffect[];
  };
  diceModifier?: number;
  /** 需要先解锁的天赋节点（全部满足）。旧配置缺省即无前置。 */
  prerequisites?: string[];
  /** 同一互斥组只能选择一个分支；缺省表示不互斥。 */
  exclusiveGroup?: string;
  /** 用于样板树的分支标识。 */
  branch?: string;
  /** 可配置树坐标（0~100 的百分比）；缺省由 UI 自动排布。 */
  graph?: { x: number; y: number; column?: number; row?: number };
  /** 各等级的点数消耗；缺省回退到 pointCost。 */
  rankCosts?: number[];
  /** 满足条件后将此节点觉醒为强化形态。 */
  awakening?: {
    id?: string;
    name: string;
    description: string;
    conditions?: GameplayCondition[];
    pointCost?: number;
    effects?: GameplayEffect[];
  };
  /** 可占用的角色装备槽（例如核心天赋/战斗专长）。 */
  equipmentSlot?: string;
}

/** 可主动使用或持续成长的技能定义。 */
export interface SkillDef {
  id: string;
  name: string;
  description: string;
  categoryId?: string;
  rarity: TalentDef['rarity'];
  maxRank?: number;
  pointCost?: number;
  cooldownTicks?: number;
  tags?: string[];
  unlockConditions?: GameplayCondition[];
  activation?: {
    costs?: GameplayCost[];
    effects?: GameplayEffect[];
    rewards?: GameplayReward[];
  };
  prerequisites?: string[];
  exclusiveGroup?: string;
  branch?: string;
  graph?: { x: number; y: number; column?: number; row?: number };
  rankCosts?: number[];
  /** 技能使用时自动积累熟练度，达到阈值可提升等级。 */
  proficiency?: {
    gainPerUse?: number;
    thresholdPerRank?: number;
    maxRank?: number;
  };
  /** 技能达到条件后可觉醒。 */
  awakening?: {
    id?: string;
    name: string;
    description: string;
    conditions?: GameplayCondition[];
    pointCost?: number;
    effects?: GameplayEffect[];
  };
  equipmentSlot?: string;
  diceModifier?: number;
}

/** 天赋大类 */
export interface TalentCategoryDef {
  id: string;              // 英文标识
  name: string;            // AI生成的大类名（如"灵根"、"体质"、"血脉"）
  description: string;     // 大类描述
  talents: TalentDef[];    // 该大类下的天赋列表
}

/** 完整的天赋体系模块 */
export interface TalentModuleSchema {
  categories: TalentCategoryDef[];  // AI生成的天赋大类列表
  skills?: SkillDef[];
  pointRules?: {
    initialTalentPoints?: number;
    initialSkillPoints?: number;
    talentPointsPerTier?: number;
    skillPointsPerTier?: number;
  };
  /** 角色可用装备槽；仅记录槽定义，不强制旧世界启用。 */
  equipmentSlots?: Array<{ id: string; name: string; capacity?: number; description?: string }>;
  /** 洗点配置；未配置时仍允许无损洗点（保持旧行为兼容）。 */
  respec?: { enabled?: boolean; cost?: GameplayCost[] };
}

// ─── 职业、先天天赋与自由技能（新架构） ───

export type ProfessionAbilityType = 'active' | 'passive' | 'specialization' | 'ultimate';

export type ProfessionAccentKey = 'crimson' | 'amber' | 'jade' | 'azure' | 'violet' | 'silver';

export type CombatScalingStatId = 'attrA' | 'attrB' | 'dim1' | 'dim2' | 'dim3' | 'dim4' | 'dim5' | 'dim6';

/** 已解锁后持续生效的确定性战斗修正。 */
export interface ProfessionCombatModifiers {
  damage?: number;
  healing?: number;
  accuracy?: number;
  armor?: number;
  initiative?: number;
}

/** 已解锁后作用于指定规范属性检定的固定加值。 */
export interface ProfessionCheckModifier {
  statIds?: CombatScalingStatId[];
  value: number;
}

/** 职业节点/先天天赋的可执行机械定义；描述文字不能替代这里的数值。 */
export interface ProfessionAbilityMechanics {
  combat?: ProfessionCombatModifiers;
  checks?: ProfessionCheckModifier[];
}

export interface ProfessionAbilityDef {
  id: string;
  name: string;
  description: string;
  type: ProfessionAbilityType;
  maxRank?: number;
  pointCost?: number;
  rankCosts?: number[];
  prerequisites?: string[];
  /** 前置默认 all；共享终极等节点可明确声明任一前置即可。 */
  prerequisiteMode?: 'all' | 'any';
  exclusiveGroup?: string;
  requiredProfessionLevel?: number;
  /** 树上的明确阶层；用于图形布局与等级门槛，不再靠数组顺序猜测。 */
  tier?: number;
  cooldownTicks?: number;
  tags?: string[];
  /** Optional local-dictionary icon key; URLs and paths are never accepted. */
  iconKey?: string;
  activation?: {
    costs?: GameplayCost[];
    effects?: GameplayEffect[];
    rewards?: GameplayReward[];
    /** 战斗中使用该能力时的声明式行动；不会执行任意代码。 */
    combatAction?: CombatActionDefinition;
  };
  passiveEffects?: GameplayEffect[];
  diceModifier?: number;
  mechanics?: ProfessionAbilityMechanics;
}

export interface ProfessionDef {
  id: string;
  name: string;
  description: string;
  archetype?: string;
  tags?: string[];
  visual?: { emblemKey?: string; accentKey?: ProfessionAccentKey };
  abilities: ProfessionAbilityDef[];
}

/** 只能在创建角色时选择；进入游戏后不靠点数购买。 */
export interface InnateTalentDef {
  id: string;
  name: string;
  description: string;
  cost: number;
  rarity?: TalentDef['rarity'];
  exclusiveGroup?: string;
  prerequisites?: string[];
  effects?: GameplayEffect[];
  mechanics?: ProfessionAbilityMechanics;
  tags?: string[];
  /** Optional local-dictionary icon key; URLs and paths are never accepted. */
  iconKey?: string;
}

export interface ProfessionModuleSchema {
  schemaVersion?: 2;
  professions: ProfessionDef[];
  innateTalents: InnateTalentDef[];
  freeSkillCatalog?: SkillDef[];
  /** v2 canonical alias; freeSkillCatalog remains a compatibility projection. */
  freeSkills?: SkillDef[];
  creationTalentBudget: number;
  allowNoProfession?: boolean;
  initialAbilityPoints?: number;
  abilityPointsPerTier?: number;
}

/** 独立职业包元数据。职业内容不再内嵌进世界定义。 */
export interface ProfessionPackManifest {
  id: string;
  name: string;
  version: string;
  schemaVersion: 1 | 2;
  description?: string;
  author?: string;
  createdAt?: number;
  updatedAt?: number;
  builtin?: boolean;
  tags?: string[];
}

/** 可复用、可导入导出的职业内容资产。 */
export interface ProfessionPack extends ProfessionModuleSchema {
  schemaVersion?: 2;
  manifest: ProfessionPackManifest;
  /** Legacy v1 packs may be usable before they reach the v3 baseline. */
  baselineStatus?: 'v3-complete' | 'legacy-v1-incomplete';
}

/** 世界只持有包引用与选择范围；包正文由职业典藏解析。 */
export interface ProfessionWorldBinding {
  packIds: string[];
  enabledProfessionIds?: string[];
  allowNoProfession?: boolean;
  creationTalentBudget?: number;
}

// ─── 独立战斗规则域 ───

export type CombatTargetMode = 'enemy' | 'ally' | 'self' | 'area' | 'none';

export interface CombatStatusDefinition {
  id: string;
  name: string;
  description?: string;
  durationRounds?: number;
  damagePerRound?: number;
  /** Additive runtime modifiers. Supported keys: armor, accuracy, damage, healing. */
  modifiers?: Record<string, number>;
}

/** 职业行动的世界无关公式：以规范属性键引用当前世界的实际数值。 */
export interface CombatScalingDefinition {
  statId: CombatScalingStatId;
  /** 0.08 表示取该属性的 8%。 */
  coefficient: number;
  appliesTo?: 'damage' | 'healing' | 'accuracy';
}

/** 声明式战斗行动；运行时只解释这些字段，不执行世界/模块代码。 */
export interface CombatActionDefinition {
  id: string;
  name: string;
  description?: string;
  target?: CombatTargetMode;
  actionCost?: number;
  accuracy?: number;
  damage?: number;
  healing?: number;
  damageType?: string;
  cooldownRounds?: number;
  scaling?: CombatScalingDefinition[];
  appliesStatus?: CombatStatusDefinition;
}

export interface CombatEnemyDefinition {
  id: string;
  name: string;
  description?: string;
  maxHp: number;
  armor?: number;
  initiative?: number;
  actions?: CombatActionDefinition[];
  statuses?: CombatStatusDefinition[];
}

export interface CombatEncounterDefinition {
  id: string;
  name: string;
  description?: string;
  enemies: CombatEnemyDefinition[];
  roundLimit?: number;
  rewards?: GameplayEffect[];
}

export interface CombatModuleSchema {
  description?: string;
  actionPointsPerTurn?: number;
  playerActions?: CombatActionDefinition[];
  encounters: CombatEncounterDefinition[];
  /** Stat paths are configurable so worlds using attrA instead of 血量 remain compatible. */
  playerHpPath?: string;
  /** Optional maximum player HP for the encounter; defaults to current HP for legacy worlds. */
  playerMaxHp?: number;
  playerAttackPath?: string;
  playerArmor?: number;
  /** 玩家在遭遇开始时的先手值；敌人 initiative 参与同一排序。 */
  playerInitiative?: number;
  /** Use a fixed d20 result of 10 when no injected random source is provided. */
  deterministic?: boolean;
}

/** 世界仅选择稳定的内置战斗规则，不要求世界生成 AI 编写战斗代码或遭遇。 */
export interface CombatRulesetBinding {
  rulesetId: string;
}

// ─── 世界演化规则模块 ───

/**
 * 模块效果 — 带模块归属的变量更新
 * 应用前校验模块开关，未启用的模块静默跳过
 */
export interface ModuleEffects {
  /** 生存资源变化（如果启用生存模块） */
  survival?: {
    resources?: Record<string, { delta?: number; set?: number; min?: number }>;
    /** 动态添加新资源（资源发现/演化解锁） */
    addResources?: Array<{
      id: string; name: string; symbol: string;
      amount: number; max: number; scarce: boolean;
      gatherRate?: string; usage?: string; description?: string;
    }>;
    /** 动态移除资源（枯竭/被替代） */
    removeResources?: Array<{ id: string }>;
    /** 动态修改资源属性（稀缺度变化等） */
    updateResources?: Array<{
      id: string; max?: number; scarce?: boolean; gatherRate?: string;
    }>;
  };
  /** 经营资产变化（如果启用经营模块） */
  business?: {
    fundsDelta?: number;
    newAssets?: unknown[];
  };
  /** 数值属性变化（如果启用数值模块） */
  stats?: {
    changes?: Record<string, { delta?: number; set?: number; min?: number }>;
  };
  /** 成长体系变化（如果启用成长模块） */
  progression?: {
    xpDelta?: number;
    tierIndex?: number;
  };
}

/**
 * 事件效果 — 事件触发时应用的变量变化
 */
export interface EventEffect {
  /** 效果 ID */
  id: string;
  /** 优先级（数字大者先匹配） */
  priority: number;
  /** 命中多条时的叠加策略 */
  stackStrategy: 'add' | 'max' | 'override' | 'exclusive';
  /** 触发条件 */
  trigger: {
    /** 结构化 tag（优先匹配） */
    tags?: string[];
    /** 事件类型 */
    eventType?: string;
    /** 事件层级 */
    eventLevel?: string;
    /** 最低严重度 */
    severityMin?: number;
    /** 关键词兜底匹配 */
    keywords?: string[];
  };
  /** 变量影响 */
  effects: ModuleEffects;
}

/**
 * 周期规则 — 事件系统中唯一一类周期单元。
 * 由 eventWorldEvolution 每 tick 按 intervalTicks 静默结算（无 UI）。
 * 两种创作来源共享此类型：世界内置节拍（world.eventPacks）与可分享事件包（RuleFile.periodicRules）。
 */
export interface PeriodicRule {
  /** 规则 ID */
  id: string;
  /** 事件名称（用于日志） */
  name?: string;
  /** 触发间隔（轮次） */
  intervalTicks: number;
  /** 首次触发偏移（避免所有周期事件同轮爆发） */
  offsetTicks?: number;
  /** 可选守卫条件（每 N tick 触发时先检查 when，满足才执行 actions） */
  when?: Condition;
  /**
   * 动作序列（统一效果系统，所有效果通过 Action[] 表达）。
   * 支持：set / addEvent / requestCombat / modifyResource / scheduleTick。
   */
  actions?: Action[];
  /**
   * @deprecated 已废弃 — 请使用 actions 字段。
   * 旧版 ModuleEffects 格式，引擎会自动转换为 Action[] 执行。
   * 仅保留用于向后兼容旧数据，新数据不应使用此字段。
   */
  effects?: ModuleEffects;
  /** 事件描述（编辑器/AI 叙事用，引擎忽略） */
  description?: string;
  /** 结算后是否喂给 AI 做叙事渲染 */
  narrateToAI?: boolean;
}

/**
 * 世界状态更新规则
 */
export interface WorldStateRule {
  /** 规则 ID */
  id: string;
  /** 触发条件 */
  trigger: {
    tags?: string[];
    eventType?: string;
    keywords?: string[];
  };
  /** 更新内容（轴名 → 字段 → 新值） */
  updates: Record<string, Record<string, string>>;
}

/**
 * AI 叙事层安全护栏
 */
export interface NarrativeGuardrails {
  /** AI 单次声明各属性最大变动 */
  maxDeltaPerStat: Record<string, number>;
  /** AI 单次声明各资源最大变动 */
  maxDeltaPerResource: Record<string, number>;
  /** 允许 AI 用 set 的变量白名单 */
  setAllowedVars: string[];
  /** 允许 AI 创建新资源（动态资源发现） */
  allowCreateResources?: boolean;
  /** 新资源的默认最大值 */
  newResourceDefaultMax?: number;
}

/**
 * 世界动态配置（静态配置，存 WorldDef.modules[]，moduleId: 'simulation'）
 * 周期事件（periodicEvents）已作为「周期卡」搬入事件/卡片系统（eventWorldEvolution），
 * 此处仅保留与「世界演化」语义解耦后的两项：世界状态规则 / 叙事护栏。
 * （原"状态轴 worldStateAxes"为死字段——运行时无任何读取，已从类型移除；历史世界 JSON 中残留的同名字段属惰性数据，不影响运行。）
 */
export interface WorldDynamics {
  /** 世界状态更新规则 */
  worldStateRules: WorldStateRule[];
  /** AI 叙事层的安全护栏 */
  narrativeGuardrails: NarrativeGuardrails;
}

/** 世界动态配置（编辑器 / 加载层用的别名，等同于 WorldDynamics；period 等已迁至事件系统，不再含 periodicEvents） */
export type WorldDynamicsConfig = WorldDynamics;

/**
 * 效果日志条目（可观测性）
 */
export interface EffectLogEntry {
  /** 发生轮次 */
  tick: number;
  /** 来源 */
  source: 'rule' | 'periodic' | 'ai' | 'npc';
  /** 规则 ID（如果是规则触发） */
  ruleId?: string;
  /** 所属模块 */
  module: 'survival' | 'business' | 'stats' | 'progression' | 'worldState';
  /** 变量名 */
  variable: string;
  /** 变动前的值 */
  before: number | string;
  /** 变动后的值 */
  after: number | string;
  /** 变动原因 */
  reason?: string;
}

/**
 * 延迟 tick 条目（scheduleTick 动作产出，到期后注入 events）
 */
export interface ScheduledTickEntry {
  /** 应触发的 tick 序号（= 当时 tick + after） */
  scheduledAt: number;
  /** 产生该条目的规则 id */
  ruleId: string;
  /** 到期时注入的事件 payload（含 type / where 等） */
  payload?: Record<string, unknown>;
}

/**
 * 世界演化运行时状态（进 GameState，随存档保存）
 */
export interface SimulationRuntimeState {
  /** 当前轮次 */
  tick: number;
  /** 周期事件已过 tick 计数：{ zombie_horde: 28 } */
  periodicCounters: Record<string, number>;
  /** 变动日志（可观测性） */
  effectLog: EffectLogEntry[];
  /** 已触发过的周期事件 id（用于一次性事件） */
  triggeredPeriodicEvents: string[];
  /** 已触发过的资源演化蓝图 id（每个演化步骤仅触发一次） */
  evolvedSteps?: string[];
  /** 延迟 tick 队列（scheduleTick 动作写入，每 tick 开始时消费到期条目） */
  scheduledTicks?: ScheduledTickEntry[];
  /** 周期规则产出的 addEvent 动作（同步段存入，async 段消费） */
  pendingAddEvents?: Array<{ eventId: string; eventPackId: string }>;
  /** 各包的 onceFired / cooldown 持久化快照（随存档保存，重启后恢复） */
  eventRuntimes?: Record<string, EventRuntimeState>;
}

/**
 * 创建默认的运行时状态
 */
export function createDefaultSimulationRuntimeState(): SimulationRuntimeState {
  return {
    tick: 0,
    periodicCounters: {},
    effectLog: [],
    triggeredPeriodicEvents: [],
    evolvedSteps: [],
  };
}

// ─── 世界系统聚合类型 ───

/**
 * 世界系统聚合类型 — 用于模块数据传递（UI 卡片、prompt 生成等）
 * 不再存放在 GameState 中，数据来源为 worldDef.modules[].moduleConfig
 */
export interface WorldSystemData {
  数值属性?: StatModuleSchema;
  成长体系?: ProgressionModuleSchema;
  生存资源?: SurvivalModuleSchema;
  经营资产?: BusinessModuleSchema;
  骰子检定?: DiceModuleSchema;
  天赋体系?: TalentModuleSchema;
  职业体系?: ProfessionModuleSchema;
  战斗系统?: CombatModuleSchema;
  世界动态?: WorldDynamics;
  /** 保留扩展性：自定义模块数据 */
  [key: string]: unknown;
}

// ============================================================
//  事件包系统 — 单一数据源类型
//  架构层持有，UI / 规则引擎 / 图编辑器均 import 自此文件。
//  规则 DSL 为声明式白名单，解释器永不执行玩家代码。
// ============================================================

// ─── 基础枚举 ───

/** 内容包分类：card = 事件包（弹卡片）/ rule = 规则（后台数值）/ worldbook = 世界书 / bundle = 混合包 */
export type EventPackType = 'card' | 'rule' | 'worldbook' | 'bundle';

/** 声明所需能力；规则引擎仅执行被授权的动作类型 */
export type Permission =
  | 'read_world_state'
  | 'modify_world_state'
  | 'add_card'
  | 'override_card'
  | 'register_tick'
  | 'emit_world_event'
  | 'provide_assets';

export type AssetKind = 'image' | 'text' | 'data' | 'audio';

// ─── 规则 DSL（白名单，非图灵完备） ───

export type Comparator = GameplayComparator;

/** Literal 仅基础值，禁止函数 / 引用 / 外部 IO */
export type Literal = GameplayLiteral;

export type Condition = GameplayCondition;

export type ActionKind =
  | 'set'
  | 'addEvent'
  | 'requestCombat'
  | 'modifyResource'
  | 'scheduleTick';

export type Action =
  | { set: { path: string; value: Literal } }
  | { addEvent: { eventId: string; eventPackId?: string } }
  | { requestCombat: CombatEncounterRequest }
  | { modifyResource: { key: string; delta: number } }
  | { scheduleTick: { after: number; payload?: Record<string, unknown> } };

/** 单条规则；每包 ≤128 条、单规则 then ≤16 动作、条件树深 ≤6 */
export interface EventRule {
  id: string;
  priority?: number;
  once?: boolean;
  cooldownTicks?: number;
  when: Condition;
  then: Action[];
}

/**
 * 规则文件（schema/rules.json 落盘形态）。
 * 规则的内部数据结构：when→then 规则 + 周期规则。
 */
export interface RuleFile {
  version: number;
  rules: EventRule[];
  /** 周期规则（与 rules 平级，随事件包分享；运行时注册进 eventWorldEvolution 按 tick 静默结算） */
  periodicRules?: PeriodicRule[];
  /** 节点位置（编辑器画布坐标，不参与规则逻辑，仅用于还原布局） */
  nodePositions?: Record<string, { x: number; y: number }>;
}

// ─── React Flow 节点图（规则编辑器） ───

export type EventNodeKind =
  | 'trigger'    // Zap   世界事件/关键词/层级触发
  | 'condition'  // GitBranch 与/或 逻辑门
  | 'effect'     // Gauge 变量变更
  | 'event'      // Swords 主动生成 SimEvent
  | 'worldState' // Globe  更新状态轴
  | 'guardrail'  // ShieldAlert 叙事层安全边界
  | 'periodic';  // Clock 周期触发器（每 N tick 静默结算）

/** 框架无关的图节点数据（ruleGraph 负责与 @xyflow/react 互转） */
export interface EventGraphNode {
  id: string;
  kind: EventNodeKind;
  label: string;
  /** 节点在画布上的位置（可选，自动布局或手动拖拽后持久化） */
  position?: { x: number; y: number };
  /** 触发条件（trigger / condition 节点承载，对应 EventRule.when） */
  when?: Condition;
  /** 动作序列（effect 节点承载，对应 EventRule.then） */
  actions?: Action[];
  /** EventEffect.trigger 语义字段（trigger 节点承载） */
  trigger?: {
    tags?: string[];
    eventType?: string;
    eventLevel?: string;
    severityMin?: number;
    keywords?: string[];
  };
  /** 周期触发间隔（periodic 节点 / 带 interval 的 trigger） */
  intervalTicks?: number;
  /** 周期首次偏移（避免所有周期事件同轮爆发） */
  offsetTicks?: number;
  /** 周期事件描述（编辑器/AI 叙事用） */
  description?: string;
  /** 结算后是否喂给 AI 做叙事渲染 */
  narrateToAI?: boolean;
  /**
   * @deprecated 已废弃 — 周期节点请通过连线 effect 节点产出 actions。
   * 旧版 ModuleEffects 格式，图转换时自动迁移为 actions。
   */
  effects?: ModuleEffects;
  /** 事件节点产出的 SimEvent 片段 */
  event?: Partial<SimEvent>;
  /** 世界状态轴更新（worldState 节点） */
  updates?: Record<string, Record<string, string>>;
  /** 叙事护栏（guardrail 节点） */
  guardrail?: Partial<NarrativeGuardrails>;
  /** 规则元数据（trigger 节点承载，对应 EventRule 顶层字段） */
  priority?: number;
  once?: boolean;
  cooldownTicks?: number;
  /** condition 节点的逻辑模式（默认 'and'）：多入边条件按此模式组合 */
  logicMode?: 'and' | 'or' | 'not';
  /** condition 节点的输入端口数（默认 2，NOT 门固定 1） */
  conditionInputCount?: number;
}

export type EventEdgeKind = 'flow' | 'constraint';

export interface EventGraphEdge {
  id: string;
  source: string;
  target: string;
  /** constraint = 护栏→效果 的虚线约束边（非执行流） */
  kind?: EventEdgeKind;
}

export interface EventGraph {
  nodes: EventGraphNode[];
  edges: EventGraphEdge[];
}

// ─── 世界事件（Swords 节点产出） ───
export interface SimEvent {
  id: string;
  title: string;
  level: string;
  severity: number;
  affectedFactions: string[];
  affectedNpcIds: string[];
  childEventIds: string[];
}

// ─── Manifest（manifest.json 落盘形态 = validate_mod 入参） ───
export interface Manifest {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  homepage?: string | null;
  engine: 'opt-event';
  schemaVersion: number;
  minAppVersion: string;
  type: EventPackType;
  coverColor: string;
  icon: string;
  enabledByDefault?: boolean;
  loadOrder?: number;
  dependencies?: string[];
  conflicts?: string[];
  permissions?: Permission[];
  rules?: string[];
  cards?: string[];
  assets?: { path: string; kind: AssetKind; size: number }[];
  checksum?: { manifest: string; assets: Record<string, string> };
  signature?: string | null;
  /** 绑定世界 ID（仅该世界的存档可见；为空则全局可见） */
  worldId?: string;
}

// ─── 发现态 / 注册表 / 校验 / 详情 ───

export interface EventMeta {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  type: EventPackType;
  coverColor: string;
  icon: string;
  schemaVersion: number;
  minAppVersion: string;
  loadOrder: number;
  enabledByDefault: boolean;
  homepage?: string | null;
  diskSizeBytes?: number;
  discoveredAt?: string;
}

export type EventRegistryStatus = 'installed' | 'enabled' | 'disabled';

export interface EventRegistryEntry {
  meta: EventMeta;
  enabled: boolean;
  status: EventRegistryStatus;
  registeredAt: string;
  lastEnabledAt?: string | null;
  /** 内置标记：来自世界树关联的事件包，不可删除 */
  builtin?: boolean;
}

export interface ValidationIssue {
  code: string;
  field?: string;
  message: string;
  /** 关联的图节点 id（用于 UI 点跳定位） */
  nodeId?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: ValidationIssue[];
  warnings: ValidationIssue[];
}

export interface RuleSummary {
  id: string;
  file: string;
  priority: number;
  once: boolean;
  cooldownTicks: number;
  when: Condition;
  actionKinds: ActionKind[];
  actionCount: number;
}

export interface CardSummary {
  id: string;
  title: string;
  file: string;
  kind: 'add' | 'override';
  overrideTarget?: string;
}

export interface WorldbookEntrySummary {
  id: string;
  title: string;
  category?: string;
  file: string;
}

export interface DepIssue {
  id: string;
  satisfied: boolean;
  reason?: string;
  requiredVersion?: string;
  actualVersion?: string | null;
}

export interface ConflictStatus {
  id: string;
  active: boolean;
}

export interface EventRuntimeState {
  onceFired: Record<string, boolean>;
  cooldownRemaining: Record<string, number>;
  lastTick?: number;
  worldbook?: Record<string, boolean>;
  custom?: Record<string, unknown>;
}

export interface EventDetail {
  meta: EventRegistryEntry;
  manifest: Manifest;
  rulesSummary: RuleSummary[];
  cardsSummary: CardSummary[];
  worldbookSummary?: WorldbookEntrySummary[];
  dependencyStatus: DepIssue[];
  conflictStatus: ConflictStatus[];
  runtimeState?: EventRuntimeState;
}

// ─── 合集（Collection）───

/** 合集定义（组织层，引用多个事件包/规则包，不复制内容） */
export interface Collection {
  id: string;
  name: string;
  coverColor: string;
  icon: string;
  memberIds: string[];
  createdAt: string;
  updatedAt: string;
}

// ─── 统一错误信封（invoke 失败时 reject 的对象） ───
export type EventErrorCode =
  | 'MOD_NOT_FOUND'
  | 'MOD_ALREADY_INSTALLED'
  | 'MANIFEST_INVALID'
  | 'MANIFEST_MISSING_FIELD'
  | 'CHECKSUM_MISMATCH'
  | 'APP_VERSION_INCOMPATIBLE'
  | 'DEPENDENCY_UNSATISFIED'
  | 'CONFLICT_DETECTED'
  | 'PERMISSION_DENIED'
  | 'ZIP_INVALID'
  | 'ZIP_BOMB'
  | 'PATH_INVALID'
  | 'IO_ERROR'
  | 'EXPORT_FAILED'
  | 'IMPORT_CANCELLED';

export interface EventError {
  code: EventErrorCode;
  message: string;
  context?: Record<string, unknown>;
}

/**
 * 选择卡选项的效果（路径 C 反馈）。
 * - statId：指向 GameState.玩家.生存状态 的扁平 key（如「生命」「dim1.value」），二选一。
 * - resourcePath：资源路径，支持三类世界自定义资源（与 statId 二选一）：
 *     经营资产.资金        → 玩家.经营资产.资金（clamp >= 0）
 *     货币资源.主货币      → 玩家.货币资源.主货币.数量（clamp >= 0）
 *     生存资源.<key>       → 玩家.生存资源.<key>.数量（复用 skip-unknown：无该资源则 warn+跳过）
 */
export interface ChoiceEffect {
  statId?: string;
  resourcePath?: string;
  delta: number;
}

/** 选择卡单个选项；从旧版 string 升级为带 effect/aiNote 的对象。 */
export interface ChoiceOption {
  /** 选项标题（必填） */
  label: string;
  /** 机械层效果：选中后下一 tick 结算时写入对应 stat 的 delta */
  effect?: ChoiceEffect;
  /** 给下一轮 AI 续写的决策上下文（玩家决策日志） */
  aiNote?: string;
  /** Typed action; UI/runtime must not infer behavior from the button label. */
  action?: NarrativeDecisionAction;
}

/**
 * 动态选项配置 — 替代静态 choices，由 AI 根据当前游戏状态动态生成选项。
 * 事件包作者只需定义「框架」（场景描述 + 生成指令），AI 负责填充具体选项。
 */
export interface DynamicChoiceConfig {
  /** 生成指令：告诉 AI 如何生成选项（如"根据玩家当前资源给出3个可行的选择"） */
  instruction: string;
  /** 选项数量范围 [min, max]，默认 [2, 4] */
  countRange?: [number, number];
  /** 每个选项必须包含的字段约束 */
  optionTemplate?: {
    /** 是否必须包含 label（选项标题），默认 true */
    labelRequired?: boolean;
    /** 是否必须包含 effect（机械效果），默认 false */
    effectRequired?: boolean;
    /** 是否必须包含 aiNote（给 AI 的决策上下文），默认 true */
    aiNoteRequired?: boolean;
  };
  /** 静态兜底选项：AI 生成失败或超时时使用 */
  fallbackChoices?: ChoiceOption[];
}

/** AI 选项生成的输入上下文（从 GameState 提取的摘要） */
export interface DynamicChoicePromptInput {
  /** 事件包/世界名称 */
  worldName?: string;
  /** 当前卡片的叙事文本（场景描述） */
  narrativeText: string;
  /** 动态选项配置 */
  config: DynamicChoiceConfig;
  /** 玩家属性摘要（规范键 → 当前值） */
  playerStats: Record<string, number>;
  /** 玩家资源摘要（资源名 → 数量） */
  playerResources: Record<string, number>;
  /** 最近决策记录（aiNote 列表） */
  recentDecisions: string[];
  /** 当前游戏时间 */
  gameTime?: string;
  /** 世界书条目摘要（标题 → 内容），由调用方从 worldBookEntries 提取 */
  worldBookContext?: Array<{ title: string; content: string }>;
}

// ═══════════════════════════════════════════════════════════════
//  卡片节点系统 — 对齐规则包架构深度
//  12 种节点类型 × typed socket × DAG 执行
// ═══════════════════════════════════════════════════════════════

/** 卡片节点类型枚举（12 种） */
export type CardNodeType =
  // 叙事节点（4 种）
  | 'narrative.text'      // 文本叙事
  | 'narrative.title'     // 标题卡
  | 'narrative.image'     // 图片叙事
  | 'narrative.dialog'    // 对话叙事（NPC 对话格式）
  // 交互节点（4 种）
  | 'choice.static'       // 静态选项
  | 'choice.dynamic'      // AI 动态选项（根据玩家状态实时生成）
  | 'choice.conditional'  // 条件选项（根据 gameState 显示/隐藏选项）
  | 'choice.weighted'     // 权重选项（按权重随机展示选项子集）
  // 效果节点（3 种）
  | 'effect.stat'         // 属性效果（修改玩家属性）
  | 'effect.resource'     // 资源效果（修改资源/物品栏数量）
  | 'effect.flag'         // 标记效果（设置/清除游戏标记）
  // 流程节点（1 种）
  | 'flow.branch';        // 条件分支（根据状态跳转到不同节点）

/** 卡片节点 socket 数据类型 */
export type CardSocketType =
  | 'flow'       // 执行流（触发信号）
  | 'number'     // 数值
  | 'string'     // 字符串
  | 'boolean'    // 布尔
  | 'stat'       // 属性引用
  | 'resource'   // 资源引用
  | 'flag'       // 标记引用
  | 'any';       // 任意类型

/** 卡片节点 socket 定义 */
export interface CardNodeSocket {
  key: string;
  type: CardSocketType;
  label: string;
  description?: string;
  /** 是否允许多根线接入（默认 false，仅 input 有效） */
  multi?: boolean;
  /** 默认值（未连接时使用） */
  defaultValue?: unknown;
  /** 是否必填 */
  required?: boolean;
}

/** 卡片节点 widget 类型 */
export type CardWidgetType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'select'
  | 'path_select'
  | 'stat_key'
  | 'resource_key'
  | 'json';

/** 卡片节点 widget 配置 */
export interface CardWidgetConfig {
  type: CardWidgetType;
  label: string;
  /** 绑定的输入 socket key */
  socketKey: string;
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ label: string; value: string | number }>;
  multiline?: boolean;
  placeholder?: string;
}

/** 卡片节点定义（类型元数据） */
export interface CardNodeDefinition {
  typeId: CardNodeType;
  category: 'narrative' | 'choice' | 'effect' | 'flow';
  name: string;
  description: string;
  icon: string;
  color: string;
  inputs: CardNodeSocket[];
  outputs: CardNodeSocket[];
  widgets?: CardWidgetConfig[];
  searchTags?: string[];
  /** 是否为终端节点（无输出流） */
  terminal?: boolean;
  /** 是否为源节点（无输入流） */
  source?: boolean;
}

/** 卡片节点实例（画布上放置的节点） */
export interface CardNodeInstance {
  id: string;
  typeId: CardNodeType;
  label?: string;
  position: { x: number; y: number };
  /** widget 值覆盖（key = socketKey） */
  widgetValues?: Record<string, unknown>;
  /** 运行时状态（不持久化） */
  runtimeState?: {
    executed?: boolean;
    outputs?: Record<string, unknown>;
    error?: string;
  };
}

/** 卡片工作流连接（边） */
export interface CardWorkflowConnection {
  id: string;
  sourceNodeId: string;
  sourceSocketKey: string;
  targetNodeId: string;
  targetSocketKey: string;
}

/** 卡片工作流定义（完整 DAG 图） */
export interface CardWorkflowDefinition {
  version: number;
  id: string;
  name: string;
  description?: string;
  nodes: CardNodeInstance[];
  connections: CardWorkflowConnection[];
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    tags?: string[];
  };
}

/** Canonical metadata entry stored in schema/events.json. */
export interface EventIndexEntry {
  id: string;
  name: string;
  description?: string;
}

/** Canonical version-2 event-pack index stored in schema/events.json. */
export interface EventPackIndex {
  version: 2;
  name?: string;
  events: EventIndexEntry[];
}

/** 卡片执行上下文 */
export interface CardExecutionContext {
  tick: number;
  events: Array<{ type: string; [key: string]: unknown }>;
  permissions: string[];
  gameState: Record<string, unknown>;
  /** 执行限制 */
  limits?: {
    maxNodes?: number;
    maxWallMs?: number;
  };
}

/** 卡片节点执行结果 */
export interface CardNodeExecutionResult {
  /** 渲染数据（叙事节点输出） */
  renderData?: {
    type: 'title' | 'text' | 'image' | 'dialog';
    title?: string;
    text?: string;
    imageUrl?: string;
    npcName?: string;
    npcEmotion?: string;
  };
  /** 选项列表（交互节点输出） */
  choices?: Array<{
    label: string;
    aiNote?: string;
    effect?: { statId?: string; resourcePath?: string; delta: number };
    action?: NarrativeDecisionAction;
    /** 条件选项的显示条件路径 */
    conditionPath?: string;
    /** 条件选项的期望值 */
    conditionValue?: unknown;
    /** 权重选项的权重值 */
    weight?: number;
  }>;
  /** 效果列表（效果节点输出，待应用） */
  pendingEffects?: Array<{
    statId?: string;
    resourcePath?: string;
    flagPath?: string;
    delta?: number;
    value?: unknown;
  }>;
  /** 分支目标（流程节点输出） */
  branchTarget?: string;
  /** 输出 socket 值 */
  outputs?: Record<string, unknown>;
  /** 动态选项配置（choice.dynamic 节点输出） */
  dynamicConfig?: Record<string, unknown>;
}

// ─── 世界书文件 ───
export interface WorldBookFile {
  version: number;
  entries: WorldBookEntryDef[];
}

// ─── 校验参考：当前世界可用变量白名单（validateEvent 引用完整性） ───
export interface WorldDefLike {
  /** 合法 statId 集合（如 attrA.current / dim1.value / special.<id>） */
  statIds: string[];
  /** 合法 resourceId 集合（生存资源 id） */
  resourceIds: string[];
  /** 合法 moduleId 集合（business/assets 等） */
  moduleIds?: string[];
}

// ─── 规则引擎求值上下文（XState context 的简化视图） ───
export type WorldContext = Record<string, unknown>;

export const WORLD_STATE_AXES_TYPE = 'Record<string, string[]>';
export type WorldStateAxes = Record<string, string[]>;
