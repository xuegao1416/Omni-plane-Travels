// 选择式世界生成管线 — 公共 API
// ============================================================

export type {
  DimensionChoice,
  DimensionGeneration,
  DimensionSelection,
  DimensionConfig,
  ChoiceFlowState,
  ChoicePipelineConfig,
} from './types';

export { DIMENSIONS, buildChoicePrompt } from './prompts';
export { assembleFromChoices } from './assembler';
export {
  generateAllOptions,
  generateWorldFromSelections,
  generateModuleEntries,
  getDimensions,
} from './choicePipeline';
