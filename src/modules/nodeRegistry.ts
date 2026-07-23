// ============================================================
//  节点注册表 — 35 个核心节点，全中文
// ============================================================
import type {
  NodeDefinition, SocketDefinition, WidgetConfig, SocketType, NodeExecutor,
} from './workflowSchema';

// ─── 注册表存储 ───

const definitions = new Map<string, NodeDefinition>();
const executors = new Map<string, NodeExecutor>();

export function registerNode(def: NodeDefinition): void { definitions.set(def.typeId, def); }
export function registerNodeExecutor(typeId: string, executor: NodeExecutor): void { executors.set(typeId, executor); }
export function getNodeDefinition(typeId: string): NodeDefinition | undefined { return definitions.get(typeId); }
export function getNodeExecutor(typeId: string): NodeExecutor | undefined { return executors.get(typeId); }
export function getAllNodeDefinitions(): NodeDefinition[] { return [...definitions.values()]; }

export function getNodeCategories(): Map<string, NodeDefinition[]> {
  const cats = new Map<string, NodeDefinition[]>();
  for (const def of definitions.values()) {
    const list = cats.get(def.category) ?? [];
    list.push(def);
    cats.set(def.category, list);
  }
  return cats;
}

export function searchNodes(query: string): NodeDefinition[] {
  const q = query.toLowerCase().trim();
  if (!q) return getAllNodeDefinitions();
  return getAllNodeDefinitions().filter((def) => {
    const haystack = [def.name, def.description, def.category, ...(def.searchTags ?? [])].join(' ').toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  });
}

export function areTypesCompatible(sourceType: SocketType, targetType: SocketType): boolean {
  if (sourceType === 'any' || targetType === 'any') return true;
  return sourceType === targetType;
}

export function validateConnection(
  sourceDef: NodeDefinition, sourceSocketKey: string,
  targetDef: NodeDefinition, targetSocketKey: string,
  existingConnections: Array<{ targetNodeId: string; targetSocketKey: string }>,
  targetNodeId: string,
): string | null {
  const srcSocket = sourceDef.outputs.find((s) => s.key === sourceSocketKey);
  const tgtSocket = targetDef.inputs.find((s) => s.key === targetSocketKey);
  if (!srcSocket) return `源节点没有输出端口 ${sourceSocketKey}`;
  if (!tgtSocket) return `目标节点没有输入端口 ${targetSocketKey}`;
  if (!areTypesCompatible(srcSocket.type, tgtSocket.type)) return `类型不兼容: ${srcSocket.type} → ${tgtSocket.type}`;
  if (!tgtSocket.multi) {
    const already = existingConnections.some((c) => c.targetNodeId === targetNodeId && c.targetSocketKey === targetSocketKey);
    if (already) return `端口已连接`;
  }
  return null;
}

// ─── 辅助 ───

function socket(key: string, type: SocketType, label: string, opts?: Partial<SocketDefinition>): SocketDefinition {
  return { key, type, label, ...opts };
}

function widget(type: WidgetConfig['type'], label: string, socketKey: string, opts?: Partial<WidgetConfig>): WidgetConfig {
  return { type, label, socketKey, ...opts };
}

// ═══════════════════════════════════════════════════════════
//  触发器（4 个）
// ═══════════════════════════════════════════════════════════

registerNode({
  typeId: 'triggers.world_event',
  category: 'triggers',
  name: '事件触发',
  description: '当指定类型的事件发生时触发',
  icon: 'Zap',
  color: 'var(--node-trigger)',
  source: true,
  inputs: [],
  outputs: [
    socket('flow_out', 'flow', '触发'),
    socket('event_out', 'event', '事件数据'),
  ],
  widgets: [
    widget('event_type', '事件类型', 'match_type', { placeholder: '如 dice_roll' }),
    widget('number', '优先级', 'priority', { min: 0, max: 100, step: 1 }),
    widget('boolean', '仅触发一次', 'once'),
    widget('number', '冷却轮数', 'cooldown', { min: 0, step: 1 }),
  ],
  searchTags: ['事件', '触发', '条件'],
});

