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
