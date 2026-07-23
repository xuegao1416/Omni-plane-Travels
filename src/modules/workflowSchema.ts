// ============================================================
//  工作流系统 — Schema 类型定义
//  类型化节点/端口/连接系统
// ============================================================

// ─── 端口类型 ───

/** 端口数据类型（类型化连接的基础） */
export type SocketType =
  | 'flow'       // 执行流（触发信号）
  | 'number'     // 数值
  | 'string'     // 字符串
  | 'boolean'    // 布尔
  | 'event'      // 事件对象
  | 'resource'   // 资源引用
  | 'stat'       // 属性引用
  | 'npc'        // NPC 引用
  | 'item'       // 物品引用
  | 'any';       // 任意类型（通配）

/** 端口颜色映射 */
export const SOCKET_COLORS: Record<SocketType, string> = {
  flow:     '#a78bfa',  // 紫色
  number:   '#60a5fa',  // 蓝色
  string:   '#34d399',  // 绿色
  boolean:  '#fbbf24',  // 黄色
  event:    '#f87171',  // 红色
  resource: '#fb923c',  // 橙色
  stat:     '#38bdf8',  // 天蓝
  npc:      '#e879f9',  // 粉色
  item:     '#a3e635',  // 黄绿
  any:      '#94a3b8',  // 灰色
};

/** 端口定义 */
export interface SocketDefinition {
  key: string;
  type: SocketType;
  label: string;
  description?: string;
  /** 是否允许多根线接入（默认 false，仅 input 有效） */
  multi?: boolean;
  /** 默认值（未连接时使用） */
  defaultValue?: unknown;
  /** 是否必填（未连接且无默认值时报错） */
  required?: boolean;
}

// ─── Widget（节点内联编辑器） ───

export type WidgetType =
  | 'number'
  | 'string'
  | 'boolean'
  | 'select'
  | 'path_select'
  | 'event_type'
  | 'event_id'
  | 'resource_key'
  | 'stat_key'
  | 'npc_select'
  | 'comparator'
  | 'math_op'
  | 'json';

export interface WidgetConfig {
  type: WidgetType;
  label: string;
  /** 绑定的输入 socket key（widget 值作为该 socket 的默认值） */
  socketKey: string;
  /** number 类型的范围 */
  min?: number;
  max?: number;
  step?: number;
  /** select 类型的选项 */
  options?: Array<{ label: string; value: string | number }>;
  /** 是否多行（string/json） */
  multiline?: boolean;
  /** 占位文本 */
  placeholder?: string;
}

// ─── 节点定义（注册表中的模板） ───

export interface NodeDefinition {
  typeId: string;         // 唯一标识，如 'triggers.world_event'
  category: string;       // 分类路径，如 'triggers'
  name: string;           // 显示名
  description: string;    // 一句话描述
  icon: string;           // lucide icon 名
  color: string;          // 主题色
  inputs: SocketDefinition[];
  outputs: SocketDefinition[];
  widgets?: WidgetConfig[];
  /** 搜索标签 */
  searchTags?: string[];
  /** 是否为终端节点（无输出流） */
  terminal?: boolean;
  /** 是否为源节点（无输入流） */
  source?: boolean;
}

// ─── 节点实例（画布上放置的节点） ───

export interface NodeInstance {
  id: string;
  typeId: string;
  label?: string;
  position: { x: number; y: number };
  /** widget 值覆盖（key = socketKey） */
  widgetValues?: Record<string, unknown>;
  /** 运行时状态（不持久化） */
  runtimeState?: {
    executed?: boolean;
    outputs?: Record<string, unknown>;
    error?: string;
    executionTimeMs?: number;
  };
}

// ─── 连接（边） ───

export interface WorkflowConnection {
  id: string;
  sourceNodeId: string;
  sourceSocketKey: string;
  targetNodeId: string;
  targetSocketKey: string;
}

// ─── 工作流定义（完整图） ───

export interface WorkflowDefinition {
  version: number;
  id: string;
  name: string;
  description?: string;
  nodes: NodeInstance[];
  connections: WorkflowConnection[];
  /** 元数据 */
  metadata?: {
    author?: string;
    createdAt?: string;
    updatedAt?: string;
    tags?: string[];
  };
}

// ─── 执行上下文 ───

export interface WorkflowExecutionContext {
  tick: number;
  events: Array<{ type: string; [key: string]: unknown }>;
  permissions: string[];
  gameState: Record<string, unknown>;
  /** 跨工作流通信的信号缓存 */
  signalCache?: Map<string, unknown>;
  /** 执行限制 */
  limits?: Partial<EvaluateLimits>;
}

export interface EvaluateLimits {
  maxNodes: number;
  maxConnections: number;
  maxDepth: number;
  maxExecutedNodes: number;
  maxWallMs: number;
  maxLoopIterations: number;
  maxSubgraphDepth: number;
}

export const DEFAULT_LIMITS: EvaluateLimits = {
  maxNodes: 256,
  maxConnections: 512,
  maxDepth: 64,
  maxExecutedNodes: 4096,
  maxWallMs: 16,
  maxLoopIterations: 64,
  maxSubgraphDepth: 4,
};

// ─── 执行结果 ───

export interface PendingAction {
  kind: 'set' | 'addEvent' | 'modifyResource' | 'scheduleTick' | 'narrateHint';
  payload: Record<string, unknown>;
}

export interface WorkflowExecutionResult {
  success: boolean;
  pendingActions: PendingAction[];
  nodeOutputs: Map<string, Record<string, unknown>>;
  executionOrder: string[];
  warnings: string[];
  aborted: boolean;
  abortReason?: string;
  totalExecutedNodes: number;
  totalWallMs: number;
}

// ─── 节点执行器类型 ───

export interface NodeExecutorContext {
  tick: number;
  events: Array<{ type: string; [key: string]: unknown }>;
  permissions: string[];
  gameState: Record<string, unknown>;
  signalCache?: Map<string, unknown>;
}

export interface NodeExecutorResult {
  outputs: Record<string, unknown>;
  actions?: PendingAction[];
  warnings?: string[];
}

export type NodeExecutor = (
  inputs: Record<string, unknown>,
  ctx: NodeExecutorContext,
  widgetValues?: Record<string, unknown>,
) => NodeExecutorResult;
