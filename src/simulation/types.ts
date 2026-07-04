/**
 * 后台世界推演系统 — 类型定义
 *
 * 架构概述：
 *   WorldSimulationEngine 管理两套并行推进系统：
 *   1. 世界事件链（WorldEventChain）— 宏观事件的级联传导
 *   2. 角色暗线（CharacterStoryline）— 重要角色离场后的后台故事
 *
 * 核心理念：
 *   草原寒潮 → 游牧民族生存危机 → 南下入侵 → 难民潮 → 军队调动 → 粮价飞涨
 *   每一层传导都产生对应层面的"玩家切入点"（超凡/政府/门派/经济/市井）
 */

// ─── 事件层级 ───
/** 事件传导层级，从宏观到微观 */
export type EventLevel =
  | 'mythic'      // 超凡/神话层面 — 天道异变、神祇意志
  | 'political'   // 政府/政治层面 — 朝廷决策、诸侯博弈
  | 'factional'   // 门派/组织层面 — 宗门动向、帮会行动
  | 'economic'    // 经济/商业层面 — 物价波动、商会策略
  | 'civilian';   // 市井/个体层面 — 难民流亡、市井百态

export const EVENT_LEVELS: EventLevel[] = [
  'mythic', 'political', 'factional', 'economic', 'civilian',
];

/** 兜底层级显示名（UI 应优先使用引擎 getLevelLabels() 返回的世界特化标签） */
export const EVENT_LEVEL_LABELS: Record<EventLevel, string> = {
  mythic: '顶层',
  political: '上层',
  factional: '势力',
  economic: '经济',
  civilian: '个体',
};

// ─── 世界事件 ───

/** 单个事件节点 */
export interface SimEvent {
  id: string;
  /** 事件标题 */
  title: string;
  /** 事件详细描述（AI 生成的叙事文本） */
  description: string;
  /** 事件层级 */
  level: EventLevel;
  /** 影响地域 */
  region: string;
  /** 严重程度 0-10 */
  severity: number;
  /** 事件状态 */
  status: 'brewing' | 'active' | 'resolved' | 'abandoned';
  /** 子事件 ID 列表（级联传导） */
  childEventIds: string[];
  /** 父事件 ID */
  parentEventId?: string;
  /** 影响的 NPC ID 列表 */
  affectedNpcIds: string[];
  /** 影响的势力名称 */
  affectedFactions: string[];
  /** 玩家切入点 — AI 生成的玩家可介入的具体场景 */
  playerHooks: PlayerHook[];
  /** 创建时的游戏时间 */
  createdAtTime: string;
  /** 开始时间 */
  startedAtTime?: string;
  /** 解决时间 */
  resolvedAtTime?: string;
  /** 创建时的纪元时间戳 */
  createdAtTick: number;
  /** AI 生成此事件时使用的批次标记 */
  batchId: string;
  /** 最后一次变化的 tick（陈旧事件检测用） */
  lastUpdatedTick: number;
}

/** 玩家切入点 — 玩家可以参与的具体场景 */
export interface PlayerHook {
  /** 切入点标题 */
  title: string;
  /** 场景描述 */
  description: string;
  /** 切入点层级 */
  level: EventLevel;
  /** 涉及的关键 NPC 或实体 */
  keyEntities: string[];
  /** 玩家可选行动（供 LLM 参考） */
  suggestedActions: string[];
  /** 时效性：紧迫/近期/持续 */
  urgency: 'urgent' | 'near_term' | 'ongoing';
}

// ─── 角色暗线 ───

/** 角色暗线节点 — 离场角色在后台的一个故事节拍 */
export interface StoryBeat {
  id: string;
  /** 此节拍发生时的游戏时间 */
  time: string;
  /** 节拍标题 */
  title: string;
  /** 节拍叙事文本 */
  narrative: string;
  /** 角色位置变化 */
  locationChange?: string;
  /** 关系变化（对玩家的好感度增减） */
  relationshipDelta?: number;
  /** 角色状态变化 */
  statusChange?: string;
  /** 此节拍是否已合并到人物事迹 */
  merged: boolean;
  /** 创建时的纪元时间戳 */
  tick: number;
  /** 关联的世界事件 ID */
  relatedEventIds: string[];
}

