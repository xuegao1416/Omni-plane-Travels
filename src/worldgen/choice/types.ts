// 选择式世界生成管线 — 类型定义
// ============================================================

import type { WorldBookEntryDef, WorldBookEntryType } from '../../data/worlds-schema';
import type { WorldSeed, WorldSkeleton, CallAI } from '../types';

/** 单个维度的选项 */
export interface DimensionChoice {
  id: string;           // 'A' | 'B' | 'C' | 'D' | 'E'(自定义)
  title: string;        // "严肃古典仙侠"
  subtitle: string;     // "以武为尊，宗门林立"
  isCustom?: boolean;   // 是否为用户自定义选项
}

/** 单个维度的生成结果 */
export interface DimensionGeneration {
  narrative: string;    // AI生成的描述文字
  choices: DimensionChoice[];  // 4个选项
}

/** 用户在某个维度的选择 */
export interface DimensionSelection {
  dimensionKey: string;
  dimensionLabel: string;
  choiceId: string;
  choice: DimensionChoice;
  /** 多选时的所有选择ID（逗号分隔） */
  choiceIds?: string;
  /** 多选时的所有选择 */
  choices?: DimensionChoice[];
}

/** 维度定义 */
export interface DimensionConfig {
  key: string;          // 'tone' | 'geography' | 'factions' | ...
  label: string;        // '基调' | '地理' | '势力' | ...
  required: boolean;    // 是否必选
  multiSelect?: boolean; // 是否支持多选（默认false）
  maxSelect?: number;    // 多选时最大选择数量（默认3）
  entryType: WorldBookEntryType;  // 对应的世界书条目类型
}

/** 选择式流程的完整状态 */
export interface ChoiceFlowState {
  userDesc: string;
  selectedModules: string[];
  // Stage0+1的结果
  seed?: WorldSeed;
  skeleton?: WorldSkeleton;
  // 各维度的生成+选择
  dimensions: Record<string, {
    generation?: DimensionGeneration;
    selection?: DimensionSelection;
  }>;
  // 最终结果
  worldBookEntries?: WorldBookEntryDef[];
}

/** 管线配置 */
export interface ChoicePipelineConfig {
  callAI: CallAI;
  onProgress?: (stage: string, detail: string) => void;
}
