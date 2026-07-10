// 选择式世界生成管线 — 2次调用版本
// 第1次：生成所有维度的选项（粗纲）
// 第2次：根据选择生成完整世界（细纲）
// ============================================================

import type { WorldBookEntryDef, WorldDef, WorldModule } from '../../data/worlds-schema';
import { executeBuildPipeline } from '../../modules/buildPipeline';
import { createBuildContext } from '../../modules/buildContext';
import type { CallAI } from '../types';
import type { DimensionGeneration, DimensionSelection } from './types';

// ── JSON 提取工具 ──
function extractJSON(text: string): string {
  const codeBlockMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = codeBlockMatch ? codeBlockMatch[1].trim() : (text.match(/(\{[\s\S]*\})/)?.[1]?.trim() ?? text.trim());
  return raw.replace(/[""]/g, '"').replace(/['']/g, "'");
}

/**
 * 第2次调用：根据用户选择生成完整世界数据
 * 返回 WorldDef + WorldBookEntryDef[]
 */
export async function generateWorldFromSelections(
  userDesc: string,
  selections: DimensionSelection[],
  callAI: CallAI,
): Promise<{ worldDef: Partial<WorldDef>; worldBookEntries: WorldBookEntryDef[] }> {
  const selectionSummary = selections
    .map(s => {
      if (s.choices && s.choices.length > 1) {
        // 多选维度，显示所有选择
        const choicesDesc = s.choices.map(c => `${c.title}（${c.subtitle}）`).join('、');
        return `【${s.dimensionLabel}】${choicesDesc}`;
      }
      // 单选维度
      return `【${s.dimensionLabel}】${s.choice.title}：${s.choice.subtitle}`;
    })
    .join('\n');

  const prompt = `你是一个世界构建专家。用户想要创建一个世界：
"${userDesc}"

用户已做出以下选择：
${selectionSummary}

请根据以上信息生成一个完整的世界设定。

【数量要求】
- locations：必须生成 3-5 个地理区域，覆盖世界的不同地形特征（如：主城、荒野、山脉、海域、特殊区域等）
- factions：必须生成 3-4 个势力，alignment 分布至少包含1个 friendly、1个 neutral、1个 hostile
- npcs：必须生成 4-5 个关键NPC，角色定位覆盖：导师/盟友/对手/神秘人/商人/信息提供者等

【字数要求】
- 区域/势力/NPC 的 description 字段：60-100字，内容要详细具体

返回严格的JSON格式，不要有任何其他文字：

{
  "name": "世界名称（2-6个字，有创意）",
  "description": "一句话描述（15-30字）",
  "icon": "一个lucide图标名（如 Globe, Flame, Mountain, Ship, Rocket, Star, Ghost, Crown, Skull, Gem 等）",
  "tags": ["标签1", "标签2", "标签3"],
  "difficulty": "easy/medium/hard",
  "overview": "世界观概述（100-200字，描述这个世界的整体面貌）",
  "atmosphere": "氛围关键词（如 阴暗压抑、轻松明快、史诗壮阔）",
  "timePeriod": "时代背景（如 远古、中世纪、近未来）",
  "locations": [
    { "name": "区域名", "description": "60-100字：地理特征、重要地标、居民特点、氛围、潜在危险或机遇" }
  ],
  "factions": [
    { "name": "势力名", "description": "60-100字：势力背景历史、核心理念、行事风格、势力范围、与其他势力的关系", "alignment": "friendly/neutral/hostile" }
  ],
  "npcs": [
    { "name": "NPC名", "role": "角色定位", "description": "60-100字：外貌特征、性格特点、背景故事、能力专长、与玩家的潜在关系", "personality": "2-4个性格标签" }
  ],
  "culture": "文化风俗描述（80-120字，包含信仰体系、重要习俗、社会禁忌、节日庆典等）",
  "economy": {
    "currencyName": "货币名",
    "currencySymbol": "货币符号",
    "currencyDesc": "货币描述（30-50字，包含货币来源、流通范围、价值特点）",
    "priceLevel": "物价水平描述（30-50字，包含不同阶层的消费水平、稀缺物资价格）"
  },
  "rules": {
    "powerSystem": "力量/权力体系名称",
    "socialStructure": "社会结构描述（50-80字，包含阶层划分、晋升途径、社会流动性）",
    "specialRules": ["特殊规则1（30-50字）", "特殊规则2（30-50字）"]
  },
  "highlights": ["核心特色1（20-30字）", "核心特色2（20-30字）", "核心特色3（20-30字）"]
}`;

  const raw = await callAI([{ role: 'user', content: prompt }]);
  const data = JSON.parse(extractJSON(raw));

  // 组装 WorldDef
  const worldDef: Partial<WorldDef> = {
    name: data.name || '未命名世界',
    description: data.description || '',
    icon: data.icon || 'Globe',
    tags: Array.isArray(data.tags) ? data.tags : [],
    difficulty: data.difficulty || 'medium',
  };

  // 组装 WorldBookEntryDef[]
  const entries: WorldBookEntryDef[] = [];
  let uid = 1;

  // 1. setting entry
  const worldTypeSel = selections.find(s => s.dimensionKey === 'worldType');
  const toneSel = selections.find(s => s.dimensionKey === 'tone');
  const conflictSel = selections.find(s => s.dimensionKey === 'conflict');
  entries.push({
    uid: uid++, key: [], constant: true, comment: '世界设定',
    content: data.overview || '',
    order: 1, position: 'before_char', entryType: 'setting',
    meta: {
      genre: worldTypeSel?.choice.title,
      atmosphere: data.atmosphere || toneSel?.choice.title,
      timePeriod: data.timePeriod,
      // 将核心冲突信息添加到 meta 中，确保不丢失
      conflict: conflictSel?.choices && conflictSel.choices.length > 1
        ? conflictSel.choices.map(c => `${c.title}：${c.subtitle}`).join('；')
        : conflictSel ? `${conflictSel.choice.title}：${conflictSel.choice.subtitle}` : undefined,
    },
  });

  // 2. lore entries（地理）
  if (Array.isArray(data.locations)) {
    for (const loc of data.locations) {
      entries.push({
        uid: uid++, key: [loc.name], constant: false,
        comment: loc.name, content: loc.description || '',
        order: 2, position: 'before_char', entryType: 'lore',
      });
    }
  }

  // 3. factions entries（每个势力独立条目，关键词触发）
  if (Array.isArray(data.factions) && data.factions.length > 0) {
    for (const faction of data.factions) {
      entries.push({
        uid: uid++, key: [faction.name], constant: false, comment: faction.name,
        content: `${faction.name}：${faction.description}`,
        order: 3, position: 'before_char', entryType: 'factions',
        meta: { factions: [faction] },
      });
    }
  }

  // 4. culture entry
  if (data.culture) {
    entries.push({
      uid: uid++, key: ['文化', '风俗'], constant: false,
      comment: '文化风俗', content: data.culture,
      order: 4, position: 'before_char', entryType: 'culture',
    });
  }

  // 5. economy entry
  if (data.economy) {
    const eco = data.economy;
    entries.push({
      uid: uid++, key: ['货币', '经济', '消费'], constant: false,
      comment: '经济系统',
      content: [eco.currencyName, eco.currencyDesc].filter(Boolean).join('：'),
      order: 5, position: 'before_char', entryType: 'economy',
      meta: {
        currency: { name: eco.currencyName, symbol: eco.currencySymbol, description: eco.currencyDesc },
        priceLevel: eco.priceLevel,
      },
    });
  }

  // 6. npcs entries（每个NPC独立条目，关键词触发）
  if (Array.isArray(data.npcs) && data.npcs.length > 0) {
    for (const npc of data.npcs) {
      entries.push({
        uid: uid++, key: [npc.name], constant: false, comment: npc.name,
        content: `${npc.name}（${npc.role}）：${npc.description}`,
        order: 6, position: 'before_char', entryType: 'npcs',
        meta: { npcs: [npc] },
      });
    }
  }

  // 7. rules entry
  if (data.rules) {
    entries.push({
      uid: uid++, key: [], constant: true, comment: '世界规则',
      content: [data.rules.powerSystem, data.rules.socialStructure].filter(Boolean).join('\n'),
      order: 7, position: 'before_char', entryType: 'rules',
      meta: {
        powerSystem: data.rules.powerSystem,
        socialStructure: data.rules.socialStructure,
        specialRules: Array.isArray(data.rules?.specialRules) ? data.rules.specialRules : [],
      },
    });
  }

  // 8. highlights entry
  if (Array.isArray(data.highlights) && data.highlights.length > 0) {
    entries.push({
      uid: uid++, key: [], constant: true, comment: '核心特色',
      content: data.highlights.join('、'),
      order: 8, position: 'before_char', entryType: 'highlights',
      meta: { highlights: data.highlights },
    });
  }

  return { worldDef, worldBookEntries: entries };
}

