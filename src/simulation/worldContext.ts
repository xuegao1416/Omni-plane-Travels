/**
 * 世界语义上下文提取器
 *
 * 从 WorldDef.worldBookEntries 中智能提取结构化语义信息，
 * 用于驱动推演引擎的自适应层级标签。
 *
 * 核心逻辑：
 *   1. 遍历世界书条目，按 entryType 分类聚合
 *   2. 从 meta 和 content 中提取结构化字段
 *   3. 根据世界设定推导五层事件标签的具体名称
 *
 * 对于自建世界（不完整的 worldBookEntries）：
 *   - 缺失的字段用通用描述填充
 *   - LLM 在 prompt 中会根据 worldName + setting 自行适配
 */

import type { WorldBookEntryDef } from '../data/worlds-schema';
import type { SimWorldContext, EventLevel } from './types';

/**
 * 从世界书条目中提取 SimWorldContext
 */
export function extractWorldContext(
  entries: WorldBookEntryDef[] | undefined,
  worldName: string,
  worldDesc: string,
): SimWorldContext {
  if (!entries || entries.length === 0) {
    return createEmptyContext(worldName, worldDesc);
  }

  // 按 entryType 分组
  const byType = groupByEntryType(entries);

  // 提取各维度语义
  const setting = extractSetting(byType, worldDesc);
  const powerSystem = extractPowerSystem(byType);
  const socialHierarchy = extractSocialHierarchy(byType);
  const factions = extractFactions(byType);
  const keyNpcs = extractNpcs(byType);
  const economy = extractEconomy(byType);
  const culture = extractCulture(byType);
  const coreThemes = extractCoreThemes(byType);

  // 推导自适应层级标签
  const levelLabels = deriveLevelLabels({
    worldName,
    setting,
    powerSystem,
    socialHierarchy,
    factions,
    economy,
    culture,
  });

  return {
    worldName,
    setting,
    powerSystem,
    socialHierarchy,
    factions,
    keyNpcs,
    economy,
    culture,
    coreThemes,
    levelLabels,
  };
}

// ─── 提取函数 ───

function groupByEntryType(entries: WorldBookEntryDef[]): Record<string, WorldBookEntryDef[]> {
  const groups: Record<string, WorldBookEntryDef[]> = {};
  for (const entry of entries) {
    if (!entry.entryType) continue;
    if (!groups[entry.entryType]) groups[entry.entryType] = [];
    groups[entry.entryType].push(entry);
  }
  return groups;
}

function extractSetting(byType: Record<string, WorldBookEntryDef[]>, fallback: string): string {
  const settingEntries = byType.setting;
  if (settingEntries && settingEntries.length > 0) {
    return settingEntries[0].content || fallback;
  }
  return fallback;
}

function extractPowerSystem(byType: Record<string, WorldBookEntryDef[]>): string {
  const rules = byType.rules;
  if (rules && rules.length > 0) {
    const metaPs = rules[0].meta?.powerSystem;
    if (metaPs) return metaPs;

    // 退而求其次：从 content 第一段中提取
    const content = rules[0].content || '';
    const match = content.match(/力量体系[：:]([^\n。]+)/);
    if (match) return match[1].trim();
  }
  return '';
}

function extractSocialHierarchy(byType: Record<string, WorldBookEntryDef[]>): string {
  const rules = byType.rules;
  if (rules && rules.length > 0) {
    const metaSs = rules[0].meta?.socialStructure;
    if (metaSs) return metaSs;

    const content = rules[0].content || '';
    const match = content.match(/社会(?:结构|层级)[：:]([^\n。]+)/);
    if (match) return match[1].trim();
  }
  return '';
}

function extractFactions(byType: Record<string, WorldBookEntryDef[]>): string[] {
  const factions: string[] = [];
  const factionEntries = byType.factions;
  if (factionEntries) {
    for (const entry of factionEntries) {
      const metaFactions = entry.meta?.factions;
      if (metaFactions) {
        for (const f of metaFactions) {
          factions.push(f.name);
        }
      } else {
        // 尝试从 key 中提取
        const key = entry.key?.[0];
        if (key && !factions.includes(key)) {
          factions.push(key);
        }
      }
    }
  }
  return factions;
}

function extractNpcs(byType: Record<string, WorldBookEntryDef[]>): Array<{ name: string; role: string; personality: string }> {
  const npcs: Array<{ name: string; role: string; personality: string }> = [];
  const npcEntries = byType.npcs;
  if (npcEntries) {
    for (const entry of npcEntries) {
      const metaNpcs = entry.meta?.npcs;
      if (metaNpcs) {
        for (const n of metaNpcs) {
          npcs.push({
            name: n.name,
            role: n.role || '',
            personality: n.personality || '',
          });
        }
      }
    }
  }
  return npcs;
}

function extractEconomy(byType: Record<string, WorldBookEntryDef[]>): string {
  const economyEntries = byType.economy;
  if (economyEntries && economyEntries.length > 0) {
    const entry = economyEntries[0];
    const currency = entry.meta?.currency;
    const priceLevel = entry.meta?.priceLevel;

    const parts: string[] = [];
    if (currency) {
      const symbol = currency.symbol ? `${currency.symbol} ` : '';
      parts.push(`货币：${symbol}${currency.name}${currency.description ? `（${currency.description}）` : ''}`);
    }
    if (priceLevel) parts.push(`物价：${priceLevel}`);
    if (parts.length > 0) return parts.join('；');
    return entry.content || '';
  }
  return '';
}

