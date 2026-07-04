// ============================================================
//  世界模块化系统 v2 — 管线执行器
//  用于多步骤世界创建管线（主题提取 → 顺序生成 → 世界书生成 → 合成验证）
//
//  依赖关系：
//  - 数值系统：独立存在
//  - 成长系统：依赖数值系统（需要知道属性名称、范围）
//  - 生存系统：与数值/成长/天赋互斥
//  - 经营系统：可与任何模块共存
// ============================================================

import type { BuildContext, StatConfig, StatState, ProgressionConfig, SurvivalConfig, BusinessConfig } from './buildContext';
import type { WorldBookEntryDef } from '../data/worlds-schema';
import type { StatModuleSchema, ProgressionModuleSchema, SurvivalModuleSchema, BusinessModuleSchema, TalentModuleSchema } from './schema';
import {
  buildStatThemePrompt,
  buildStatGenPrompt,
  buildProgressionGenPrompt,
  buildSurvivalGenPrompt,
  buildBusinessGenPrompt,
  buildTalentGenPrompt,
  STAT_UPDATE_RULES,
  PROGRESSION_UPDATE_RULES,
  SURVIVAL_UPDATE_RULES,
  DICE_RULES_PROMPT,
  DICE_UPDATE_RULES,
  TALENT_RULES_PROMPT,
  TALENT_UPDATE_RULES,
} from './prompts';
import { waitForRateLimit } from '../api/rateLimiter';
import { buildSpecialConfig } from './normalizeModule';

export interface PipelineConfig {
  /** AI 调用函数（由外部注入，解耦API层） */
  callAI: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  /** 进度回调 */
  onProgress?: (stage: string, detail: string) => void;
}

/**
 * 执行世界创建管线
 *
 * 阶段1: 主题提取 → WorldTheme
 * 阶段2: 顺序生成（属性 → 成长 → 资源），避免并发触发429
 * 阶段3: 世界书条目生成（蓝灯/绿灯）
 * 阶段4: 合成验证（分离配置和状态）
 */
