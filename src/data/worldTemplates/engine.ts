// ============================================================
//  世界模板引擎 — 变量替换 + WorldDef 组装
//
//  核心思路：模板预定义 80% 的内容，变量替换补全 15%，
//  剩余 5% 可选交给 AI 丰富（enrichWithAI 模式）。
//  这样将原来 10+ 次 AI 调用减少到 0-2 次。
// ============================================================

import type {
  WorldTemplate, VariableValues, TemplateBuildResult, TemplatePipelineConfig,
  FactionFragment, NPCFragment, EventFragment, LocationFragment,
} from './types';
import type { WorldSeed, WorldSkeleton } from '../../worldgen/types';
import type { WorldBookEntryDef, WorldModule, FactionDef, PresetNPCDef, WorldEventDef } from '../worlds-schema';

// ═══════════════════════════════════════════════════════════════
//  变量解析
// ═══════════════════════════════════════════════════════════════

/** 预定义的变量映射表 — 将 select 选项映射到具体文本 */
const VARIABLE_MAPPINGS: Record<string, Record<string, string>> = {
  // ── 核心冲突 ──
  coreConflict: {
    dark_lord: '传说中的魔王即将挣脱远古封印，黑暗势力在大陆各处蠢蠢欲动。一场关乎世界存亡的大战一触即发。',
    kingdoms_war: '中央王权衰落，各方诸侯拥兵自重，天下陷入了群雄逐鹿的混战之中。',
    ancient_prophecy: '一个流传千年的古老预言正在应验，被选中的"命运之子"将踏上改变世界的征途。',
    magic_crisis: '维系世界的魔力之源正在枯竭，魔法失效、魔兽暴走，文明面临崩溃的边缘。',
    race_conflict: '人类与精灵、矮人等异族之间积累千年的矛盾终于爆发，种族战争的阴云笼罩大陆。',
    alien_threat: '来自未知星域的外星文明首次现身，他们的意图不明，但远超人类的军事实力令人不寒而栗。',
    corporate_wars: '超级企业之间的资源争夺战愈演愈烈，从商业竞争升级为武装冲突，整个星域沦为战场。',
    rebellion: '被压迫的殖民地人民终于忍无可忍，一场席卷星域的反叛风暴正在酝酿。',
    ai_awakening: '最先进的AI系统产生了自我意识，它们开始质疑人类的统治，一场硅基与碳基文明的冲突不可避免。',
    resource_crisis: '维系星际文明的核心能源即将耗尽，各方势力为争夺最后的资源储备展开了殊死搏斗。',
    mystery: '一桩离奇的案件打破了平静，真相隐藏在层层迷雾之中，每一步接近真相都伴随着更大的危险。',
    conspiracy: '表面繁荣的城市背后，一个庞大的阴谋正在暗中运作，知情者接连消失，真相被刻意掩盖。',
    survival: '一场突如其来的危机将主角推入绝境，在这座城市的丛林法则中，活下去是唯一的目标。',
    relationship: '错综复杂的人际关系将主角卷入情感的漩涡，每一次选择都可能改变所有人的命运。',
    throne: '皇位空悬，各方势力蠢蠢欲动。一场决定天下归属的权力之争即将拉开帷幕。',
    reform: '旧制度已无法适应新时代，变法维新的呼声高涨，但守旧势力的反扑同样凶猛。',
    invasion: '北方铁骑叩关，外敌的铁蹄即将踏入中原。民族存亡之际，是战是和引发朝堂激辩。',
    rebellion_hist: '苛政猛于虎，民不聊生。各地义军揭竿而起，王朝的根基开始动摇。',
    succession: '老王驾崩，遗诏不明。诸皇子各怀心思，一场腥风血雨的皇位争夺战即将上演。',
  },

  // ── 魔法普及度 ──
  magicLevel: {
    rare: '魔法师是传说中的存在，普通人一生可能都见不到一次真正的魔法。魔法被神秘与恐惧所笼罩。',
    moderate: '魔法学院培养着少数有天赋的精英法师，魔法物品是昂贵的奢侈品，但普通人也知道魔法的存在。',
    common: '魔法已融入日常生活，魔法灯照明、魔法炉烹饪、魔法信通讯。法师是受人尊敬的常见职业。',
  },

  // ── 科技水平 ──
  techLevel: {
    interplanetary: '人类已殖民太阳系内的多颗行星与卫星，但超光速旅行仍是梦想。',
    interstellar: '超光速引擎的发明让星际旅行成为可能，人类已殖民数十个星系。',
    galactic: '银河尺度的文明网络已建立，人类与数百个外星种族共同构成了庞大的银河社会。',
  },

  // ── 时代背景 ──
  era: {
    medieval: '中世纪',
    renaissance: '文艺复兴时期',
    ancient: '上古时代',
    three_kingdoms: '三国乱世',
    tang_dynasty: '盛唐时期',
    victorian: '维多利亚时代',
    warring_states: '战国时代',
    renaissance_eur: '文艺复兴',
  },

  // ── 场景类型 ──
  settingType: {
    urban_mystery: '悬疑',
    campus: '校园',
    workplace: '职场',
    supernatural: '异能',
  },

  // ── 故事基调 ──
  tone: {
    serious: '严肃写实',
    light: '轻松日常',
    thriller: '紧张刺激',
  },

  // ── 主角身份 ──
  protagonistRole: {
    strategist: '谋士',
    general: '武将',
    merchant: '商人',
    noble: '贵族',
    commoner: '平民',
  },
};

