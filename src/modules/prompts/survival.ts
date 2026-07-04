// 生存资源模块 — Prompt 模板

/** 阶段：生存资源生成 */
export function buildSurvivalGenPrompt(params: {
  theme: string;
  tone: string;
}): string {
  return `为以下世界设计生存资源系统：

世界主题：${params.theme}
基调：${params.tone}

【设计原则】
- 生存资源是这个世界的核心挑战，资源获取和消耗是叙事驱动力
- 3-6种核心资源，不能太多（控制复杂度）
- 至少1种稀缺资源（标记 scarce: true），稀缺资源是生存压力的来源
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

2. 资源列表（3-6种）：
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
  }
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
- output 是制作出来的产品
- 如果产品是对已有资源的加工（如：木材→木板），output.resourceId 也必须使用已有资源的 id
- 如果产品是新物品，resourceId 用英文小写下划线命名（如：stone_axe, purified_water）
- amount 必须是正数
- 材料消耗要合理（不能太贵也不能太便宜）
- 如果玩家需求不合理，可以生成一个近似的合理配方

输出JSON（单个配方对象，只输出 JSON，不要其他解释）：
{
  "id": "recipe_英文标识",
  "name": "配方名称",
  "inputs": {"已有资源id": 数量},
  "output": {"resourceId": "产品id", "amount": 产品数量},
  "description": "制作说明（一句话）"
}`;
}
