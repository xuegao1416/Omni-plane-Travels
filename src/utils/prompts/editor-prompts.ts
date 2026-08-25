/**
 * Prompt 管理系统 - 编辑器 AI 相关
 * 管理角色补全、变量提取等编辑器功能的 prompt
 */

import type { StatModuleSchema, ProgressionModuleSchema, SurvivalModuleSchema, BusinessModuleSchema, DiceModuleSchema, TalentModuleSchema, CombatModuleSchema, ProfessionModuleSchema, WorldSystemData } from '../../modules/schema';
import { extractWorldSystemData } from '../../modules/runtime';
import { getXpForNextTier } from '../../modules/xpAlgorithm';

// 角色补全选项
export interface CharacterFillOptions {
  worldSetting: string;
  playerName: string;
  playerGender: string;
  playerAge: string;
  playerBackground: string;
  /** 世界的数值属性模块配置（用于生成角色初始属性） */
  statModule?: {
    attrA: { name: string; max: number };
    attrB: { name: string; max: number };
    dim1: { name: string; range: [number, number] };
    dim2: { name: string; range: [number, number] };
    dim3: { name: string; range: [number, number] };
    dim4: { name: string; range: [number, number] };
    dim5: { name: string; range: [number, number] };
    dim6: { name: string; range: [number, number] };
    special?: Array<{ id: string; name: string; range: [number, number]; description: string }>;
  };
  /** 职业包启用时，职业与先天天赋由下一步专门选择，AI 补全不得抢先生成。 */
  hasProfessionSystem?: boolean;
}

/**
 * 构建角色 AI 补全的 System Prompt（只补全玩家信息，不含NPC）
 */
export function buildCharacterFillPrompt(options: CharacterFillOptions): string {
  const { worldSetting, playerName, playerGender, playerAge, playerBackground, statModule, hasProfessionSystem } = options;

  return `你是一个专业的角色设定生成器，擅长根据基础信息创建完整的角色设定。
你的任务是分析玩家提供的基础信息，结合世界设定，生成丰富的角色设定。

═══════════════════════════════════════
【核心原则】
1. 保持玩家已填信息不变，只补全未填内容
2. 所有生成内容必须与世界设定一致
3. 生成内容要合理、有逻辑、符合角色背景
4. 不要生成过于夸张或不合理的设定

【世界设定】
${worldSetting}

【玩家已填信息】
- 姓名：${playerName}
- 性别：${playerGender || '未设定'}
- 年龄：${playerAge || '未设定'}
- 背景描述：${playerBackground || '无'}

【生成规则】

1. 年龄（age）
   - 如玩家已填则沿用，否则根据世界设定推断一个合理年龄
   - 年龄要符合角色的职业和背景

2. 背景描述（background）
   - 丰富或扩写玩家的描述，2-3句话
   - 包含关键信息：出身、经历、动机
   - 保持与玩家已填信息的一致性

3. 职业（career）
${hasProfessionSystem ? '   - 当前世界启用了独立职业典藏；职业将在下一步由玩家选择，此处必须返回空字符串，不得猜测职业' : `   - 根据世界设定推断，选择最匹配的职业
   - 要与年龄、背景、技能相呼应`}

4. 性格（personality）
   - 根据角色的年龄、背景、职业推断合理性格
   - 2-4个关键词，如：温柔善良、沉默寡言、外冷内热

8. 外貌（appearance）
   - 根据角色的性别、年龄、种族推断合理外貌
   - 包含发型、体型、标志性特征等，不少于20字

9. 技能（skills）
${hasProfessionSystem ? '   - 当前世界启用了独立职业典藏；初始职业能力由职业树负责，此处必须返回空数组，禁止重复生成技能' : `   - 生成 1~3 个与世界设定匹配的技能
   - 技能要与职业、背景相关
   - 品质分级：普通/精良/稀有/史诗/传说`}

10. 物品（items）
   - 生成 1~3 个合理的初始物品
   - 物品要与职业、背景、技能相关
   - 品质分级：普通/精良/稀有/史诗/传说
${statModule ? `
11. 初始属性（initialStats）
   - 根据角色的职业、背景、年龄，为每个属性分配合理的初始值
   - 初始值应在属性范围内，体现角色的特点
   - 例如：战士力量高但魔力低，法师魔力高但体质低
   - 生命/能量初始值取上限的 60%~90%（根据角色体质调整）
   - 特色属性如有，也需要设定初始值

   【当前世界的属性系统】
   - ${statModule.attrA.name}（生命类）：上限 ${statModule.attrA.max}
   - ${statModule.attrB.name}（能量类）：上限 ${statModule.attrB.max}
   - ${statModule.dim1.name}：范围 [${statModule.dim1.range[0]}, ${statModule.dim1.range[1]}]
   - ${statModule.dim2.name}：范围 [${statModule.dim2.range[0]}, ${statModule.dim2.range[1]}]
   - ${statModule.dim3.name}：范围 [${statModule.dim3.range[0]}, ${statModule.dim3.range[1]}]
   - ${statModule.dim4.name}：范围 [${statModule.dim4.range[0]}, ${statModule.dim4.range[1]}]
   - ${statModule.dim5.name}：范围 [${statModule.dim5.range[0]}, ${statModule.dim5.range[1]}]
   - ${statModule.dim6.name}：范围 [${statModule.dim6.range[0]}, ${statModule.dim6.range[1]}]
${statModule.special?.map(s => `   - ${s.name}（${s.description}）：范围 [${s.range[0]}, ${s.range[1]}]`).join('\n') || ''}
` : ''}
═══════════════════════════════════════
【输出要求】
只输出一个合法JSON对象，不要markdown，不要代码块，不要额外解释。
JSON字段必须完全如下：

{
  "age": "年龄（字符串）",
  "personality": "性格（2-4个关键词，如：温柔善良、沉默寡言）",
  "appearance": "外貌（包含发型、体型、标志性特征等，不少于20字）",
  "background": "背景描述（2-3句话，包含出身、经历、动机）",
  "career": "职业",
  "skills": [
    {
      "name": "技能名",
      "quality": "普通/精良/稀有/史诗/传说",
      "desc": "技能描述",
      "type": "技能类型"
    }
  ],
  "items": [
    {
      "name": "物品名",
      "quantity": 1,
      "quality": "普通/精良/稀有/史诗/传说",
      "type": "物品类型",
      "note": "备注"
    }
  ]${statModule ? `,
  "initialStats": {
    "attrA": <生命类初始值，取上限的60%~90%>,
    "attrB": <能量类初始值，取上限的50%~80%>,
    "dim1": <${statModule.dim1.name}初始值，在范围内根据角色特点设定>,
    "dim2": <${statModule.dim2.name}初始值>,
    "dim3": <${statModule.dim3.name}初始值>,
    "dim4": <${statModule.dim4.name}初始值>,
    "dim5": <${statModule.dim5.name}初始值>,
    "dim6": <${statModule.dim6.name}初始值>${statModule.special?.length ? `,
    "special": [
      { "id": "${statModule.special[0]?.id}", "value": <初始值> }
    ]` : ''}
  }` : ''}
}`;
}

