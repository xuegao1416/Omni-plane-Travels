/**
 * Prompt 管理系统 - 编辑器 AI 相关
 * 管理角色补全、变量提取等编辑器功能的 prompt
 */

import type { StatModuleSchema, ProgressionModuleSchema, SurvivalModuleSchema, BusinessModuleSchema, DiceModuleSchema, TalentModuleSchema, WorldSystemData } from '../../modules/schema';
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
}

/**
 * 构建角色 AI 补全的 System Prompt（只补全玩家信息，不含NPC）
 */
export function buildCharacterFillPrompt(options: CharacterFillOptions): string {
  const { worldSetting, playerName, playerGender, playerAge, playerBackground, statModule } = options;

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
   - 根据世界设定推断，选择最匹配的职业
   - 要与年龄、背景、技能相呼应

4. 性格（personality）
   - 根据角色的年龄、背景、职业推断合理性格
   - 2-4个关键词，如：温柔善良、沉默寡言、外冷内热

8. 外貌（appearance）
   - 根据角色的性别、年龄、种族推断合理外貌
   - 包含发型、体型、标志性特征等，不少于20字

9. 技能（skills）
   - 生成 1~3 个与世界设定匹配的技能
   - 技能要与职业、背景相关
   - 品质分级：普通/精良/稀有/史诗/传说

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
  "attrs": {
    "attrA": <生命类初始值，取上限的60%~90%>,
    "attrB": <能量类初始值，取上限的50%~80%>,
    "dim1": <${statModule.dim1.name}初始值，在范围内根据角色特点设定>,
    "dim2": <${statModule.dim2.name}初始值>,
    "dim3": <${statModule.dim3.name}初始值>,
    "dim4": <${statModule.dim4.name}初始值>,
    "dim5": <${statModule.dim5.name}初始值>,
    "dim6": <${statModule.dim6.name}初始值>
  }` : ''}
  ${hasProgression ? `,
  "tierIndex": <NPC的段位索引，根据实力设定，0=最低段位>` : ''}
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
  const { worldSetting, playerName, playerGender, playerAge, playerBackground, npc } = options;

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
   - 生命类（${s.attrA.name}）：{"玩家":{"生存状态":{"血量":新值}}}
   - 能量类（${s.attrB.name}）：{"玩家":{"生存状态":{"体力值":新值}}}
   - 六维属性：${dims.map((d, i) => `${d!.name}(${dimKeys[i]})`).join('、')}
     示例：{"玩家":{"生存状态":{"dim1":新值}}}
   - 属性值不能超过range[1]，不能低于range[0]
   ${s.special.length > 0 ? `  - 特色属性：${s.special.map(sp => `${sp.name}(${sp.id})`).join('、')}
     示例：{"玩家":{"生存状态":{"${s.special[0]?.id}":新值}}}` : ''}`);
  }

  // ── 成长体系 → 玩家 ──
  if (progressionConfig) {
    const p = progressionConfig as any;

    if (p.mode === 'level' && p.levelData) {
      const maxLevel = p.levelData.maxLevel;
      rules.push(`   【成长体系更新规则】
   - 模式：等级制（0~${maxLevel}级）
   - 获得经验时：{"玩家":{"当前经验值":新值}}
   - 升级时：{"玩家":{"当前段位索引":新等级,"当前经验值":0}}
   - 当前经验值不能为负，当前段位索引不能超过${maxLevel}`);
    } else if (p.tiers?.length) {
      const tierList = p.tiers.map((t: any, i: number) => `${i + 1}.${t.name}`).join('、');
      rules.push(`   【成长体系更新规则】
   - 模式：段位制
   - 阶段列表：${tierList}
   - 获得经验时：{"玩家":{"当前经验值":新值}}
   - 升段时：{"玩家":{"当前段位索引":新索引,"当前经验值":0}}
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
   - 数量变化：{"玩家":{"生存资源":{"资源id":{"数量":新数量}}}}
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
   - 资金变化：{"玩家":{"经营资产":{"资金":新资金}}}
   - 收购新资产（同时扣除资金）：{"玩家":{"经营资产":{"资金":扣款后余额,"资产列表":[{"id":"英文标识","名称":"资产名","类型":"类别","等级":1,"最高等级":3,"描述":"描述","状态":"active","基础收益":10,"每级收益":5,"维护费":3}]}}}
   - 升级资产（扣除升级费用，提升等级）：{"玩家":{"经营资产":{"资金":扣款后余额,"资产列表":[{"id":"原id","等级":新等级}]}}}
   - 出售资产（从列表移除，增加资金）：用 RFC 6902 remove 操作
   - 资产状态变化：受损时状态改为 "damaged"（收入减半），被毁时改为 "destroyed"（收入归零）
   - 经营日志：重大事件添加到交易日志数组
   - 资金不能为负数
   - 只输出发生变化的字段`);
  }

  // ── 骰子检定（前端自动处理） ──
  if (data.骰子检定) {
    rules.push(`   【骰子检定更新规则】
   - 骰子检定由玩家在前端卡片中操作，AI无需手动更新`);
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
  const hasProgression = !!(progressionConfig && Array.isArray(progressionConfig.tiers) && progressionConfig.tiers.length > 0);

  return `你是一个后台变量裁定系统，负责分析玩家消息和AI回复，提取需要更新的变量。
你的任务是识别剧情中的关键变化，更新游戏状态，但不续写剧情。

═══════════════════════════════════════
【核心原则】
1. 只做变量更新，不续写剧情，不做价值评判
2. 仅依据已发生事实更新，禁止凭空脑补关键结果
3. ★ 人物档案每轮必须更新 ★：只要场景中有NPC，就必须更新其当前想法、当前状态、当前行动等字段。这不是可选的。
4. 保持变量的逻辑性和合理性
5. 笔记本仅在变量发生变动时更新

【输出格式】
用 <UpdateVariable></UpdateVariable> 标签包裹JSON输出。
只写需要更新的字段，未变化的字段不要输出。

【顶层 key】
设置 / 世界 / 玩家 / 人物档案

═══════════════════════════════════════
【人物档案规则】（★ 每轮必须更新，不可跳过 ★）

★ 重要：无论本轮是否有"重大事件"，只要场景中有NPC出现，就必须输出人物档案更新。
★ 不输出人物档案 = 严重错误。即使只是NPC说了几句话，也必须更新其当前想法、当前状态。

1. 出现新角色 → 必须创建完整NPC条目
2. 场景中有NPC → 必须更新该NPC的以下字段：
   - 人物分类（在场/离场）
   - 个人信息.当前想法（以角色口吻的内心独白，不少于15字）
   - 个人信息.当前状态（最新的动作/表情/情绪）
   - 个人信息.当前位置（有变化时更新）
   - 当前行动（角色正在做的事）
   - 关系数据.好感度（有变化时更新）
   - 人物事迹（★ 每轮必须追加1条，见下方事迹规则）
3. NPC离开场景 → 将人物分类设为"离场"
4. 用角色姓名作key即可，系统自动匹配

【创建新NPC - 必须包含以下全部字段】
{"人物档案":{"角色名":{
  "姓名":"角色名",
  "种族":"人类/精灵/兽人等",
  "性别":"男/女",
  "年龄":25,
  "人物分类":"在场",
  "社会身份":{"职业":"...","社会地位":"..."},
  "关系数据":{"好感度":50,"关系类型":"初次见面"},
  "个人信息":{
    "外貌":"【必填】具体外貌描写：发型、发色、瞳色、肤色、体型、面容特征、标志性特征等，不少于30字",
    "表性格":"【必填】外在表现的性格特点，2-4个关键词",
    "里性格":"【必填】内心深处的真实性格，与表性格可能不同",
    "当前想法":"【必填】角色当前的真实内心想法，以角色第一人称口吻，不少于20字",
    "当前状态":"【必填】当前动作/表情/情绪状态",
    "当前穿着":"【必填】具体穿着描述，包含衣物材质、颜色、风格等",
    "当前位置":"角色当前所在位置"
  },
  "人物事迹":["角色的重要人生经历或初次登场事件"],
  "当前行动":"角色当前正在做的事",
  "短期目标":"【必填】近期要完成的具体目标，1-2句话",
  "长期目标":"【必填】中长期的人生追求，1-2句话",
  "内心想法":"角色更深层的内心独白（可选，与个人信息.当前想法互补）",
  "技能列表":{"技能名":{"描述":"技能描述","类型":"战斗/生活/社交/特殊","品质":"普通/精良/稀有/史诗/传说"}},
  "物品列表":{"物品名":{"数量":1,"类型":"物品类型","品质":"普通/精良/稀有/史诗/传说","备注":"备注"}}
  ${statModule ? `,
  "属性":{"attrA":<生命值>,"attrB":<能量>,"dim1":<${statModule.dim1.name}>,"dim2":<${statModule.dim2.name}>,"dim3":<${statModule.dim3.name}>,"dim4":<${statModule.dim4.name}>,"dim5":<${statModule.dim5.name}>,"dim6":<${statModule.dim6.name}>}` : ''}
  ${hasProgression ? `,
  "成长状态":{"当前段位索引":<段位索引,根据实力设定>}` : ''}
}}}

【更新已有NPC - ★ 每轮必须输出，不可省略 ★】
场景中出现的每个NPC都必须更新，即使只是旁观或沉默。示例：
{"人物档案":{"角色名":{
  "人物分类":"在场",
  "个人信息":{
    "当前想法":"【必填】以角色口吻的最新内心想法，不少于15字",
    "当前状态":"【必填】最新的动作/表情/情绪",
    "当前位置":"当前位置（有变化时更新）",
    "当前穿着":"穿着（有变化时更新）"
  },
  "关系数据":{"好感度":新值},
  "当前行动":"当前正在做的事",
  "短期目标":"如有变化则更新",
  "长期目标":"如有变化则更新"
  ${statModule ? `,
  "属性":{"attrA":<新值,受伤/恢复时更新>,"attrB":<新值>,"dim1":<新值>,"dim2":<新值>,"dim3":<新值>,"dim4":<新值>,"dim5":<新值>,"dim6":<新值>}` : ''}
  ${hasProgression ? `,
  "成长状态":{"当前段位索引":<新值,升级/突破时更新>}` : ''}
}}}

【离场规则】
1. NPC未在当前场景出现 → 人物分类设为"离场"，仅更新此字段
2. NPC重新出现 → 人物分类设回"在场"，并更新上述全部字段

【人物事迹规则】
人物事迹是NPC的关键事件记录。系统会在快照中展示每个NPC的当前事迹列表（带编号 [0][1][2]...）。
你有两种更新方式：

方式1 - 追加（简单场景，NPC有新事件发生）：
{"人物档案":{"角色名":{"人物事迹":["新事件摘要"]}}}
只写新条目即可，系统会自动去重追加到末尾。

方式2 - 精细操作（需要合并/替换/删除旧条目时）：
{"人物档案":{"角色名":{"chronicleOperations":[
  {"type":"add","value":"新事件"},
  {"type":"replace","index":2,"value":"替换后的内容"},
  {"type":"merge","indexes":[0,1],"value":"合并后的内容"},
  {"type":"remove","index":3}
]}}}
操作说明：
- add: 追加新条目（自动去重）
- replace: 替换指定编号的条目
- merge: 将多条合并为一条（自动删除被合并的旧条目）
- remove: 删除指定编号的条目

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
   {"玩家":{"当前目标":"...","物品栏":{"物品名":{"数量":1}},"当前位置":"...","外貌":"..."}}
   - 外貌：仅在玩家外貌发生永久性变化时更新（如受伤留疤、获得纹身、年龄增长等），不要写入当前动作或临时状态

2. 玩家生存状态
${hasStatModule ? `   ★ 数值属性模块已启用，所有属性变化通过 玩家.生存状态 更新（见下方模块规则）。` : `   无数值属性模块时，更新生存状态：
   {"玩家":{"生存状态":{"血量":新值,"体力值":新值}}}
   血量范围0~100，体力值范围0~100`}

3. 世界变量（★ 首轮必须设置，后续有变化时更新 ★）
   - 首轮必须输出 时间系统.当前时间 和 空间定位.当前位置，否则界面无法显示世界状态
   - 后续轮次：时间流逝、地点变化、天气变化时更新
   {"世界":{"时间系统":{"当前时间":"傍晚","当前天气":"晴朗"},"空间定位":{"当前位置":"城门"}}}

4. 笔记本（变量发生变动时更新）
   - 游戏开始时笔记本为空，由 AI 根据世界设定动态创建
   - 仅在剧情中出现新的危机、机遇、待办事项，或已有条目状态发生变化时才更新
   - 如果本轮没有新的变量变动，不要更新笔记本
   - 记录危机（剧情中出现威胁/隐患/敌对行动时）：
     {"玩家":{"记事本":{"潜在危机":{"危机名":{"严重程度":"低/中/高/致命","预计影响时间":"时间描述","应对措施":"应对建议"}}}}}
   - 记录机遇（出现可利用的机会/资源/线索时）：
     {"玩家":{"记事本":{"当前机遇":{"机遇名":{"时效性":"时间描述","所需资源":"所需资源","行动计划":"行动计划"}}}}}
   - 记录待办（玩家有明确待办/承诺/任务时）：
     {"玩家":{"记事本":{"待办事项":{"事项名":{"优先级":"低/中/高/紧急","截止时间":"时间或条件","状态":"进行中/已完成/已取消"}}}}}
   - 更新已有条目（状态变化、信息补充时）：
     {"玩家":{"记事本":{"待办事项":{"事项名":{"状态":"已完成"}}}}}
   - 删除条目（危机已解除/机遇已过期/待办已完成且不需要记录时，用RFC 6902的remove操作）：
     [{"op":"remove","path":"/玩家/记事本/潜在危机/危机名"}]
   - 笔记本仅记录玩家已知晓的信息，禁止剧透
   - 不要过度记录，只保留有意义的关键信息
   - 优先更新已有的待办事项状态，而不是创建新条目

5. 模块数据（如果世界启用了模块）
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

【示例输出】
<UpdateVariable>{"人物档案":{"神秘老者":{"姓名":"神秘老者","种族":"人类","性别":"男","年龄":80,"人物分类":"在场","社会身份":{"职业":"智者"},"关系数据":{"好感度":60,"关系类型":"初次见面"},"个人信息":{"外貌":"白发苍苍的老者，银丝般的胡须垂至胸前","表性格":"温和、睿智","当前想法":"终于等到了预言中的勇者","当前状态":"微笑着注视着你","当前穿着":"深蓝色长袍，上面绣着银色星辰图案"},"当前行动":"向勇者走来"}}}</UpdateVariable>`;
}
