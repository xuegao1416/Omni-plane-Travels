// ============================================================
//  卡片节点注册表 — 12 种核心节点，全中文
//  对齐规则包 nodeRegistry.ts 的架构深度
// ============================================================
import type {
  CardNodeType, CardNodeDefinition, CardNodeSocket, CardSocketType, CardWidgetConfig,
} from './schema';

// ─── 注册表存储 ───

const definitions = new Map<CardNodeType, CardNodeDefinition>();

export function registerCardNode(def: CardNodeDefinition): void {
  definitions.set(def.typeId, def);
}

export function getCardNodeDefinition(typeId: CardNodeType): CardNodeDefinition | undefined {
  return definitions.get(typeId);
}

export function getAllCardNodeDefinitions(): CardNodeDefinition[] {
  return [...definitions.values()];
}

export function getCardNodeCategories(): Map<string, CardNodeDefinition[]> {
  const cats = new Map<string, CardNodeDefinition[]>();
  for (const def of definitions.values()) {
    const list = cats.get(def.category) ?? [];
    list.push(def);
    cats.set(def.category, list);
  }
  return cats;
}

export function searchCardNodes(query: string): CardNodeDefinition[] {
  const q = query.toLowerCase().trim();
  if (!q) return getAllCardNodeDefinitions();
  return getAllCardNodeDefinitions().filter((def) => {
    const haystack = [def.name, def.description, def.category, ...(def.searchTags ?? [])].join(' ').toLowerCase();
    return q.split(/\s+/).every((word) => haystack.includes(word));
  });
}

export function areCardSocketTypesCompatible(sourceType: CardSocketType, targetType: CardSocketType): boolean {
  if (sourceType === 'any' || targetType === 'any') return true;
  return sourceType === targetType;
}

export function validateCardConnection(
  sourceDef: CardNodeDefinition, sourceSocketKey: string,
  targetDef: CardNodeDefinition, targetSocketKey: string,
  existingConnections: Array<{ targetNodeId: string; targetSocketKey: string }>,
  targetNodeId: string,
): string | null {
  const srcSocket = sourceDef.outputs.find((s) => s.key === sourceSocketKey);
  const tgtSocket = targetDef.inputs.find((s) => s.key === targetSocketKey);
  if (!srcSocket) return `源节点没有输出端口 ${sourceSocketKey}`;
  if (!tgtSocket) return `目标节点没有输入端口 ${targetSocketKey}`;
  if (!areCardSocketTypesCompatible(srcSocket.type, tgtSocket.type)) return `类型不兼容: ${srcSocket.type} → ${tgtSocket.type}`;
  if (!tgtSocket.multi) {
    const already = existingConnections.some((c) => c.targetNodeId === targetNodeId && c.targetSocketKey === targetSocketKey);
    if (already) return `端口已连接`;
  }
  return null;
}

// ─── 辅助工厂 ───

function socket(key: string, type: CardSocketType, label: string, opts?: Partial<CardNodeSocket>): CardNodeSocket {
  return { key, type, label, ...opts };
}

function widget(type: CardWidgetConfig['type'], label: string, socketKey: string, opts?: Partial<CardWidgetConfig>): CardWidgetConfig {
  return { type, label, socketKey, ...opts };
}

// ═══════════════════════════════════════════════════════════
//  叙事节点（4 个）
// ═══════════════════════════════════════════════════════════

registerCardNode({
  typeId: 'narrative.title',
  category: 'narrative',
  name: '标题卡',
  description: '事件卡的标题，用于展示事件名称',
  icon: 'Type',
  color: '#8b5cf6',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('string', '标题文本', 'title', { placeholder: '如：神秘的森林' }),
    widget('select', '样式', 'style', { options: [
      { label: '默认', value: 'default' },
      { label: '警告', value: 'warning' },
      { label: '重要', value: 'important' },
    ]}),
  ],
  searchTags: ['标题', '名称', '事件名'],
});

