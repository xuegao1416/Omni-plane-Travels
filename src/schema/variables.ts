// 游戏变量类型定义 - 从世界漫游指南.json的Zod schema提取

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

export interface Notebook {
  潜在危机: Record<string, { 严重程度: string; 预计影响时间: string; 应对措施: string; $time: number }>;
  当前机遇: Record<string, { 时效性: string; 所需资源: string; 行动计划: string; $time: number }>;
  待办事项: Record<string, { 优先级: string; 截止时间: string; 状态: string; $time: number }>;
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
  记事本: Notebook;
  // ── 成长体系状态（动态，AI可更新） ──
  /** 当前段位/等级索引 */
  当前段位索引?: number;
  /** 当前经验值 */
  当前经验值?: number;
  /** 可用属性点 */
  可用属性点?: number;
  /** 生存资源（生存模块启用时填充） */
  生存资源?: Record<string, { 数量: number; 最大值?: number }>;
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
      记事本: { 潜在危机: {}, 当前机遇: {}, 待办事项: {} },
    },
    人物档案: {},
  };
}



