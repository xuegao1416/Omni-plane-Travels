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
  /** 事件效果与条件可用的变量（来自玩法宿主的变量注册表）。 */
  variables?: Array<{ path: string; label: string; type: string; writable: boolean }>;
  /** 事件效果可调用的模块命令。 */
  commands?: string[];
  /** 本世界会发生的领域事件类型（卡片触发器 on 可用）。 */
  domainEvents?: string[];
}

/** 没有世界目录时（旧调用方）用的常见领域事件；正常情况由玩法宿主按已启用模块给出（generatorReference）。 */
export const COMMON_DOMAIN_EVENTS = [
  'turn.ended（每回合结束）', 'time.day（跨过一天）', 'quest.completed / quest.failed / quest.accepted',
  'check.rolled（事件检定，payload.success）', 'dice.resolved（正文检定）', 'player.downed（生命归零）', 'stat.changed',
  'resources.low / resources.depleted（payload.id 为物资 id）', 'status.applied', 'resources.crafted',
  'economy.traded（payload.side 为 buy/sell）', 'economy.contractFulfilled / economy.contractFailed', 'economy.incident',
  'progression.promoted（升级）', 'events.resolved（玩家处理完一张事件卡）',
  'combat.ended（战斗结束，payload.status 为 victory/defeat/escaped/draw）', 'talent.unlocked / skill.learned / skill.used（能力）',
];

/** 卡片节点类型白名单 */
const CARD_NODE_TYPES = [
  'narrative.title', 'narrative.text', 'narrative.image', 'narrative.dialog',
  'choice.static', 'choice.dynamic', 'choice.conditional', 'choice.weighted',
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
  const variableRef = (options.variables ?? []).length
    ? options.variables!.slice(0, 60).map(item => `- ${item.path}（${item.label}，${item.type}${item.writable ? '' : '，只读'}）`).join('\n')
    : '（无）';
  const commandRef = (options.commands ?? []).length ? options.commands!.map(item => `- ${item}`).join('\n') : '（无）';
  const eventRef = (options.domainEvents?.length ? options.domainEvents : COMMON_DOMAIN_EVENTS).map(item => `- ${item}`).join('\n');

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

属性 key（用于选项效果 stat、检定 check.stat，以及规则节点 conditions.check_stat / actions.modify_stat 的 stat_key）：
${statRef}

物资 id（用于选项效果 resource，以及规则节点 conditions.check_resource / actions.modify_resource 的 resource_key）：
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
      "trigger": { "on": ["deck"], "cooldownTurns": 6 },
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
- choice.static: { "options": [选项对象...] }（选项对象格式见下方【选项的后果】）
- choice.dynamic: { "instruction": "生成指令", "minCount": 2, "maxCount": 4 }
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
narrative.title(flow_out) → narrative.text(flow_in)
narrative.text(flow_out) → choice.static(flow_in)
（不要在选项后面再接 effect 节点：那样的效果对所有选项一视同仁。效果写在每个选项自己身上。）

═══════════════════════════════════════
【选项的后果 —— 每个选项写自己的效果，不同选项后果必须不同】
{
  "label": "选项文字",
  "aiNote": "给下一段正文的提示（玩家这样选意味着什么）",
  "effects": [效果...],                      // 选了就生效
  "check": { "stat": "属性key或变量路径", "dc": 12, "label": "检定名" },   // 可选：d20 检定，dc 8~18
  "success": { "effects": [...], "note": "成功时发生了什么", "next": "后续事件id" },
  "failure": { "effects": [...], "note": "失败时发生了什么", "next": "后续事件id" },
  "next": "选完接着出现的事件id（可选）",
  "requires": { "fact": "变量路径", "op": ">=", "value": 100 },   // 可选：不满足时选项灰掉
  "requiresText": "不满足时显示的原因"
}
效果写法（数值用增减，系统会按范围钳制）：
- { "stat": "属性key", "delta": -10 }
- { "resource": "物资id", "delta": 3 }
- { "currency": -50 }
- { "item": "物品名", "delta": 1 }
- { "flag": "标记名", "value": true }            // 写入 flags.标记名，可被后续条件读取
- { "fact": "变量路径", "delta": 1 } 或 { "fact": "变量路径", "value": "新值" }
- { "status": "状态id", "days": 3 } / { "clearStatus": "状态id" }
- { "command": "命令名", "args": { ... } }
- { "note": "需要正文承认的事实" }

【事件出现方式 —— 每个事件可写 "trigger"】
"trigger": { "on": ["deck"], "cooldownTurns": 6 }                    // 进随机牌堆（默认）
"trigger": { "on": ["deck"], "once": true, "when": { "fact": "turn", "op": ">=", "value": 10 } }
"trigger": { "on": ["resources.low"], "when": { "event": { "type": "resources.low", "where": { "id": "water" } } }, "cooldownTurns": 4 }
"trigger": { "on": ["turn.ended"], "when": { "fact": "flags.某标记", "op": "==", "value": true }, "once": true }
可选字段：chance（0~1 概率）、weight（牌堆权重）、once、cooldownTurns。只作为 next 后续出现的事件不要写 trigger。

可监听的领域事件：
${eventRef}

条件与效果可用的变量：
${variableRef}

效果可调用的命令：
${commandRef}

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
1. 包含 3~5 个有意义的事件（每个事件至少 1 个叙事节点 + 1 个 choice 节点；每个选项写自己的 effects，至少一个选项带检定和成功/失败分支）
2. 包含 2~3 条规则（周期触发或条件触发）
3. 【核心】规则必须与事件联动！至少 1 条规则要用 actions.add_event 弹出本合集中的事件卡
4. 内容要与世界书中的势力、NPC、地点、冲突等元素深度融合
5. 事件之间要有故事连贯性
6. 【重要】每个事件的工作流必须有完整的连线！choice 节点的 flow_out 必须连到后续节点
7. 【重要】所有节点 id 必须全局唯一
8. 【重要】属性 key、物资 id、变量路径、命令名必须使用参考表中的精确值
10. 【重要】每个事件写 trigger：至少一个事件监听领域事件（如物资告急、任务完成、交易），而不是全部随机出现
9. 【重要】actions.add_event 的 event_id 必须填写本合集中 events 里某个事件的 id
${extra ? `\n【用户额外要求】\n${extra}` : ''}

直接输出 JSON，不要任何解释文字。`;
}