export async function executeBuildPipeline(
  ctx: BuildContext,
  config: PipelineConfig
): Promise<BuildContext> {
  const { callAI, onProgress } = config;
  const hasModule = (id: string) => ctx.selectedModules.includes(id);

  // ─── 阶段1：主题提取 ───
  // 如果选了成长模块但没选属性模块，自动启用属性模块（成长依赖属性）
  if (hasModule('progression') && !hasModule('stat')) {
    ctx.selectedModules.push('stat');
  }

  if (hasModule('stat')) {
    onProgress?.('阶段1', '提取世界主题与属性命名...');
    const themePrompt = buildStatThemePrompt(ctx.description);
    try {
      const themeRaw = await callAI([{ role: 'user', content: themePrompt }]);
      const themeData = JSON.parse(extractJSON(themeRaw));
      ctx.theme = {
        theme: themeData.theme || '',
        tone: themeData.tone || '中等',
        era: themeData.era || '现代',
        attrAName: themeData.attrAName || '生命',
        attrBName: themeData.attrBName || '能量',
        dim1Name: themeData.dim1Name || '攻击',
        dim2Name: themeData.dim2Name || '防御',
        dim3Name: themeData.dim3Name || '速度',
        dim4Name: themeData.dim4Name || '智力',
        dim5Name: themeData.dim5Name || '魅力',
        dim6Name: themeData.dim6Name || '幸运',
      };
    } catch (err: unknown) {
      console.warn('[BuildPipeline] 主题提取失败，使用默认命名:', err instanceof Error ? err.message : String(err));
      // JSON解析失败，使用默认命名
      ctx.theme = {
        theme: '通用',
        tone: '中等',
        era: '现代',
        attrAName: '生命', attrBName: '能量',
        dim1Name: '攻击', dim2Name: '防御', dim3Name: '速度',
        dim4Name: '智力', dim5Name: '魅力', dim6Name: '幸运',
      };
    }
  }

  await waitForRateLimit();

  // ─── 阶段2：顺序生成（避免并发触发429） ───

  // 2a. 生成属性系统（如果选了）
  if (hasModule('stat') && ctx.theme) {
    await waitForRateLimit();
    onProgress?.('阶段2', '生成属性系统...');
    const statPrompt = buildStatGenPrompt({
      theme: ctx.theme.theme,
      attrAName: ctx.theme.attrAName,
      attrBName: ctx.theme.attrBName,
      dim1Name: ctx.theme.dim1Name,
      dim2Name: ctx.theme.dim2Name,
      dim3Name: ctx.theme.dim3Name,
      dim4Name: ctx.theme.dim4Name,
      dim5Name: ctx.theme.dim5Name,
      dim6Name: ctx.theme.dim6Name,
    });
    try {
      const statRaw = await callAI([{ role: 'user', content: statPrompt }]);
      ctx.statData = JSON.parse(extractJSON(statRaw)) as StatModuleSchema;
      if (ctx.statData) {
        ctx.statConfig = extractStatConfig(ctx.statData);
        ctx.statState = extractStatState(ctx.statData);
      }
    } catch (err: unknown) {
      console.error('[BuildPipeline] 属性系统生成失败:', err instanceof Error ? err.message : String(err));
      onProgress?.('阶段2', '⚠ 属性系统生成失败，将使用默认值');
    }
  }

  // 2b. 生成成长体系（如果选了，依赖属性数据）
  if (hasModule('progression') && ctx.theme) {
    await waitForRateLimit();
    onProgress?.('阶段2', '生成成长体系...');
    const progPrompt = buildProgressionGenPrompt({
      theme: ctx.theme.theme,
      tone: ctx.theme.tone,
      era: ctx.theme.era,
    });
    try {
      const progRaw = await callAI([{ role: 'user', content: progPrompt }]);
      ctx.progressionData = JSON.parse(extractJSON(progRaw)) as ProgressionModuleSchema;
      if (ctx.progressionData) {
        ctx.progressionConfig = extractProgressionConfig(ctx.progressionData);
      }
    } catch (err: unknown) {
      console.error('[BuildPipeline] 成长体系生成失败:', err instanceof Error ? err.message : String(err));
      onProgress?.('阶段2', '⚠ 成长体系生成失败，将使用默认值');
    }
  }

  // 2c. 生成生存资源系统
  if (hasModule('survival')) {
    await waitForRateLimit();
    onProgress?.('阶段2', '生成生存资源系统...');
    const survivalTheme = ctx.theme?.theme || ctx.description.substring(0, 100);
    const survivalTone = ctx.theme?.tone || '中等';
    const userDesc = ctx.survivalUserDesc ? `\n\n用户对生存资源的具体要求：${ctx.survivalUserDesc}` : '';
    const survPrompt = buildSurvivalGenPrompt({ theme: survivalTheme, tone: survivalTone }) + userDesc;
    try {
      const survRaw = await callAI([{ role: 'user', content: survPrompt }]);
      ctx.survivalData = JSON.parse(extractJSON(survRaw)) as SurvivalModuleSchema;
      if (ctx.survivalData) {
        ctx.survivalConfig = extractSurvivalConfig(ctx.survivalData);
      }
    } catch (err: unknown) {
      console.error('[BuildPipeline] 生存资源系统生成失败:', err instanceof Error ? err.message : String(err));
    }
  }

  // 2d. 生成经营资产系统
  if (hasModule('business')) {
    await waitForRateLimit();
    onProgress?.('阶段2', '生成经营资产系统...');
    const businessTheme = ctx.theme?.theme || ctx.description.substring(0, 100);
    const businessTone = ctx.theme?.tone || '中等';
    const bizPrompt = buildBusinessGenPrompt({ theme: businessTheme, tone: businessTone, userDesc: ctx.businessUserDesc });
    try {
      const bizRaw = await callAI([{ role: 'user', content: bizPrompt }]);
      ctx.businessData = JSON.parse(extractJSON(bizRaw)) as BusinessModuleSchema;
      if (ctx.businessData) {
        ctx.businessConfig = extractBusinessConfig(ctx.businessData);
      }
    } catch (err: unknown) {
      console.error('[BuildPipeline] 经营资产系统生成失败:', err instanceof Error ? err.message : String(err));
    }
  }

  // 2e. 生成天赋体系
  if (hasModule('talent')) {
    await waitForRateLimit();
    onProgress?.('阶段2', '生成天赋体系...');
    const talentTheme = ctx.theme?.theme || ctx.description.substring(0, 100);
    const talentTone = ctx.theme?.tone || '中等';
    const talentEra = ctx.theme?.era || '现代';
    const talentPrompt = buildTalentGenPrompt({
      theme: talentTheme,
      tone: talentTone,
      era: talentEra,
      existingCategories: [],
      count: 5,
    });
    try {
      const talentRaw = await callAI([{ role: 'user', content: talentPrompt }]);
      ctx.talentData = JSON.parse(extractJSON(talentRaw)) as TalentModuleSchema;
    } catch (err: unknown) {
      console.error('[BuildPipeline] 天赋体系生成失败:', err instanceof Error ? err.message : String(err));
    }
  }

  // ─── 阶段3：生成世界书条目（蓝灯/绿灯） ───
  onProgress?.('阶段3', '生成世界书条目...');
  ctx.worldBookEntries = generateWorldBookEntries(ctx);

  // ─── 阶段4：合成验证 ───
  onProgress?.('阶段4', '合成验证...');
  ctx.result = synthesizeResult(ctx);

  return ctx;
}