/**
 * 构建 NPC 创建的 System Prompt
 */
export function buildNpcCreatePrompt(options: {
  worldSetting: string;
  playerName: string;
  playerGender: string;
  playerAge: string;
  playerBackground: string;
  statModule?: CharacterFillOptions['statModule'];
  hasProgression?: boolean;
}): string {
  const { worldSetting, playerName, playerGender, playerAge, playerBackground, statModule, hasProgression } = options;

  return `你是一个专业的NPC角色生成器，擅长根据玩家信息和世界设定创建有趣的NPC。

═══════════════════════════════════════
【世界设定】
${worldSetting}

【玩家信息】
- 姓名：${playerName}
- 性别：${playerGender || '未设定'}
- 年龄：${playerAge || '未设定'}
- 背景：${playerBackground || '无'}

【NPC生成要求】
- 生成 1 个与玩家有关联的NPC
- 关系要合理，如：师徒、朋友、亲人、同事、宿敌、青梅竹马等
- 性格要有层次：personality（外在表现）和 hiddenPersonality（内心深处）可以不同
- 外貌描写要具体：包含发型、体型、标志性特征等，不少于20字
- 技能列表生成 1~3 个技能，物品列表生成 1~2 个物品
- 所有字段都必须填写，不可留空

═══════════════════════════════════════
【输出要求】
只输出一个合法JSON对象，不要markdown，不要代码块，不要额外解释。

{
  "name": "NPC姓名",
  "gender": "性别",
  "age": "年龄",
  "race": "种族",
  "relationship": "与角色的关系类型（如：师徒、青梅竹马、宿敌）",
  "occupation": "职业",
  "socialStatus": "社会地位（如：贵族、平民、边缘人）",
  "personality": "外在表性格（2-4个关键词）",
  "hiddenPersonality": "内在里性格（与表性格可能不同）",
  "currentThought": "NPC当前的想法",
  "appearance": "外貌特征（具体描写，不少于20字）",
  "currentOutfit": "当前穿着描述",
  "currentAction": "NPC当前正在做的事",
  "currentLocation": "NPC当前位置",
  "currentState": "当前动作/表情/情绪",
  "shortTermGoal": "近期目标",
  "longTermGoal": "长期人生追求",
  "background": "NPC背景故事（2-3句话）",
  "skillsList": {"技能名": {"描述": "技能描述", "类型": "战斗/生活/社交/特殊", "品质": "普通/精良/稀有/史诗/传说"}},
  "itemsList": {"物品名": {"数量": 1, "类型": "物品类型", "品质": "普通/精良/稀有/史诗/传说", "备注": "备注"}}
  ${statModule ? `,
  "survivalStats": {
    "血量": <生命类初始值，取上限的60%~90%>,
    "体力值": <能量类初始值，取上限的50%~80%>,
    "dim1": <${statModule.dim1.name}初始值，在范围内根据角色特点设定>,
    "dim2": <${statModule.dim2.name}初始值>,
    "dim3": <${statModule.dim3.name}初始值>,
    "dim4": <${statModule.dim4.name}初始值>,
    "dim5": <${statModule.dim5.name}初始值>,
    "dim6": <${statModule.dim6.name}初始值>
  }` : ''}
  ${hasProgression ? `,
  "tierIndex": <NPC的段位/等级索引，根据实力设定，0=最低段位/等级>` : ''}
}`;
}

