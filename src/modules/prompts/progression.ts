// 成长体系模块 — Prompt 模板

/** 成长体系生成（AI根据世界描述自动选择段位制或等级制） */
export function buildProgressionGenPrompt(params: {
  theme: string;
  tone: string;
  era: string;
}): string {
  return `为以下世界设计成长体系：

世界主题：${params.theme}
基调：${params.tone}
时代：${params.era}

【根据世界描述自动选择模式】

模式A - 段位制（适合慢节奏、有明显质变的世界）：
- 段位数：4-10个
- 特点：每个段位之间有明显的实力差距
- 适用：修仙/武侠/宫斗/奇幻/有"境界""突破""段位"概念的世界

模式B - 等级制（适合快节奏、平滑成长的世界）：
- 等级范围：0~N（如0~100）
- 特点：每级提升较小，累积效果明显
- 适用：网游/RPG/校园/都市/有"等级""升级""经验值"概念的世界
- 如果描述中明确提到"等级制"或"网游"，必须选等级制

【段位制输出格式】
{
  "mode": "tiered",
  "tiers": [
    {
      "name": "段位名",
      "description": "该段位特征描述",
      "statBonuses": {
        "attrAMax": 100, "attrBMax": 100,
        "dim1Max": 100, "dim2Max": 100, "dim3Max": 100,
        "dim4Max": 100, "dim5Max": 100, "dim6Max": 100
      }
    }
  ],
  "xpFormula": { "baseXP": 100, "exponent": 2.0, "scaleFactor": 1.0 }
}

【等级制输出格式】
{
  "mode": "level",
  "levelData": {
    "maxLevel": 100,
    "baseStats": {
      "attrAMax": 100, "attrBMax": 100,
      "dim1Max": 100, "dim2Max": 100, "dim3Max": 100,
      "dim4Max": 100, "dim5Max": 100, "dim6Max": 100
    },
    "growthPerLevel": {
      "attrAMax": 10, "attrBMax": 10,
      "dim1Max": 8, "dim2Max": 8, "dim3Max": 8,
      "dim4Max": 8, "dim5Max": 8, "dim6Max": 8
    }
  },
  "xpFormula": { "baseXP": 100, "exponent": 1.5, "scaleFactor": 1.0 }
}

【数值设计指南 — 根据世界类型选择合适的数值尺度】

● 现实/日常/校园/都市类（数值偏小）：
  - 段位制 statBonuses：初始段 attrAMax=100，每段+50~100，六维上限50~100
  - 等级制 baseStats：attrAMax=100，dimXMax=50
  - 等级制 growthPerLevel：attrAMax=5，dimXMax=3

● 奇幻/武侠/中世纪类（数值中等）：
  - 段位制 statBonuses：初始段 attrAMax=200，每段+100~200，六维上限100~200
  - 等级制 baseStats：attrAMax=200，dimXMax=100
  - 等级制 growthPerLevel：attrAMax=10，dimXMax=8

● 网游/MMO/修仙/高武类（数值偏大）：
  - 段位制 statBonuses：初始段 attrAMax=500，每段+200~500，六维上限200~500
  - 等级制 baseStats：attrAMax=500，dimXMax=200
  - 等级制 growthPerLevel：attrAMax=20，dimXMax=15

● 末日/生存/高难度类（数值偏低且紧张）：
  - 段位制 statBonuses：初始段 attrAMax=100，每段+30~60，六维上限30~60
  - 等级制 baseStats：attrAMax=100，dimXMax=30
  - 等级制 growthPerLevel：attrAMax=5，dimXMax=3

请根据「${params.theme}」自动判断属于哪类世界，选择对应的数值尺度。

【等级制设计要点】
- maxLevel：根据世界节奏设定（网游100，校园50，都市30等）
- baseStats：0级时的属性天花板，代表角色初始状态的属性上限
- growthPerLevel：每级属性增长量，baseStats + maxLevel * growthPerLevel = 满级属性天花板
- xpFormula.baseXP：基础经验值（50~200）
- xpFormula.exponent：增长指数（1.0~2.0，越大越难升级）

【段位制设计要点】
- 每个段位的 statBonuses 代表该段位的属性天花板
- 段位越高，statBonuses 越大，体现实力差距
- 最低段位的 statBonuses 应接近角色初始属性范围
- 最高段位的 statBonuses 应体现该世界的巅峰战力`;
}

/** 运行时UpdateVariable规则 */
export const PROGRESSION_UPDATE_RULES = `【成长体系更新规则】

currentXP 语义说明：
- currentXP 是"当前级别内积累的经验值"，不是角色总经验值
- 每次升级/升段后，currentXP 重置为 0，然后重新积累
- 例如：从 Lv.5 升到 Lv.6 时，currentXP 重置为 0

获得经验值时（增量更新）：
{"玩家":{"当前经验值":当前值+获得量}}

升级/升段时：
{"玩家":{"当前段位索引":新索引,"当前经验值":0}}

注意：
- currentXP 不能为负数
- currentXP 是当前级别内的累计值，不是总经验值
- 等级制：currentTierIndex 不能超过 maxLevel
- 段位制：currentTierIndex 不能超过 tiers.length - 1
- 属性天花板由框架自动计算，AI不需要手动输出`;