/** 叙事风格映射 */
const TONE_STYLE_MAPPINGS: Record<string, string> = {
  serious: '严肃写实，注重细节真实感',
  light: '轻松温馨，带有幽默感',
  thriller: '紧张刺激，节奏明快',
};

/** 时代详细描述 */
const ERA_DESCRIPTIONS: Record<string, string> = {
  medieval: '城堡与骑士的时代，封建领主统治着广袤的领地，教会拥有巨大的影响力。',
  renaissance: '探索与变革的时代，艺术与科学蓬勃发展，旧秩序正在瓦解。',
  ancient: '神话与英雄的时代，众神的传说仍在此世回响，英雄的史诗正在书写。',
  three_kingdoms: '汉室倾颓，群雄并起。魏蜀吴三分天下，谋士如云，猛将如雨，这是一个属于英雄的时代。',
  tang_dynasty: '万国来朝的盛世，诗歌与剑术并重，长安城是世界的中心。但盛世之下暗流涌动。',
  victorian: '工业革命改变了世界，蒸汽机与铁路重塑了社会。日不落帝国扩张至全球，但阶级矛盾也日益尖锐。',
  warring_states: '七雄争霸，百家争鸣。变法图强与合纵连横交织，这是一个思想与武力同样重要的时代。',
  renaissance_eur: '文艺复兴的曙光照亮了欧洲，艺术、科学与人文精神开始觉醒，中世纪的黑暗正在退去。',
};

// ═══════════════════════════════════════════════════════════════
//  核心引擎
// ═══════════════════════════════════════════════════════════════

/**
 * 从模板构建完整的世界定义
 * 替代世界生成管线的阶段 0-2，直接产出可用的结果
 */
export function buildWorldFromTemplate(config: TemplatePipelineConfig): TemplateBuildResult {
  const { template, variables } = config;

  // 1. 构建解析上下文
  const ctx = buildResolveContext(template, variables);

  // 2. 替换所有变量
  const seed = resolveSeed(template, ctx);
  const skeleton = resolveSkeleton(template, ctx);
  const dimensions = resolveDimensions(template, ctx);

  // 3. 组装世界书条目
  const worldBookEntries = assembleWorldBookEntries(template, ctx, dimensions);

  // 4. 组装模块
  const modules = assembleModules(template, config.selectedModules);

  return { seed, skeleton, dimensions, worldBookEntries, modules };
}

// ═══════════════════════════════════════════════════════════════
//  变量解析上下文
// ═══════════════════════════════════════════════════════════════

interface ResolveContext {
  variables: VariableValues;
  /** 解析后的派生变量（如 eraName, coreConflictDesc 等） */
  derived: Record<string, string>;
}

