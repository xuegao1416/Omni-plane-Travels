// ============================================================
//  世界模块化系统 v2 — Schema 类型定义
//  框架层零指向性，所有世界相关内容由AI生成时注入
// ============================================================

import type { WorldBookEntryDef } from '../data/worlds-schema';

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
  /** 变量影响（与原 PeriodicEvent.effects 同源，复用机械层合并逻辑） */
  effects: ModuleEffects;
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
  世界动态?: WorldDynamics;
  /** 保留扩展性：自定义模块数据 */
  [key: string]: unknown;
}

// ============================================================
//  模块客制化 / Mod 系统 — 单一数据源类型
//  架构层持有，UI / 规则引擎 / 图编辑器均 import 自此文件。
//  规则 DSL 为声明式白名单，解释器永不执行玩家代码。
// ============================================================

// ─── 基础枚举 ───

/** 用户面分类；数据层(card/worldbook) / 逻辑层(rule) / 混合(bundle) / 周期(periodic) 归属由 type 推导 */
export type EventType = 'card' | 'rule' | 'worldbook' | 'bundle' | 'periodic';

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

export type Comparator = '==' | '!=' | '>' | '>=' | '<' | '<=' | 'in' | 'contains';

/** Literal 仅基础值，禁止函数 / 引用 / 外部 IO */
export type Literal = string | number | boolean | string[];

export type Condition =
  | { all: Condition[] }
  | { any: Condition[] }
  | { not: Condition }
  | { state: { path: string; op: Comparator; value: Literal } }
  | { event: { type: string; where?: Record<string, Literal> } };

export type ActionKind =
  | 'set'
  | 'emit'
  | 'addCard'
  | 'overrideCard'
  | 'modifyResource'
  | 'scheduleTick';

export type Action =
  | { set: { path: string; value: Literal } }
  | { emit: { type: string; payload?: Record<string, Literal> } }
  | { addCard: { cardId: string } }
  | { overrideCard: { cardId: string; patch: Record<string, unknown> } }
  | { modifyResource: { key: string; delta: number } }
  | { scheduleTick: { after: number; payload?: Record<string, unknown> } };

/** 单条规则；每 mod ≤128 条、单规则 then ≤16 动作、条件树深 ≤6 */
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
 * 任务 A 称其为 SimulationRules { version, rules: EventRule[] } —— 即 Mod 规则 DSL 文件。
 * 注意：世界演化内核消费的「SimulationRules」(eventEffects/periodicEvents/...) 另见上文，
 * 二者命名相近但形态不同，请勿混淆。
 */
export interface RuleFile {
  version: number;
  rules: EventRule[];
  /** 周期规则（与 rules 平级，随事件包分享；运行时注册进 eventWorldEvolution 按 tick 静默结算） */
  periodicRules?: PeriodicRule[];
}

// ─── React Flow 节点图（规则编辑器） ───

export type EventNodeKind =
  | 'trigger'    // Zap   世界事件/关键词/层级触发
  | 'condition'  // GitBranch 与/或 逻辑门
  | 'effect'     // Gauge 变量变更
  | 'event'      // Swords 主动生成 SimEvent
  | 'worldState' // Globe  更新状态轴
  | 'guardrail'; // ShieldAlert 叙事层安全边界

/** 框架无关的图节点数据（ruleGraph 负责与 @xyflow/react 互转） */
export interface EventGraphNode {
  id: string;
  kind: EventNodeKind;
  label: string;
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
  /** 周期性 / 事件效果（module 层变量） */
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
  type: EventType;
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
}

// ─── 发现态 / 注册表 / 校验 / 详情 ───

