// 生存资源模块 — Prompt 模板

/** 阶段：生存资源生成（含演化蓝图） */
export function buildSurvivalGenPrompt(params: {
  theme: string;
  tone: string;
}): string {
  return `为以下世界设计生存资源系统：

世界主题：${params.theme}
基调：${params.tone}

【设计原则】
- 生存资源是这个世界的核心挑战，资源获取和消耗是叙事驱动力
- 初始只生成早期资源（3-4种基础资源），后续资源通过演化蓝图解锁
- 至少1种初始稀缺资源（标记 scarce: true），稀缺资源是生存压力的来源
- 每种资源必须有 max 上限，代表物理存储/携带极限
- 每种资源必须有 gatherRate（采集速率）和 usage（消耗速率），用自然语言描述
- 配方不在世界创建时生成，而是在游戏中由玩家触发AI动态生成

★ amount 必须是正数！表示游戏开始时玩家拥有的初始数量，不能为0！

【数值设计指南】

● 末日/荒岛/原始生存类（紧张节奏）：
  - 资源上限：5-15，初始数量：上限的30%-60%
  - 每天消耗：1-2单位核心资源，稀缺资源初始：1-3

● 像素生存/沙盒类（中等节奏）：
  - 资源上限：20-50，初始数量：上限的40%-70%
  - 每天消耗：1单位，稀缺资源初始：3-5

● 轻度生存/经营混合类（宽松节奏）：
  - 资源上限：50-100，初始数量：上限的50%-80%
  - 每天消耗：0-1单位，稀缺资源初始：5-10

【必须生成以下内容】

1. 整体描述：一句话说明这个世界的生存资源系统特点

2. 初始资源列表（3-4种，只生成游戏开局就能获取的基础资源）：
   每种资源需要：
   - id: 英文标识（如 water, food, wood, stone, herb）
   - name: 中文名（与世界观贴合）
   - symbol: 资源符号（emoji）
   - ★ amount: 初始数量（必须是正数！如 6、10、3，绝不能是 0）
   - max: 上限（必须设定）
   - scarce: 是否稀缺（至少1种为true）
   - gatherRate: 采集速率描述（如"河边每天可取3桶水"）
   - usage: 消耗速率描述（如"每人每天需要1份饮用水"）
   - description: 获取方式与用途

3. 生存规则：
   - cycleName: 结算周期名（"一天"/"一个回合"）
   - consumePerCycle: 每周期自动消耗描述
   - criticalThreshold: 危机触发阈值（默认2）

4. 结构化消耗规则（consumption）：
   系统需要确定性地执行每轮资源消耗，所以需要结构化的数值：
   - perCycle: 每周期自动消耗的资源 { "资源id": 消耗量 }，如 { "food": 1, "water": 1 }
   - exhaustionPenalty（可选）: 某资源耗尽时对属性的惩罚 { "属性id": 每轮扣减 }，如 { "体力值": 5 }
     注意：属性 id 必须是这个世界的实际属性名（如"体力值""血量"等）

5. 资源演化蓝图（resourceEvolution）：
   设计2-3个演化阶段，每个阶段解锁新资源、淘汰旧资源。
   每个演化步骤需要：
   - id: 唯一标识（如 "evolution_iron"）
   - trigger.keywords: 触发关键词列表（AI叙事或玩家行动中自然出现这些词时触发，如"冶炼""锻造""发电"）
   - afterRounds（可选）: 强制触发的轮次下限。设置后，到达该轮次即强制解锁（即使关键词未命中），用于"到后期必然出现 X 资源"。建议为后期阶段设置，保证技术进步的确定性。
   - add: 新增的资源列表（与初始资源格式相同）
   - remove: 需要淘汰的资源 id 列表（可选，留空表示不淘汰任何旧资源）
   - narrateHint: 叙事提示（一句话，告诉AI解锁时如何渲染）

   设计要点：
   - 演化应反映世界观的技术/文明进步（如石器→铁器→工业）
   - 新资源的 max 应高于旧资源（体现进步）
   - 旧资源淘汰要合理（如铁矿出现后石头不再是核心资源）
   - 关键词应该是玩家行动中自然会出现的词（如"冶炼""锻造""发电"）

输出JSON：
{
  "description": "一句话描述",
  "resources": [
    {
      "id": "water", "name": "淡水", "symbol": "💧",
      "amount": 6, "max": 10, "scarce": false,
      "gatherRate": "河边每天可取3桶水",
      "usage": "每人每天需要1份饮用水",
      "description": "生存必需品，用于饮用和烹饪。"
    },
    {
      "id": "wood", "name": "木材", "symbol": "🪵",
      "amount": 4, "max": 12, "scarce": false,
      "gatherRate": "森林中每天可采集3-4根",
      "usage": "用于生火、建造和制作工具",
      "description": "最基础的建材和燃料。"
    },
    {
      "id": "herb", "name": "药草", "symbol": "🌿",
      "amount": 2, "max": 15, "scarce": true,
      "gatherRate": "山林中偶有发现，每天约1-2株",
      "usage": "受伤或生病时使用，每次1株",
      "description": "稀有的野生草药，可治疗伤口和疾病。"
    }
  ],
  "rules": {
    "cycleName": "一天",
    "consumePerCycle": "每人每天消耗1份口粮+1份饮用水",
    "criticalThreshold": 2
  },
  "consumption": {
    "perCycle": { "food": 1, "water": 1 },
    "exhaustionPenalty": { "体力值": 5 }
  },
  "resourceEvolution": [
    {
      "id": "evolution_iron",
      "trigger": { "keywords": ["冶炼", "熔炉", "铁矿", "锻造"] },
      "add": [
        {
          "id": "iron", "name": "铁矿", "symbol": "⚙️",
          "amount": 0, "max": 20, "scarce": true,
          "gatherRate": "矿洞中每天可采集2-3块矿石",
          "usage": "用于锻造工具和武器",
          "description": "比石头更坚固的金属原料。"
        }
      ],
      "remove": [],
      "narrateHint": "你发现了铁矿脉，金属时代的大门正在打开"
    },
    {
      "id": "evolution_industry",
      "trigger": { "keywords": ["工厂", "机械", "蒸汽", "电力"] },
      "add": [
        {
          "id": "steel", "name": "钢材", "symbol": "🔩",
          "amount": 0, "max": 30, "scarce": false,
          "gatherRate": "工厂每天可冶炼5单位钢材",
          "usage": "高级建造和机械制造的核心材料",
          "description": "工业时代的命脉。"
        }
      ],
      "remove": ["stone"],
      "narrateHint": "工厂的烟囱开始冒烟，工业革命悄然来临"
    }
  ]
}`;
}

