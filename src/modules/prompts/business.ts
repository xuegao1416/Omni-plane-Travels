// 经营资产模块 — Prompt 模板

/** 阶段：经营资产生成（仅生成环境配置，不生成具体资产） */
export function buildBusinessGenPrompt(params: {
  theme: string;
  tone: string;
  userDesc?: string;
}): string {
  const userBlock = params.userDesc
    ? `\n\n玩家对经营系统的额外要求：\n${params.userDesc}`
    : '';

  return `为以下世界设计经营资产系统的环境配置：

世界主题：${params.theme}
基调：${params.tone}
${userBlock}

【设计要求】

1. 只生成经营环境配置，不要生成具体资产
2. 具体资产由玩家在游戏中通过角色行动获取（如：买下一家酒馆、承包一座矿场）
3. 你需要生成：
   - description: 经济环境描述（2-3句话，描述这个世界的经济状况）
   - cycleName: 结算周期名（"天"/"周"/"回合"，根据世界观选择）
   - funds: 初始资金（角色的起始资金，根据基调设定）
     - 末日/废土：50~150
     - 古代/宫廷：100~300
     - 都市/商战：200~500
     - 修仙/玄幻：50~200（灵石/仙玉等）
4. 可选生成 market（3~5个商品行情，有 basePrice 和 trend）
5. assets 数组留空（[]）
6. economy 使用确定性结算：市场影响权重建议 0.2~0.5，资金不足时自动暂停亏损资产

【输出JSON】
{
  "description": "经济环境描述（2-3句话）",
  "funds": 300,
  "cycleName": "天",
  "assets": [],
  "market": {
    "items": [
      { "name": "铁矿", "basePrice": 50, "trend": "stable", "changePercent": 0 },
      { "name": "粮食", "basePrice": 20, "trend": "up", "changePercent": 10 }
    ]
  },
  "economy": { "marketWeight": 0.35, "autoIdleOnDeficit": true, "logLimit": 50 },
  "transactionLog": []
}`;
}

/** 运行时统一玩法事务契约 */
export const BUSINESS_UPDATE_RULES = `【经营资产更新规则】
- 经营数据必须使用 GameplayTransaction JSON（通过现有更新标签传输），禁止直接合并 玩家.经营资产 或发送 RFC 补丁
- 初始状态下玩家没有经营资产，需要通过角色行动获取
- 收购资产：当玩家在叙事中明确表达要购买/承包/开设经营项目时，将新资产添加到资产列表，同时扣除资金
  - 收购前必须检查资金是否充足
  - 资产必须填写基础收益、每级收益、维护费、员工效率、市场标签、风险等级和升级费用
- 示例：{"id":"ai:business:purchase","source":"ai","moduleId":"business","costs":[{"path":"玩家.经营资产.资金","amount":50}],"effects":[{"append":{"path":"玩家.经营资产.资产列表","value":{"id":"tavern","名称":"酒馆","类型":"餐饮","等级":1,"最高等级":3,"状态":"active"},"create":true}}]}
- 升级资产：修改对应资产的等级（不能超过最高等级），扣除升级费用
  - 使用 costs 扣除升级费用，并用 effects.set 修改对应资产等级
- 出售资产：从资产列表中移除，增加资金（售价约为升级费用 * 0.5）
- 资产状态变化：受损时状态改为 "damaged"（收入减半），被毁时改为 "destroyed"（收入归零）
- 每个资产的净收益（基础收益 + 每级收益*(等级-1) - 维护费）应为正数
- 资金不能为负数
- 经营日志：重大事件添加到交易日志数组
- 只输出发生变化的字段，未变化的不要输出
- 资金、材料、资产和交易日志的变化必须在同一个 GameplayTransaction 中提交`;

/**
 * 经营资产独立提取提示词
 * 从主变量提取中剥离，专门用于从叙事中提取经营资产变更
 */
export function buildBusinessExtractionPrompt(params: {
  currentBusiness: Record<string, unknown> | undefined;
  environment: { description?: string; cycleName?: string } | undefined;
  userText: string;
  aiContent: string;
}): string {
  const { currentBusiness, environment, userText, aiContent } = params;

  const businessState = currentBusiness
    ? JSON.stringify(currentBusiness, null, 2)
    : '（尚未初始化）';

  const envDesc = environment?.description || '这个世界存在商业活动。';
  const cycleName = environment?.cycleName || '天';

  const assetList = Array.isArray((currentBusiness as any)?.资产列表)
    ? (currentBusiness as any).资产列表 as Array<Record<string, unknown>>
    : [];
  const assetSummary = assetList.length > 0
    ? assetList.map((a: Record<string, unknown>) =>
      `- ${a.名称 || a.id}（${a.类型 || '通用'}）：等级 ${a.等级 ?? 1}/${a.最高等级 ?? 3}，状态 ${a.状态 || 'active'}`
    ).join('\n')
    : '（暂无资产）';

  return `你是经营资产提取系统。分析叙事文本，提取玩家的经营资产变更。

【当前经营状态】
${businessState}

【经营环境】${envDesc} 结算周期：${cycleName}

【当前资产】
${assetSummary}

【玩家消息】
${userText}

【AI 叙事】
${aiContent}

═══════════════════════════════════════
【规则】
1. 只提取经营相关变更
2. 用 <UpdateVariable>...</UpdateVariable> 作为传输标签，标签内必须是 GameplayTransaction JSON，不能是状态合并对象或 RFC 补丁
3. 只输出变化的字段

【收购】新资产需填全部字段：
<UpdateVariable>{"id":"ai:business:purchase","source":"ai","moduleId":"business","costs":[{"path":"玩家.经营资产.资金","amount":购买费用}],"effects":[{"append":{"path":"玩家.经营资产.资产列表","value":{"id":"英文id","名称":"中文名","类型":"类别","等级":1,"最高等级":3,"状态":"active"},"create":true}}]}</UpdateVariable>

【升级】使用 costs + effects.set 的 GameplayTransaction

【出售】使用 effects.remove + effects.add 的 GameplayTransaction

【资金变更】使用 effects.add 的 GameplayTransaction

【无变更】不要输出事务`;
}