function extractCulture(byType: Record<string, WorldBookEntryDef[]>): string {
  const cultureEntries = byType.culture;
  if (cultureEntries && cultureEntries.length > 0) {
    return cultureEntries[0].content || '';
  }
  return '';
}

function extractCoreThemes(byType: Record<string, WorldBookEntryDef[]>): string[] {
  const highlights = byType.highlights;
  if (highlights && highlights.length > 0) {
    const metaHighlights = highlights[0].meta?.highlights;
    if (metaHighlights) return metaHighlights;
  }
  return [];
}

// ─── 层级标签推导 ───

interface LabelDeriveInput {
  worldName: string;
  setting: string;
  powerSystem: string;
  socialHierarchy: string;
  factions: string[];
  economy: string;
  culture: string;
}

function deriveLevelLabels(input: LabelDeriveInput): Record<EventLevel, string> {
  const labels: Record<EventLevel, string> = {
    mythic: deriveMythicLabel(input),
    political: derivePoliticalLabel(input),
    factional: deriveFactionalLabel(input),
    economic: deriveEconomicLabel(input),
    civilian: deriveCivilianLabel(input),
  };
  return labels;
}

function deriveMythicLabel(input: LabelDeriveInput): string {
  if (input.powerSystem) {
    // 用力量体系的首个关键概念作为神话层标签
    const short = input.powerSystem.split(/[，,、]/)[0].trim();
    if (short.length <= 10) return `天道·${short}`;
    return short;
  }
  // 从 setting 推断
  const setting = input.setting ?? '';
  if (setting.includes('修仙') || setting.includes('灵气')) return '天道·仙途';
  if (setting.includes('魔法') || setting.includes('魔力')) return '神域·魔法';
  if (setting.includes('赛博') || setting.includes('科技')) return '网络·赛博空间';
  if (setting.includes('末日') || setting.includes('废土')) return '天灾·环境异变';
  if (setting.includes('校园')) return '命运·规则之力';
  return '宏观/顶层';
}

function derivePoliticalLabel(input: LabelDeriveInput): string {
  if (input.socialHierarchy) {
    // 提取社会结构的顶层描述
    const top = input.socialHierarchy.split(/[，,、]/)[0].trim();
    if (top.length <= 10) return `权力·${top}`;
    return top;
  }
  // 从 setting 推断
  const setting = input.setting ?? '';
  if (setting.includes('朝廷') || setting.includes('皇帝')) return '权力·朝廷';
  if (setting.includes('门阀') || setting.includes('世家')) return '权力·世家';
  if (setting.includes('企业') || setting.includes('公司')) return '权力·企业';
  if (setting.includes('政府') || setting.includes('政治')) return '权力·政府';
  if (setting.includes('校园')) return '权力·校方';
  return '权力层面';
}

function deriveFactionalLabel(input: LabelDeriveInput): string {
  if (input.factions.length > 0) {
    const names = input.factions.slice(0, 3).join('、');
    if (names.length <= 20) return `势力·${names}`;
    return `势力·${input.factions.slice(0, 2).join('、')}等`;
  }
  const setting = input.setting ?? '';
  if (setting.includes('宗门') || setting.includes('门派')) return '势力·宗门';
  if (setting.includes('帮派') || setting.includes('组织')) return '势力·帮派';
  if (setting.includes('商会') || setting.includes('公司')) return '势力·商会';
  if (setting.includes('校园')) return '势力·社团';
  return '组织/势力层面';
}

function deriveEconomicLabel(input: LabelDeriveInput): string {
  if (input.economy) {
    // 提取货币名称
    const currencyMatch = input.economy.match(/货币[：:]\s*([^\n，。；]+)/);
    if (currencyMatch) {
      const currency = currencyMatch[1].trim().slice(0, 8);
      return `经济·${currency}`;
    }
    return input.economy.slice(0, 15);
  }
  return '经济/商业';
}

function deriveCivilianLabel(input: LabelDeriveInput): string {
  if (input.culture) {
    const snippet = input.culture.slice(0, 15).replace(/[。，；\n]/g, '');
    if (snippet.length > 3) return `市井·${snippet}`;
  }
  // 提取社会结构的底层描述
  if (input.socialHierarchy) {
    const parts = input.socialHierarchy.split(/[，,、]/);
    const bottom = parts[parts.length - 1]?.trim();
    if (bottom && bottom.length <= 10) return `市井·${bottom}`;
  }
  return '市井/个体';
}

// ─── 兜底 ───

function createEmptyContext(worldName: string, worldDesc: string): SimWorldContext {
  return {
    worldName,
    setting: worldDesc,
    powerSystem: '',
    socialHierarchy: '',
    factions: [],
    keyNpcs: [],
    economy: '',
    culture: '',
    coreThemes: [],
    levelLabels: {
      mythic: '宏观/顶层',
      political: '权力/政治',
      factional: '组织/势力',
      economic: '经济/商业',
      civilian: '市井/个体',
    },
  };
}
