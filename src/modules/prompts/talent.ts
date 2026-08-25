// 天赋体系模块 — Prompt 模板

/** 天赋按需生成（在世界编辑器中手动触发） */
export function buildTalentGenPrompt(params: {
  theme: string;
  tone: string;
  era: string;
  existingCategories: string[];
  count?: number;
}): string {
  const count = params.count || 5;
  const existing = params.existingCategories.length > 0
    ? `\n已有天赋大类（可以往这些大类里补充，也可以新建大类）：${params.existingCategories.join('、')}`
    : '';

  return `为以下世界设计一套可实际运行的天赋与技能体系：

世界主题：${params.theme}
基调：${params.tone}
时代：${params.era}
${existing}

【设计要求】

1. 生成 2~4 个天赋大类（根据世界观选择合适分类）
2. 每个大类下生成 ${count} 个具体天赋
3. 品质分为5档：普通、精良、稀有、史诗、传说
4. 天赋名和描述必须与世界观高度贴合
5. effects 数组列出天赋的效果描述（纯文本，1~3条）
6. 额外生成 4~8 个可学习技能；技能可主动使用，支持技能点、消耗和冷却
7. pointRules 决定初始点数与每次成长获得的点数，推荐初始各 1~3 点、每阶段各 1 点
8. 机械效果只能使用以下安全路径：玩家.生存状态.血量、玩家.生存状态.体力值、玩家.生存状态.dim1~dim6、玩家.经营资产.资金、玩家.当前经验值。不要创造未知路径

【品质分布参考】
- 普通：常见天赋，约40%
- 精良：较好的天赋，约25%
- 稀有：少见的天赋，约20%
- 史诗：极少见，约10%
- 传说：最稀有，约5%

【输出JSON】
{
  "pointRules": {
    "initialTalentPoints": 2,
    "initialSkillPoints": 2,
    "talentPointsPerTier": 1,
    "skillPointsPerTier": 1
  },
  "categories": [
    {
      "id": "英文标识（如 root, physique, bloodline）",
      "name": "大类中文名（如：灵根）",
      "description": "大类描述",
      "talents": [
        {
          "id": "英文标识（如 heavenly_root）",
          "name": "天赋中文名（如：天灵根）",
          "description": "天赋描述（2-3句话）",
          "rarity": "普通/精良/稀有/史诗/传说",
          "effects": ["效果1", "效果2"],
          "maxRank": 1,
          "pointCost": 1,
          "mechanics": {
            "onUnlock": [{ "add": { "path": "玩家.经营资产.资金", "delta": 5 } }]
          }
        }
      ]
    }
  ],
  "skills": [
    {
      "id": "英文标识",
      "name": "技能名",
      "description": "技能描述",
      "categoryId": "对应大类id",
      "rarity": "普通",
      "maxRank": 3,
      "pointCost": 1,
      "cooldownTicks": 2,
      "tags": ["交涉"],
      "activation": {
        "costs": [{ "path": "玩家.生存状态.体力值", "amount": 3, "label": "体力" }],
        "effects": [{ "add": { "path": "玩家.经营资产.资金", "delta": 5 } }]
      }
    }
  ]
}`;
}

/** 天赋体系规则（注入世界书，绿灯触发） */
export const TALENT_RULES_PROMPT = `【天赋与技能体系】
天赋是角色的长期特质，技能是可以学习、升级和主动使用的能力。点数、消耗、冷却与效果均由本地系统确定性结算。

【天赋分类】
天赋按来源分为几大类（如：灵根、体质、血脉、天赋、命格等，根据世界观选择）。
每个大类下有多个具体天赋，品质分为5档：普通、精良、稀有、史诗、传说。

【天赋觉醒】
角色初始可能拥有部分天赋，其余天赋在特定条件下觉醒：
- 修为突破时
- 生死关头
- 特殊机缘（获得宝物、传承、奇遇）
- 血脉激活

当角色觉醒新天赋时，在叙事中输出以下标记，系统会自动渲染觉醒卡片：
[TALENT_GAIN]{id:"天赋id", name:"天赋名", rarity:"品质", description:"描述", effects:["效果1","效果2"]}[/TALENT_GAIN]

【天赋与技能效果】
AI 应在叙事中自然体现已解锁天赋和已掌握技能，但不得自行扣点、绕过冷却或虚构机械结算。例如：
- 天灵根：修炼速度极快，对灵气感应敏锐
- 龙之血脉：肉身强横，可抵抗火焰
- 时间感知：危急时刻反应速度倍增

不要输出具体的数值加成，而是通过叙事展现天赋的影响。`;

/** 运行时统一玩法事务契约 */
export const TALENT_UPDATE_RULES = `【天赋与技能更新规则】
- 天赋是角色的固有特质，一般不会频繁变化
- AI在叙事中可以提及角色的天赋，自然地体现天赋效果
- 如果剧情触发角色觉醒新天赋，输出 [TALENT_GAIN] 标记
- 不要删除或修改已有的天赋数据
- 天赋可以在特殊情况下被封印、剥夺或强化
- 技能学习、升级、使用、消耗和冷却由本地系统处理，AI 不要直接改写能力系统点数
- 需要提交机械效果时，只能输出 GameplayTransaction JSON（通过现有更新标签传输），使用 effects/costs/rewards/events 字段
- AI 不得直接输出玩家状态对象或 RFC 补丁；觉醒叙事仍使用 [TALENT_GAIN] 标记，由本地系统决定是否落地`;
