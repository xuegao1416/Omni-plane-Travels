// 世界定义完整 Schema —— 通用结构化框架，适用于所有类型的世界
//
// 设计原则：worldBookEntries 是世界叙事内容的唯一真相源。
// WorldDef 只保留纯 UI 元数据。详情页、编辑器、游戏引擎全部从 worldBookEntries 读取。

import type { EventRule, PeriodicRule, Permission } from '../modules/schema';

// ═══════════════════════════════════════════════════════════════
//  通用子接口 —— 6 大结构化概念（供模块系统和 worldBookEntries.meta 使用）
// ═══════════════════════════════════════════════════════════════

/** 属性定义 —— 该世界的核心数值属性 */
export interface StatDef {
  id: string;                    // 'charm' | 'neigong' | 'exam_score' | 'radiation_res'
  name: string;                  // '魅力值' | '内力' | '考试成绩' | '辐射抗性'
  description: string;           // '社交场合的影响力与诱惑力'
  range?: [number, number];      // [0, 100]，可选
  important?: boolean;           // true = 核心属性，UI 高亮显示
}

/** 进阶体系 —— 角色如何变强/升级/晋升 */
export interface ProgressionDef {
  type: 'tiered' | 'skill_points' | 'reputation' | 'rank' | 'none';
  description?: string;          // 进阶方式的整体描述
  tiers?: Array<{
    name: string;                // '秀女' | '不入流' | '下城区居民'
    description?: string;        // 该阶段特征简述
  }>;
}

/** 冲突方式 —— 该世界如何处理对抗与纠纷 */
export interface ConflictDef {
  types: string[];               // ['权谋博弈', '毒害陷害'] / ['枪战火拼', '黑客攻防']
  description: string;           // 冲突运作机制的详细说明
  lethal?: boolean;              // 角色是否可能在冲突中死亡
  nonViolent?: boolean;          // true = 无物理暴力（校园/宫斗/都市）
}

/** 资源定义 —— 该世界中的一种重要资源 */
export interface ResourceDef {
  id: string;                    // 'favor' | 'bottlecaps' | 'credit' | 'allowance'
  name: string;                  // '恩宠值' | '瓶盖' | '信用点' | '零花钱'
  symbol?: string;               // '♥' | '⛃' | '₦' | '¥'
  description: string;           // 获取方式与用途
  scarce?: boolean;              // true = 稀缺资源，生存攸关
}

/** 生存资源系统 / 经营资产系统 */
export interface ResourceManagementDef {
  resources: ResourceDef[];
  description?: string;          // 资源系统的整体说明
}

/** 关系类型定义 */
export interface RelationType {
  name: string;                  // '帝王' | '同学' | '帮派成员' | '师兄师姐'
  description: string;           // 与该类角色的关系特点
}

/** 关系系统 —— 该世界中的人际关系机制 */
export interface RelationshipDef {
  types: RelationType[];         // 可存在的关系类型
  mechanics?: string;            // 好感度、信任度、忠诚度等机制说明
  description?: string;          // 关系系统的整体描述
}

/** 世界事件/活动 */
export interface WorldEventDef {
  name: string;                  // '选秀大典' | '学园祭' | '月考' | '午夜狂欢'
  trigger?: string;              // '三年一次' | '秋季' | '每月' | '凌晨2点'
  description: string;           // 事件内容与影响
  significance?: 'major' | 'minor';
}

// ═══════════════════════════════════════════════════════════════
//  玩家指南与叙事风格（供 worldBookEntries.meta 使用）
// ═══════════════════════════════════════════════════════════════

/** 玩家指南 —— 帮助玩家选择适合自己的世界 */
export interface PlaystyleGuideDef {
  recommendedFor?: string[];     // ['喜欢经营的玩家', '策略爱好者']
  avoidIf?: string[];            // ['不喜欢慢节奏']
  estimatedPlaytime?: string;    // '5-20小时'
}

/** 叙事风格指引 —— 可注入到 system prompt */
export interface NarrativeStyleDef {
  tone?: string;                 // '轻松幽默' | '压抑沉重' | '华丽压抑'
  pacing?: string;               // '慢热' | '快节奏'
  contentWarnings?: string[];    // ['暴力描写', '心理恐怖']
}

