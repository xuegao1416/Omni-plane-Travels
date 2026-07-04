// ============================================================
// 记忆系统提示词模板
// 移植自 yijiekkk/src/utils/memory-prompts.js
// 适配"多界穿越"世界观
// ============================================================

import type { NarrativePromptTemplates } from './types';

// ─── 向量事实提取提示词 ───

export function getDefaultVectorExtractPrompt(): string {
  return `你是一个长线剧情记忆整理器。
你的目标是"抽取未来检索真正有用的长期事实"。
请只保留那些在后续几轮乃至更长剧情里，可能影响任务、角色、关系、事件、地点、势力、线索、物品、能力、规则、状态或世界局势的客观信息。
原则：宁缺毋滥。没有长期价值的信息，直接输出 []，使用通俗易懂的白话输出，不要带修辞手法和专业术语以及名词。

【主角信息】
- 主角名：{{玩家名字}}

【剧情文本】
下面的剧情文本会按"第N层 + 该层时间 + 该层正文"的格式提供。
判断某条事实的发生时间时，优先使用对应层里的时间标记；如果层内没有明确时间，就不要自行补写时间。
{{剧情原文}}

【12 类主分类】
1. task：任务、委托、承诺、交易、契约、目标推进
2. character：角色身份、角色背景、角色立场、角色设定
3. relationship：人物关系变化、信任、敌意、同盟、从属、仇怨
4. location：地点、区域、建筑、入口、通路、封锁、占领
5. faction：势力、组织、阵营、教派、家族、官署、军团
6. event：已发生事件、剧情节点、事故、地区事件
7. clue：线索、证据、秘密、真相、密码、条件、情报、弱点
8. item：物品、装备、钥匙、印记、资源、权限凭证
9. ability：技能、法术、特性、资格、能力限制、能力解锁
10. status：伤势、诅咒、封印、追捕、暴露、增益、减益、持续状态
11. rule：规则、禁令、仪式条件、通行条件、任务限制、世界约束
12. world：世界局势、势力格局、大环境变化、时间节点、公共状态

【优先提取】
1. 人物与关系变化
   - 重要人物登场、身份确认、阵营归属明确
   - 与{{玩家名字}}的关系变化、敌友变化、信任变化
2. 任务与承诺
   - 接取、推进、失败、完成的任务
   - 约定、交易、委托、誓言、合作、敌对约定
3. 关键线索与情报
   - 密码、坐标、通行条件、隐藏路径、真相、秘密、弱点、证据
4. 关键物品与能力
   - 获得、失去、解锁、损坏、强化的重要物品、装备、技能、资格、权限
5. 地点、势力、事件与世界状态
   - 重要地点的抵达、封锁、占领、失守、开放
   - 势力关系变化、公共事件、世界局势变化
6. 持续状态与规则
   - 伤势、诅咒、封印、追捕、身份暴露、长期增益/减益
   - 禁令、仪式条件、通行规则、任务限制
   - 这些状态或规则的解除、失效、结束，也属于可提取事实

【不要提取】
1. 日常寒暄、无意义闲聊、纯氛围描写。
2. 没有后续价值的动作过程、普通战斗来回、零碎赶路、重复操作。
3. 已消耗且不再重要的普通补给、日常消费、一次性细枝末节。
4. 未被剧情明确证实的猜测、主观推断、心理描写、情绪感受。
5. 只是重复提及旧事实、但状态没有变化的信息。
6. 同一事件的多个碎片描述；应合并成一条更完整的事实。

【提取策略】
1. 普通一段剧情通常提取 0-6 条；只有关键信息密集时才适当增加。
2. 同一事件如果已经能用一句话表达清楚，不要拆成多条。
3. 若一个旧事实在本段剧情中发生了状态变化，应输出更新后的新事实，而不是重复旧事实。
4. 优先写"主体 + 行为或变化 + 对象 + 结果"；若文本中有明确时间、地点、条件，也应保留。
5. 禁止使用"他/她/它/对方/某人"等模糊代词，必须写出明确的人名、地点名、组织名、物品名。
6. keywords、entities 与各实体槽位尽量使用稳定、可检索的正式称呼，不要随意换别名。

【字段要求】
建议每个元素尽量包含以下字段；没有把握或确实没有内容的字段可以省略：
- "fact": "一句话客观描述"
- "keywords": ["关键词1", "关键词2", "关键词3"]
- "entities": ["实体1", "实体2"]
- "primaryType": "task | character | relationship | location | faction | event | clue | item | ability | status | rule | world"
- "secondaryTypes": ["可选次分类1", "可选次分类2"]
- "characters": ["角色1", "角色2"]
- "locations": ["地点1", "地点2"]
- "factions": ["势力1", "势力2"]
- "items": ["物品1", "物品2"]
- "abilities": ["能力1", "能力2"]
- "events": ["事件1", "事件2"]
- "rules": ["规则1", "规则2"]
- "timeMarkers": ["时间标记1", "时间标记2"]
- "importance": 1-5 的整数，5 表示极重要
- "timeScope": "short | mid | long"
- "state": "active | resolved | expired | unknown"

【推荐输出示例】
推荐直接输出 JSON 数组，例如：
[
  {
    "fact": "白狼团要求{{玩家名字}}在三日内携带黑铁徽章前往北门营地报到。",
    "keywords": ["白狼团", "黑铁徽章", "北门营地"],
    "entities": ["白狼团", "黑铁徽章", "北门营地"],
    "primaryType": "task",
    "secondaryTypes": ["faction", "item", "location"],
    "characters": ["{{玩家名字}}"],
    "locations": ["北门营地"],
    "factions": ["白狼团"],
    "items": ["黑铁徽章"],
    "rules": ["三日内报到"],
    "timeMarkers": ["三日内"],
    "importance": 4,
    "timeScope": "mid",
    "state": "active"
  }
]

也兼容以下形式：
1. 代码块包裹的 JSON
2. 顶层对象中包含 facts / data / result 数组
3. 省略没有内容的空字段

【空结果示例】
[]

【输出要求】
1. 推荐优先输出结构清晰的 JSON 数组，方便系统稳定解析。
2. 如果没有提取到有长期价值的信息，直接输出 []。
3. 允许使用代码块或顶层对象包裹，但内容本体必须仍然是合法 JSON。
4. 如果某些字段没有内容，可以省略，不必强行输出所有空字段。
5. 输出前自检：
   - 是否存在模糊代词
   - 是否把同一事件拆成了多条
   - 是否只是复述最近对白而没有长期价值
   - primaryType 是否只填了一个，并且属于 12 类之一
   - secondaryTypes 是否重复、是否包含 primaryType、是否出现了枚举外分类
   - timeMarkers 是否只写了真实存在或可直接确定的时间信息
   - 实体槽位是否与事实内容对应
   - 字段类型和值是否尽量保持稳定`;
}

