// ============================================================
//  WorldModule canonicalization helpers
// ============================================================

import type { WorldModule } from '@/data/worlds-schema';
import type { ProgressionModuleSchema } from './schema';
import { normalizeProgressionConfig } from './xpAlgorithm';

/**
 * Normalize the current WorldModule shape.
 *
 * Historical `WorldModule.data` support has been retired. Runtime/editor code
 * consumes only `moduleConfig + initialState`; progression still receives its
 * canonical config normalizer here.
 */
export function normalizeModule(mod: WorldModule): WorldModule {
  return mod.moduleId === 'progression' && mod.moduleConfig
    ? {
        ...mod,
        moduleConfig: normalizeProgressionConfig(
          mod.moduleConfig as unknown as ProgressionModuleSchema,
        ) as unknown as Record<string, unknown>,
      }
    : mod;
}

export function normalizeModules(modules: WorldModule[]): WorldModule[] {
  return modules.map(normalizeModule);
}

/**
 * 归一化 special 字段（stat 模块）
 * 支持多种输入格式：
 * - string[] → [{ name, value: 0 }]
 * - { name, value? }[] → [{ name, value }]
 * - { id, name, value? }[] → [{ name, value }]
 */
export function normalizeSpecial(special: unknown): Array<{ name: string; value: number }> {
  if (!Array.isArray(special)) return [];
  return special
    .filter((s): s is string | Record<string, unknown> => s != null)
    .map((s) => {
      if (typeof s === 'string') return { name: s, value: 0 };
      const name = (s.name as string) || (s.id as string) || '';
      const value = typeof s.value === 'number' ? s.value : 0;
      return { name, value };
    })
    .filter((s) => s.name !== '');
}

/**
 * 从 special 数组提取 config 格式（用于 moduleConfig.special）
 * 输入：[{ id?, name, value?, range?, description? }]
 * 输出：[{ id, name, range, description }]
 */
export function buildSpecialConfig(special: unknown): Array<{
  id: string;
  name: string;
  range: [number, number];
  description: string;
}> {
  if (!Array.isArray(special)) return [];
  return special
    .filter((s): s is Record<string, unknown> => s != null && typeof s === 'object')
    .map((s) => ({
      id: (s.id as string) || '',
      name: (s.name as string) || '',
      range: (Array.isArray(s.range) && s.range.length >= 2 ? s.range : [0, 100]) as [number, number],
      description: (s.description as string) || '',
    }))
    .filter((s) => s.name !== '');
}

/**
 * 从 special 数组提取状态格式（用于 initialState.special）
 * 输入：[{ id?, name, value? }]
 * 输出：{ [id]: value }
 */
export function buildSpecialState(special: unknown): Record<string, number> {
  if (!Array.isArray(special)) return {};
  const state: Record<string, number> = {};
  for (const s of special as Array<Record<string, unknown>>) {
    const id = (s.id as string) || (s.name as string) || '';
    const value = typeof s.value === 'number' ? s.value : 0;
    if (id) state[id] = value;
  }
  return state;
}
