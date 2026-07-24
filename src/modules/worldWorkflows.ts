// ============================================================
//  内置世界工作流定义
//  已清空旧规则工作流，等待新架构重建
// ============================================================
import type { WorkflowDefinition } from './workflowSchema';

/** 内置世界工作流映射（已清空，等待新架构重建） */
export const WORLD_WORKFLOWS: Record<string, () => WorkflowDefinition> = {};
