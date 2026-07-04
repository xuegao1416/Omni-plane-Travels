// ============================================================
//  世界模板系统 — 类型定义
//  通过预定义模板 + 变量替换，减少 AI 生成负担
// ============================================================

import type { WorldModule } from '../worlds-schema';
import type {
  WorldSeed, WorldSkeleton, DimensionResults,
  GeographyResult, FactionResult, NPCResult, EventResult,
  CultureResult, EconomyResult, RulesResult,
} from '../../worldgen/types';

// ═══════════════════════════════════════════════════════════════
//  变量系统
// ═══════════════════════════════════════════════════════════════

/** 变量定义 — 描述模板中可替换的占位符 */
export interface VariableDefinition {
  key: string;                   // 变量名，如 'worldName'
  label: string;                 // 显示名，如 '世界名称'
  description?: string;          // 帮助文本
  type: 'text' | 'select' | 'textarea';
  required: boolean;
  defaultValue?: string;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;  // type=select 时的选项
  /** 该变量影响的维度，用于提示用户 */
  affects?: string[];
}

/** 用户提供的变量值 */
export type VariableValues = Record<string, string>;

// ═══════════════════════════════════════════════════════════════
//  维度片段模板
// ═══════════════════════════════════════════════════════════════

/** 势力模板片段 */
export interface FactionFragment {
  name: string;                  // 可含 {{变量}} 占位符
  description: string;
  alignment: string;
  headquarters?: string;
  philosophy?: string;
  strength?: string;
}

/** NPC 模板片段 */
export interface NPCFragment {
  name: string;
  role: string;
  description: string;
  personality: string;
  appearance?: string;
  background?: string;
  motivation?: string;
}

/** 事件模板片段 */
export interface EventFragment {
  name: string;
  description: string;
  trigger: string;
  significance: 'major' | 'minor';
}

/** 地点模板片段 */
export interface LocationFragment {
  name: string;
  description: string;
  features: string[];
  atmosphere: string;
}

/** 维度片段集合 — 模板预定义的各维度数据 */
export interface DimensionFragments {
  geography: { locations: LocationFragment[] };
  factions: { factions: FactionFragment[] };
  npcs: { npcs: NPCFragment[] };
  events: { events: EventFragment[] };
  culture: {
    description: string;
    customs: string[];
    beliefs: string[];
    dailyLife: string;
    taboos: string[];
  };
  economy: {
    description: string;
    currency: { name: string; symbol?: string; description?: string };
    priceLevel: string;
  };
  rules: {
    powerSystem: string;
    socialStructure: string;
    specialRules: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
//  世界模板
// ═══════════════════════════════════════════════════════════════

/** 模板的固定骨架数据（变量替换后直接使用） */
export interface TemplateScaffold {
  /** 一句话简介模板 */
  oneLiner: string;
  /** 世界观概述模板（多段） */
  overview: string;
  /** 世界规模 */
  worldScale: 'small' | 'medium' | 'large';
  /** 时间背景模板 */
  timePeriod: string;
  /** 核心矛盾模板 */
  coreConflict: string;
  /** 标签 */
  tags: string[];
  /** 图标 */
  icon: string;
  /** 主题色 */
  coverColor: string;
  /** 难度 */
  difficulty: 'easy' | 'medium' | 'hard';
}

/** 模板预定义的模块配置 */
export interface TemplateModules {
  /** 推荐启用的模块 ID 列表 */
  enabledModules: string[];
  /** 各模块的预设配置 */
  moduleConfigs: Record<string, {
    name: string;
    description?: string;
    moduleConfig: Record<string, unknown>;
    initialState?: Record<string, unknown>;
  }>;
}

/** 世界模板定义 */
export interface WorldTemplate {
  /** 模板唯一 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 模板描述 */
  description: string;
  /** 模板分类标签 */
  category: 'fantasy' | 'scifi' | 'modern' | 'historical' | 'apocalypse' | 'other';
  /** 预览用标签 */
  tags: string[];
  /** 预览用图标 */
  icon: string;
  /** 预览用主题色 */
  coverColor: string;

  /** 变量定义 — 用户需要填写的字段 */
  variables: VariableDefinition[];

  /** 固定骨架 */
  scaffold: TemplateScaffold;

  /** 维度片段（含变量占位符） */
  dimensions: DimensionFragments;

  /** 模块预设 */
  modules: TemplateModules;

  /** 叙事风格提示（可选） */
  narrativeStyle?: {
    tone?: string;
    pacing?: string;
    contentWarnings?: string[];
  };
}

// ═══════════════════════════════════════════════════════════════
//  模板引擎输出
// ═══════════════════════════════════════════════════════════════

/** 模板引擎生成的中间结果 */
export interface TemplateBuildResult {
  /** 替换变量后的种子 */
  seed: WorldSeed;
  /** 替换变量后的骨架 */
  skeleton: WorldSkeleton;
  /** 替换变量后的维度数据 */
  dimensions: DimensionResults;
  /** 预组装的世界书条目（可直接使用，也可交给 AI 丰富） */
  worldBookEntries: import('../worlds-schema').WorldBookEntryDef[];
  /** 模块配置 */
  modules: WorldModule[];
}

/** 模板管线配置 */
export interface TemplatePipelineConfig {
  /** 选择的模板 */
  template: WorldTemplate;
  /** 用户填写的变量值 */
  variables: VariableValues;
  /** AI 调用函数（用于丰富模板内容，可选） */
  callAI?: (messages: Array<{ role: string; content: string }>) => Promise<string>;
  /** 是否用 AI 丰富模板内容（默认 false = 纯模板，不调 AI） */
  enrichWithAI?: boolean;
  /** 进度回调 */
  onProgress?: (stage: string, detail: string) => void;
  /** 选择的模块（覆盖模板默认值） */
  selectedModules?: string[];
}