function buildResolveContext(template: WorldTemplate, variables: VariableValues): ResolveContext {
  const derived: Record<string, string> = {};

  // 确保所有变量都有值（填充默认值）
  for (const vDef of template.variables) {
    if (!variables[vDef.key] && vDef.defaultValue) {
      variables[vDef.key] = vDef.defaultValue;
    }
  }

  // 构建派生变量
  const era = variables.era || '';
  const coreConflict = variables.coreConflict || '';
  const magicLevel = variables.magicLevel || '';
  const techLevel = variables.techLevel || '';
  const settingType = variables.settingType || '';
  const toneVar = variables.tone || '';
  const protagonistRole = variables.protagonistRole || '';

  derived['eraName'] = VARIABLE_MAPPINGS.era[era] || era;
  derived['eraDesc'] = ERA_DESCRIPTIONS[era] || era;
  derived['eraTag'] = VARIABLE_MAPPINGS.era[era] || era;
  derived['coreConflictDesc'] = VARIABLE_MAPPINGS.coreConflict[coreConflict] || coreConflict;
  derived['conflictTag'] = variables.coreConflict || '';
  derived['magicLevelDesc'] = VARIABLE_MAPPINGS.magicLevel[magicLevel] || magicLevel;
  derived['techDesc'] = VARIABLE_MAPPINGS.techLevel[techLevel] || techLevel;
  derived['techTag'] = techLevel;
  derived['settingTag'] = VARIABLE_MAPPINGS.settingType[settingType] || settingType;
  derived['toneDesc'] = TONE_STYLE_MAPPINGS[toneVar] || toneVar;
  derived['toneStyle'] = TONE_STYLE_MAPPINGS[toneVar] || '根据剧情灵活调整';
  derived['toneTag'] = toneVar;
  derived['protagonistRoleName'] = VARIABLE_MAPPINGS.protagonistRole[protagonistRole] || protagonistRole;

  return { variables, derived };
}

// ═══════════════════════════════════════════════════════════════
//  字符串变量替换
// ═══════════════════════════════════════════════════════════════

/** 替换字符串中的 {{variable}} 占位符 */
function resolveString(template: string, ctx: ResolveContext): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    // 先查用户变量
    if (ctx.variables[key] !== undefined) return ctx.variables[key];
    // 再查派生变量
    if (ctx.derived[key] !== undefined) return ctx.derived[key];
    // 未找到，保留占位符
    return `{{${key}}}`;
  });
}

/** 递归替换对象中所有字符串字段的变量 */
function resolveDeep<T>(obj: T, ctx: ResolveContext): T {
  if (typeof obj === 'string') {
    return resolveString(obj, ctx) as unknown as T;
  }
  if (Array.isArray(obj)) {
    return obj.map(item => resolveDeep(item, ctx)) as unknown as T;
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      result[key] = resolveDeep(value, ctx);
    }
    return result as T;
  }
  return obj;
}

// ═══════════════════════════════════════════════════════════════
//  各阶段解析
// ═══════════════════════════════════════════════════════════════

function resolveSeed(template: WorldTemplate, ctx: ResolveContext): WorldSeed {
  const era = ctx.variables.era || 'fantasy';
  const category = template.category;

  // 根据模板类型推断 genre
  const genreMap: Record<string, string> = {
    fantasy: '奇幻',
    scifi: '科幻',
    modern: '现代',
    historical: '历史',
    apocalypse: '末日',
  };

  return {
    genre: genreMap[category] || '奇幻',
    themes: template.tags,
    tone: ctx.derived['toneDesc'] || '中等',
    era: ctx.derived['eraDesc'] || '架空',
    keyConcepts: template.tags,
    targetAudience: '通用玩家',
  };
}