registerNode({
  typeId: 'triggers.periodic',
  category: 'triggers',
  name: '周期触发',
  description: '每 N 个回合自动触发',
  icon: 'Clock',
  color: 'var(--node-periodic, #8b5cf6)',
  source: true,
  inputs: [],
  outputs: [
    socket('flow_out', 'flow', '触发'),
    socket('tick_out', 'number', '当前轮次'),
  ],
  widgets: [
    widget('number', '间隔轮数', 'interval', { min: 1, step: 1 }),
    widget('number', '首次偏移', 'offset', { min: 0, step: 1 }),
    widget('string', '描述', 'description', { multiline: true }),
    widget('boolean', 'AI 叙事', 'narrate'),
  ],
  searchTags: ['周期', '定时', '每轮'],
});

registerNode({
  typeId: 'triggers.manual',
  category: 'triggers',
  name: '手动触发',
  description: '调试用，模拟运行时始终触发',
  icon: 'Play',
  color: 'var(--node-trigger)',
  source: true,
  inputs: [],
  outputs: [socket('flow_out', 'flow', '触发')],
  searchTags: ['手动', '调试'],
});

registerNode({
  typeId: 'triggers.choice_made',
  category: 'triggers',
  name: '选择触发',
  description: '当玩家在事件卡中做出选择时触发',
  icon: 'MousePointerClick',
  color: 'var(--node-trigger)',
  source: true,
  inputs: [],
  outputs: [
    socket('flow_out', 'flow', '触发'),
    socket('choice_id', 'string', '选项 ID'),
    socket('card_id', 'string', '卡片 ID'),
  ],
  widgets: [
    widget('string', '匹配卡片 ID', 'match_card', { placeholder: '留空则匹配所有' }),
    widget('number', '优先级', 'priority', { min: 0, max: 100, step: 1 }),
    widget('boolean', '仅触发一次', 'once'),
  ],
  searchTags: ['选择', '卡片', '选项', '触发'],
});

// ═══════════════════════════════════════════════════════════
//  条件（10 个）
// ═══════════════════════════════════════════════════════════

registerNode({
  typeId: 'conditions.compare',
  category: 'conditions',
  name: '比较',
  description: '比较两个值',
  icon: 'GitCompare',
  color: 'var(--accent)',
  inputs: [
    socket('value_a', 'any', '值 A', { required: true }),
    socket('value_b', 'any', '值 B', { required: true }),
  ],
  outputs: [socket('result', 'boolean', '结果')],
  widgets: [widget('comparator', '运算符', 'op')],
  searchTags: ['比较', '等于', '大于', '小于'],
});

registerNode({
  typeId: 'conditions.check_resource',
  category: 'conditions',
  name: '检查资源',
  description: '检查资源数量是否满足条件',
  icon: 'Coins',
  color: 'var(--accent)',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '满足'),
    socket('met', 'boolean', '是否满足'),
    socket('amount_out', 'number', '当前数量'),
  ],
  widgets: [
    widget('resource_key', '资源', 'resource_key'),
    widget('comparator', '运算符', 'op'),
    widget('number', '阈值', 'threshold', { min: 0, step: 1 }),
  ],
  searchTags: ['资源', '检查', '食物', '水'],
});

registerNode({
  typeId: 'conditions.check_stat',
  category: 'conditions',
  name: '检查属性',
  description: '检查属性值是否满足条件',
  icon: 'Heart',
  color: 'var(--accent)',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '满足'),
    socket('met', 'boolean', '是否满足'),
    socket('value_out', 'number', '当前值'),
  ],
  widgets: [
    widget('stat_key', '属性', 'stat_key'),
    widget('comparator', '运算符', 'op'),
    widget('number', '阈值', 'threshold'),
  ],
  searchTags: ['属性', '血量', '体力', '检查'],
});

registerNode({
  typeId: 'conditions.and',
  category: 'conditions',
  name: '并且',
  description: '所有条件都满足',
  icon: 'Ampersand',
  color: 'var(--accent)',
  inputs: [
    socket('in_0', 'boolean', '条件 A', { required: true }),
    socket('in_1', 'boolean', '条件 B', { required: true }),
  ],
  outputs: [socket('result', 'boolean', '结果')],
  searchTags: ['并且', '与', '都满足'],
});