export interface EventMeta {
  id: string;
  name: string;
  version: string;
  author: string;
  description?: string;
  type: EventType;
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

// ─── 卡片文件（Puck 产物） ───
export interface PuckData {
  root: { props?: Record<string, unknown> };
  components: Record<string, Array<{ id: string; props: Record<string, unknown> }>>;
}

export interface CardDef {
  id: string;
  componentId: string;
  title: string;
  category?: string;
  kind?: 'add' | 'override';
  overrideTarget?: string;
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
}

/**
 * @deprecated 旧版「单文件卡片」落盘形态（schema/card.json）。
 * 修正后的数据模型改用 OptEventFile（聚合事件包，见下）。
 * 保留此类型仅用于向后兼容：CardEditor / CardRenderer / 旧存档仍产出/消费此形态。
 * 新消费端请改用 EventDef + OptEventFile，并用 cardFileToOptEvent() 做迁移桥接。
 */
export interface CardFile {
  version: number;
  puck: PuckData;
  cards: CardDef[];
}

// ─── 修正后的事件数据模型（PACK 持有多个事件；卡片是事件的子单元） ───

/**
 * 事件定义（PACK 的子单元）。
 * 一个事件（EventDef）由多张「卡片（CardDef）」组成 —— 卡片是事件的子单元，而非平级于包。
 * 事件还可携带自己的规则（rules）与世界书（worldbook）。
 */
export interface EventDef {
  /** 事件 ID（唯一标识） */
  id: string;
  /** 事件名（用于日志 / 编辑器展示） */
  name: string;
  /** 卡片：一个事件由多张卡片组成（卡片是事件的子单元） */
  cards: CardDef[];
  /** Puck 可视化布局数据（additive；与 CardFile.puck 同源，供 CardRenderer/CardOverlay 渲染卡片实际 props）。无布局数据时可为空。 */
  puck?: PuckData;
  /** 事件专属规则（可选） */
  rules?: EventRule[];
  /** 事件专属世界书条目（可选） */
  worldbook?: WorldBookEntryDef[];
}

/**
 * 事件包（PACK）落盘形态 —— 修正后的统一数据模型。
 * 一个 PACK 持有多个「事件（EventDef）」；周期规则（PeriodicRule）与事件平级（siblings），
 * 由 eventWorldEvolution 每 tick 静默结算（与 RuleFile.periodicRules 同源）。
 * 包级 worldbook 与 events 内各自携带的 worldbook 平级合并。
 *
 * 与旧「拆分单文件」形态（CardFile / RuleFile / WorldBookFile 分别落盘为
 * schema/card.json / schema/rules.json / schema/worldbook.json）不同，OptEventFile 是聚合形态。
 * 引擎上层请用 flattenOptEvent() 把多个事件的 cards/rules/worldbook 展平后消费，
 * 从而无需改读取逻辑即可在「修正后的数据模型」下运行。
 */
export interface OptEventFile {
  /** 版本号 */
  version: number;
  /** 包名（可选） */
  name?: string;
  /** 事件列表（每个事件包含其卡片 / 规则 / 世界书） */
  events: EventDef[];
  /** 周期规则（与 events 平级，运行时注册进 eventWorldEvolution 按 tick 静默结算） */
  periodic?: PeriodicRule[];
  /** 包级世界书（与 events 平级，可选；events 内也可各自带 worldbook） */
  worldbook?: WorldBookEntryDef[];
}

/**
 * 把 OptEventFile 展平成引擎可直接消费的扁平结构。
 * 遍历所有 events，拼接其 cards / rules / worldbook；再并入包级 worldbook。
 * 返回结构保持与旧消费端（读 CardFile.cards / RuleFile.rules / WorldBookFile.entries）一致，
 * 以便引擎在「修正后的数据模型」下无需改读取逻辑。
 */
export function flattenOptEvent(file: OptEventFile): {
  cards: CardDef[];
  rules: EventRule[];
  worldbook: WorldBookEntryDef[];
} {
  const cards: CardDef[] = [];
  const rules: EventRule[] = [];
  const worldbook: WorldBookEntryDef[] = [];

  for (const ev of file.events ?? []) {
    if (ev.cards) cards.push(...ev.cards);
    if (ev.rules) rules.push(...ev.rules);
    if (ev.worldbook) worldbook.push(...ev.worldbook);
  }
  // 包级 worldbook 追加（与事件内 worldbook 平级合并）
  if (file.worldbook) worldbook.push(...file.worldbook);

  return { cards, rules, worldbook };
}

/**
 * 迁移辅助：把旧版 CardFile（单文件卡片形态）包装为一个 OptEventFile。
 * 将 cf.cards 包裹进一个 EventDef；事件名取自 manifest.name（缺失则回退 'event'）；
 * 事件 ID 使用 crypto.randomUUID() 生成（保证唯一）。
 *
 * 用法：旧存档/旧导出（schema/card.json）经此函数转成 OptEventFile 后，
 * 即可走 flattenOptEvent() 与修正后的引擎读取逻辑统一。
 */
export function cardFileToOptEvent(cf: CardFile, manifest: Manifest): OptEventFile {
  const eventId = crypto.randomUUID();
  const eventName = manifest?.name ?? 'event';
  return {
    version: cf.version,
    name: manifest?.name ?? undefined,
    events: [
      {
        id: eventId,
        name: eventName,
        cards: cf.cards,
      },
    ],
  };
}

/**
 * 迁移辅助（cardFileToOptEvent 的逆操作）：把单个 EventDef 还原为 CardFile（带 puck），
 * 供 CardRenderer / CardOverlay 等仍消费 CardFile 的 UI 兼容。
 * - version 固定为 1（EventDef 不携带 version，UI 渲染不依赖）。
 * - puck 取自 event.puck（additive 字段）；缺失时给一个空 PuckData，保证 CardFile 形态合法。
 *
 * 与 flattenOptEvent 互补：flattenOptEvent 展平供「引擎注册」消费（只取 cards/rules/worldbook，不渲染）；
 * 本函数供「卡片渲染」消费（需要 puck 携带实际 props），二者职责不同、互不冲突。
 */
export function optEventToCardFile(event: EventDef): CardFile {
  return {
    version: 1,
    puck: event.puck ?? { root: {}, components: {} },
    cards: event.cards,
  };
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
