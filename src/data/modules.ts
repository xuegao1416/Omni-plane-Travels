// ============================================================
//  世界模块系统 — 旧格式兼容层
//  模块定义已统一到 ModuleSelector.tsx 的 MODULE_OPTIONS
//  此文件仅保留旧格式存档所需的渲染类型映射
// ============================================================

/** 模块渲染类型（旧格式存档兼容） */
export type ModuleRenderType = 'stats' | 'progression' | 'tags' | 'resource_list' | 'event_list' | 'dice' | 'text';

/** moduleId → renderType 映射（旧格式存档渲染用） */
const MODULE_RENDER_MAP: Record<string, ModuleRenderType> = {
  stat: 'stats',
  progression: 'progression',
  combat: 'tags',
  survival: 'resource_list',
  business: 'resource_list',
  event: 'event_list',
  dice: 'dice',
  talent: 'tags',
  custom_prompt: 'text',
};

/** 根据模块ID获取渲染类型（旧格式兼容） */
export function getModuleTemplate(moduleId: string): { renderType: ModuleRenderType } | undefined {
  const renderType = MODULE_RENDER_MAP[moduleId];
  return renderType ? { renderType } : undefined;
}