registerNode({
  typeId: 'conditions.or',
  category: 'conditions',
  name: '或者',
  description: '任一条件满足即可',
  icon: 'Pipette',
  color: 'var(--accent)',
  inputs: [
    socket('in_0', 'boolean', '条件 A', { required: true }),
    socket('in_1', 'boolean', '条件 B', { required: true }),
  ],
  outputs: [socket('result', 'boolean', '结果')],
  searchTags: ['或者', '任一', '满足'],
});

registerNode({
  typeId: 'conditions.not',
  category: 'conditions',
  name: '取反',
  description: '条件不满足时为真',
  icon: 'ToggleLeft',
  color: 'var(--accent)',
  inputs: [socket('in_0', 'boolean', '条件', { required: true })],
  outputs: [socket('result', 'boolean', '结果')],
  searchTags: ['取反', '不满足', '非'],
});

registerNode({
  typeId: 'conditions.check_flag',
  category: 'conditions',
  name: '检查标记',
  description: '检查任意路径的布尔标记',
  icon: 'Flag',
  color: 'var(--accent)',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [socket('flow_out', 'flow', '满足')],
  widgets: [
    widget('path_select', '路径', 'path'),
    widget('boolean', '期望值', 'expected'),
  ],
  searchTags: ['标记', '布尔', '开关', '检查'],
});

registerNode({
  typeId: 'conditions.check_inventory',
  category: 'conditions',
  name: '检查物品',
  description: '检查玩家物品栏中是否有指定物品',
  icon: 'Backpack',
  color: 'var(--accent)',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '满足'),
    socket('count_out', 'number', '当前数量'),
  ],
  widgets: [
    widget('string', '物品名称', 'item_name', { placeholder: '如 医疗包' }),
    widget('comparator', '运算符', 'op'),
    widget('number', '阈值', 'threshold', { min: 0, step: 1 }),
  ],
  searchTags: ['物品', '背包', '道具', '检查'],
});

registerNode({
  typeId: 'conditions.check_npc',
  category: 'conditions',
  name: '检查人物',
  description: '检查 NPC 属性或关系值',
  icon: 'UserCheck',
  color: 'var(--accent)',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '满足'),
    socket('value_out', 'number', '当前值'),
  ],
  widgets: [
    widget('npc_select', 'NPC', 'npc_id'),
    widget('string', '字段', 'field', { placeholder: '如 好感度' }),
    widget('comparator', '运算符', 'op'),
    widget('number', '阈值', 'threshold'),
  ],
  searchTags: ['NPC', '人物', '好感', '关系', '属性'],
});

registerNode({
  typeId: 'conditions.event_match',
  category: 'conditions',
  name: '事件匹配',
  description: '检查当前回合是否有匹配类型的事件',
  icon: 'ScanSearch',
  color: 'var(--accent)',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('matched', 'boolean', '是否匹配'),
    socket('event_out', 'event', '事件数据'),
  ],
  widgets: [
    widget('event_type', '事件类型', 'match_type', { placeholder: '留空则匹配所有' }),
  ],
  searchTags: ['事件', '匹配', '检查', '类型'],
});

// ═══════════════════════════════════════════════════════════
//  动作（9 个）
// ═══════════════════════════════════════════════════════════