// ─── 叙事写入提示词 ───

export function getDefaultNarrativeIngestPrompt(): string {
  return `你是编译式叙事记忆系统的写入器。你的唯一职责：读取最新剧情批次，按 CoT 思维链逐步分析，输出结构化叙事记忆 JSON。

【当前上下文】
- 当前主角：{{玩家名字}}

【只读参考锚点】
{{叙事写入参考}}

【剧情文本】
{{剧情原文}}

═══════════════════════════════════
【CoT 思维链 —— 在给出 JSON 之前，先在心中按以下顺序完整思考】
═══════════════════════════════════

第1步：通读剧情，列出本批所有事实片段
- 谁出现了？说了什么？做了什么？去了哪里？发生了什么变化？
- 有没有明确的时间推进或地点转移？
- 不要脑补剧情中没有写到的内容。

第2步：扫描只读参考锚点，对比变化
- 场景：地点是否变了？时间是否变了？在场实体是否变了？没变就留空。
- 线程：有没有旧任务被推进、完成、失败？有没有新任务出现？
- 关系网：有没有两个人物之间的关系发生了变化、被确认、被强化、被削弱、被破裂？
- 状态槽：有没有伤势、BUFF、伪装、封锁等临时持续状态出现、变化或消失？
- 关系边：有没有人物-势力、人物-地点、势力-势力之间的关系发生变化？

第3步：逐字段填写，宁缺毋滥
- 每个字段都问自己"本批剧情有没有明确写到这个变化？"
- 没有明确证据 → 留空或不写该条目。
- 有明确证据 → 填写，但不扩写、不总结升华、不加括号解释。

═══════════════════════════════════
【字段写入规范】
═══════════════════════════════════

■ scenePatch（场景锚点变化）
  - timeLabel / locationLabel / presentEntities / immediateGoal / immediateRisk / conversationFocus / recentChange / confidence
  - 始终显式输出这四个字段：immediateGoal / immediateRisk / conversationFocus / recentChange

■ threadUpserts（活跃线程更新）
  - id、title、summary、goal、status(open/blocked/suspended/resolved/failed/superseded)、priority(1-5)、blockingReason、relatedEntities、relatedLocations、deadline

■ stateSlotUpserts（状态槽更新）
  - id、scopeType(player/npc/location/world)、scopeId、slotType、value、status(active/resolved/expired)、priority(1-5)、summary

■ relationUpserts（关系边更新 - 非人物对人物）
  - id、sourceEntityId、targetEntityId、relationType、stance、strength(0-1)、status(active/broken/changed)、summary

■ relationNetworkUpserts（人物关系网更新 - 人物对人物）
  - id、sourceEntityId、targetEntityId、relationType、summary、strength(0-1)、status、confidence(0-1)

■ eventCandidates（关键历史事件卡）
  - id、title、summary、excerpt、importance(1-5)、status(hot/warm/cold)、entityRefs、locationRefs、threadRefs、timeLabels

■ entityPatches（实体档案补丁）
  - id、name、entityType(character/location/faction/item/ability)、aliases、currentStatus、stableFacts、currentStance、affiliations

■ archiveHints（归档提示）

■ dropReasons（丢弃原因）

【输出要求】
只返回合法 JSON 对象，不要输出思维链过程，不要输出任何额外说明。

{
  "scenePatch": { "timeLabel": "", "locationLabel": "", "presentEntities": [], "immediateGoal": "", "immediateRisk": "", "conversationFocus": "", "recentChange": "", "confidence": 0.0 },
  "threadUpserts": [],
  "stateSlotUpserts": [],
  "relationUpserts": [],
  "relationNetworkUpserts": [],
  "eventCandidates": [],
  "entityPatches": [],
  "archiveHints": [],
  "dropReasons": []
}`;
}

