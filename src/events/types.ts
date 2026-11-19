/**
 * 事件系统的运行时类型。
 *
 * 各种来源（世界内置卡、用户事件包的规则/周期规则/节点工作流/卡片）在加载时编译成统一的事件定义，
 * 由事件导演（events 模块）按领域事件、回合与节奏牌堆触发。
 */
import type { CoreCondition } from '../core/conditions';
import type { Op } from '../core/ops';
import type { Action, CardWorkflowDefinition } from '../modules/schema';
import type { WorkflowDefinition } from '../modules/workflowSchema';
import type { NarrativeDecisionAction } from '../gameplay/narrativeDecision';

export type EventKind = 'card' | 'rule' | 'workflow';

export interface TriggerSpec {
  /** 触发的领域事件类型；`deck` 表示进入节奏牌堆随机抽取。支持 `prefix.*`。 */
  on: string[];
  when?: CoreCondition;
  /** 0..1，满足条件后再掷一次概率。 */
  chance?: number;
  /** 每 N 回合检查一次（周期规则）。 */
  everyTurns?: number;
  offsetTurns?: number;
  /** 牌堆权重。 */
  weight?: number;
}

export interface EventDefinition {
  /** `${packId}/${eventId}`。 */
  key: string;
  packId: string;
  eventId: string;
  name: string;
  kind: EventKind;
  source: 'world' | 'user';
  trigger: TriggerSpec;
  once: boolean;
  cooldownTurns: number;
  priority: number;
  /** rule：旧格式动作（触发时按当前变量注册表翻译成效果）。 */
  actions?: Action[];
  /** rule：新格式效果。 */
  program?: Op[];
  /** 用户事件包声明的权限；世界内置事件为 undefined（不受限）。 */
  permissions?: string[];
  description?: string;
  /** workflow：旧节点工作流，触发时解释执行。 */
  workflow?: WorkflowDefinition;
  /** card：有卡片可展示。 */
  card?: CardWorkflowDefinition;
}

export interface EventCatalog {
  worldId: string;
  definitions: EventDefinition[];
  /** 最近一次加载的说明（来源数量、跳过的包）。 */
  summary: string;
  /** 编译时发现的问题（超出上限、无法识别的动作、读取失败）。 */
  warnings?: string[];
}

export type CardEffectSpec =
  | { stat: string; delta: number }
  | { resource: string; delta: number }
  | { fact: string; delta?: number; value?: unknown }
  | { item: string; delta: number }
  | { currency: number }
  | { flag: string; value?: unknown }
  | { status: string; days?: number }
  | { clearStatus: string }
  | { npc: string; affinity: number }
  | { note: string }
  | { command: string; args?: Record<string, unknown> };

export interface CardOutcomeSpec {
  effects?: CardEffectSpec[];
  note?: string;
  aiNote?: string;
  next?: string;
}

export interface CardOptionSpec {
  label: string;
  aiNote?: string;
  /** 旧格式：单个属性/资源增减。 */
  effect?: { statId?: string; resourcePath?: string; delta: number };
  effects?: CardEffectSpec[];
  /**
   * 选择后掷 d20 检定：属性值换算的修正 + 加成，≥ dc 成功（天然 20 必成，天然 1 必败）。
   * stat 可以是属性键/中文名，也可以是任意数值变量路径（如 flags.心动值），此时用 range 换算修正。
   */
  check?: { stat: string; dc: number; label?: string; range?: [number, number] };
  success?: CardOutcomeSpec;
  failure?: CardOutcomeSpec;
  /** 选完后接着出现的事件（同包 eventId 或 packId/eventId）。 */
  next?: string;
  /** 选项可用条件。 */
  requires?: CoreCondition;
  /** 条件不满足时显示的原因。 */
  requiresText?: string;
  action?: NarrativeDecisionAction;
  /** choice.conditional 旧字段。 */
  conditionPath?: string;
  conditionValue?: unknown;
  weight?: number;
}

export interface QueuedCard {
  key: string;
  packId: string;
  eventId: string;
  turn: number;
  reason: string;
}

export interface EventHistoryEntry {
  key: string;
  name: string;
  turn: number;
  /** 选中的选项文字；跳过时为空。 */
  choice?: string;
  success?: boolean;
  dismissed?: boolean;
  /** 结算结果的简短说明（界面展示）。 */
  summary?: string;
}

export interface EventDirectorState {
  version: 1;
  fired: Record<string, { count: number; lastTurn: number }>;
  /** key → 冷却到第几回合（含）。 */
  cooldowns: Record<string, number>;
  /** 等待玩家处理的卡片（存档内，刷新/读档后仍在）。 */
  queue: QueuedCard[];
  history: EventHistoryEntry[];
  pacing: { level: PacingLevel; lastCardTurn: number; quietTurns: number };
  /** 本回合发生、供旧节点工作流在回合结束时读取的事件。 */
  signals: Array<{ type: string; payload: Record<string, unknown> }>;
  /** 已处理的卡片总数（决策记录编号）。 */
  serial: number;
}

export type PacingLevel = 'off' | 'low' | 'normal' | 'high';