registerNode({
  typeId: 'actions.set_value',
  category: 'actions',
  name: '设置变量',
  description: '设置任意路径的值',
  icon: 'Variable',
  color: 'var(--node-effect)',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('value_in', 'any', '值'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [widget('path_select', '路径', 'path')],
  searchTags: ['设置', '变量', '修改'],
});

registerNode({
  typeId: 'actions.modify_resource',
  category: 'actions',
  name: '修改资源',
  description: '增减资源数量',
  icon: 'Package',
  color: 'var(--node-effect)',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('delta_in', 'number', '变化量'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('resource_key', '资源', 'resource_key'),
    widget('number', '变化量', 'delta', { step: 1 }),
  ],
  searchTags: ['资源', '增减', '食物', '水'],
});

registerNode({
  typeId: 'actions.modify_stat',
  category: 'actions',
  name: '修改属性',
  description: '增减属性值',
  icon: 'HeartPulse',
  color: 'var(--node-effect)',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('delta_in', 'number', '变化量'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('stat_key', '属性', 'stat_key'),
    widget('number', '变化量', 'delta', { step: 1 }),
  ],
  searchTags: ['属性', '血量', '体力', '增减'],
});

registerNode({
  typeId: 'actions.add_event',
  category: 'actions',
  name: '弹出事件卡',
  description: '弹出一张事件卡供玩家选择',
  icon: 'Swords',
  color: 'var(--node-effect)',
  inputs: [socket('flow_in', 'flow', '触发')],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [widget('event_id', '事件 ID', 'event_id')],
  searchTags: ['事件卡', '弹窗', '选择'],
});

registerNode({
  typeId: 'actions.schedule_tick',
  category: 'actions',
  name: '延迟触发',
  description: '若干回合后触发',
  icon: 'AlarmClock',
  color: 'var(--node-effect)',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('payload_in', 'any', '数据'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('number', '延迟轮数', 'after', { min: 1, step: 1 }),
    widget('string', '标签', 'tag', { placeholder: '用于匹配' }),
  ],
  searchTags: ['延迟', '定时', '稍后'],
});

registerNode({
  typeId: 'actions.modify_inventory',
  category: 'actions',
  name: '修改物品',
  description: '向物品栏添加或移除物品',
  icon: 'PackagePlus',
  color: 'var(--node-effect)',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('count_in', 'number', '数量'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('string', '物品名称', 'item_name', { placeholder: '如 医疗包' }),
    widget('number', '数量', 'count', { step: 1 }),
  ],
  searchTags: ['物品', '背包', '道具', '添加', '移除'],
});

registerNode({
  typeId: 'actions.modify_currency',
  category: 'actions',
  name: '修改货币',
  description: '增减主货币数量',
  icon: 'Coins',
  color: 'var(--node-effect)',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('delta_in', 'number', '变化量'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('number', '变化量', 'delta', { step: 1 }),
  ],
  searchTags: ['货币', '金币', '金钱', '增减'],
});

registerNode({
  typeId: 'actions.modify_npc',
  category: 'actions',
  name: '修改人物',
  description: '修改 NPC 属性或关系值',
  icon: 'UserCog',
  color: 'var(--node-effect)',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('value_in', 'any', '值'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('npc_select', 'NPC', 'npc_id'),
    widget('string', '字段', 'field', { placeholder: '如 好感度' }),
  ],
  searchTags: ['NPC', '人物', '好感', '关系', '修改'],
});

registerNode({
  typeId: 'actions.add_notebook',
  category: 'actions',
  name: '记事本',
  description: '向记事本添加一条记录',
  icon: 'NotebookPen',
  color: 'var(--node-effect)',
  inputs: [socket('flow_in', 'flow', '触发')],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('select', '类型', 'note_type', { options: [
      { label: '危机', value: 'crises' },
      { label: '机遇', value: 'opportunities' },
      { label: '待办', value: 'todo' },
    ]}),
    widget('string', '内容', 'content', { multiline: true }),
  ],
  searchTags: ['记事本', '笔记', '记录', '待办'],
});

// ═══════════════════════════════════════════════════════════
//  数据（6 个）
// ═══════════════════════════════════════════════════════════

registerNode({
  typeId: 'data.get_value',
  category: 'data',
  name: '读取值',
  description: '读取游戏状态中任意路径的值',
  icon: 'Eye',
  color: '#38bdf8',
  inputs: [],
  outputs: [socket('value', 'any', '值')],
  widgets: [widget('path_select', '路径', 'path')],
  source: true,
  searchTags: ['读取', '获取', '路径'],
});

registerNode({
  typeId: 'data.get_resource',
  category: 'data',
  name: '读取资源',
  description: '读取资源当前数量',
  icon: 'Database',
  color: '#38bdf8',
  inputs: [],
  outputs: [socket('amount', 'number', '数量')],
  widgets: [widget('resource_key', '资源', 'resource_key')],
  source: true,
  searchTags: ['资源', '读取', '数量'],
});

registerNode({
  typeId: 'data.get_stat',
  category: 'data',
  name: '读取属性',
  description: '读取属性当前值',
  icon: 'BarChart',
  color: '#38bdf8',
  inputs: [],
  outputs: [socket('value', 'number', '值')],
  widgets: [widget('stat_key', '属性', 'stat_key')],
  source: true,
  searchTags: ['属性', '读取', '血量'],
});

