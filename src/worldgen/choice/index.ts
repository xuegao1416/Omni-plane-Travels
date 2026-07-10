// 选择式世界生成管线 — 公共 API
// ============================================================

export type {
  DimensionChoice,
  DimensionGeneration,
  DimensionSelection,
} from './types';

export {
  generateWorldFromSelections,
  generateModuleEntries,
} from './choicePipeline';
