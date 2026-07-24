// 游戏变量类型定义 - 从世界漫游指南.json的Zod schema提取

import type { SurvivalRecipe } from '../modules/schema';

export interface WorldModuleRuntime {
  moduleId: string;
  名称: string;
  描述: string;
  数据: Record<string, unknown>;
}

export interface WorldState {
  时间系统: { 当前时间: string; 当前天气: string };
  空间定位: { 当前位置: string };
  /**
   * 泛化世界状态（由世界演化系统动态更新）
   * 结构：轴名 → 字段 → 值
   * 例如：{ "社会环境": { "权力结构": "王朝统治", "社会氛围": "紧张" } }
   * 不同世界观有不同的状态轴，由世界生成时定义
   */
  状态轴?: Record<string, Record<string, string>>;
}

/**
 * 玩家生存/属性状态
 * 未启用数值模块时只有 血量/体力值
 * 启用数值模块后扩展 attrA/attrB/dim1-6/special 等字段
 */
export interface SurvivalStats {
  血量: number;
  体力值: number;
  [key: string]: number; // 六维、特色属性等动态字段
}

export interface SkillData {
  品质: '普通' | '精良' | '稀有' | '史诗' | '传说';
  描述: string;
  类型: string;
}

export interface InventoryItem {
  数量: number;
  类型: string;
  品质: '普通' | '精良' | '稀有' | '史诗' | '传说';
  备注: string;
}

// ═══════════════════════════════════════════
//  纪事系统（统一情报板）
// ═══════════════════════════════════════════

/** 纪事类型标签 */
export type ChronicleType = '风险' | '机遇' | '线索' | '关系' | '地点' | '物品';

/** 单条纪事 */
export interface ChronicleEntry {
  标题: string;
  类型: ChronicleType;
  描述: string;
  /** 状态：活跃/已解决/已过期 */
  状态?: '活跃' | '已解决' | '已过期';
  /** 类型相关的详情字段（灵活结构，不同类型存不同数据） */
  详情?: Record<string, string | number>;
  $time: number;
}

/** 纪事系统容器 */
export interface ChronicleSystem {
  纪事: Record<string, ChronicleEntry>;
}

/** @deprecated 旧笔记结构，保留用于旧存档兼容迁移 */
export interface Notebook {
  潜在危机?: Record<string, { 严重程度: string; 预计影响时间: string; 应对措施: string; $time: number }>;
  当前机遇?: Record<string, { 时效性: string; 所需资源: string; 行动计划: string; $time: number }>;
  待办事项?: Record<string, { 优先级: string; 截止时间: string; 状态: string; $time: number }>;
}

// ═══════════════════════════════════════════
//  动态任务系统
// ═══════════════════════════════════════════

/** 任务类型 */
export type TaskType = '主线' | '支线' | '日常' | '隐藏' | '成就';

/** 任务状态 */
export type TaskStatus = '进行中' | '已完成' | '已失败' | '已放弃';

/** 物品需求 — 任务要求玩家拥有/交付指定物品 */
export interface TaskItemRequirement {
  物品名: string;
  数量: number;
  /** true=完成时扣除（交付型），false=仅检查拥有（收集型） */
  消耗: boolean;
}

/** 属性需求 — 任务要求玩家属性达到指定值 */
export interface TaskStatRequirement {
  属性名: string;
  最小值: number;
}

/** 资源需求 — 任务要求消耗生存资源 */
export interface TaskResourceRequirement {
  资源名: string;
  数量: number;
  /** true=完成时扣除 */
  消耗: boolean;
}

/** 技能需求 */
export interface TaskSkillRequirement {
  技能名: string;
  最低品质?: '普通' | '精良' | '稀有' | '史诗' | '传说';
}

/** NPC关系需求 */
export interface TaskNPCRequirement {
  NPC名: string;
  最低好感度?: number;
  需要关系类型?: string;
}

/** 骰子检定需求 */
export interface TaskDiceRequirement {
  属性名: string;
  难度DC: number;
  描述: string;
}

/** 货币需求 */
export interface TaskCurrencyRequirement {
  数量: number;
  消耗: boolean;
}

/** 任务奖励 */
export interface TaskReward {
  经验值?: number;
  金币?: number;
  物品?: Array<{ 物品名: string; 数量: number; 类型: string; 品质: string; 备注: string }>;
  技能?: Array<{ 技能名: string; 品质: string; 描述: string; 类型: string }>;
  天赋?: Array<{ 天赋名: string; 品质: string; 描述: string }>;
  属性提升?: Record<string, number>;
  好感度变化?: Record<string, number>;
  资源?: Record<string, number>;
  解锁任务?: string[];
  解锁段位?: number;
}

/** 任务阶段（多步骤任务链中的单个阶段） */
export interface TaskStage {
  名称: string;
  描述: string;
  状态: '未开始' | '进行中' | '已完成';
  物品需求?: TaskItemRequirement[];
  属性需求?: TaskStatRequirement[];
  资源需求?: TaskResourceRequirement[];
  技能需求?: TaskSkillRequirement[];
  NPC需求?: TaskNPCRequirement[];
  骰子检定?: TaskDiceRequirement;
  货币需求?: TaskCurrencyRequirement;
  阶段奖励?: Partial<TaskReward>;
}

/** 单个任务 */
export interface Task {
  任务名: string;
  任务类型: TaskType;
  描述: string;
  状态: TaskStatus;
  优先级: '低' | '中' | '高' | '紧急';
  来源?: string;
  关联NPC?: string;
  截止时间?: string;
  $time: number;

