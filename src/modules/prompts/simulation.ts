// 世界演化规则模块 — Prompt 模板

/**
 * 生成世界演化规则的提示词
 * 根据已启用的模块，生成对应的事件效果和周期性事件
 */
export function buildSimulationRulesPrompt(params: {
  theme: string;
  tone: string;
  enabledModules: string[];
  resourceIds: string[];      // 生存资源的 id 列表
  assetTypes: string[];       // 经营资产的类型列表
  statIds: string[];          // 数值属性的 id 列表
}): string {
  const { theme, tone, enabledModules, resourceIds, assetTypes, statIds } = params;

  // 构建模块特定的指导
  const moduleGuidance: string[] = [];

  if (enabledModules.includes('survival') && resourceIds.length > 0) {
    moduleGuidance.push(`
【生存资源联动】
可用资源 ID：${resourceIds.join(', ')}
- 事件可以增减资源数量（如：发现水源→water+3，遭遇掠夺→food-2）
- delta 表示增减量（正数增加，负数减少）
- min 表示资源下限（通常为 0，防止负数）
- 示例：{ "survival": { "resources": { "water": { "delta": 3, "min": 0 } } } }

【资源动态演化】
- 事件可以添加新资源（如：发现铁矿→addResources）
- 事件可以移除旧资源（如：资源枯竭→removeResources）
- 事件可以修改资源属性（如：稀缺度变化→updateResources）
- addResources 示例：{ "survival": { "addResources": [{ "id": "iron", "name": "铁矿", "symbol": "⚙️", "amount": 0, "max": 20, "scarce": true }] } }
- removeResources 示例：{ "survival": { "removeResources": [{ "id": "stone" }] } }
- 注意：如果世界有资源演化蓝图（resourceEvolution），演化资源应使用蓝图中定义的数据，不要重复创建`);
  }

  if (enabledModules.includes('business') && assetTypes.length > 0) {
    moduleGuidance.push(`
【经营资产联动】
可用资产类型：${assetTypes.join(', ')}
- 事件可以影响资金（fundsDelta）
- 示例：{ "business": { "fundsDelta": 100 } }`);
  }

  if (enabledModules.includes('stat') && statIds.length > 0) {
    moduleGuidance.push(`
【数值属性联动】
可用属性 ID：${statIds.join(', ')}
- 事件可以影响属性值（如：战斗→hp-10，修炼→mp+5）
- delta 表示增减量
- min 表示属性下限（通常为 0）
- 示例：{ "stats": { "changes": { "hp": { "delta": -10, "min": 0 } } } }`);
  }

  if (enabledModules.includes('progression')) {
    moduleGuidance.push(`
【成长体系联动】
- 事件可以提供经验值（xpDelta）
- 示例：{ "progression": { "xpDelta": 50 } }`);
  }

  const moduleGuidanceText = moduleGuidance.join('\n');

  return `为以下世界设计演化规则：

世界主题：${theme}
基调：${tone}
已启用模块：${enabledModules.join(', ') || '无'}

【设计原则】
- 世界演化规则定义了"事件如何影响游戏变量"
- 分为两类：事件效果（eventEffects）和周期性事件（periodicEvents）
- 事件效果：当世界事件发生时，自动触发的变量变化
- 周期性事件：每隔固定轮次自动触发的事件（如尸潮、季节变化）
- 规则是确定性的，不经过 AI，直接由引擎结算

${moduleGuidanceText}

【事件效果设计指南】

● 事件效果（eventEffects）：
  - id: 唯一标识
  - priority: 优先级（数字大者先匹配）
  - stackStrategy: 命中多条时的合并策略（add=累加, max=取最大, override=覆盖, exclusive=互斥择一）
  - trigger: 触发条件
    - tags: 结构化标签（优先匹配）
    - keywords: 关键词兜底（匹配事件标题和描述）
    - eventLevel: 事件层级（mythic/political/factional/economic/civilian）
    - severityMin: 最低严重度
  - effects: 变量影响（只包含已启用的模块）

● 周期性事件（periodicEvents）：
  - id: 唯一标识
  - name: 事件名称
  - description: 事件描述
  - intervalTicks: 触发间隔（轮次）
  - offsetTicks: 首次触发偏移（避免所有周期事件同轮爆发）
  - effects: 变量影响
  - narrateToAI: 结算后是否喂给 AI 做叙事渲染

【数值设计指南】

● 紧张节奏（末日/荒岛）：
  - 周期事件间隔：10-20轮
  - 资源消耗：2-5单位/次
  - 属性损耗：10-20点/次

● 中等节奏（奇幻/武侠）：
  - 周期事件间隔：20-40轮
  - 资源消耗：1-3单位/次
  - 属性损耗：5-15点/次

● 宽松节奏（日常/经营）：
  - 周期事件间隔：30-60轮
  - 资源消耗：0-2单位/次
  - 属性损耗：0-10点/次

【必须生成以下内容】

1. 事件效果列表（3-8个）：
   - 覆盖常见的事件类型（战斗、贸易、发现、灾害、机遇等）
   - 每个效果都有明确的触发条件和变量影响

2. 周期性事件列表（0-3个）：
   - 如果世界设定中有周期性威胁或事件，定义它们
   - 如果没有，可以为空数组

3. 世界状态轴定义（可选）：
   - 定义这个世界有哪些状态维度（如：社会环境、威胁态势）
   - 每个维度有哪些字段

4. 叙事层护栏：
   - AI 单次声明各属性/资源的最大变动幅度
   - 防止 AI 乱改数值

请以 JSON 格式输出，结构如下：
{
  "eventEffects": [...],
  "periodicEvents": [...],
  "worldStateAxes": { "轴名": ["字段1", "字段2"] },
  "narrativeGuardrails": {
    "maxDeltaPerStat": { "属性id": 最大变动值 },
    "maxDeltaPerResource": { "资源id": 最大变动值 },
    "setAllowedVars": []
  }
}`;
}