/** 事迹操作类型 */
export type ChronicleOpType = 'add' | 'replace' | 'merge' | 'remove';

/** 单条事迹增量操作 — 允许 LLM 精确修改 NPC 大事记 */
export interface ChronicleOperation {
  op: ChronicleOpType;
  /** 按索引定位目标条目 */
  index?: number;
  /** 按旧值文本匹配目标条目（index 优先） */
  oldValue?: string;
  /** 新值（add/replace/merge 时必填） */
  value?: string;
}

/** 角色的完整暗线故事 */
export interface CharacterStoryline {
  /** NPC ID（人物档案的 key） */
  npcId: string;
  /** 故事节拍列表 */
  beats: StoryBeat[];
  /** 最近一次推演的 tick */
  lastSimulatedTick: number;
  /** 暗线总结（AI 生成，用于注入系统提示） */
  summary?: string;
}

// ─── NPC 主动交互 ───

/** NPC 主动联系玩家的交互条目 */
export interface NpcProactiveInteraction {
  id: string;
  npcId: string;
  npcName: string;
  /** 联系原因 */
  contactReason: string;
  /** 优先级 0-999，数值越小越优先 */
  priority: number;
  /** NPC 内心想法 */
  innerThoughts: string;
  /** NPC 对白或行动描述 */
  reply: string;
  /** 去重 key，防止同一交互重复推送 */
  dedupeKey: string;
  /** 关联的变量变更说明 */
  variableChanges?: string[];
  /** 创建时的 tick */
  createdAtTick: number;
}

// ─── 模拟状态 ───

/** 游戏内时间表示 */
export interface GameTime {
  /** 当前时间文本（如 "深秋·霜月·第十五日·黄昏"） */
  current: string;
}

/** 模拟配置 */
export interface SimConfig {
  /** 是否启用世界推演 */
  enabled: boolean;
  /**
   * 时间流速：游戏内每过多少"感觉单位"触发一次推演
   * 例如 "per_scene" = 每次场景切换 / "per_day" = 每天推演一次
   */
  timeUnit: 'per_scene' | 'per_day' | 'per_week' | 'per_month';
  /** AI 生成事件的最大层级深度 */
  maxCascadeDepth: number;
  /** 同时活跃的最大事件数量 */
  maxActiveEvents: number;
  /** 暗线推演的最多角色数（按重要NPC优先级） */
  maxStorylineCharacters: number;
  /** 每次推演生成的故事节拍数（每角色） */
  beatsPerTick: number;
  /** 自动推演间隔（消息轮数），0 表示手动触发 */
  autoTickInterval: number;
  /** 上次推演时的消息轮数 */
  lastAutoTickRound: number;
  /** 上次推演时的游戏时间 */
  lastSimulatedTime: string;
  /** 陈旧事件阈值（tick 数），超过则自动降级，0=禁用 */
  staleTickThreshold: number;
  /** 当前使用的预设 ID */
  activePresetId: string;
}

export const DEFAULT_SIM_CONFIG: SimConfig = {
  enabled: true,
  timeUnit: 'per_scene',
  maxCascadeDepth: 3,
  maxActiveEvents: 5,
  maxStorylineCharacters: 5,
  beatsPerTick: 2,
  autoTickInterval: 3,
  lastAutoTickRound: 0,
  lastSimulatedTime: '',
  staleTickThreshold: 10,
  activePresetId: 'default',
};

/** 完整的模拟状态（可持久化到存档） */
export interface SimulationState {
  /** 模拟配置 */
  config: SimConfig;
  /** 当前活跃的世界事件（以事件 ID 为键） */
  events: Record<string, SimEvent>;
  /** 已解决的事件 */
  resolvedEvents: Record<string, SimEvent>;
  /** 角色暗线（以 NPC ID 为键） */
  storylines: Record<string, CharacterStoryline>;
  /** 全局世界新闻摘要（最近推演生成） */
  worldNewsSummary?: string;
  /** 模拟时钟的 tick 计数 */
  tickCount: number;
  /** 最近一次推演的时间戳 */
  lastTickTimestamp: number;
  /** NPC 主动交互队列（待消费） */
  pendingInteractions: NpcProactiveInteraction[];
}