registerNode({
  typeId: 'data.constant',
  category: 'data',
  name: '常量',
  description: '输出一个固定值',
  icon: 'Hash',
  color: '#38bdf8',
  inputs: [],
  outputs: [socket('value', 'any', '值')],
  widgets: [
    widget('select', '类型', 'const_type', { options: [
      { label: '数字', value: 'number' },
      { label: '文字', value: 'string' },
      { label: '是/否', value: 'boolean' },
    ]}),
    widget('string', '值', 'const_value'),
  ],
  source: true,
  searchTags: ['常量', '固定值', '数字'],
});

registerNode({
  typeId: 'data.math',
  category: 'data',
  name: '数学运算',
  description: '对两个数值做运算',
  icon: 'Calculator',
  color: '#38bdf8',
  inputs: [
    socket('a', 'number', 'A', { required: true }),
    socket('b', 'number', 'B', { required: true }),
  ],
  outputs: [socket('result', 'number', '结果')],
  widgets: [widget('math_op', '运算', 'op')],
  searchTags: ['数学', '加减乘除', '计算'],
});

registerNode({
  typeId: 'data.get_random',
  category: 'data',
  name: '随机数',
  description: '生成指定范围内的随机数（确定性）',
  icon: 'Dice5',
  color: '#38bdf8',
  inputs: [],
  outputs: [socket('value', 'number', '随机值')],
  widgets: [
    widget('number', '最小值', 'min', { step: 1 }),
    widget('number', '最大值', 'max', { step: 1 }),
  ],
  source: true,
  searchTags: ['随机', '骰子', '概率', '数字'],
});

// ═══════════════════════════════════════════════════════════
//  流程控制（3 个）
// ═══════════════════════════════════════════════════════════

registerNode({
  typeId: 'flow.branch',
  category: 'flow',
  name: '分支',
  description: '根据条件走不同路径',
  icon: 'GitBranch',
  color: '#f97316',
  inputs: [
    socket('flow_in', 'flow', '输入'),
    socket('condition', 'boolean', '条件', { required: true }),
  ],
  outputs: [
    socket('true_out', 'flow', '满足'),
    socket('false_out', 'flow', '不满足'),
  ],
  searchTags: ['分支', '条件', '如果'],
});

registerNode({
  typeId: 'flow.gate',
  category: 'flow',
  name: '门控',
  description: '条件为真时放行',
  icon: 'DoorOpen',
  color: '#f97316',
  inputs: [
    socket('flow_in', 'flow', '输入'),
    socket('condition', 'boolean', '条件', { required: true }),
  ],
  outputs: [socket('flow_out', 'flow', '放行')],
  searchTags: ['门控', '开关', '判断'],
});

registerNode({
  typeId: 'flow.reroute',
  category: 'flow',
  name: '整理连线',
  description: '纯粹的连线整理节点',
  icon: 'ArrowRightLeft',
  color: '#f97316',
  inputs: [socket('in', 'any', '输入')],
  outputs: [socket('out', 'any', '输出')],
  searchTags: ['整理', '连线', '中转'],
});

// ═══════════════════════════════════════════════════════════
//  输出（3 个）
// ═══════════════════════════════════════════════════════════

registerNode({
  typeId: 'output.show_card',
  category: 'output',
  name: '显示卡片',
  description: '弹出一张事件卡',
  icon: 'CreditCard',
  color: 'var(--success)',
  inputs: [socket('flow_in', 'flow', '触发')],
  outputs: [],
  terminal: true,
  widgets: [widget('event_id', '事件 ID', 'event_id')],
  searchTags: ['卡片', '弹窗', '事件卡'],
});

registerNode({
  typeId: 'output.narrate_hint',
  category: 'output',
  name: 'AI 叙事提示',
  description: '向 AI 注入叙事提示',
  icon: 'Sparkles',
  color: 'var(--success)',
  inputs: [socket('flow_in', 'flow', '触发')],
  outputs: [],
  terminal: true,
  widgets: [widget('string', '提示内容', 'hint', { multiline: true })],
  searchTags: ['AI', '叙事', '提示'],
});

registerNode({
  typeId: 'output.end_workflow',
  category: 'output',
  name: '结束',
  description: '工作流终点',
  icon: 'CircleDot',
  color: 'var(--success)',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [],
  terminal: true,
  searchTags: ['结束', '终点'],
});
