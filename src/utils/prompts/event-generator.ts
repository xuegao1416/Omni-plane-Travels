// ============================================================
//  AI 事件/规则模板生成器 — Prompt 构建函数
//  选中世界后一键生成包含事件+规则的完整合集
// ============================================================

export interface EventGeneratorOptions {
  /** 世界名称 */
  worldName: string;
  /** 世界简介 */
  worldDescription: string;
  /** 世界书条目内容 */
  worldBookEntries: Array<{ comment: string; content: string }>;
  /** 世界已启用的模块名列表 */
  moduleNames: string[];
  /** 用户可选的额外要求 */
  extraRequest?: string;

  // ── 世界实际配置（供 AI 填写有效值） ──
  /** 属性 key 列表，如 ['attrA', 'attrB', 'dim1', 'dim2', ...] */
  statKeys: string[];
  /** 属性中文名映射，如 { attrA: '生命', dim1: '力量' } */
  statNames: Record<string, string>;
  /** 生存资源列表，如 [{ id: 'food', name: '食物' }] */
  resources: Array<{ id: string; name: string }>;
  /** 经营资产列表，如 [{ id: 'tavern', name: '酒馆' }] */
  assets: Array<{ id: string; name: string }>;
  /** 世界书中的 NPC 名列表 */
  npcNames: string[];
  /** 世界书中的势力名列表 */
  factionNames: string[];
}

/** 卡片节点类型白名单 */
const CARD_NODE_TYPES = [
  'narrative.title', 'narrative.text', 'narrative.image', 'narrative.dialog',
  'choice.static', 'choice.dynamic', 'choice.conditional', 'choice.weighted',
  'effect.stat', 'effect.resource', 'effect.flag',
  'flow.branch',
];

/** 规则节点类型白名单 */
const RULE_NODE_TYPES = [
  'triggers.world_event', 'triggers.periodic', 'triggers.manual', 'triggers.choice_made',
  'conditions.compare', 'conditions.check_resource', 'conditions.check_stat',
  'conditions.and', 'conditions.or', 'conditions.not',
  'conditions.check_flag', 'conditions.check_inventory', 'conditions.check_npc', 'conditions.event_match',
  'actions.set_value', 'actions.modify_resource', 'actions.modify_stat',
  'actions.add_event', 'actions.schedule_tick', 'actions.modify_inventory',
  'actions.modify_currency', 'actions.modify_npc', 'actions.add_notebook',
  'data.get_value', 'data.get_resource', 'data.get_stat', 'data.constant', 'data.math',
];

/**
 * 构建 AI 合集生成器的 System Prompt
 */