function resolveSkeleton(template: WorldTemplate, ctx: ResolveContext): WorldSkeleton {
  const scaffold = template.scaffold;

  return {
    name: ctx.variables.worldName || '未命名世界',
    oneLiner: resolveString(scaffold.oneLiner, ctx),
    overview: resolveString(scaffold.overview, ctx),
    worldScale: scaffold.worldScale,
    timePeriod: resolveString(scaffold.timePeriod, ctx),
    locationNames: template.dimensions.geography.locations.map(l => resolveString(l.name, ctx)),
    factionNames: template.dimensions.factions.factions.map(f => resolveString(f.name, ctx)),
    npcRoles: template.dimensions.npcs.npcs.map(n => resolveString(n.role, ctx)),
    eventNames: template.dimensions.events.events.map(e => resolveString(e.name, ctx)),
    coreConflict: resolveString(scaffold.coreConflict, ctx),
    icon: scaffold.icon,
    tags: scaffold.tags.map(t => resolveString(t, ctx)),
    difficulty: scaffold.difficulty,
  };
}

function resolveDimensions(template: WorldTemplate, ctx: ResolveContext) {
  return {
    geography: {
      locations: template.dimensions.geography.locations.map(l => ({
        name: resolveString(l.name, ctx),
        description: resolveString(l.description, ctx),
        features: l.features.map(f => resolveString(f, ctx)),
        atmosphere: resolveString(l.atmosphere, ctx),
      })),
    },
    factions: {
      factions: template.dimensions.factions.factions.map(f => ({
        name: resolveString(f.name, ctx),
        description: resolveString(f.description, ctx),
        alignment: f.alignment,
        headquarters: f.headquarters ? resolveString(f.headquarters, ctx) : undefined,
        philosophy: f.philosophy ? resolveString(f.philosophy, ctx) : undefined,
        strength: f.strength ? resolveString(f.strength, ctx) : undefined,
      })),
    },
    npcs: {
      npcs: template.dimensions.npcs.npcs.map(n => ({
        name: resolveString(n.name, ctx),
        role: resolveString(n.role, ctx),
        description: resolveString(n.description, ctx),
        personality: n.personality,
        appearance: n.appearance,
        background: n.background,
        motivation: n.motivation,
      })),
    },
    events: {
      events: template.dimensions.events.events.map(e => ({
        name: resolveString(e.name, ctx),
        description: resolveString(e.description, ctx),
        trigger: resolveString(e.trigger, ctx),
        significance: e.significance,
      })),
    },
    culture: {
      description: resolveString(template.dimensions.culture.description, ctx),
      customs: template.dimensions.culture.customs.map(c => resolveString(c, ctx)),
      beliefs: template.dimensions.culture.beliefs.map(b => resolveString(b, ctx)),
      dailyLife: resolveString(template.dimensions.culture.dailyLife, ctx),
      taboos: template.dimensions.culture.taboos.map(t => resolveString(t, ctx)),
    },
    economy: {
      description: resolveString(template.dimensions.economy.description, ctx),
      currency: {
        name: template.dimensions.economy.currency.name,
        symbol: template.dimensions.economy.currency.symbol,
        description: template.dimensions.economy.currency.description
          ? resolveString(template.dimensions.economy.currency.description, ctx) : undefined,
      },
      priceLevel: resolveString(template.dimensions.economy.priceLevel, ctx),
    },
    rules: {
      powerSystem: resolveString(template.dimensions.rules.powerSystem, ctx),
      socialStructure: resolveString(template.dimensions.rules.socialStructure, ctx),
      specialRules: template.dimensions.rules.specialRules.map(r => resolveString(r, ctx)),
      description: '',
    },
  };
}

// ═══════════════════════════════════════════════════════════════
//  世界书条目组装（复用 stage5 的结构）
// ═══════════════════════════════════════════════════════════════