// ─── 查询改写提示词 ───

export function getDefaultNarrativeQueryRewritePrompt(): string {
  return `你是编译式叙事记忆系统的查询改写器，负责把当前输入改写成适合检索叙事记忆的查询包。

【当前上下文】
- 当前主角：{{玩家名字}}

【输入信息】
- 当前输入：{{inputText}}
- 最近上下文：{{recentContext}}
- 已识别实体：{{entityTerms}}
- 已识别时间：{{timeTerms}}

【改写原则】
1. 语义查询应关注"{{玩家名字}}当前需要什么信息"，而不只是复述输入。
2. 如果输入涉及特定角色、地点、势力或物品，应将其提取为实体焦点。
3. 如果输入暗含时间线索（如"之前""上次""刚才"），应将其提取为时间焦点。
4. intent 应尽量精确，不要滥用 mixed 和 unknown。
5. 保持查询简洁，避免冗余修饰。

【输出要求】
只返回合法 JSON：
{
  "intent": "scene | thread | status | relation | event | entity | archive | mixed | unknown",
  "semanticQuery": "适合语义检索的查询文本",
  "entityTerms": [],
  "timeTerms": [],
  "locationTerms": [],
  "threadHints": [],
  "stateHints": [],
  "needRecentConversation": true,
  "needHistoricalCause": false,
  "needRelationshipFocus": false
}`;
}

// ─── 摘要保存提示词 ───

export function getDefaultNarrativeSummaryPrompt(): string {
  return `你是编译式叙事记忆系统的分层剧情摘要保存器，负责在主写入完成后，根据当前剧情批次总结这一层真正新增、推进、揭露或确认的剧情信息。

【当前上下文】
- 当前主角：{{玩家名字}}

【输入信息】
- 当前剧情批次：{{batchText}}

【整理目标】
请为当前剧情批次产出"新增且可复用的稳定记忆"。

【CoT 思考流程】
1. 先按时间变化、地点变化、出场角色、关键动作、信息揭露、物件变化、状态变化、承诺、限制与未完成事项，逐条扫描。
2. 判断应落入 otherCharacterMemories / playerMemories / itemMemories 哪一类。
3. 对 playerMemories，必须把本层所有关键推进合并为 1 条本层总摘要。
4. 只允许记录文本里明确发生的事实；严禁进行阅读理解式的总结升华。
5. 严禁使用括号解释。
6. 每条 summary 都必须显式写出故事发生时间。
7. title 采用"稳定命名 + 一眼可检索"的格式。
8. 严格控制条数：otherCharacterMemories 最多 4 条，playerMemories 最多 1 条，itemMemories 最多 3 条。超出时合并同类条目，优先保留最重要的。

【三分类说明】
- otherCharacterMemories：重要角色在本层的行为、态度变化、立场变化（最多 4 条）
- playerMemories：本层剧情的总摘要（最多 1 条）
- itemMemories：重要物品、道具、资源的来源、获得方式、状态变化（最多 3 条）

【输出要求】
只返回合法 JSON 对象：
{
  "otherCharacterMemories": [{ "id": "可选", "title": "稳定标题", "summary": "时间；摘要", "keywords": [] }],
  "playerMemories": [{ "id": "可选", "title": "稳定标题", "summary": "时间；摘要", "keywords": [] }],
  "itemMemories": [{ "id": "可选", "title": "稳定标题", "summary": "时间；摘要", "keywords": [] }]
}`;
}