// ═══════════════════════════════════════════════════════════════
//  嵌入式世界书条目 —— 唯一真相源
// ═══════════════════════════════════════════════════════════════

/** 条目分类，用于 UI 渲染分组 */
export type WorldBookEntryType =
  | 'setting'         // 世界观设定
  | 'factions'        // 势力
  | 'npcs'            // 预设NPC
  | 'rules'           // 世界规则
  | 'economy'         // 经济/时间系统
  | 'events'          // 世界事件
  | 'relationships'   // 关系系统
  | 'highlights'      // 核心特色
  | 'lore'            // 地理地点
  | 'culture'         // 文化风俗
  | 'module_rule';    // 模块生成的规则条目

/** 预设势力（用于 meta.factions） */
export interface FactionDef {
  name: string;
  description: string;
  alignment?: string;           // '友善' | '中立' | '敌对' | ...
}

/** 预设NPC（用于 meta.npcs） */
export interface PresetNPCDef {
  name: string;
  role: string;                 // 角色定位：'邻居大婶'、'矿场工头'
  description: string;
  personality?: string;         // 性格标签：'热心肠、爱八卦'
}

/** worldBookEntry 的结构化元数据，供 UI 渲染卡片/网格/徽章等（不注入 AI） */
export interface WorldBookEntryMeta {
  // setting 类型用
  genre?: string;               // 世界类型（如"修仙世界"、"末日废土"）
  location?: string;
  timePeriod?: string;
  atmosphere?: string;
  conflict?: string;            // 核心冲突（如"正邪对立：正义与邪恶的永恒较量"）

  // factions 类型用
  factions?: FactionDef[];

  // npcs 类型用
  npcs?: PresetNPCDef[];

  // rules 类型用
  powerSystem?: string;
  socialStructure?: string;
  specialRules?: string[];

  // economy 类型用
  currency?: { name: string; symbol?: string; description?: string };
  priceLevel?: string;

  // timeSystem（挂在 economy 条目或独立条目）
  calendar?: string;
  startTime?: string;
  timeSpeed?: string;

  // events 类型用
  events?: WorldEventDef[];

  // relationships 类型用
  relationships?: RelationshipDef;

  // highlights 类型用
  highlights?: string[];

  // playstyleGuide（挂在 setting 条目或独立条目）
  recommendedFor?: string[];
  avoidIf?: string[];
  estimatedPlaytime?: string;

  // narrativeStyle（挂在 setting 条目或独立条目）
  narrativeStyle?: NarrativeStyleDef;
}

/** 世界书条目（直接嵌入 WorldDef，可注入到 system prompt） */
export interface WorldBookEntryDef {
  uid: number;
  key: string[];                 // 触发关键词（空数组 = 始终注入）
  keysecondary?: string[];
  exclude_key?: string[];        // 排除关键词（命中即否决）
  comment: string;               // 条目标题
  content: string;               // 详细内容（注入到 prompt）
  constant: boolean;             // true = 始终注入，false = 关键词触发
  selectiveLogic?: number;       // 0=AND_ANY, 1=NOT_ALL, 2=NOT_ANY, 3=AND_ALL
  order: number;                 // 注入顺序
  position?: 'before_char' | 'after_char';
  depth?: number;                // 最大注入轮次
  probability?: number;          // 触发概率 (0-100)
  disable?: boolean;
  // ── v2 新增 ──
  scanDepth?: number;            // 扫描深度（只扫最近 N 条消息）
  caseSensitive?: boolean;       // 大小写敏感
  matchWholeWords?: boolean;     // 全词匹配
  useProbability?: boolean;      // 是否启用概率
  excludeRecursion?: boolean;    // 排除递归
  preventRecursion?: boolean;    // 阻止递归
  group?: string;                // 分组名（同组互斥）
  useGroupScoring?: boolean;     // 使用分组评分
  groupWeight?: number;          // 分组权重
  // ── v3 新增：统一架构 ──
  /** 条目分类，用于 UI 渲染分组（不设置 = 纯世界书条目） */
  entryType?: WorldBookEntryType;
  /** 结构化元数据，供 UI 渲染（不注入 AI） */
  meta?: WorldBookEntryMeta;
}