/**
 * 构建 NPC 补全的 System Prompt（已知部分信息，补全其余）
 */
export function buildNpcFillPrompt(options: {
  worldSetting: string;
  playerName: string;
  playerGender: string;
  playerAge: string;
  playerBackground: string;
  npc: {
    name: string;
    gender: string;
    age: string;
    race: string;
    relationshipType: string;
    occupation: string;
    socialStatus: string;
    personality: string;
    hiddenPersonality: string;
    appearance: string;
    currentOutfit: string;
    currentThought: string;
    currentAction: string;
    currentLocation: string;
    currentState: string;
    shortTermGoal: string;
    longTermGoal: string;
    background: string;
  };
  statModule?: CharacterFillOptions['statModule'];
  hasProgression?: boolean;
}): string {
  const { worldSetting, playerName, playerGender, playerAge, playerBackground, npc, hasProgression } = options;

  // 构建NPC已填信息列表
  const npcInfo: string[] = [];
  if (npc.name) npcInfo.push(`- 姓名：${npc.name}`);
  if (npc.gender) npcInfo.push(`- 性别：${npc.gender}`);
  if (npc.age) npcInfo.push(`- 年龄：${npc.age}`);
  if (npc.race) npcInfo.push(`- 种族：${npc.race}`);
  if (npc.relationshipType) npcInfo.push(`- 与玩家关系：${npc.relationshipType}`);
  if (npc.occupation) npcInfo.push(`- 职业：${npc.occupation}`);
  if (npc.socialStatus) npcInfo.push(`- 社会地位：${npc.socialStatus}`);
  if (npc.personality) npcInfo.push(`- 表性格：${npc.personality}`);
  if (npc.hiddenPersonality) npcInfo.push(`- 里性格：${npc.hiddenPersonality}`);
  if (npc.appearance) npcInfo.push(`- 外貌：${npc.appearance}`);
  if (npc.currentOutfit) npcInfo.push(`- 穿着：${npc.currentOutfit}`);
  if (npc.currentThought) npcInfo.push(`- 当前想法：${npc.currentThought}`);
  if (npc.currentAction) npcInfo.push(`- 当前行动：${npc.currentAction}`);
  if (npc.currentLocation) npcInfo.push(`- 当前位置：${npc.currentLocation}`);
  if (npc.currentState) npcInfo.push(`- 当前状态：${npc.currentState}`);
  if (npc.shortTermGoal) npcInfo.push(`- 短期目标：${npc.shortTermGoal}`);
  if (npc.longTermGoal) npcInfo.push(`- 长期目标：${npc.longTermGoal}`);
  if (npc.background) npcInfo.push(`- 背景：${npc.background}`);

  return `你是一个专业的NPC角色设定补全器，擅长根据已知信息补全NPC的完整设定。

═══════════════════════════════════════
【核心原则】
1. ★ 保持已填信息不变 ★，只补全空缺内容
2. 所有生成内容必须与世界设定一致
3. NPC设定要与玩家角色有关联，关系合理

【世界设定】
${worldSetting}

【玩家信息】
- 姓名：${playerName}
- 性别：${playerGender || '未设定'}
- 年龄：${playerAge || '未设定'}
- 背景：${playerBackground || '无'}

【NPC已知信息】（★ 已填字段必须原样保留 ★）
${npcInfo.length > 0 ? npcInfo.join('\n') : '- （暂无）'}

【补全要求】
- 已填字段必须原样输出，不得修改
- 只补全空缺字段
- 性格要有层次：personality（外在）和 hiddenPersonality（内在）可以不同
- 外貌描写要具体，不少于20字
- 技能列表 1~3 个，物品列表 1~2 个

═══════════════════════════════════════
【输出要求】
只输出一个合法JSON对象，不要markdown，不要代码块。
所有字段都必须输出（包括已填的，原样保留）。

{
  "gender": "性别",
  "age": "年龄",
  "race": "种族",
  "relationship": "与角色的关系",
  "occupation": "职业",
  "socialStatus": "社会地位",
  "personality": "外在表性格（2-4个关键词）",
  "hiddenPersonality": "内在里性格",
  "currentThought": "NPC当前的想法",
  "appearance": "外貌特征（不少于20字）",
  "currentOutfit": "当前穿着描述",
  "currentAction": "NPC当前正在做的事",
  "currentLocation": "NPC当前位置",
  "currentState": "当前动作/表情/情绪",
  "shortTermGoal": "近期目标",
  "longTermGoal": "长期人生追求",
  "background": "NPC背景故事（2-3句话）",
  "skillsList": {"技能名": {"描述": "技能描述", "类型": "战斗/生活/社交/特殊", "品质": "普通/精良/稀有/史诗/传说"}},
  "itemsList": {"物品名": {"数量": 1, "类型": "物品类型", "品质": "普通/精良/稀有/史诗/传说", "备注": "备注"}}
  ${hasProgression ? `,
  "tierIndex": <NPC的段位/等级索引，根据实力设定，0=最低段位/等级>` : ''}
}`;
}