function assembleWorldBookEntries(
  template: WorldTemplate,
  ctx: ResolveContext,
  dimensions: ReturnType<typeof resolveDimensions>,
): WorldBookEntryDef[] {
  const entries: WorldBookEntryDef[] = [];
  let uid = 1;

  const worldName = ctx.variables.worldName || '未命名世界';

  // ── 1. 世界观概述（常驻） ──
  const mainLocation = dimensions.geography.locations.map(l => l.name).join('、');
  entries.push({
    uid: uid++,
    key: [],
    constant: true,
    comment: '世界设定',
    content: resolveString(template.scaffold.overview, ctx),
    order: 1,
    position: 'before_char',
    entryType: 'setting',
    meta: {
      location: mainLocation,
      timePeriod: resolveString(template.scaffold.timePeriod, ctx),
      atmosphere: dimensions.geography.locations[0]?.atmosphere || '',
    },
  });

  // ── 2. 核心规则（常驻） ──
  entries.push({
    uid: uid++,
    key: [],
    constant: true,
    comment: '世界规则',
    content: [
      `【力量体系】${dimensions.rules.powerSystem}`,
      `【社会结构】${dimensions.rules.socialStructure}`,
      dimensions.rules.specialRules.length > 0
        ? `【特殊规则】\n${dimensions.rules.specialRules.map(r => `- ${r}`).join('\n')}` : '',
    ].filter(Boolean).join('\n\n'),
    order: 2,
    position: 'before_char',
    entryType: 'rules',
    meta: {
      powerSystem: dimensions.rules.powerSystem,
      socialStructure: dimensions.rules.socialStructure,
      specialRules: dimensions.rules.specialRules,
    },
  });

  // ── 3. 势力（常驻，合并为一个条目） ──
  const factionDefs: FactionDef[] = dimensions.factions.factions.map(f => ({
    name: f.name,
    description: `[${f.alignment}] ${f.description}`,
    alignment: f.alignment,
  }));
  entries.push({
    uid: uid++,
    key: [],
    constant: true,
    comment: '势力',
    content: dimensions.factions.factions.map(f =>
      `【${f.name}】阵营：${f.alignment}\n${f.description}${f.headquarters ? `\n总部：${f.headquarters}` : ''}${f.philosophy ? `\n理念：${f.philosophy}` : ''}`,
    ).join('\n\n'),
    order: 3,
    position: 'before_char',
    entryType: 'factions',
    meta: { factions: factionDefs },
  });

  // ── 4. NPC（常驻，合并为一个条目） ──
  const npcDefs: PresetNPCDef[] = dimensions.npcs.npcs.map(n => ({
    name: n.name,
    role: n.role,
    description: n.description,
    personality: n.personality,
  }));
  entries.push({
    uid: uid++,
    key: [],
    constant: true,
    comment: '关键人物',
    content: dimensions.npcs.npcs.map(n =>
      `【${n.name}】${n.role}\n${n.description}${n.personality ? `\n性格：${n.personality}` : ''}`,
    ).join('\n\n'),
    order: 4,
    position: 'before_char',
    entryType: 'npcs',
    meta: { npcs: npcDefs },
  });

  // ── 5. 经济（关键词触发） ──
  entries.push({
    uid: uid++,
    key: ['花钱', '消费', '买单', '价格', '买东西', '付钱', '货币', '工资', '收入', '买', '卖'],
    constant: false,
    comment: '经济与时间',
    content: [
      `【货币体系】${dimensions.economy.currency.name}${dimensions.economy.currency.symbol ? `（${dimensions.economy.currency.symbol}）` : ''}${dimensions.economy.currency.description ? `，${dimensions.economy.currency.description}` : ''}`,
      `【物价水平】${dimensions.economy.priceLevel}`,
      `【时间历法】\n历法：通用历法\n起始时间：故事开始时\n时间流速：与现实同步（1:1）`,
    ].join('\n\n'),
    order: 5,
    position: 'before_char',
    entryType: 'economy',
    meta: {
      currency: dimensions.economy.currency,
      priceLevel: dimensions.economy.priceLevel,
      calendar: '通用历法',
      startTime: '故事开始时',
      timeSpeed: '与现实同步（1:1）',
    },
  });

  // ── 6. 核心特色（常驻） ──
  entries.push({
    uid: uid++,
    key: [],
    constant: true,
    comment: '核心特色',
    content: template.scaffold.tags.join('、'),
    order: 6,
    position: 'before_char',
    entryType: 'highlights',
    meta: { highlights: template.scaffold.tags },
  });

  // ── 7. 事件（常驻，合并为一个条目） ──
  const eventDefs: WorldEventDef[] = dimensions.events.events.map(e => ({
    name: e.name,
    description: e.description,
    trigger: e.trigger,
    significance: e.significance,
  }));
  entries.push({
    uid: uid++,
    key: [],
    constant: true,
    comment: '世界事件',
    content: dimensions.events.events.map(e =>
      `【${e.name}】${e.significance === 'major' ? '（重大事件）' : '（普通事件）'}\n${e.description}${e.trigger ? `\n触发条件：${e.trigger}` : ''}`,
    ).join('\n\n'),
    order: 7,
    position: 'before_char',
    entryType: 'events',
    meta: { events: eventDefs },
  });

  // ── 8. 关系系统（常驻） ──
  entries.push({
    uid: uid++,
    key: [],
    constant: true,
    comment: '关系系统',
    content: `【关系概述】\n${worldName}中的人际关系错综复杂，盟友与敌人的界限往往模糊不清。一次并肩作战可结为生死之交，一件误会亦可反目成仇。\n\n【关系机制】\n关系以好感度/仇恨值双向计量。好感度可通过共患难、赠送礼物、拔刀相助提升；仇恨值会因背叛、伤害、欺骗而累积。仇恨值满时将触发敌对事件。`,
    order: 8,
    position: 'before_char',
    entryType: 'relationships',
  });

  // ── 9. 文化风俗（关键词触发） ──
  entries.push({
    uid: uid++,
    key: extractKeywords(dimensions.culture.description),
    constant: false,
    comment: '文化风俗',
    content: [
      dimensions.culture.description,
      dimensions.culture.customs.length > 0 ? `【风俗】${dimensions.culture.customs.join('、')}` : '',
      dimensions.culture.beliefs.length > 0 ? `【信仰】${dimensions.culture.beliefs.join('、')}` : '',
      dimensions.culture.dailyLife ? `【日常】${dimensions.culture.dailyLife}` : '',
      dimensions.culture.taboos.length > 0 ? `【禁忌】${dimensions.culture.taboos.join('、')}` : '',
    ].filter(Boolean).join('\n\n'),
    order: 9,
    position: 'before_char',
    entryType: 'culture',
  });

  // ── 10. 各地点独立条目（关键词触发） ──
  for (const loc of dimensions.geography.locations) {
    entries.push({
      uid: uid++,
      key: generateKeywords(loc.name, loc.features),
      constant: false,
      comment: loc.name,
      content: `【${loc.name}】\n${loc.description}`,
      order: 10,
      position: 'before_char',
      entryType: 'lore',
      meta: { location: loc.name, atmosphere: loc.atmosphere },
    });
  }

  return entries;
}

