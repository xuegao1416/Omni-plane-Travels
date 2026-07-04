// ============================================================
//  世界模块化系统 v2 — Schema 类型定义
//  框架层零指向性，所有世界相关内容由AI生成时注入
// ============================================================

// ─── 数值属性模块 ───

/** 六维单个属性 */
export interface SixDimStat {
  name: string;           // AI生成的中文名
  value: number;          // 当前值
  range: [number, number]; // [最小值, 最大值]
}

/** 特色属性 */
export interface SpecialStat {
  id: string;             // 英文标识
  name: string;           // AI生成的中文名
  value: number;          // 当前值
  range: [number, number];
  description: string;    // AI生成的描述
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
  description: string;    // 获取方式与用途
}

/** 制作配方 */
export interface SurvivalRecipe {
  id: string;
  name: string;           // 制作结果名称
  inputs: Record<string, number>;  // 输入资源 { "木材": 2, "石头": 1 }
  output: { resourceId: string; amount: number };
  description: string;
}

/** 资源演化蓝图条目 */
export interface ResourceEvolutionStep {
  /** 唯一标识，与 periodicEvents 里的兜底事件 id 对应 */
  id: string;
  /** 触发条件（关键词触发；轮次兜底由 periodicEvents 承载） */
  trigger: { keywords: string[] };
  /** 新增的资源 */
  add?: SurvivalResource[];
  /** 移除的资源 id */
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

  /** 收益（每周期） */
  income: {
    base: number;          // 基础收益
    perLevel: number;      // 每级额外收益
    resource?: string;     // 产出资源名（可选）
    cycle: string;         // 结算周期："天"/"周"/"回合"
  };

  /** 每周期维护费 */
  maintenance: number;
  /** 升级费用（资金） */
  upgradeCost?: number;
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
  /** 市场行情（可选） */
  market?: {
    items: MarketItem[];
  };
  /** 经营日志（可选） */
  transactionLog?: TransactionEntry[];
  /** AI可添加自定义字段 */
  [key: string]: unknown;
}

// ─── 骰子检定模块 ───

/** 骰子检定结果 */
export interface DiceRoll {
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
}

/** 完整的骰子检定模块 */
export interface DiceModuleSchema {
  lastRoll?: DiceRoll;    // 最近一次掷骰结果
  history?: DiceRoll[];   // 掷骰历史（最多保留10次）
}

// ─── 天赋体系模块 ───

/** 天赋条目 */
export interface TalentDef {
  id: string;              // 英文标识
  name: string;            // 天赋名
  description: string;     // 描述
  rarity: '普通' | '精良' | '稀有' | '史诗' | '传说';  // 品质
  effects?: string[];      // 效果描述（纯文本，供AI参考）
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
 * 周期性事件 — 每隔固定轮次触发
 */
export interface PeriodicEvent {
  /** 事件 ID */
  id: string;
  /** 事件名称 */
  name: string;
  /** 事件描述 */
  description: string;
  /** 触发间隔（轮次） */
  intervalTicks: number;
  /** 首次触发偏移（避免所有周期事件同轮爆发） */
  offsetTicks?: number;
  /** 变量影响 */
  effects: ModuleEffects;
  /** 周期事件结算后是否喂给 AI 做叙事渲染 */
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
 * 世界演化规则（静态配置，存 WorldDef.modules[]，moduleId: 'simulation'）
 */
export interface SimulationRules {
  /** 事件 → 变量映射 */
  eventEffects: EventEffect[];
  /** 周期性事件 */
  periodicEvents: PeriodicEvent[];
  /** 世界状态更新规则 */
  worldStateRules: WorldStateRule[];
  /** 该世界定义的状态轴（替代写死的字段） */
  worldStateAxes?: Record<string, string[]>;
  /** AI 叙事层的安全护栏 */
  narrativeGuardrails: NarrativeGuardrails;
}

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
  世界演化?: SimulationRules;
  /** 保留扩展性：自定义模块数据 */
  [key: string]: unknown;
}
