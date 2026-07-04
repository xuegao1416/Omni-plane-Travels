// ============================================================
//  世界模板注册表
// ============================================================

import type { WorldTemplate } from '../types';
import { fantasyTemplate } from './fantasy';
import { scifiTemplate } from './scifi';
import { modernTemplate } from './modern';
import { historicalTemplate } from './historical';

/** 所有内置世界模板 */
export const WORLD_TEMPLATES: WorldTemplate[] = [
  fantasyTemplate,
  scifiTemplate,
  modernTemplate,
  historicalTemplate,
];

/** 按 ID 查找模板 */
export function getTemplateById(id: string): WorldTemplate | undefined {
  return WORLD_TEMPLATES.find(t => t.id === id);
}

/** 按分类获取模板 */
export function getTemplatesByCategory(category: WorldTemplate['category']): WorldTemplate[] {
  return WORLD_TEMPLATES.filter(t => t.category === category);
}
