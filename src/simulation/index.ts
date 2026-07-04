// 后台世界推演系统 — 统一导出
export { WorldSimulationEngine } from './engine';
export { buildSimulationPrompt, parseSimulationResponse } from './llmIntegration';
export * from './types';
export { SIM_STORAGE_KEY } from './storage';
export {
  DEFAULT_SIM_PRESET,
  getBuiltinPresets,
  buildPromptFromPreset,
  filterKeywordEntries,
  exportPreset,
  importPreset,
} from './presets';
export {
  getSimulationEngine,
  resetSimulationEngine,
  setWorldContext,
  getWorldContext,
  restoreEngineState,
  getEngineState,
  saveEngineState,
  setSimApiOverride,
  // 快照 API
  createSimulationSnapshot,
  restoreSimulationSnapshot,
  deleteSimulationSnapshot,
  getSimulationSnapshots,
  clearAllSimulationSnapshots,
} from './SimulationApi';
export { extractWorldContext } from './worldContext';
