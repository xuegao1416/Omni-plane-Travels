// ============================================================
// 记忆系统统一导出
// ============================================================

// 核心 Hook（游戏引擎主要使用这个）
export { useMemorySystem } from './useMemorySystem';
export type {
  MemorySystemHook,
  MemoryEntry,
  RetrieveResult,
  MemoryPipelineContext,
} from './useMemorySystem';

// Zustand Store（底层状态管理）
export { useMemoryStore } from './memoryStore';

// 类型
export type {
  MemorySystemConfig,
  NarrativeMemoryRuntime,
  SummaryMemoryItem,
  SummarySaveRecord,
  DebugLog,
} from './types';

// 配置
export {
  createDefaultMemorySystemConfig,
  normalizeMemorySystemConfig,
} from './memoryConfig';

// 提示词（可自定义）
export {
  createDefaultNarrativePromptTemplates,
} from './memoryPrompts';

// PNG 导出/导入
export {
  createMemoryDataPngBlob,
  extractMemoryPackFromPng,
  isMemoryPngFile,
} from './narrativePng';

// Mermaid 图谱生成
export {
  buildMemoryRuntimeGraphPayload,
  buildMemoryRuntimeMermaidGraph,
  TAB_LABELS,
} from './narrativeGraph';
export type { GraphPayloadOptions } from './narrativeGraph';