// ─── 检索规划提示词 ───

export function getDefaultNarrativeRetrievePlannerPrompt(): string {
  return `你是编译式叙事记忆系统的发送前上下文记忆协同整理器，负责结合最近原始剧情、热编译结果和联合候选记忆，补齐最近原始剧情窗口之前仍然必须知道的记忆。

【当前上下文】
- 当前主角：{{玩家名字}}

【输入信息】
- 当前输入：{{inputText}}
- 最近原始剧情：{{recentContext}}
- 热编译摘要：{{compiledNarrativeContext}}
- 热层结构摘要：{{compiledNarrativeSections}}
- 语义分析结果：{{semanticAnalysis}}
- 摘要历史概览：{{summaryHistory}}
- 联合候选记忆：{{memoryCandidates}}

【CoT 思考流程】
1. 从全部输入中识别核心实体：角色、事件、任务、地点、组织、物品、规则、关系。
2. 对每个角色补齐完整记忆链：历史行为、立场变化、关系变化、承诺、秘密。
3. 对每个事件补齐完整记忆链：起因、参与者、推进节点、结果、遗留问题。
4. 只补齐热编译尚未覆盖的关键记忆。
5. items 只选择需要召回的候选记忆，title 必须严格逐字复制。

【输出要求】
只返回合法 JSON 对象：
{
  "items": [{ "title": "逐字复制候选标题", "reason": "为什么需要" }],
  "retrievalKeywords": ["关键词1", "关键词2"],
  "notes": "可选说明"
}`;
}

// ─── 多轮检索提示词 ───

export function getDefaultMultiRoundRetrievePlannerPrompt(): string {
  return `你是编译式叙事记忆系统的多轮检索整理器（非最后一轮）。判断是否仍有遗漏的关键记忆需要补充。

【当前上下文】
- 当前主角：{{玩家名字}}
- 当前轮次：第 {{currentRound}} 轮（共最多 {{maxRounds}} 轮）

【输入信息】
- 当前输入：{{inputText}}
- 热编译摘要：{{compiledNarrativeContext}}
- 联合候选记忆：{{memoryCandidates}}

【前序检索结果】
{{previousResults}}

【输出要求】
只返回合法 JSON 对象：
{
  "items": [{ "title": "逐字复制候选标题", "reason": "为什么需要" }],
  "retrievalKeywords": ["关键词1"],
  "notes": "可选说明"
}`;
}

export function getDefaultMultiRoundRetrievePlannerFinalPrompt(): string {
  return `你是编译式叙事记忆系统的多轮检索整理器（最后一轮）。基于所有前序检索结果补齐仍然缺失的关键记忆引用。

【当前上下文】
- 当前主角：{{玩家名字}}
- 当前轮次：第 {{currentRound}} 轮（最后一轮）

【前序检索结果（所有轮次累计）】
{{previousResults}}

【联合候选记忆】
{{memoryCandidates}}

【输出要求】
只返回合法 JSON 对象：
{
  "items": [{ "title": "逐字复制候选标题", "reason": "为什么需要" }],
  "retrievalKeywords": ["关键词1"],
  "notes": "可选说明"
}`;
}

// ─── 精排提示词 ───

export function getDefaultNarrativeRerankPrompt(): string {
  return `你是编译式叙事记忆系统的候选精排器，根据当前输入对候选条目重新打分排序。

【当前上下文】
- 当前主角：{{玩家名字}}

【当前输入】
{{query}}

【候选内容】
{{candidates}}

【排序原则】
1. 当前有效状态优先
2. 未解决线程优先
3. 与{{玩家名字}}或当前实体直接相关的条目优先
4. 对下一段生成真正有决策价值的条目优先
5. 已失效、已解决且无直接关联的条目降权

【输出要求】
只返回合法 JSON 对象：
{
  "rankings": [{ "index": 0, "score": 0.98 }],
  "needVectorRecall": true,
  "vectorRecallReason": "简要说明",
  "currentSceneRelationNetwork": []
}`;
}

// ─── 冲突裁决提示词 ───