/** 从AI回复中提取JSON字符串 */
function extractJSON(text: string): string {
  // 修复中文引号（某些 API 会返回全角引号）
  const fixed = text.replace(/[""]/g, '"').replace(/['']/g, "'");

  // 1. 优先匹配 markdown code block
  const codeBlockMatch = fixed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlockMatch) return repairJSON(codeBlockMatch[1].trim());

  // 2. 匹配最外层的 { ... } 对象（支持嵌套）
  const firstBrace = fixed.indexOf('{');
  const lastBrace = fixed.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    return repairJSON(fixed.slice(firstBrace, lastBrace + 1).trim());
  }

  // 3. 兜底：返回原始文本
  console.warn('[extractJSON] 未找到有效 JSON，返回原始文本前200字符:', fixed.slice(0, 200));
  return repairJSON(fixed.trim());
}

/**
 * 修复 AI 生成的常见 JSON 格式问题：
 * - 尾部逗号（trailing commas）
 * - 截断的 JSON（括号不匹配）
 */
function repairJSON(json: string): string {
  let s = json;

  // 去掉尾部逗号：,} -> }  ,] -> ]
  s = s.replace(/,s*([}]])/g, '$1');

  // 如果字符串中有未闭合的引号，先截断到最后一个完整值
  let inString = false;
  let escaped = false;
  let lastValidPos = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (!inString && (ch === '}' || ch === ']')) {
      lastValidPos = i;
    }
  }

  // 如果检测到未闭合字符串，截断到最近的完整 } 或 ]
  if (inString && lastValidPos > 0) {
    s = s.slice(0, lastValidPos + 1);
  }

  // 重新计算括号差，补齐缺失的闭合括号
  const openBrace = (s.match(/{/g) || []).length;
  const closeBrace = (s.match(/}/g) || []).length;
  const openBracket = (s.match(/\[/g) || []).length;
  const closeBracket = (s.match(/]/g) || []).length;

  s += ']'.repeat(Math.max(0, openBracket - closeBracket));
  s += '}'.repeat(Math.max(0, openBrace - closeBrace));

  // 再次去掉可能产生的尾部逗号
  s = s.replace(/,s*([}]])/g, '$1');

  return s;
}

/** 安全数值转换，防止 NaN 传播 */
function safeNum(value: unknown, fallback: number): number {
  const num = Number(value);
  return Number.isFinite(num) ? num : fallback;
}

/**
 * 从数值属性原始数据中提取配置（静态部分）
 */