/** 运行时 UpdateVariable 规则 */
export const SURVIVAL_UPDATE_RULES = `【生存资源更新规则】

当资源数量发生变化时，通过 UpdateVariable 更新：
{"玩家":{"生存资源":{"资源id":{"数量":新数量}}}}

规则：
- 只输出发生变化的资源，未变化的不要输出
- 数量不能为负数
- 多个资源同时变化时，放在同一个对象中
- 示例：食物消耗1、木材采集3 → {"玩家":{"生存资源":{"food":{"数量":5},"wood":{"数量":8}}}}

【动态资源发现】
当叙事中出现全新的资源类型时，可以通过 UpdateVariable 直接创建：
{"玩家":{"生存资源":{"新资源id":{"数量":初始数量}}}}
注意：只有在演化蓝图中未覆盖的资源才用此方式创建。蓝图内的资源由演化系统自动处理。

危机触发：
- 当任何资源数量过低时，应在叙事中体现危机感
- 资源耗尽时，必须触发严重后果（受伤、虚弱、死亡威胁等）`;

/** 动态配方生成（游戏中玩家触发） */
export function buildRecipeGenPrompt(params: {
  currentResources: Array<{ id: string; name: string; amount: number; max: number }>;
  playerRequest: string;
  worldTheme: string;
}): string {
  const resList = params.currentResources.map(r => `${r.name}(${r.id}): ${r.amount}/${r.max}`).join('\n');
  const idList = params.currentResources.map(r => r.id).join(', ');

  return `你是生存世界的配方生成系统。玩家想要制作一样东西，你需要生成一个合理的配方。

【当前世界】${params.worldTheme}

【已有资源（名称(id): 当前/上限）】
${resList}

【可用资源 id 列表】${idList}

【玩家需求】
${params.playerRequest}

【规则】
- inputs 的 key 必须从【可用资源 id 列表】中选择，严禁使用未列出的 id
- output.resourceId 也必须从【可用资源 id 列表】中选择，严禁创建列表中不存在的新资源 id
  （即：配方只能把已有资源加工/组合成另一个已有资源，不能凭空造出尚未出现在世界中的资源）
- 如果玩家想要的产品（如"蒸汽机"）不在列表中，请勿编造新 id；
  请改为在列表中寻找已存在的、最贴近的可制作资源来设计配方；
  若实在无法对应，可把某基础资源加工为列表中另一已存在的资源
  （例如 木头+火石→木炭，前提是"木炭"也已在列表中）
- amount 必须是正数
- 材料消耗要合理（不能太贵也不能太便宜）

输出JSON（单个配方对象，只输出 JSON，不要其他解释）：
{
  "id": "recipe_英文标识",
  "name": "配方名称",
  "inputs": {"已有资源id": 数量},
  "output": {"resourceId": "产品id", "amount": 产品数量},
  "description": "制作说明（一句话）"
}`;
}