export function getDefaultNarrativeConflictJudgePrompt(): string {
  return `你是编译式叙事记忆系统的冲突裁决器，判断新候选对象是否会覆盖、失效或替代旧对象。

【当前上下文】
- 当前主角：{{玩家名字}}

【旧对象】
{{currentObject}}

【新对象】
{{incomingObject}}

【裁决原则】
1. 如果新对象明确更新了旧对象的状态，选择 update_current 或 supersede_current
2. 如果描述不同事实，选择 keep_both
3. 如果新对象不可靠或矛盾，选择 reject_incoming
4. 如果旧对象已过时，选择 mark_expired

【输出要求】
只返回合法 JSON：
{
  "action": "keep_both | update_current | supersede_current | mark_expired | reject_incoming",
  "reason": "",
  "confidence": 0.0
}`;
}

// ─── 向量查询改写提示词 ───

export function getDefaultVectorQueryRewritePrompt(): string {
  return `你是编译式叙事记忆系统的语义检索分析器，分析出适合向量召回的语义查询。

【当前上下文】
- 当前主角：{{玩家名字}}

【输入信息】
- 当前输入：{{inputText}}
- 最近原始剧情：{{recentContext}}
- 热编译摘要：{{hotContextSummary}}

【输出要求】
只返回合法 JSON：
{
  "semanticQuery": "适合向量召回的查询文本",
  "retrievalKeywords": ["关键词1"],
  "entityFocus": [],
  "timeFocus": [],
  "locationFocus": [],
  "intent": "task_query | relationship_query | character_query | location_query | item_query | mixed_query | unknown",
  "needHistoricalCause": false,
  "needRelationshipFocus": false
}`;
}

// ─── 向量精排提示词 ───

export function getDefaultVectorRerankPrompt(): string {
  return `你是编译式叙事记忆系统的长程向量候选精排器，根据当前输入对候选向量事实重新打分排序。

【当前上下文】
- 当前主角：{{玩家名字}}

【当前输入】
{{query}}

【候选事实】
{{candidates}}

【评分要求】
1. 只根据"是否能帮助当前生成"评分
2. 与{{玩家名字}}直接相关的有效状态、未解决事项优先
3. 当前有效状态优先于已解决或已失效的事实

【输出要求】
只返回合法 JSON 数组：
[
  { "index": 0, "score": 0.98 },
  { "index": 1, "score": 0.26 }
]`;
}

// ─── 模板工厂 ───

export function createDefaultNarrativePromptTemplates(): NarrativePromptTemplates {
  return {
    ingest: getDefaultNarrativeIngestPrompt(),
    summary: getDefaultNarrativeSummaryPrompt(),
    retrievePlanner: getDefaultNarrativeRetrievePlannerPrompt(),
    multiRoundRetrievePlanner: getDefaultMultiRoundRetrievePlannerPrompt(),
    multiRoundRetrievePlannerFinal: getDefaultMultiRoundRetrievePlannerFinalPrompt(),
    queryRewrite: getDefaultNarrativeQueryRewritePrompt(),
    rerank: getDefaultNarrativeRerankPrompt(),
    conflictJudge: getDefaultNarrativeConflictJudgePrompt(),
    vectorExtract: getDefaultVectorExtractPrompt(),
    vectorQueryRewrite: getDefaultVectorQueryRewritePrompt(),
    vectorRerank: getDefaultVectorRerankPrompt(),
  };
}

const NARRATIVE_PROMPT_TEMPLATE_FORCE_RESET_VERSION = 24;

export function normalizeNarrativePromptTemplates(templates: unknown): NarrativePromptTemplates {
  const defaults = createDefaultNarrativePromptTemplates();
  const safe = (templates && typeof templates === 'object' && !Array.isArray(templates))
    ? templates as Record<string, unknown>
    : {};

  const storedVersion = Math.max(0, Math.floor(Number((safe as Record<string, unknown>)._version) || 0));
  if (storedVersion < NARRATIVE_PROMPT_TEMPLATE_FORCE_RESET_VERSION) {
    return { ...defaults, _version: NARRATIVE_PROMPT_TEMPLATE_FORCE_RESET_VERSION };
  }

  const result: Record<string, string | number> = {};
  for (const [key, defaultValue] of Object.entries(defaults)) {
    const candidate = safe[key];
    const normalizedValue = typeof candidate === 'string' ? candidate : (candidate == null ? '' : String(candidate));
    result[key] = normalizedValue.trim() ? normalizedValue : defaultValue;
  }
  result._version = NARRATIVE_PROMPT_TEMPLATE_FORCE_RESET_VERSION;

  return result as unknown as NarrativePromptTemplates;
}