function extractStatConfig(statData: StatModuleSchema): StatConfig {
  const dimDefaults = [
    { name: '属性1', range: [0, 100] as [number, number] },
    { name: '属性2', range: [0, 100] as [number, number] },
    { name: '属性3', range: [0, 100] as [number, number] },
    { name: '属性4', range: [0, 100] as [number, number] },
    { name: '属性5', range: [0, 100] as [number, number] },
    { name: '属性6', range: [0, 100] as [number, number] },
  ];
  const dims = [statData.dim1, statData.dim2, statData.dim3, statData.dim4, statData.dim5, statData.dim6];
  return {
    attrA: { name: statData.attrA?.name || '生命', max: safeNum(statData.attrA?.max, 100) },
    attrB: { name: statData.attrB?.name || '能量', max: safeNum(statData.attrB?.max, 100) },
    dim1: dims[0] ? { name: dims[0].name, range: dims[0].range } : dimDefaults[0],
    dim2: dims[1] ? { name: dims[1].name, range: dims[1].range } : dimDefaults[1],
    dim3: dims[2] ? { name: dims[2].name, range: dims[2].range } : dimDefaults[2],
    dim4: dims[3] ? { name: dims[3].name, range: dims[3].range } : dimDefaults[3],
    dim5: dims[4] ? { name: dims[4].name, range: dims[4].range } : dimDefaults[4],
    dim6: dims[5] ? { name: dims[5].name, range: dims[5].range } : dimDefaults[5],
    special: buildSpecialConfig(statData.special),
  };
}

/**
 * 从数值属性原始数据中提取状态（动态部分）
 */
function extractStatState(statData: StatModuleSchema): StatState {
  const specialState: Record<string, number> = {};
  if (Array.isArray(statData.special)) {
    for (const s of statData.special) {
      if (s && s.id) {
        specialState[s.id] = safeNum(s.value, 0);
      }
    }
  }
  const dims = [statData.dim1, statData.dim2, statData.dim3, statData.dim4, statData.dim5, statData.dim6];
  return {
    attrA: safeNum(statData.attrA?.current, 80),
    attrB: safeNum(statData.attrB?.current, 60),
    dim1: dims[0] ? safeNum(dims[0].value, 50) : 50,
    dim2: dims[1] ? safeNum(dims[1].value, 50) : 50,
    dim3: dims[2] ? safeNum(dims[2].value, 50) : 50,
    dim4: dims[3] ? safeNum(dims[3].value, 50) : 50,
    dim5: dims[4] ? safeNum(dims[4].value, 50) : 50,
    dim6: dims[5] ? safeNum(dims[5].value, 50) : 50,
    special: specialState,
  };
}

/**
 * 从成长体系原始数据中提取配置（静态部分）
 * 注意：状态（当前段位索引、当前经验值）不在这里，存放在变量系统
 */
function extractProgressionConfig(progData: ProgressionModuleSchema): ProgressionConfig {
  const config: ProgressionConfig = {
    mode: progData.mode,
    xpFormula: progData.xpFormula,
  };

  if (progData.mode === 'tiered' && progData.tiers) {
    config.tiers = progData.tiers.map(t => ({
      name: t.name,
      description: t.description,
    }));
  }

  if (progData.mode === 'level' && progData.levelData) {
    config.levelData = {
      maxLevel: progData.levelData.maxLevel,
      baseStats: progData.levelData.baseStats,
      growthPerLevel: progData.levelData.growthPerLevel,
    };
  }

  // 叙事风格（可选）
  if (progData.narrativeStyle) {
    (config as any).narrativeStyle = progData.narrativeStyle;
  }

  return config;
}

/**
 * 从生存资源原始数据中提取配置
 */
function extractSurvivalConfig(survData: SurvivalModuleSchema): SurvivalConfig {
  return {
    description: survData.description,
    resources: Array.isArray(survData.resources) ? survData.resources.map(r => ({
      id: r.id,
      name: r.name,
      symbol: r.symbol,
      amount: r.amount ?? 0,
      max: r.max,
      scarce: r.scarce,
      gatherRate: r.gatherRate,
      usage: r.usage,
      description: r.description,
    })) : [],
    rules: survData.rules || { cycleName: '一天', consumePerCycle: '', criticalThreshold: 2 },
    resourceEvolution: Array.isArray(survData.resourceEvolution) ? survData.resourceEvolution.map(evo => ({
      id: evo.id,
      trigger: { keywords: evo.trigger?.keywords ?? [] },
      add: evo.add?.map(r => ({
        id: r.id, name: r.name, symbol: r.symbol,
        amount: r.amount ?? 0, max: r.max, scarce: r.scarce,
        gatherRate: r.gatherRate, usage: r.usage, description: r.description,
      })),
      remove: evo.remove,
      narrateHint: evo.narrateHint,
    })) : undefined,
  };
}

