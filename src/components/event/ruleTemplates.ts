import {
  Apple, AlertTriangle, Compass, RefreshCw, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { EventGraph } from '../../modules/schema';

export interface RuleTemplate {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  category: 'economy' | 'combat' | 'exploration' | 'system';
  difficulty: 'beginner' | 'intermediate';
  graph: EventGraph;
}

/* ─── 预设模板 ─── */

/**
 * 模板 1：生存消耗（periodic → effect）
 * 最简模式：周期节点直接连线效果节点，无条件判断。
 * 每 5 轮自动消耗食物和水，模拟基本生存需求。
 */
const survivalConsumptionGraph: EventGraph = {
  nodes: [
    {
      id: 'periodic-consume',
      kind: 'periodic',
      label: '每5轮消耗',
      intervalTicks: 5,
      offsetTicks: 0,
      description: '每5轮自动消耗食物和水',
      narrateToAI: true,
    },
    {
      id: 'effect-consume',
      kind: 'effect',
      label: '消耗食物和水',
      actions: [
        { modifyResource: { key: 'food', delta: -1 } },
        { modifyResource: { key: 'water', delta: -1 } },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: 'periodic-consume', target: 'effect-consume', kind: 'flow' },
  ],
};

/**
 * 模板 2：饥饿警报（periodic → condition → effect + emit）
 * 周期触发后走条件判断，满足时同时设标记和发出事件。
 * 每 5 轮检查食物储备，低于 3 时设置饥饿标记并广播警报事件。
 */
const hungerAlertGraph: EventGraph = {
  nodes: [
    {
      id: 'periodic-check-food',
      kind: 'periodic',
      label: '每5轮检查储备',
      intervalTicks: 5,
      offsetTicks: 0,
      description: '每5轮检查食物储备是否充足',
      narrateToAI: true,
    },
    {
      id: 'cond-food-low',
      kind: 'condition',
      label: '食物不足？',
      logicMode: 'and',
      when: { state: { path: '玩家.生存资源.food.数量', op: '<', value: 3 } },
    },
    {
      id: 'effect-set-hunger',
      kind: 'effect',
      label: '标记饥饿 + 广播警报',
      actions: [
        { set: { path: 'flags.isHungry', value: true } },
        { addEvent: { eventId: 'hunger_alert' } },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: 'periodic-check-food', target: 'cond-food-low', kind: 'flow' },
    { id: 'e2', source: 'cond-food-low', target: 'effect-set-hunger', kind: 'flow' },
  ],
};

/**
 * 模板 3：事件触发型（trigger → condition → effect）
 * 外部事件驱动：先匹配事件类型，再检查状态条件，最后执行效果。
 * 收到探索事件时，检查水是否足够（≥2），够则消耗水换取食物。
 */
const explorationRewardGraph: EventGraph = {
  nodes: [
    {
      id: 'trigger-explore',
      kind: 'trigger',
      label: '收到探索事件',
      when: { event: { type: 'explore' } },
      trigger: { eventType: 'explore' },
      priority: 10,
    },
    {
      id: 'cond-has-water',
      kind: 'condition',
      label: '水源充足？',
      logicMode: 'and',
      when: { state: { path: '玩家.生存资源.water.数量', op: '>=', value: 2 } },
    },
    {
      id: 'effect-trade',
      kind: 'effect',
      label: '消耗水换取食物',
      actions: [
        { modifyResource: { key: 'water', delta: -2 } },
        { modifyResource: { key: 'food', delta: 3 } },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger-explore', target: 'cond-has-water', kind: 'flow' },
    { id: 'e2', source: 'cond-has-water', target: 'effect-trade', kind: 'flow' },
  ],
};

/**
 * 模板 4：资源回收（periodic → condition → effect）
 * 周期检查自定义标记，标记存在时给予奖励。
 * 展示 flags 作为规则间"接力"信号的用法（标记由其他规则写入）。
 * 每 10 轮检查回收标记，有标记则木材 +5 并清除标记。
 */
const resourceRecoveryGraph: EventGraph = {
  nodes: [
    {
      id: 'periodic-recycle',
      kind: 'periodic',
      label: '每10轮回收检定',
      intervalTicks: 10,
      offsetTicks: 0,
      description: '每10轮检查是否可以回收资源',
      narrateToAI: true,
    },
    {
      id: 'cond-can-recycle',
      kind: 'condition',
      label: '可回收？',
      logicMode: 'and',
      when: { state: { path: 'flags.canRecycle', op: '==', value: true } },
    },
    {
      id: 'effect-recycle',
      kind: 'effect',
      label: '回收木材 +5',
      actions: [
        { modifyResource: { key: 'wood', delta: 5 } },
        { set: { path: 'flags.canRecycle', value: false } },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: 'periodic-recycle', target: 'cond-can-recycle', kind: 'flow' },
    { id: 'e2', source: 'cond-can-recycle', target: 'effect-recycle', kind: 'flow' },
  ],
};

/**
 * 模板 5：连锁反应（trigger → effect → emit）
 * 事件驱动 + 多级 effect 串联 + emit 产生新事件。
 * 收到危险事件后：①设标记 ②发新事件，下游规则可继续匹配。
 * 展示 emit 作为规则间"信号总线"的连锁模式。
 */
const chainReactionGraph: EventGraph = {
  nodes: [
    {
      id: 'trigger-danger',
      kind: 'trigger',
      label: '收到危险事件',
      when: { event: { type: 'danger' } },
      trigger: { eventType: 'danger' },
      priority: 20,
    },
    {
      id: 'effect-set-flag',
      kind: 'effect',
      label: '设置危险标记',
      actions: [
        { set: { path: 'flags.inDanger', value: true } },
      ],
    },
    {
      id: 'effect-emit-alert',
      kind: 'effect',
      label: '广播警报事件',
      actions: [
        { addEvent: { eventId: 'danger_alert' } },
      ],
    },
  ],
  edges: [
    { id: 'e1', source: 'trigger-danger', target: 'effect-set-flag', kind: 'flow' },
    { id: 'e2', source: 'effect-set-flag', target: 'effect-emit-alert', kind: 'flow' },
  ],
};

/* ─── 导出模板列表 ─── */

export const RULE_TEMPLATES: RuleTemplate[] = [
  {
    id: 'survival-consumption',
    name: '生存消耗',
    description: '每5轮自动消耗1食物和1水。最简单的 周期→效果 模式，模拟基本生存需求。',
    icon: Apple,
    category: 'system',
    difficulty: 'beginner',
    graph: survivalConsumptionGraph,
  },
  {
    id: 'hunger-alert',
    name: '饥饿警报',
    description: '每5轮检查食物储备，低于3时设标记并广播警报。展示 周期→条件→效果(多动作) 模式。',
    icon: AlertTriangle,
    category: 'system',
    difficulty: 'beginner',
    graph: hungerAlertGraph,
  },
  {
    id: 'exploration-reward',
    name: '探索收获',
    description: '收到探索事件时，如果水≥2则消耗水换取食物。展示 触发→条件→效果 的事件驱动模式。',
    icon: Compass,
    category: 'exploration',
    difficulty: 'intermediate',
    graph: explorationRewardGraph,
  },
  {
    id: 'resource-recovery',
    name: '资源回收',
    description: '每10轮检查回收标记，有标记则木材+5。展示 flags 作为规则间信号接力的用法。',
    icon: RefreshCw,
    category: 'economy',
    difficulty: 'intermediate',
    graph: resourceRecoveryGraph,
  },
  {
    id: 'chain-reaction',
    name: '连锁反应',
    description: '收到危险事件后设标记并广播新事件，下游规则可继续匹配。展示 emit 信号总线连锁模式。',
    icon: Zap,
    category: 'combat',
    difficulty: 'intermediate',
    graph: chainReactionGraph,
  },
];