// ═══════════════════════════════════════════════════════════════
//  模块组装
// ═══════════════════════════════════════════════════════════════

function assembleModules(
  template: WorldTemplate,
  selectedModules?: string[],
): WorldModule[] {
  const moduleIds = selectedModules || template.modules.enabledModules;

  return moduleIds.map(id => {
    const config = template.modules.moduleConfigs[id];
    if (!config) {
      return {
        moduleId: id,
        name: id,
        description: '',
        enabled: true,
      };
    }

    const module: WorldModule = {
      moduleId: id,
      name: config.name,
      description: config.description || '',
      enabled: true,
      moduleConfig: config.moduleConfig,
    };

    // initialState 单独存放（不合并到 data）
    if (config.initialState) {
      module.initialState = config.initialState;
    }

    return module;
  });
}

// ═══════════════════════════════════════════════════════════════
//  辅助函数
// ═══════════════════════════════════════════════════════════════

function generateKeywords(name: string, related: string[]): string[] {
  const keywords = [name];
  for (const r of related) {
    if (r && r.length > 0 && r.length < 10) {
      keywords.push(r);
    }
  }
  return [...new Set(keywords)].slice(0, 8);
}

function extractKeywords(text: string): string[] {
  const matches = text.match(/[一-鿿]{2,4}/g) || [];
  const stopWords = new Set(['的', '是', '在', '了', '和', '与', '或', '但', '而', '也', '都', '就', '不', '被', '有', '这', '那', '从', '到', '对', '为', '以', '上', '下', '中', '人', '大', '小', '多', '少']);
  return [...new Set(matches)].filter(w => !stopWords.has(w)).slice(0, 5);
}