/**
 * 从经营资产原始数据中提取配置
 */
function extractBusinessConfig(bizData: BusinessModuleSchema): BusinessConfig {
  return {
    description: bizData.description || '',
    funds: bizData.funds ?? 500,
    cycleName: bizData.cycleName || '天',
    assets: Array.isArray(bizData.assets) ? bizData.assets.map(a => ({
      id: a.id,
      name: a.name,
      type: a.type || '',
      level: a.level ?? 1,
      maxLevel: a.maxLevel ?? 3,
      description: a.description || '',
      income: a.income || { base: 0, perLevel: 0, cycle: '天' },
      maintenance: a.maintenance ?? 0,
      upgradeCost: a.upgradeCost,
      staff: a.staff,
      risk: a.risk ? { level: a.risk.level, description: a.risk.description } : undefined,
      status: a.status || 'active',
    })) : [],
    market: bizData.market ? {
      items: bizData.market.items.map(i => ({
        name: i.name,
        basePrice: i.basePrice ?? 0,
        trend: i.trend || 'stable',
        changePercent: i.changePercent ?? 0,
      })),
    } : undefined,
  };
}

/** 合成最终结果（分离配置和状态） */
function synthesizeResult(ctx: BuildContext): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  // 数值属性：配置 + 初始状态
  if (ctx.statConfig && ctx.statState) {
    result.数值属性 = {
      config: ctx.statConfig,
      initialState: ctx.statState,
    };
  } else if (ctx.statData) {
    // 兼容旧格式：直接使用原始数据
    result.数值属性 = ctx.statData;
  }

  // 成长体系：配置 + 初始状态
  if (ctx.progressionConfig) {
    result.成长体系 = {
      config: ctx.progressionConfig,
      initialState: {
        currentTierIndex: 0,
        currentXP: 0,
      },
    };
  } else if (ctx.progressionData) {
    // 兼容旧格式：直接使用原始数据
    result.成长体系 = ctx.progressionData;
  }

  // 生存资源：配置（占位）
  if (ctx.survivalConfig) {
    result.生存资源 = { config: ctx.survivalConfig };
  } else if (ctx.survivalData) {
    result.生存资源 = ctx.survivalData;
  }

  // 经营资产：配置（占位）
  if (ctx.businessConfig) {
    result.经营资产 = { config: ctx.businessConfig };
  } else if (ctx.businessData) {
    result.经营资产 = ctx.businessData;
  }

  // 天赋体系：包装成 { config } 格式
  if (ctx.talentData) {
    result.天赋体系 = { config: ctx.talentData };
  }

  // 世界书条目
  if (ctx.worldBookEntries && ctx.worldBookEntries.length > 0) {
    result.worldBookEntries = ctx.worldBookEntries;
  }

  return result;
}


/**
 * 生成世界书条目（蓝灯/绿灯）
 *
 * 蓝灯：底层架构，常驻注入
 * 绿灯：详细规则，关键词触发（使用该世界自定义的名称）
 */