export function buildEventGeneratorPrompt(options: EventGeneratorOptions): string {
  const {
    worldName, worldDescription, worldBookEntries, moduleNames,
    statKeys, statNames, resources, assets, npcNames, factionNames,
  } = options;

  const worldBookContext = worldBookEntries.length > 0
    ? worldBookEntries.map(e => `【${e.comment}】\n${e.content}`).join('\n\n')
    : '（无世界书条目）';

  const moduleInfo = moduleNames.length > 0
    ? moduleNames.map(n => `- ${n}`).join('\n')
    : '（无已启用模块）';

  // 构建属性参考表
  const statRef = statKeys.length > 0
    ? statKeys.map(k => `- ${k}（${statNames[k] ?? k}）`).join('\n')
    : '（无属性系统）';

  // 构建资源参考表
  const resourceRef = resources.length > 0
    ? resources.map(r => `- id: "${r.id}"（${r.name}）`).join('\n')
    : '（无生存资源）';

  // 构建资产参考表
  const assetRef = assets.length > 0
    ? assets.map(a => `- id: "${a.id}"（${a.name}）`).join('\n')
    : '（无经营资产）';

  // 构建 NPC 参考表
  const npcRef = npcNames.length > 0
    ? npcNames.map(n => `- ${n}`).join('\n')
    : '（无预设 NPC）';

  // 构建势力参考表
  const factionRef = factionNames.length > 0
    ? factionNames.map(n => `- ${n}`).join('\n')
    : '（无预设势力）';

  return `你是一个游戏内容合集生成器。你的任务是根据世界设定，生成一个完整的、可直接导入的事件+规则合集。

═══════════════════════════════════════
【核心原则】
1. 输出必须是严格的 JSON 格式，不要包含任何其他文字说明
2. 所有 id 使用英文小写字母 + 下划线，简短有意义
3. 节点类型只能使用白名单中的类型，不能自创
4. 生成内容必须与世界设定深度融合，融入世界书中的具体元素
5. 合集应包含 3~5 个事件（卡片）+ 2~3 条规则，形成完整的游戏体验
6. 事件之间、事件与规则之间应有关联性
7. 节点之间必须有正确的连线，形成完整的执行流
8. 【关键】widgetValues 中的值必须使用下方「可选值参考表」中的精确 id，不要自己编造

【世界设定】
世界名：${worldName}
世界简介：${worldDescription}

【已启用模块】
${moduleInfo}

【世界书参考】
${worldBookContext}

═══════════════════════════════════════
【可选值参考表 —— widgetValues 必须使用以下精确值】

属性 key（用于 effect.stat / conditions.check_stat / actions.modify_stat 的 stat_key / statKey 字段）：
${statRef}

生存资源 id（用于 effect.resource / conditions.check_resource / actions.modify_resource 的 resource_key / resourceKey 字段）：
${resourceRef}

经营资产 id：
${assetRef}

NPC 名称（用于 narrative.dialog 的 npcName、conditions.check_npc 的 npc_id、actions.modify_npc 的 npc_id）：
${npcRef}

势力名称（用于 narrative 文本中提及）：
${factionRef}

═══════════════════════════════════════
【卡片节点白名单】
${CARD_NODE_TYPES.map(t => `- ${t}`).join('\n')}

【规则节点白名单】
${RULE_NODE_TYPES.map(t => `- ${t}`).join('\n')}

【输出 JSON 结构】
{
  "bundleName": "合集名称",
  "events": [
    {
      "id": "event_id",
      "name": "事件名称",
      "workflow": {
        "nodes": [
          {
            "id": "node_1",
            "typeId": "narrative.text",
            "label": "节点标签",
            "position": { "x": 100, "y": 100 },
            "widgetValues": { "text": "叙事文本" }
          }
        ],
        "connections": [
          {
            "id": "conn_1",
            "sourceNodeId": "node_1",
            "sourceSocketKey": "flow_out",
            "targetNodeId": "node_2",
            "targetSocketKey": "flow_in"
          }
        ]
      }
    }
  ],
  "rules": [
    {
      "id": "rule_id",
      "name": "规则名称",
      "workflow": {
        "nodes": [...],
        "connections": [...]
      }
    }
  ]
}

【节点 widgetValues 格式 —— 必须严格按此格式填写】
- narrative.title: { "title": "标题文本", "style": "default"|"warning"|"important" }
- narrative.text: { "text": "叙事文本内容" }
- narrative.dialog: { "npcName": "从NPC参考表选取", "dialogText": "台词", "emotion": "neutral"|"friendly"|"serious"|"angry"|"sad"|"surprised" }
- choice.static: { "options": [{ "label": "选项文本", "aiNote": "给AI的备注" }] }
- choice.dynamic: { "instruction": "生成指令", "minCount": 2, "maxCount": 4 }
- effect.stat: { "statKey": "从属性key参考表选取如attrA", "delta": 10 }
- effect.resource: { "resourceKey": "从资源id参考表选取如food", "delta": -5 }
- effect.flag: { "flagPath": "flags.自定义标记名", "value": true }
- flow.branch: { "checkPath": "从属性key参考表选取", "op": ">"|"<"|">="|"<="|"=="|"!=", "compareValue": "50" }
- triggers.periodic: { "interval": 5, "description": "描述", "narrate": true }
- triggers.world_event: { "match_type": "自定义事件类型", "priority": 10 }
- conditions.check_resource: { "resource_key": "从资源id参考表选取", "op": ">=", "threshold": 5 }
- conditions.check_stat: { "stat_key": "从属性key参考表选取", "op": "<", "threshold": 30 }
- actions.modify_resource: { "resource_key": "从资源id参考表选取", "delta": -3 }
- actions.modify_stat: { "stat_key": "从属性key参考表选取", "delta": -10 }
- actions.add_event: { "event_id": "本合集中某个事件的id" }
- actions.add_notebook: { "title": "标题", "note_type": "风险"|"机遇"|"线索"|"关系"|"地点"|"物品", "content": "内容" }

【连线规则 —— 必须严格遵守】
1. 每个事件的工作流必须形成完整的执行链：从第一个节点开始，每个节点的 flow_out 必须连到下一个节点的 flow_in
2. choice 节点的 flow_out 端口必须连接到后续节点（如 effect 节点或下一个 narrative 节点）
3. effect 节点的 flow_out 必须连接到下一个节点
4. 一个非 multi 输入端口只能连一个输出端口
5. 一个输出端口可以连多个输入端口
6. 节点 id 必须全局唯一（跨事件也唯一），建议格式：evt1_narrative_1、evt1_choice_1、evt2_trigger_1

【每个事件的典型连线模式】
narrative.text(flow_out) → choice.static(flow_in)
choice.static(flow_out) → effect.stat(flow_in)
effect.stat(flow_out) → narrative.text(flow_in)

【每条规则的典型连线模式】
triggers.periodic(flow_out) → conditions.check_resource(flow_in)
conditions.check_resource(flow_out) → actions.modify_stat(flow_in)
conditions.check_resource(flow_out) → actions.add_notebook(flow_in)

【自联动 —— 规则弹出本合集中的事件卡】
规则可以用 actions.add_event 节点弹出事件包中的事件卡，实现"后台规则触发 → 弹出事件让玩家选择"的联动效果。
具体做法：
1. 在 rules 的 workflow 中使用 actions.add_event 节点
2. widgetValues.event_id 填写 events 中某个事件的 id（精确匹配）
3. 典型模式：triggers.periodic → conditions.check_resource → actions.add_event
示例：
- events 中定义 id 为 "random_encounter" 的事件
- rules 中用 actions.add_event 节点，widgetValues: { "event_id": "random_encounter" }
- 当规则触发时，会弹出这个事件卡供玩家选择

【完整自联动示例】
events: [
  { "id": "starvation_event", "name": "饥饿危机", "workflow": { "nodes": [...], "connections": [...] } }
],
rules: [
  {
    "id": "hunger_rule",
    "name": "饥饿检测",
    "workflow": {
      "nodes": [
        { "id": "r1_trigger", "typeId": "triggers.periodic", "widgetValues": { "interval": 3, "description": "每3回合检测饥饿" } },
        { "id": "r1_check", "typeId": "conditions.check_resource", "widgetValues": { "resource_key": "food", "op": "<", "threshold": 3 } },
        { "id": "r1_popup", "typeId": "actions.add_event", "widgetValues": { "event_id": "starvation_event" } }
      ],
      "connections": [
        { "id": "c1", "sourceNodeId": "r1_trigger", "sourceSocketKey": "flow_out", "targetNodeId": "r1_check", "targetSocketKey": "flow_in" },
        { "id": "c2", "sourceNodeId": "r1_check", "sourceSocketKey": "flow_out", "targetNodeId": "r1_popup", "targetSocketKey": "flow_in" }
      ]
    }
  }
]`;
}

/**
 * 构建用户消息
 */
export function buildEventGeneratorUserMessage(options: EventGeneratorOptions): string {
  const extra = options.extraRequest?.trim();
  return `请根据「${options.worldName}」的世界设定，生成一个完整的游戏内容合集。

要求：
1. 包含 3~5 个有意义的事件（每个事件至少 1 个叙事节点 + 1 个交互/效果节点）
2. 包含 2~3 条规则（周期触发或条件触发）
3. 【核心】规则必须与事件联动！至少 1 条规则要用 actions.add_event 弹出本合集中的事件卡
4. 内容要与世界书中的势力、NPC、地点、冲突等元素深度融合
5. 事件之间要有故事连贯性
6. 【重要】每个事件的工作流必须有完整的连线！choice 节点的 flow_out 必须连到后续节点
7. 【重要】所有节点 id 必须全局唯一
8. 【重要】widgetValues 中的 statKey / resourceKey / stat_key / resource_key 必须使用参考表中的精确值
9. 【重要】actions.add_event 的 event_id 必须填写本合集中 events 里某个事件的 id
${extra ? `\n【用户额外要求】\n${extra}` : ''}

直接输出 JSON，不要任何解释文字。`;
}