/** 模块ID到中文名称的映射 */
const MODULE_ID_TO_KEY: Record<string, string> = {
  stat: '数值属性', progression: '成长体系', survival: '生存资源',
  business: '经营资产', dice: '骰子检定', talent: '天赋体系',
};

/**
 * 为选中的模块生成世界书条目和模块配置
 */
export async function generateModuleEntries(
  worldDesc: string,
  selectedModules: string[],
  callAI: CallAI,
): Promise<{ modules: WorldModule[]; worldBookEntries: WorldBookEntryDef[] }> {
  if (selectedModules.length === 0) return { modules: [], worldBookEntries: [] };

  const buildCtx = createBuildContext(worldDesc, selectedModules);

  try {
    await executeBuildPipeline(buildCtx, {
      callAI,
      onProgress: () => {},
    });

    // 从管线结果构建 modules 数组
    const modules = selectedModules.map(id => {
      const key = MODULE_ID_TO_KEY[id];
      const pipelineData = key ? buildCtx.result?.[key] : undefined;

      if (pipelineData && typeof pipelineData === 'object' && 'config' in pipelineData) {
        const { config, initialState } = pipelineData as any;
        return {
          moduleId: id,
          name: key || id,
          description: '',
          enabled: true,
          moduleConfig: config,
          ...(initialState ? { initialState } : {}),
        };
      }

      // 兜底
      return {
        moduleId: id,
        name: key || id,
        description: '',
        enabled: true,
      };
    }) as WorldModule[];

    // 提取模块生成的世界书条目
    // 叙事条目用正数 uid (1, 2, 3...)，模块规则用负数 uid，从 -1 开始递减避免冲突
    const worldBookEntries = (buildCtx.worldBookEntries ?? []).map((e, i) => ({
      ...e,
      uid: -1 - i,
      entryType: 'module_rule' as const,
    }));

    return { modules, worldBookEntries };
  } catch (err) {
    console.warn('[generateModuleEntries] 模块管线失败:', err);
    return {
      modules: selectedModules.map(id => ({
        moduleId: id,
        name: MODULE_ID_TO_KEY[id] || id,
        description: '',
        enabled: true,
      })) as WorldModule[],
      worldBookEntries: [],
    };
  }
}