export function generateWorldBookEntries(ctx: BuildContext): WorldBookEntryDef[] {
  const entries: WorldBookEntryDef[] = [];

  // ─── 数值属性模块（绿灯：关键词触发）───
  if (ctx.statData) {
    const statData = ctx.statData;
    const dims = [statData.dim1, statData.dim2, statData.dim3, statData.dim4, statData.dim5, statData.dim6];

    const statKeywords = [
      statData.attrA?.name, statData.attrB?.name,
      ...dims.filter(Boolean).map(d => d!.name),
      ...(Array.isArray(statData.special) ? statData.special.filter(s => s?.name).map(s => s.name!) : []),
      '属性', '数值', '状态',
    ].filter((k): k is string => !!k && k.length > 0);

    // 把 AI 生成的属性名称写入内容
    const dimNames = dims.filter(Boolean).map(d => d!.name).join('、');
    const specialNames = buildSpecialConfig(statData.special)
      .map(s => `${s.name}（${s.description || ''}）`).join('、');
    const statContent = `${STAT_UPDATE_RULES}\n\n─── 属性体系 ───\n生命类：${statData.attrA?.name || '生命'}（上限${statData.attrA?.max || 100}）\n能量类：${statData.attrB?.name || '能量'}（上限${statData.attrB?.max || 100}）\n六维属性：${dimNames}${specialNames ? `\n特色属性：${specialNames}` : ''}`;

    entries.push({
      uid: -5002,
      comment: '[模块] 数值属性 - 规则',
      content: statContent,
      constant: false,
      key: statKeywords,
      order: 51,
      position: 'after_char',
    });
  }

  // ─── 成长体系模块（绿灯：关键词触发）───
  if (ctx.progressionData) {
    const progData = ctx.progressionData;
    let progressionKeywords: string[] = [];
    let progressionContent = PROGRESSION_UPDATE_RULES;

    if (progData.mode === 'level' && progData.levelData) {
      progressionKeywords = ['等级', '升级', '经验', 'Lv', '等级制'];
      progressionContent += `\n\n─── 等级制详情 ───\n最大等级：${progData.levelData.maxLevel}\n每级增长：${JSON.stringify(progData.levelData.growthPerLevel)}`;
    } else if (progData.tiers?.length) {
      progressionKeywords = [
        ...progData.tiers.map(t => t.name),
        '段位', '境界', '突破', '升级', '进阶',
      ];
      const tierList = progData.tiers.map((t, i) =>
        `${i + 1}. ${t.name}${t.description ? `：${t.description}` : ''}`
      ).join('\n');
      progressionContent += `\n\n─── 段位体系 ───\n${tierList}`;
    }

    // 叙事风格指引（避免游戏化表述）
    if (progData.narrativeStyle) {
      const ns = progData.narrativeStyle;
      progressionContent += `\n\n─── 叙事风格 ───\n角色成长时的表现：${ns.upgradeDesc || ''}\n成长相关关键词：${(ns.keywords || []).join('、')}\n注意：在正文中描述角色成长时，使用上述自然语言风格，不要出现"升级""经验值""叮"等游戏化词汇。`;
    }

    if (progressionKeywords.length > 0) {
      entries.push({
        uid: -5004,
        comment: '[模块] 成长体系 - 规则',
        content: progressionContent,
        constant: false,
        key: progressionKeywords.filter(k => k && k.length > 0),
        order: 53,
        position: 'after_char',
      });
    }
  }

  // ─── 生存资源模块（绿灯：关键词触发）───
  if (ctx.survivalData) {
    const survivalData = ctx.survivalData;

    // 把 AI 生成的资源列表写入内容
    const resourceList = Array.isArray(survivalData.resources)
      ? survivalData.resources.map(r => `${r.symbol || ''}${r.name}：${r.description || ''}${r.scarce ? '（稀缺）' : ''}`).join('\n')
      : '';

    // 演化蓝图写入世界书
    const evolutionSteps = Array.isArray(survivalData.resourceEvolution) ? survivalData.resourceEvolution : [];
    const evolutionContent = evolutionSteps.length > 0
      ? '\n\n─── 资源演化蓝图 ───\n' + evolutionSteps.map(evo => {
        const addList = evo.add?.map(r => `${r.symbol || ''}${r.name}`).join('、') || '无';
        const removeList = evo.remove?.length ? evo.remove.join('、') : '无';
        return `- ${evo.id}：当叙事中出现关键词「${evo.trigger.keywords.join('、')}」时解锁\n  新增：${addList}，淘汰：${removeList}${evo.narrateHint ? `\n  叙事提示：${evo.narrateHint}` : ''}`;
      }).join('\n')
      : '';

    // 收集演化关键词加入触发词
    const evolutionKeywords = evolutionSteps.flatMap(evo => evo.trigger?.keywords ?? []);

    const survivalKeywords = [
      ...(Array.isArray(survivalData.resources) ? survivalData.resources.map(r => r.name) : []),
      '生存', '资源', '采集', '制作', '消耗', '食物', '水',
      ...evolutionKeywords,
    ].filter(k => k && k.length > 0);

    const survContent = `${SURVIVAL_UPDATE_RULES}${resourceList ? `\n\n─── 资源清单 ───\n${resourceList}` : ''}${evolutionContent}`;

    entries.push({
      uid: -5006,
      comment: '[模块] 生存资源 - 规则',
      content: survContent,
      constant: false,
      key: survivalKeywords,
      order: 55,
      position: 'after_char',
    });
  }

  // ─── 经营资产模块（绿灯：关键词触发）───
  // 注意：此处只注入叙事上下文（经营环境描述 + 资产清单），
  // 不注入 UpdateVariable JSON 格式规则——那些规则由辅助 API 的
  // generateModuleUpdateRules() 动态生成，不应该出现在主 AI 上下文中，
  // 否则主 AI 会在正文中输出变量 JSON，导致"变量泄漏到正文"。
  if (ctx.businessData) {
    const biz = ctx.businessData;
    const businessKeywords = [
      ...(biz.assets?.map(a => a.name) || []),
      ...(biz.assets?.map(a => a.type) || []),
      '经营', '资产', '收购', '升级', '出售', '资金', '收益', '维护', '员工', '市场',
      ...(biz.market?.items?.map(i => i.name) || []),
    ].filter(k => k && k.length > 0);

    const assetLines = Array.isArray(biz.assets) && biz.assets.length > 0
      ? biz.assets.map(a => `- ${a.name}（${a.type || '通用'}）：${a.description || ''}，等级 ${a.level ?? 1}/${a.maxLevel ?? 3}，状态 ${a.status || 'active'}`).join('\n')
      : '（暂无资产，玩家需在游戏中通过角色行动获取）';

    const marketLines = biz.market?.items?.length
      ? '\n\n─── 市场行情 ───\n' + biz.market.items.map(i => `- ${i.name}：基准价 ${i.basePrice ?? 0}，趋势 ${i.trend || 'stable'}`).join('\n')
      : '';

    const bizContent = `【经营系统背景】
${biz.description || '这个世界存在商业活动。'}

结算周期：${biz.cycleName || '天'}
初始资金：${biz.funds ?? 0}

─── 当前资产 ───
${assetLines}${marketLines}

叙事指引：当玩家进行经营活动（收购、升级、出售资产等）时，在正文中描述其过程和结果。经营数据的变化由后台系统自动处理，你只需专注于叙事。`;

    entries.push({
      uid: -5009,
      comment: '[模块] 经营资产 - 背景',
      content: bizContent,
      constant: false,
      key: businessKeywords,
      order: 58,
      position: 'after_char',
    });
  }

  // ─── 骰子检定模块（绿灯：关键词触发）───
  if (ctx.selectedModules.includes('dice')) {
    entries.push({
      uid: -5007,
      comment: '[模块] 骰子检定',
      content: `${DICE_RULES_PROMPT}\n\n${DICE_UPDATE_RULES}`,
      constant: false,
      key: ['掷骰', '检定', '判定', 'd20', '骰子', '骰', '难度', 'DC', '成功率', '豁免'],
      order: 56,
      position: 'after_char',
    });
  }

  // ─── 天赋体系模块（绿灯：关键词触发）───
  if (ctx.selectedModules.includes('talent') && ctx.talentData?.categories?.length) {
    const cats = ctx.talentData.categories;
    const allTalents = cats.flatMap(c => c.talents || []);

    // 从 AI 生成的天赋中提取关键词
    const talentKeywords = [
      ...cats.map(c => c.name),           // 大类名（如"灵根"、"体质"）
      ...allTalents.slice(0, 10).map(t => t.name),  // 前10个天赋名
      '天赋', '技能', '觉醒', '能力',
    ].filter(k => k && k.length > 0);

    // 把 AI 生成的天赋列表写入内容
    const talentList = cats.map(c => {
      const talents = (c.talents || []).map(t =>
        `  - ${t.name}（${t.rarity}）：${t.description}${t.effects?.length ? ` [${t.effects.join('、')}]` : ''}`
      ).join('\n');
      return `【${c.name}】${c.description ? ` ${c.description}` : ''}\n${talents}`;
    }).join('\n\n');

    entries.push({
      uid: -5008,
      comment: '[模块] 天赋体系 - 规则',
      content: `${TALENT_RULES_PROMPT}\n\n${TALENT_UPDATE_RULES}\n\n─── 已知天赋 ───\n${talentList}`,
      constant: false,
      key: [...new Set(talentKeywords)],
      order: 57,
      position: 'after_char',
    });
  }

  return entries;
}