registerCardNode({
  typeId: 'narrative.text',
  category: 'narrative',
  name: '文本叙事',
  description: '叙事文本内容，描述场景、对话、内心独白等',
  icon: 'FileText',
  color: '#8b5cf6',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('string', '叙事文本', 'text', { multiline: true, placeholder: '描述当前场景...' }),
  ],
  searchTags: ['文本', '叙事', '描述', '故事'],
});

registerCardNode({
  typeId: 'narrative.image',
  category: 'narrative',
  name: '图片叙事',
  description: '展示图片，配合文字描述场景',
  icon: 'Image',
  color: '#8b5cf6',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('string', '图片 URL', 'imageUrl', { placeholder: 'https://...' }),
    widget('string', '替代文本', 'alt', { placeholder: '图片描述' }),
    widget('string', '说明文字', 'caption', { placeholder: '可选的图片说明' }),
  ],
  searchTags: ['图片', '插图', '场景图'],
});

registerCardNode({
  typeId: 'narrative.dialog',
  category: 'narrative',
  name: '对话叙事',
  description: 'NPC 对话格式，包含角色名和台词',
  icon: 'MessageCircle',
  color: '#8b5cf6',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('string', 'NPC 名称', 'npcName', { placeholder: '如：老村长' }),
    widget('string', '台词内容', 'dialogText', { multiline: true, placeholder: '"年轻人，你来了..."' }),
    widget('select', '情绪', 'emotion', { options: [
      { label: '平静', value: 'neutral' },
      { label: '友好', value: 'friendly' },
      { label: '严肃', value: 'serious' },
      { label: '愤怒', value: 'angry' },
      { label: '悲伤', value: 'sad' },
      { label: '惊讶', value: 'surprised' },
    ]}),
  ],
  searchTags: ['对话', 'NPC', '台词', '说话'],
});

// ═══════════════════════════════════════════════════════════
//  交互节点（4 个）
// ═══════════════════════════════════════════════════════════

registerCardNode({
  typeId: 'choice.static',
  category: 'choice',
  name: '静态选项',
  description: '固定的选项列表，玩家从中选择一个',
  icon: 'ListChecks',
  color: '#f59e0b',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '选择后'),
    socket('selected_index', 'number', '选中索引'),
    socket('selected_label', 'string', '选中标签'),
  ],
  widgets: [
    widget('json', '选项列表', 'options', { multiline: true, placeholder: '[{"label":"选项一","aiNote":"备注"}]' }),
  ],
  searchTags: ['选项', '选择', '静态', '固定'],
});

registerCardNode({
  typeId: 'choice.dynamic',
  category: 'choice',
  name: 'AI 动态选项',
  description: '根据玩家状态、物品栏、属性实时生成选项',
  icon: 'Sparkles',
  color: '#f59e0b',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '选择后'),
    socket('selected_index', 'number', '选中索引'),
    socket('selected_label', 'string', '选中标签'),
  ],
  widgets: [
    widget('string', '生成指令', 'instruction', { multiline: true, placeholder: '根据玩家当前资源给出3个可行的选择' }),
    widget('number', '最少选项', 'minCount', { min: 1, max: 6, step: 1 }),
    widget('number', '最多选项', 'maxCount', { min: 2, max: 8, step: 1 }),
    widget('boolean', '要求效果', 'effectRequired'),
    widget('boolean', '要求备注', 'aiNoteRequired'),
    widget('json', '兜底选项', 'fallback', { multiline: true, placeholder: '[{"label":"静观其变","aiNote":"等待"}]' }),
  ],
  searchTags: ['AI', '动态', '生成', '智能'],
});