  // ── 完成条件（单阶段任务） ──
  目标: string;
  进度?: number;
  物品需求?: TaskItemRequirement[];
  属性需求?: TaskStatRequirement[];
  资源需求?: TaskResourceRequirement[];
  技能需求?: TaskSkillRequirement[];
  NPC需求?: TaskNPCRequirement[];
  骰子检定?: TaskDiceRequirement;
  货币需求?: TaskCurrencyRequirement;

  // ── 多阶段任务链 ──
  阶段?: TaskStage[];

  // ── 奖励 ──
  奖励?: TaskReward;

  // ── 解锁链 ──
  前置任务?: string[];
  后续任务?: string[];
}

/** 任务系统容器 */
export interface TaskSystem {
  活跃任务: Record<string, Task>;
  已完成任务: Record<string, Task>;
  已失败任务: Record<string, Task>;
}

export interface PlayerState {
  生存状态: SurvivalStats;
  姓名: string;
  年龄: string | number;
  性别: string;
  身份信息: {
    职业: string;
    背景信息: string;
  };
  当前位置?: string;
  当前目标: string;
  性格: string;
  外貌: string;
  技能系统: Record<string, SkillData>;
  货币资源: {
    主货币: { 名称: string; 数量: number };
  };
  物品栏: Record<string, InventoryItem>;
  /** @deprecated 旧笔记，保留用于存档兼容 */
  记事本?: Notebook;
  /** 纪事系统 — 统一情报板（危机/机遇/线索/情报/承诺等） */
  纪事系统?: ChronicleSystem;
  /** 动态任务系统 — 与物品/属性/资源/技能/NPC深度联动 */
  任务系统?: TaskSystem;
  // ── 成长体系状态（动态，AI可更新） ──
  /** 当前段位/等级索引 */
  当前段位索引?: number;
  /** 当前经验值 */
  当前经验值?: number;
  /** 可用属性点 */
  可用属性点?: number;
  /** 生存资源（生存模块启用时填充）
   * 基础资源只存 { 数量, 最大值? }，元数据来自世界静态定义；
   * 演化动态新增的资源会在此附带 name/symbol/最大值/scarse 等元数据，
   * 以便 UI 正确显示（而非匿名 ❓）。 */
  生存资源?: Record<string, {
    数量: number;
    最大值?: number;
    name?: string;
    symbol?: string;
    scarce?: boolean;
    description?: string;
    gatherRate?: string;
    usage?: string;
  }>;
  /** 运行时配方（玩家在游戏中点击"创建配方"由 AI 动态生成）
   * 存于 gameState 随存档持久化，刷新/读档后不会丢失。 */
  生存配方?: SurvivalRecipe[];
  /** 经营资产（经营模块启用时填充，AI 通过 UpdateVariable 更新） */
  经营资产?: {
    资金: number;
    资产列表: Array<{
      id: string;
      名称: string;
      类型: string;
      等级: number;
      最高等级: number;
      描述: string;
      状态: 'active' | 'idle' | 'damaged' | 'destroyed';
      基础收益: number;
      每级收益: number;
      维护费: number;
    }>;
    交易日志?: Array<{
      类型: 'income' | 'expense' | 'purchase' | 'sale' | 'upgrade' | 'event';
      描述: string;
      金额: number;
    }>;
  };
}

export interface NPCData {
  姓名: string;
  种族: string;
  性别: string;
  年龄: string | number;
  背景?: string;
  生存状态: SurvivalStats;
  社会身份: { 职业: string; 社会地位: string };
  关系数据: {
    好感度: number;
    关系类型: string;
  };
  个人信息: {
    外貌: string;
    表性格: string;
    里性格: string;
    当前想法: string;
    当前穿着: string;
    当前位置: string;
    当前状态: string;
    备注: string;
  };
  重要NPC: boolean;
  _关注: boolean;
  $time: number;
  // NPC 管理扩展字段
  人物分类?: '在场' | '离场' | '重点';
  人物事迹?: string[];
  种族描述?: string;
  种族效果?: string;
  种族特性?: string[];
  性格?: string;
  穿着?: string;
  当前行动?: string;
  短期目标?: string;
  长期目标?: string;
  内心想法?: string;
  // 成长体系（当世界启用成长体系模块时填充）
  成长状态?: {
    当前段位索引?: number;
    当前经验值?: number;
    可用属性点?: number;
  };
  天赋?: string[];
  技能列表?: string[] | Record<string, unknown>;
  物品列表?: string[] | Record<string, unknown>;
  装备列表?: Record<string, unknown>;
}

export interface GameState {
  世界: WorldState;
  玩家: PlayerState;
  人物档案: Record<string, NPCData>;
  /** 记忆系统运行态（可选，由记忆系统模块管理） */
  memoryRuntime?: Record<string, unknown>;
  /** 记忆系统配置（可选） */
  memoryConfig?: Record<string, unknown>;
  /** 世界演化运行时状态（可选，由世界演化引擎管理） */
  simulationRuntime?: import('../modules/schema').SimulationRuntimeState;
}

// 默认空状态
export function createDefaultGameState(): GameState {
  return {
    世界: {
      时间系统: { 当前时间: '', 当前天气: '' },
      空间定位: { 当前位置: '' },
    },
    玩家: {
      生存状态: { 血量: 100, 体力值: 100 },
      姓名: '', 年龄: '', 性别: '',
      身份信息: { 职业: '', 背景信息: '' },
      当前目标: '',
      性格: '',
      外貌: '',
      技能系统: {},
      货币资源: { 主货币: { 名称: '', 数量: 500 } },
      物品栏: {},
      纪事系统: { 纪事: {} },
      任务系统: { 活跃任务: {}, 已完成任务: {}, 已失败任务: {} },
    },
    人物档案: {},
  };
}