// ═══════════════════════════════════════════════════════════════
//  世界模块 —— 模块化系统
// ═══════════════════════════════════════════════════════════════

/** 世界启用的模块实例 */
export interface WorldModule {
  /** 模块ID（对应 MODULE_OPTIONS.id） */
  moduleId: string;
  /** 模块在该世界中的中文名（AI生成，如"武学属性"、"资产总览"） */
  name: string;
  /** 模块描述 */
  description?: string;
  /** 是否启用 */
  enabled: boolean;
  /** 模块特定配置（如自定义提示词内容等） */
  config?: Record<string, unknown>;
  /**
   * @deprecated 已废弃，请使用 moduleConfig + initialState
   * 模块运行时初始数据（旧格式，兼容用）
   * normalizeModule() 会自动将 data 拆分到 moduleConfig 和 initialState
   */
  data?: Record<string, unknown>;

  // ── 新格式：分离配置和状态 ──
  /** 模块配置（静态，注入世界书给AI参考） */
  moduleConfig?: Record<string, unknown>;
  /** 模块初始状态（动态，初始化变量系统） */
  initialState?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════
//  完整的世界定义
// ═══════════════════════════════════════════════════════════════

/** 完整的世界定义 —— worldBookEntries 为唯一叙事真相源 */
export interface WorldDef {
  // ─── 必填 ───
  id: string;
  name: string;
  description: string;          // 一句话简介（Step 1 卡片用）
  entryId: number | null;       // 世界书条目ID，null = 默认自由模式

  // ─── 视觉/展示 ───
  tags?: string[];              // ['科幻', '封闭空间', '生存']
  icon?: string;                // Lucide 图标名称：'Cpu'、'Swords'（见 shared/worldIcons.tsx）
  coverColor?: string;          // 主题色 hex：'#e74c3c'

  // ─── 文风引用（预留） ───
  writingStyleRef?: string;     // 引用外部文风 JSON 的 id

  // ─── 元数据 ───
  difficulty?: 'easy' | 'medium' | 'hard';
  author?: string;
  version?: string;
  createdAt?: string;
  matureContent?: boolean;

  // ─── 叙事内容（唯一真相源） ───
  /** 嵌入式世界书条目 —— 所有叙事内容都在这里 */
  worldBookEntries?: WorldBookEntryDef[];

  // ─── 模块系统 ───
  /** 世界启用的模块列表 */
  modules?: WorldModule[];

  // ─── 导入来源（v3：区分外部导入 vs 内部世界） ───
  /** 导入来源：'external' = 外部世界书 → 用条目编辑器；undefined = 内部世界 → 用 9-tab 详情 */
  source?: 'external';

  // ─── 世界关联事件包（随世界定义打包，加载时自动安装进事件中心） ───
  /** 世界自带的事件包；加载世界时自动写入 IndexedDB（builtin=true），在事件中心展示为「内置」。
   *  存档导出时这些包会随存档一起打包，导入时排重写入。 */
  eventPacks?: EmbeddedEventPack[];
}

/**
 * 内嵌事件包 —— 直接写在 WorldDef 上的事件包，随世界定义一起分发。
 * 形状对齐 eventWorldEvolution.registerPack() 的入参（RegisteredEventRules）。
 */
export interface EmbeddedEventPack {
  /** 全局唯一包 ID，建议 'world:<worldId>' 或 'world:<worldId>:events' */
  id: string;
  /** 包显示名（编辑器/日志用） */
  name?: string;
  /** 包类型：'rule'=规则包（when→then+周期），'card'=事件包（弹卡片） */
  type: 'rule' | 'card';
  /** 规则包：when→then 规则 */
  rules?: EventRule[];
  /** 规则包：周期规则 */
  periodicRules?: PeriodicRule[];
  /** 事件包：事件定义列表（每个事件含卡片） */
  events?: Array<{
    id: string;
    name: string;
    cards: Array<{
      id: string;
      componentId: string;
      title: string;
    }>;
    puck?: {
      root: { props?: Record<string, unknown> };
      components: Record<string, Array<{ id: string; props: Record<string, unknown> }>>;
    };
  }>;
  /** 拥有的权限（如 modify_world_state, add_card） */
  permissions?: Permission[];
}