registerCardNode({
  typeId: 'choice.conditional',
  category: 'choice',
  name: '条件选项',
  description: '根据游戏状态（物品栏/属性/标记）动态显示或隐藏选项',
  icon: 'Filter',
  color: '#f59e0b',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '选择后'),
    socket('selected_index', 'number', '选中索引'),
    socket('selected_label', 'string', '选中标签'),
  ],
  widgets: [
    widget('json', '选项列表', 'options', { multiline: true, placeholder: '[{"label":"选项一","conditionPath":"玩家.生存资源.食物","conditionOp":">","conditionValue":5}]' }),
  ],
  searchTags: ['条件', '过滤', '物品栏', '判断'],
});

registerCardNode({
  typeId: 'choice.weighted',
  category: 'choice',
  name: '权重选项',
  description: '按权重随机展示选项子集，适合随机遭遇',
  icon: 'Dice5',
  color: '#f59e0b',
  inputs: [socket('flow_in', 'flow', '输入')],
  outputs: [
    socket('flow_out', 'flow', '选择后'),
    socket('selected_index', 'number', '选中索引'),
    socket('selected_label', 'string', '选中标签'),
  ],
  widgets: [
    widget('number', '展示数量', 'showCount', { min: 1, max: 6, step: 1 }),
    widget('json', '选项列表', 'options', { multiline: true, placeholder: '[{"label":"选项一","weight":50}]' }),
  ],
  searchTags: ['权重', '随机', '概率', '抽取'],
});

// ═══════════════════════════════════════════════════════════
//  效果节点（3 个）
// ═══════════════════════════════════════════════════════════

registerCardNode({
  typeId: 'effect.stat',
  category: 'effect',
  name: '属性效果',
  description: '修改玩家属性值（生命/能量/六维等）',
  icon: 'HeartPulse',
  color: '#10b981',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('delta_in', 'number', '变化量'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('stat_key', '属性', 'statKey'),
    widget('number', '变化量', 'delta', { step: 1 }),
  ],
  searchTags: ['属性', '生命', '能量', '增减'],
});

registerCardNode({
  typeId: 'effect.resource',
  category: 'effect',
  name: '资源效果',
  description: '修改资源/物品栏数量',
  icon: 'Package',
  color: '#10b981',
  inputs: [
    socket('flow_in', 'flow', '触发'),
    socket('delta_in', 'number', '变化量'),
  ],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('resource_key', '资源', 'resourceKey'),
    widget('number', '变化量', 'delta', { step: 1 }),
  ],
  searchTags: ['资源', '物品', '食物', '水', '增减'],
});

registerCardNode({
  typeId: 'effect.flag',
  category: 'effect',
  name: '标记效果',
  description: '设置或清除游戏标记（布尔开关）',
  icon: 'Flag',
  color: '#10b981',
  inputs: [socket('flow_in', 'flow', '触发')],
  outputs: [socket('flow_out', 'flow', '继续')],
  widgets: [
    widget('path_select', '标记路径', 'flagPath', { placeholder: '如：flags.已遇到村长' }),
    widget('boolean', '设置值', 'value'),
  ],
  searchTags: ['标记', '开关', '布尔', '设置'],
});

// ═══════════════════════════════════════════════════════════
//  流程节点（1 个）
// ═══════════════════════════════════════════════════════════

registerCardNode({
  typeId: 'flow.branch',
  category: 'flow',
  name: '条件分支',
  description: '根据游戏状态走不同路径（属性/资源/标记判断）',
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
  widgets: [
    widget('path_select', '检查路径', 'checkPath', { placeholder: '如：玩家.生存状态.生命' }),
    widget('select', '运算符', 'op', { options: [
      { label: '等于', value: '==' },
      { label: '不等于', value: '!=' },
      { label: '大于', value: '>' },
      { label: '大于等于', value: '>=' },
      { label: '小于', value: '<' },
      { label: '小于等于', value: '<=' },
    ]}),
    widget('string', '比较值', 'compareValue', { placeholder: '如：50' }),
  ],
  searchTags: ['分支', '条件', '判断', '如果'],
});