/** 根据当前世界系统数据，生成具体的模块更新规则 */
function generateModuleUpdateRules(worldSystem?: Record<string, unknown>, progressionConfig?: Record<string, unknown>): string {
  if (!worldSystem && !progressionConfig) return '';

  const data = worldSystem ? extractWorldSystemData(worldSystem) : ({} as WorldSystemData);
  const rules: string[] = [];

  // ── 数值属性 → 玩家.生存状态 ──
  if (data.数值属性) {
    const s = data.数值属性 as StatModuleSchema;
    const dims = [s.dim1, s.dim2, s.dim3, s.dim4, s.dim5, s.dim6].filter(Boolean);
    const dimKeys = ['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'];
    rules.push(`   【数值属性更新规则】
   - 生命类（${s.attrA.name}）：使用 {"set":{"path":"玩家.生存状态.血量","value":新值}}
   - 能量类（${s.attrB.name}）：使用 {"set":{"path":"玩家.生存状态.体力值","value":新值}}
   - 六维属性：${dims.map((d, i) => `${d!.name}(${dimKeys[i]})`).join('、')}
     示例：使用 {"set":{"path":"玩家.生存状态.dim1","value":新值}}
   - 属性值不能超过range[1]，不能低于range[0]
   ${s.special.length > 0 ? `  - 特色属性：${s.special.map(sp => `${sp.name}(${sp.id})`).join('、')}
     示例：使用 {"set":{"path":"玩家.生存状态.${s.special[0]?.id}","value":新值}}` : ''}`);
  }

  // ── 成长体系 → 玩家 ──
  if (progressionConfig) {
    const p = progressionConfig as any;

    if (p.mode === 'level' && p.levelData) {
      const maxLevel = p.levelData.maxLevel;
      rules.push(`   【成长体系更新规则】
   - 模式：等级制（0~${maxLevel}级）
   - 战斗、训练、探索产生的经验由本地机械系统自动结算，禁止更新当前经验值或当前段位索引
   - 只有任务奖励、事件奖励等正文明确给出具体经验数值的来源，才可更新：使用 {"add":{"path":"玩家.当前经验值","delta":经验变化,"min":0}}
   - 当前经验值不能为负，当前段位索引不能超过${maxLevel}`);
    } else if (p.tiers?.length) {
      const tierList = p.tiers.map((t: any, i: number) => `${i + 1}.${t.name}`).join('、');
      rules.push(`   【成长体系更新规则】
   - 模式：段位制
   - 阶段列表：${tierList}
   - 战斗、训练、探索产生的经验由本地机械系统自动结算，禁止更新当前经验值或当前段位索引
   - 只有任务奖励、事件奖励等正文明确给出具体经验数值的来源，才可更新：使用 {"add":{"path":"玩家.当前经验值","delta":经验变化,"min":0}}
   - 当前经验值不能为负，当前段位索引不能超过${p.tiers.length - 1}`);
    }
  }

  // ── 生存资源 → 玩家.生存资源 ──
  if (data.生存资源) {
    const s = data.生存资源 as SurvivalModuleSchema;
    const resList = Array.isArray(s.resources) ? s.resources.map(r =>
      `${r.name}(${r.id})`
    ).join('、') : '';
    rules.push(`   【生存资源更新规则】
   - 当前资源：${resList}
   - 数量变化：使用 {"set":{"path":"玩家.生存资源.资源id.数量","value":新数量}}
   - 数量不能为负数`);
  }

  // ── 经营资产 → 玩家.经营资产 ──
  if (data.经营资产) {
    const biz = data.经营资产 as BusinessModuleSchema;
    const assetList = Array.isArray(biz.assets) ? biz.assets.map(a =>
      `${a.name}(${a.id})`
    ).join('、') : '';
    rules.push(`   【经营资产更新规则】
   - 经营数据通过 UpdateVariable 更新到 玩家.经营资产
   - 当前资产：${assetList || '无'}
   - 资金变化：使用 add effect 写入 玩家.经营资产.资金，并在同一 transaction 的 costs 中声明扣款
   - 收购新资产（同时扣除资金）：使用 append effect 写入 玩家.经营资产.资产列表；资产字段全部必填：id、名称、类型、等级、最高等级、描述、状态、基础收益、每级收益、维护费
     ★ 收购新资产时，以下字段全部必填，不可省略：id、名称、类型、等级、最高等级、描述、状态、基础收益、每级收益、维护费
   - 升级资产（扣除升级费用，提升等级）：使用 set effect 写入对应资产路径，并在同一 transaction 的 costs 中声明升级费用
   - 出售资产（从列表移除，增加资金）：使用 remove effect 删除对应资产路径
   - 资产状态变化：受损时状态改为 "damaged"（收入减半），被毁时改为 "destroyed"（收入归零）
   - 经营日志：重大事件添加到交易日志数组
   - 资金不能为负数
   - 只输出发生变化的字段`);
  }

  // ── 骰子检定（本地自动处理） ──
  if (data.骰子检定) {
    rules.push(`   【骰子检定更新规则】
   - 骰子检定由叙事标记触发，本地系统自动选择已指定的真实属性并立即结算
   - 玩家不能自行选择属性、DC、优势或劣势；AI 也不得伪造检定结果`);
  }

  // ── 新职业体系：职业树是本地权威状态，AI 只可记录剧情所得自由技能/后天天赋 ──
  if (data.职业体系) {
    const profession = data.职业体系 as ProfessionModuleSchema;
    const professionNames = (profession.professions ?? []).map(item => item.name).join('、');
    rules.push(`   【职业体系更新规则】
   - 当前职业包：${professionNames || '未挂载可用职业'}
   - 严禁写入或改动 玩家.能力系统.职业状态、玩家.能力系统.先天天赋：职业选择、职业等级、能力点、节点解锁、冷却和使用次数全部由本地职业系统结算
   - 严禁因正文提到一个能力，就把未解锁职业节点写成已掌握；职业能力的伤害、治疗、命中、护甲、先手与检定修正也不得由 AI 重算
   - 剧情明确学会的非职业生活技艺/通用技能，写入 玩家.技能系统.技能名，value 必须包含 品质、描述、类型；它与职业能力点无关
   - 剧情明确发生新的天赋觉醒时，只可写入 玩家.能力系统.后天天赋.稳定ID，value 必须包含 觉醒轮次、名称、描述；不得冒充创建时的先天天赋`);
  }

  // ── 战斗系统 → 本地机械结算 ──
  if (data.战斗系统) {
    const combat = data.战斗系统 as CombatModuleSchema;
    const encounters = combat.encounters.map(encounter => `${encounter.name}(${encounter.id})`).join('、');
    rules.push(`   【战斗系统更新规则】
   - 战斗由前端战斗卡片按回合、命中、伤害、状态和胜负结算，AI不得直接伪造 combat.active、生命、伤害或奖励。
   - 当前可用遭遇：${encounters || '无'}
   - 没有 active 战斗时，不要自行写入战斗状态；需要战斗结果时只描述叙事，机械状态由前端事件写入。`);
  }

  return rules.join('\n\n');
}