/** 创建空的模拟状态 */
export function createEmptySimState(): SimulationState {
  return {
    config: { ...DEFAULT_SIM_CONFIG },
    events: {},
    resolvedEvents: {},
    storylines: {},
    pendingInteractions: [],
    tickCount: 0,
    lastTickTimestamp: 0,
  };
}

// ─── LLM 交互类型 ───

/** 推演请求的输入上下文 */
export interface SimContext {
  /** 世界设定摘要 */
  worldSetting: string;
  /** 当前游戏时间 */
  gameTime: GameTime;
  /** 当前活跃事件摘要 */
  activeEventsSummary: string;
  /** 离场重要角色摘要 */
  offscreenNpcSummaries: OffscreenNpcSummary[];
  /** 区域状态 */
  regionStates: Record<string, string>;
  /** 世界核心冲突 */
  coreConflict?: string;
}

/** 离场 NPC 摘要 */
export interface OffscreenNpcSummary {
  npcId: string;
  name: string;
  race: string;
  personality: string;
  currentLocation: string;
  currentStatus: string;
  shortTermGoal: string;
  longTermGoal: string;
  lastKnownChronicles: string[];
  relationship: string;
}

// ─── 事件生成 Prompt 结构 ───

/** LLM 返回的事件生成结果 */
export interface SimGenerationResult {
  /** 新生成的世界事件（可能为级联树） */
  newEvents: SimEvent[];
  /** 更新了哪些现有事件 */
  updatedEvents: SimEvent[];
  /** 角色暗线更新 */
  storylineUpdates: StorylineUpdate[];
  /** 全局世界新闻 */
  worldNews: string;
  /** 玩家切入点汇总 */
  playerHooks: PlayerHook[];
  /** NPC 主动交互 */
  npcInteractions: NpcProactiveInteraction[];
}

/** 暗线更新描述 */
export interface StorylineUpdate {
  npcId: string;
  newBeats: StoryBeat[];
  summary: string;
  /** 事迹增量操作 */
  chronicleOps?: ChronicleOperation[];
}

// ─── 世界语义上下文 ───

/** 从世界书条目中提取的结构化语义信息，用于驱动自适应层级标签 */
export interface SimWorldContext {
  /** 世界名称 */
  worldName: string;
  /** 世界设定摘要（setting entry 的 content） */
  setting: string;
  /** 力量/魔法体系描述 */
  powerSystem: string;
  /** 社会层级结构描述 */
  socialHierarchy: string;
  /** 势力名称列表 */
  factions: string[];
  /** 预设 NPC 列表 */
  keyNpcs: Array<{ name: string; role: string; personality: string }>;
  /** 经济/货币体系描述 */
  economy: string;
  /** 文化/风俗描述 */
  culture: string;
  /** 核心特色 */
  coreThemes: string[];
  /** 自适应层级标签 — 根据世界设定推导的事件层级名称 */
  levelLabels: Record<EventLevel, string>;
}

/** 创建默认的 SimWorldContext（通用模板，LLM 会自行适配） */
export function createDefaultWorldContext(worldName: string, worldDesc: string): SimWorldContext {
  const labels: Record<EventLevel, string> = {
    mythic: '宏观/顶层',
    political: '权力/政治',
    factional: '组织/势力',
    economic: '经济/商业',
    civilian: '市井/个体',
  };
  return {
    worldName,
    setting: worldDesc,
    powerSystem: '根据世界设定推断',
    socialHierarchy: '根据世界设定推断',
    factions: [],
    keyNpcs: [],
    economy: '根据世界设定推断',
    culture: '根据世界设定推断',
    coreThemes: [],
    levelLabels: labels,
  };
}

// ─── 预设系统 ───

/** 预设条目 — prompt 的一个可配置片段 */
export interface SimPresetEntry {
  id: string;
  /** 排序权重（越小越靠前） */
  order: number;
  /** 条目标题（UI 展示用） */
  title: string;
  /** Prompt 内容 */
  content: string;
  /** 是否启用 */
  enabled: boolean;
  /** 触发模式：always=常驻, keyword=关键词匹配 */
  triggerMode: 'always' | 'keyword';
  /** keyword 模式下的匹配词 */
  keywords?: string[];
}

/** 推演预设 — 一组有序的 prompt 条目 */
export interface SimPreset {
  id: string;
  name: string;
  description: string;
  version: string;
  entries: SimPresetEntry[];
}
