// ============================================================
//  世界生成管线 v3 — 类型定义
// ============================================================

import type { WorldBookEntryDef, WorldBookEntryType, WorldModule } from '../data/worlds-schema';

/** AI 调用函数类型 */
export type CallAI = (messages: Array<{ role: string; content: string }>) => Promise<string>;

/** 管线配置 */
export interface WorldGenConfig {
  callAI: CallAI;
  onProgress?: (stage: string, detail: string) => void;
  selectedModules?: string[];
  maxConcurrency?: number;  // 并行调用上限，默认 2
}

/** 管线最终结果 */
export interface WorldGenResult {
  worldDef: {
    id: string;
    name: string;
    description: string;
    icon?: string;
    coverColor?: string;
    tags?: string[];
    difficulty?: 'easy' | 'medium' | 'hard';
    entryId: null;
    modules?: WorldModule[];
  };
  worldBookEntries: WorldBookEntryDef[];
}

// ─── 阶段0：种子分析 ───

export interface WorldSeed {
  genre: string;           // '末日废土' | '仙侠' | '赛博朋克'
  themes: string[];        // ['生存', '人性考验', '重建文明']
  tone: string;            // '压抑沉重' | '轻松幽默'
  era: string;             // '近未来' | '架空古代'
  keyConcepts: string[];   // ['僵尸病毒', '资源匮乏', '幸存者聚落']
  targetAudience: string;  // '喜欢生存挑战的玩家'
}

// ─── 阶段1：世界骨架 ───

export interface WorldSkeleton {
  name: string;
  oneLiner: string;              // 一句话简介
  overview: string;              // 2-3 段世界观概述
  worldScale: 'small' | 'medium' | 'large';
  timePeriod: string;            // 时间背景（如"架空古代"、"近未来2087年"）
  locationNames: string[];       // 预规划地名
  factionNames: string[];        // 预规划势力名
  npcRoles: string[];            // 预规划 NPC 角色定位
  eventNames: string[];          // 预规划事件名
  coreConflict: string;          // 核心矛盾
  icon: string;                  // Lucide 图标名
  tags: string[];
  difficulty: 'easy' | 'medium' | 'hard';
}

// ─── 阶段2：维度结果 ───

export interface LocationDetail {
  name: string;
  description: string;
  features: string[];
  atmosphere: string;
  history?: string;
}

export interface GeographyResult {
  locations: LocationDetail[];
}

export interface FactionDetail {
  name: string;
  description: string;
  alignment: string;             // '友善' | '中立' | '敌对'
  headquarters?: string;
  philosophy?: string;
  strength?: string;
  internalFactions?: string[];
  relationships?: Array<{ target: string; relation: string }>;
}

export interface FactionResult {
  factions: FactionDetail[];
}

export interface NPCDetail {
  name: string;
  role: string;
  description: string;
  personality: string;
  appearance?: string;
  background?: string;
  motivation?: string;
  secrets?: string;
  relationships?: Array<{ target: string; relation: string }>;
}

export interface NPCResult {
  npcs: NPCDetail[];
}

export interface EventDetail {
  name: string;
  description: string;
  trigger: string;
  significance: 'major' | 'minor';
  impact?: string;
}

export interface EventResult {
  events: EventDetail[];
}

export interface CultureResult {
  customs: string[];
  beliefs: string[];
  dailyLife: string;
  taboos: string[];
  languageFeatures?: string[];
  description: string;
}

export interface EconomyResult {
  currency: { name: string; symbol?: string; description?: string };
  priceLevel: string;
  tradeRoutes?: string[];
  scarceResources?: string[];
  blackMarket?: string;
  description: string;
}

export interface RulesResult {
  powerSystem: string;
  socialStructure: string;
  specialRules: string[];
  physicalLaws?: string;
  magicOrTechSystem?: string;
  description: string;
}

export interface DimensionResults {
  geography: GeographyResult;
  factions: FactionResult;
  npcs: NPCResult;
  events: EventResult;
  culture: CultureResult;
  economy: EconomyResult;
  rules: RulesResult;
}

// ─── 阶段3：交叉校验 ───

export interface ConsistencyPatch {
  patches: Array<{
    target: string;      // 'geography' | 'factions' | ...
    field: string;
    oldValue: string;
    newValue: string;
    reason: string;
  }>;
}

// ─── 阶段4：深度细节 ───

export interface DeepDetailResults {
  locationDeep: LocationDetail[];     // 深写后的地点
  factionDeep: FactionDetail[];       // 深写后的势力
  npcDeep: NPCDetail[];               // 深写后的 NPC
}

// ─── 管线上下文 ───

export interface WorldGenContext {
  userDesc: string;
  config: WorldGenConfig;
  seed?: WorldSeed;
  skeleton?: WorldSkeleton;
  dimensions?: DimensionResults;
  consistencyPatch?: ConsistencyPatch;
  deepDetails?: DeepDetailResults;
  worldBookEntries?: WorldBookEntryDef[];
  modules?: WorldModule[];
}