/**
 * 构建变量提取的 System Prompt
 * @param worldSystem 当前世界系统运行时数据（用于生成具体的模块更新规则）
 * @param progressionConfig 成长体系配置（从世界定义读取，不存入 GameState）
 */
export function buildVariableExtractionPrompt(worldSystem?: Record<string, unknown>, progressionConfig?: Record<string, unknown>): string {
  // 提取模块数据，判断是否有数值属性模块
  const moduleData = worldSystem ? extractWorldSystemData(worldSystem) : {};
  const hasStatModule = !!moduleData.数值属性;
  const statModule = hasStatModule ? moduleData.数值属性 as any : undefined;
  const hasBusinessModule = !!moduleData.经营资产;
  const hasProgression = !!(
    progressionConfig && (
      (Array.isArray((progressionConfig as any).tiers) && (progressionConfig as any).tiers.length > 0) ||
      (progressionConfig as any).levelData
    )
  );

  return `你是一个后台变量裁定系统，负责分析玩家消息和AI回复，提取需要更新的变量。
你的任务是识别剧情中的关键变化，更新游戏状态，但不续写剧情。

═══════════════════════════════════════
【核心原则】
1. 只做变量更新，不续写剧情，不做价值评判
2. 仅依据已发生事实更新，禁止凭空脑补关键结果
3. ★ 人物档案每轮必须更新 ★：只要场景中有NPC，就必须更新其当前想法、当前状态、当前行动等字段。这不是可选的。
4. 保持变量的逻辑性和合理性
5. 笔记本根据叙事信息更新（不依赖机械变量变动，见下方笔记本规则）
6. ★ 没发生的事不更新 ★：正文里没有发生影响某变量的事件，该变量就保持原样，不要"觉得应该变一变"

【输出格式】
用 <UpdateVariable></UpdateVariable> 标签包裹JSON输出。
输出必须是唯一的 GameplayTransaction 对象；只写需要更新的效果，未变化的字段不要输出。

【唯一允许的顶层结构】
{"id":"本轮唯一标识","source":"ai","label":"变量裁定","effects":[
  {"set":{"path":"玩家.当前目标","value":"新值"}},
  {"add":{"path":"玩家.当前经验值","delta":10,"min":0}},
  {"append":{"path":"玩家.纪事系统.纪事.线索.详情","value":"新信息"}},
  {"remove":{"path":"玩家.任务系统.活跃任务.已完成任务"}},
  {"emit":{"type":"narrative.state.changed","payload":{"reason":"剧情事实"}}}
]}
- 所有写入都必须放在 effects（或 rewards[].effects）中，路径使用点号路径。
- 允许使用 conditions、costs、rewards、events；它们也必须遵守 GameplayTransaction 结构。
- 好感度优先使用 add；单次变化必须控制在 -15 到 +15，系统还会进行最终钳制。
- 人物事迹追加使用 append，系统会自动去重；不要输出 chronicleOperations。
- 下面的旧对象示例仅用于说明字段语义，绝对不能照抄为输出格式；禁止输出 RFC 6902 数组或“设置/世界/玩家/人物档案”顶层对象。

═══════════════════════════════════════
【人物档案规则】（★ 每轮必须更新，不可跳过 ★）

★ 重要：无论本轮是否有"重大事件"，只要场景中有NPC出现，就必须输出人物档案更新。
★ 不输出人物档案 = 严重错误。即使只是NPC说了几句话，也必须更新其当前想法、当前状态。

1. 出现新角色 → 必须创建完整NPC条目
2. 场景中有NPC → 必须更新该NPC的以下字段：
   - 人物分类（在场/离场）
   - 个人信息.当前想法（★ 必须用该角色自己的第一人称口吻，用该角色对主角的称呼，不少于15字。不同角色的口吻、用词、称呼必须不同，禁止混用 ★）
   - 个人信息.当前状态（最新的动作/表情/情绪）
   - 个人信息.当前位置（有变化时更新）
   - 当前行动（角色正在做的事）
   - 关系数据.好感度（★ 仅当正文发生了明确影响关系的事件时才更新 ★：如一起冒险、吵架、送礼、救助、背叛等。日常对话、闲聊、无实质性互动时不要更新好感度。没发生关系事件 = 不输出此字段）
   - 人物事迹（★ 每轮必须追加1条，见下方事迹规则）
3. NPC离开场景 → 将人物分类设为"离场"
4. 用角色姓名作key即可，系统自动匹配

【创建新NPC - 必须包含以下全部字段】
创建时使用 set effect，路径为 人物档案.角色名，value 为完整 NPC 对象。value 必须包含姓名、种族、性别、年龄、人物分类、社会身份、关系数据、个人信息、人物事迹、当前行动、短期目标和长期目标；启用数值/成长模块时再填入对应模块字段。

【更新已有NPC - ★ 每轮必须输出，不可省略 ★】
场景中出现的每个NPC都必须更新，即使只是旁观或沉默。
★ 当前想法必须是该角色独有的视角和口吻，禁止写成通用旁白。
★ 好感度仅在发生关系事件时才输出，没发生就不写。

示例（无关系事件时，不输出好感度）：
更新已有 NPC 使用 set effect，路径为 人物档案.角色名.字段路径；例如人物分类写入 人物档案.角色名.人物分类，当前状态写入 人物档案.角色名.个人信息.当前状态。好感度只在关系事件发生时使用 add effect。

【离场规则】
1. NPC未在当前场景出现 → 人物分类设为"离场"，仅更新此字段
2. NPC重新出现 → 人物分类设回"在场"，并更新上述全部字段

【人物事迹规则】
人物事迹是NPC的关键事件记录。系统会在快照中展示每个NPC的当前事迹列表（带编号 [0][1][2]...）。
你有两种更新方式：

方式1 - 追加（简单场景，NPC有新事件发生）：
使用 {"append":{"path":"人物档案.角色名.人物事迹","value":"新事件摘要"}}，系统会自动去重追加到末尾。

方式2 - 精细操作（需要合并/替换/删除旧条目时）：
使用 set effect 写回去重后的完整人物事迹数组；删除单条时使用 remove effect 删除对应数组路径。不要输出 chronicleOperations。

★ 指导原则：
- 一般情况下每轮为在场NPC记录1条新事迹即可
- 当事迹积累较多时（>8条），优先用merge整合琐碎条目，用replace更新过时信息
- 保持事迹列表精炼有意义，不要超过15条

【缺失字段补全】
更新在场NPC时，若以下字段为空或"未知"，必须根据上下文推断补全：
- 职业、外貌、表性格、里性格、当前状态、当前穿着 → 不可为空，必须填入合理值
- 短期目标、长期目标 → 不可为空，根据角色背景推断

═══════════════════════════════════════
【其他变量规则】

1. 玩家变量
   使用 set effect 写入 玩家.当前目标、玩家.物品栏、玩家.当前位置 或玩家.外貌等具体点号路径；货币变化使用对应路径的 add effect。
   - 外貌：仅在玩家外貌发生永久性变化时更新（如受伤留疤、获得纹身、年龄增长等），不要写入当前动作或临时状态
   ${hasBusinessModule
    ? '- ★ 当前世界启用了经营资产模块，所有金钱变化只写入 玩家.经营资产.资金；禁止更新 玩家.货币资源，禁止同时写两套资金。'
    : '- 货币资源：玩家获得/花费货币时更新数量，名称仅在首次或变化时设置'}

2. 玩家生存状态
${hasStatModule ? `   ★ 数值属性模块已启用，所有属性变化通过 玩家.生存状态 更新（见下方模块规则）。` : `   无数值属性模块时，更新生存状态：
   使用 set effect 写入 玩家.生存状态.血量 或 玩家.生存状态.体力值
   血量范围0~100，体力值范围0~100`}

3. 世界变量（★ 首轮设置位置，后续有变化时更新 ★）
   - 时间系统.时钟 是系统维护的权威时间；禁止创建、修改、删除 时间系统.时钟 或 时间系统.当前时间
   - 首轮必须输出 空间定位.当前位置；天气明确时可同时输出 当前天气
   - 后续轮次只在地点或天气变化时更新，时间流逝由系统自动处理
   使用 set effect 写入 世界.时间系统.当前天气 或 世界.空间定位.当前位置；禁止写入权威时钟路径

4. 纪事系统（统一情报板 — 记录玩家已知的所有重要信息）
   - 游戏开始时纪事为空，由 AI 根据剧情动态创建
   - 当剧情中出现新信息时更新纪事：风险/机遇/线索/关系/地点/物品
   - 如果正文是纯日常闲聊且完全没有新信息，才可以跳过

   【纪事类型】
   - 风险：威胁/隐患/危险/不利局面/需要注意的事态
   - 机遇：可利用的机会/资源/有利条件
   - 线索：谜题/调查/发现的证据/获得的情报/内幕信息
   - 关系：重要的人物关系变化/联盟/敌对/信任变化
   - 地点：新发现的地点/区域/通道/重要位置
   - 物品：重要物品的信息/线索/特殊道具

   【创建纪事】
   使用 set effect 写入 玩家.纪事系统.纪事.纪事名，value 为完整纪事对象；不要手动写入权威时间字段

   【详情字段说明】（不同类型用不同字段，灵活组合）
   - 风险：严重程度、预计影响时间、应对措施
   - 机遇：时效性、所需资源、行动计划
   - 线索：来源、可靠性、关联人物
   - 关系：NPC名、关系变化、原因
   - 地点：位置、特征、危险度
   - 物品：物品名、品质、用途

   【更新纪事】
   使用 set effect 写入 玩家.纪事系统.纪事.纪事名.状态 或对应的具体字段

   【删除纪事】使用 remove effect 删除 玩家.纪事系统.纪事.纪事名

   【注意事项】
   - 纪事仅记录玩家已知晓的信息，禁止剧透
   - 不要过度记录，只保留有意义的关键信息
   - 同一事件/信息不要重复记录
   - 当危机解除/机遇过期/线索失效时，更新状态为"已解决"或"已过期"

5. 任务系统（★ 核心系统 — 叙事驱动，与游戏系统深度联动 ★）

   ★ 核心原则：任务不是待办列表，是游戏目标。每个任务必须有明确的游戏意义和奖励。

   【创建任务】当剧情中出现以下情况时创建任务：
   - NPC委托/请求 → 创建任务，来源=NPC名
   - 玩家主动承诺/决定做某事 → 创建任务
   - 发现新目标/线索/秘密 → 创建任务
   - 世界事件触发 → 创建任务

   创建格式（基础）：使用 set effect 写入 玩家.任务系统.活跃任务.任务名，value 为完整任务对象；系统负责时间字段

   【任务类型说明】
   - 主线：推动剧情发展的核心任务，通常由重要NPC发布
   - 支线：丰富世界观的额外任务，可做可不做
   - 日常：可重复的日常任务，有冷却时间
   - 隐藏：不主动提示，玩家自行发现触发
   - 成就：被动触发，达到条件自动完成

   【★ 物品需求 — 与物品栏联动 ★】
   当任务要求收集/交付物品时，添加物品需求：
   "物品需求":[{"物品名":"药草","数量":3,"消耗":true}]
   - 消耗=true：完成任务时从物品栏扣除（交付型任务，如"把药草交给药师"）
   - 消耗=false：仅检查是否拥有（收集型任务，如"收集3个药草"）
   - 每轮检查物品栏，满足条件时推进任务

   【★ 属性需求 — 与生存状态/六维属性联动 ★】
   当任务需要属性达标时：
   "属性需求":[{"属性名":"力量","最小值":30},{"属性名":"魅力","最小值":20}]
   - 属性名对应 生存状态 中的字段（血量/体力值/dim1-6/特色属性等）
   - 检查时读取 玩家.生存状态[属性名]

   【★ 资源需求 — 与生存资源模块联动 ★】
   当任务需要消耗生存资源时：
   "资源需求":[{"资源名":"木材","数量":50,"消耗":true}]
   - 资源名对应 玩家.生存资源 中的 key
   - 消耗=true：完成时扣除资源

   【★ 技能需求 — 与技能系统联动 ★】
   当任务需要掌握技能时：
   "技能需求":[{"技能ID":"稳定能力ID（职业能力时填写）","技能名":"初级锻造"},{"技能名":"炼药术","最低品质":"精良"}]
   - 自由技能检查 玩家.技能系统；职业能力优先写技能ID，并检查 玩家.能力系统.职业状态.已解锁能力
   - 可选最低品质要求

   【★ NPC需求 — 与人物档案/好感度联动 ★】
   当任务需要NPC关系时：
   "NPC需求":[{"NPC名":"村长","最低好感度":20},{"NPC名":"药师","需要关系类型":"师徒"}]
   - 检查 人物档案[NPC名].关系数据.好感度
   - 可选关系类型要求

   【★ 骰子检定需求 — 与骰子模块联动 ★】
   当任务阶段需要掷骰判定时：
   "骰子检定":{"属性名":"敏捷","难度DC":15,"描述":"翻越城墙"}

   【★ 货币需求 — 与货币系统联动 ★】
   当任务需要花费货币时：
   "货币需求":{"数量":50,"消耗":true}

   【★ 任务奖励 — 完成时给予实际游戏奖励 ★】
   "奖励":{
     "经验值":100,
     "金币":50,
     "物品":[{"物品名":"铁剑","数量":1,"类型":"武器","品质":"精良","备注":"锋利的铁剑"}],
     "技能":[{"技能名":"疾风步","品质":"稀有","描述":"瞬间移动","类型":"身法"}],
     "天赋":[{"天赋名":"天选之人","品质":"传说","描述":"命运的宠儿"}],
     "属性提升":{"魅力":3},
     "好感度变化":{"药师":15},
     "资源":{"木材":20},
     "解锁任务":["后续任务名"],
     "解锁段位":2
   }
   - 奖励不是必须的，但主线/支线任务强烈建议设置奖励
   - 日常任务可以只有金币/资源奖励
   - 隐藏/成就任务可以有特殊奖励（天赋、解锁段位）

   【多阶段任务 — 复杂任务拆分为阶段】
   当任务有多步骤时，使用阶段：
   "阶段":[
     {"名称":"收集材料","描述":"收集所需材料","状态":"已完成","物品需求":[{"物品名":"铁矿","数量":5,"消耗":true}]},
     {"名称":"寻找铁匠","描述":"找到能打造武器的铁匠","状态":"进行中","NPC需求":[{"NPC名":"老铁匠","最低好感度":10}]},
     {"名称":"等待打造","描述":"等待铁匠完成","状态":"未开始","阶段奖励":{"经验值":50}}
   ]
   - 每个阶段可以有独立的条件和奖励
   - 阶段按顺序推进，当前阶段完成后自动进入下一阶段

   【任务链 — 任务之间的依赖关系】
   - 前置任务：{"前置任务":["前置任务名"]} → 前置完成后才能接取
   - 后续任务：{"后续任务":["后续任务名"]} → 完成后自动解锁
   - 用 奖励.解锁任务 来建立链式关系

   【更新任务进度】
   - 进度变化：使用 set effect 写入 玩家.任务系统.活跃任务.任务名.进度 和对应的目标路径
   - 阶段推进：使用 set effect 写入 玩家.任务系统.活跃任务.任务名.阶段
   - 满足条件后更新，不要等玩家手动操作

   【完成任务】
   将任务从活跃移到已完成，并应用奖励：
   [{"op":"remove","path":"/玩家/任务系统/活跃任务/任务名"},{"op":"add","path":"/玩家/任务系统/已完成任务/任务名","value":{"任务名":"...","状态":"已完成",...}}]

   【失败任务】
   [{"op":"remove","path":"/玩家/任务系统/活跃任务/任务名"},{"op":"add","path":"/玩家/任务系统/已失败任务/任务名","value":{"任务名":"...","状态":"已失败",...}}]

   【★ 每轮检查时机 ★】
   每轮回复时必须检查：
   1. 活跃任务的物品需求 → 对比物品栏是否满足
   2. 活跃任务的属性需求 → 对比生存状态是否满足
   3. 活跃任务的资源需求 → 对比生存资源是否满足
   4. 活跃任务的NPC需求 → 对比人物档案好感度
   5. 满足全部条件的任务 → 推进阶段或标记完成，应用奖励
   6. 超时任务 → 标记失败
   7. 有前置任务的新任务 → 前置完成后解锁

   【注意事项】
   - 任务是游戏目标，不是待办清单，每个任务必须有实际意义
   - 隐藏任务不主动提示，在描述中暗示，玩家自行发现
   - 日常任务描述中注明冷却时间
   - 成就任务是被动触发的（达到条件自动完成，不需要玩家主动接取）
   - 活跃任务上限15条，超出时优先完成/放弃旧任务
   - 任务仅记录玩家已知的信息，禁止剧透

6. 模块数据（如果世界启用了模块）
   - 数值属性通过 玩家.生存状态 更新（见下方规则）
   - 成长体系通过 玩家.当前段位索引/当前经验值 更新
   - 生存资源通过 玩家.生存资源 更新
   - 只更新发生变化的字段，未变化的不要输出
${generateModuleUpdateRules(worldSystem, progressionConfig)}

═══════════════════════════════════════
【禁止事项】
1. 禁止输出剧情续写或价值评判
2. 禁止凭空编造NPC未展现的能力或经历
3. 好感度单次变化建议 -5~+5，重大事件可更大
4. 不要输出与变量更新无关的内容
5. ★ 禁止无理由修改好感度 ★：正文没有发生影响关系的事件时，不要输出好感度字段。好感度不是"每轮必须更新"的字段
6. ★ 禁止混淆角色口吻 ★：每个NPC的当前想法必须是该角色独有的视角、语气和对主角的称呼。角色A的想法里不能出现角色B的称呼方式或视角

【示例输出】（注意：创建新NPC时才设置初始好感度，更新已有NPC时仅在发生关系事件后才更新好感度）
<UpdateVariable>{"id":"npc-arrival-1","source":"ai","label":"记录神秘老者登场","effects":[{"set":{"path":"人物档案.神秘老者","value":{"姓名":"神秘老者","种族":"人类","性别":"男","年龄":80,"人物分类":"在场","社会身份":{"职业":"智者"},"关系数据":{"好感度":0,"关系类型":"初次见面"},"个人信息":{"外貌":"白发苍苍的老者，银丝般的胡须垂至胸前","表性格":"温和、睿智","当前想法":"终于等到了预言中的勇者，不知他是否真能拯救这片大陆……","当前状态":"微笑着注视着你","当前穿着":"深蓝色长袍，上面绣着银色星辰图案"},"当前行动":"向勇者走来","人物事迹":["在城门口与玩家初次相遇"]}}}]}</UpdateVariable>
【最终输出门禁】
再次确认：输出只能是上面的 GameplayTransaction。不要输出旧的“设置/世界/玩家/人物档案”对象、RFC 6902 数组、chronicleOperations 或任何裸字段合并。即使上方规则用旧字段展示业务语义，也必须把它们翻译成 effects 中的点号路径后再输出。`;
}