/**
 * 校验 AI 生成的 SimulationRules
 * @returns { valid: boolean, errors: string[], rules: SimulationRules | null }
 */
export function validateSimulationRules(
  raw: unknown,
  enabledModules: string[],
  resourceIds: string[],
  statIds: string[],
): { valid: boolean; errors: string[]; rules: import('../schema').SimulationRules | null } {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['输出不是对象'], rules: null };
  }

  const data = raw as Record<string, unknown>;

  // 校验 eventEffects
  if (!Array.isArray(data.eventEffects)) {
    errors.push('eventEffects 不是数组');
  } else {
    for (let i = 0; i < data.eventEffects.length; i++) {
      const effect = data.eventEffects[i] as Record<string, unknown>;
      if (!effect.id) errors.push(`eventEffects[${i}].id 缺失`);
      if (typeof effect.priority !== 'number') errors.push(`eventEffects[${i}].priority 不是数字`);
      if (!effect.trigger) errors.push(`eventEffects[${i}].trigger 缺失`);
      if (!effect.effects) errors.push(`eventEffects[${i}].effects 缺失`);
    }
  }

  // 校验 periodicEvents
  if (!Array.isArray(data.periodicEvents)) {
    errors.push('periodicEvents 不是数组');
  } else {
    for (let i = 0; i < data.periodicEvents.length; i++) {
      const event = data.periodicEvents[i] as Record<string, unknown>;
      if (!event.id) errors.push(`periodicEvents[${i}].id 缺失`);
      if (!event.name) errors.push(`periodicEvents[${i}].name 缺失`);
      if (typeof event.intervalTicks !== 'number') errors.push(`periodicEvents[${i}].intervalTicks 不是数字`);
      if (!event.effects) errors.push(`periodicEvents[${i}].effects 缺失`);
    }
  }

  // 校验 narrativeGuardrails
  if (!data.narrativeGuardrails || typeof data.narrativeGuardrails !== 'object') {
    errors.push('narrativeGuardrails 缺失或不是对象');
  }

  if (errors.length > 0) {
    return { valid: false, errors, rules: null };
  }

  // ── 增强校验：清理引用了不存在 id 的 effects ──
  const resourceSet = new Set(resourceIds);
  const statSet = new Set(statIds);

  // 清理 eventEffects 中引用不存在 id 的字段
  const cleanedEventEffects = ((data.eventEffects as import('../schema').EventEffect[]) || [])
    .map(effect => {
      const cleaned = { ...effect, effects: { ...effect.effects } };

      if (cleaned.effects.survival?.resources) {
        const validResources: Record<string, any> = {};
        for (const [id, val] of Object.entries(cleaned.effects.survival.resources)) {
          if (resourceSet.has(id)) {
            validResources[id] = val;
          } else {
            console.warn(`[validateSimulationRules] eventEffect "${effect.id}" 引用了未知资源 id: ${id}，已剔除`);
          }
        }
        cleaned.effects.survival = { ...cleaned.effects.survival, resources: validResources };
      }

      if (cleaned.effects.stats?.changes) {
        const validStats: Record<string, any> = {};
        for (const [id, val] of Object.entries(cleaned.effects.stats.changes)) {
          if (statSet.has(id)) {
            validStats[id] = val;
          } else {
            console.warn(`[validateSimulationRules] eventEffect "${effect.id}" 引用了未知属性 id: ${id}，已剔除`);
          }
        }
        cleaned.effects.stats = { changes: validStats };
      }

      return cleaned;
    });

  // 清理 periodicEvents 中引用不存在 id 的字段
  const cleanedPeriodicEvents = ((data.periodicEvents as import('../schema').PeriodicEvent[]) || [])
    .map(event => {
      const cleaned = { ...event, effects: { ...event.effects } };

      if (cleaned.effects.survival?.resources) {
        const validResources: Record<string, any> = {};
        for (const [id, val] of Object.entries(cleaned.effects.survival.resources)) {
          if (resourceSet.has(id)) {
            validResources[id] = val;
          } else {
            console.warn(`[validateSimulationRules] periodicEvent "${event.id}" 引用了未知资源 id: ${id}，已剔除`);
          }
        }
        cleaned.effects.survival = { resources: validResources };
      }

      if (cleaned.effects.stats?.changes) {
        const validStats: Record<string, any> = {};
        for (const [id, val] of Object.entries(cleaned.effects.stats.changes)) {
          if (statSet.has(id)) {
            validStats[id] = val;
          } else {
            console.warn(`[validateSimulationRules] periodicEvent "${event.id}" 引用了未知属性 id: ${id}，已剔除`);
          }
        }
        cleaned.effects.stats = { changes: validStats };
      }

      return cleaned;
    });

  // 构建完整的 SimulationRules
  const rules: import('../schema').SimulationRules = {
    eventEffects: cleanedEventEffects,
    periodicEvents: cleanedPeriodicEvents,
    worldStateRules: [],
    worldStateAxes: (data.worldStateAxes as Record<string, string[]>) || {},
    narrativeGuardrails: (data.narrativeGuardrails as import('../schema').NarrativeGuardrails) || {
      maxDeltaPerStat: {},
      maxDeltaPerResource: {},
      setAllowedVars: [],
    },
  };

  return { valid: true, errors: [], rules };
}
