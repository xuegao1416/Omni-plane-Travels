/**
 * Prompt 管理系统 - 统一导出
 * 集中管理所有 AI prompt，方便维护和复用
 */

// 类型定义
export type { CharacterFillOptions } from './editor-prompts';

// 编辑器 AI 相关
export {
  buildCharacterFillPrompt,
  buildNpcCreatePrompt,
  buildNpcFillPrompt,
  buildVariableExtractionPrompt,
} from './editor-prompts';
