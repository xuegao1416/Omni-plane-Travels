// ============================================================
//  统一 WorldModule 数据格式 — normalizeModule
//  将旧格式 `data` 转换为新格式 `moduleConfig` + `initialState`
// ============================================================

import type { WorldModule } from '@/data/worlds-schema';

/**
 * 将 WorldModule 统一为新格式（moduleConfig + initialState）
 *
 * - 已有 moduleConfig 且无 data → 原样返回
 - 有 data 但无 moduleConfig → 拆分为 moduleConfig + initialState
 * - 两者都有 → 以 moduleConfig 为准，删除 data
 */
export function normalizeModule(mod: WorldModule): WorldModule {
  // 已经是新格式，无需转换
  if (mod.moduleConfig && !mod.data) return mod;

  const data = mod.data as Record<string, unknown> | undefined;
  if (!data || Object.keys(data).length === 0) {
    // data 为空，直接删除
    const { data: _, ...rest } = mod;
    return rest;
  }

  switch (mod.moduleId) {
    case 'stat':
      return normalizeStatModule(mod, data);
    case 'progression':
      return normalizeProgressionModule(mod, data);
    default:
      return normalizeGenericModule(mod, data);
  }
}

/** stat 模块：从 data 拆分出 moduleConfig（定义）和 initialState（初始值） */
function normalizeStatModule(mod: WorldModule, data: Record<string, unknown>): WorldModule {
  const config: Record<string, unknown> = {};
  const state: Record<string, unknown> = {};

  // attrA / attrB：拆 name+max → config，current → state
  for (const key of ['attrA', 'attrB']) {
    const attr = data[key] as Record<string, unknown> | undefined;
    if (attr && typeof attr === 'object') {
      config[key] = { name: attr.name, max: attr.max };
      if (attr.current != null) state[key] = attr.current;
    }
  }

  // 六维 dim1~dim6：拆 name+range → config，value → state
  for (let i = 1; i <= 6; i++) {
    const dimKey = `dim${i}`;
    const dim = data[dimKey] as Record<string, unknown> | undefined;
    if (dim && typeof dim === 'object') {
      config[dimKey] = { name: dim.name, range: dim.range };
      if (dim.value != null) state[`${dimKey}Value`] = dim.value;
    }
  }

  // special：定义 → config，值 → state
  if (Array.isArray(data.special)) {
    config.special = data.special.map((sp: Record<string, unknown>) => ({
      id: sp.id, name: sp.name, value: sp.value, range: sp.range, description: sp.description,
    }));
    const specialState: Record<string, number> = {};
    for (const sp of data.special as Array<Record<string, unknown>>) {
      if (sp.id && sp.value != null) specialState[sp.id as string] = sp.value as number;
    }
    if (Object.keys(specialState).length > 0) state.special = specialState;
  }

  return {
    ...mod,
    moduleConfig: mod.moduleConfig || config,
    initialState: mod.initialState || state,
    data: undefined,
  };
}

/** progression 模块：拆分 config（模式/段位定义）和 state（当前段位/经验） */
function normalizeProgressionModule(mod: WorldModule, data: Record<string, unknown>): WorldModule {
  const config: Record<string, unknown> = {};
  const state: Record<string, unknown> = {};

  // 配置字段
  if (data.mode) config.mode = data.mode;
  if (data.xpFormula) config.xpFormula = data.xpFormula;
  if (data.tiers) config.tiers = data.tiers;
  if (data.levelData) config.levelData = data.levelData;

  // 状态字段
  if (data.currentTierIndex != null) state.currentTierIndex = data.currentTierIndex;
  if (data.currentXP != null) state.currentXP = data.currentXP;

  return {
    ...mod,
    moduleConfig: mod.moduleConfig || config,
    initialState: mod.initialState || (Object.keys(state).length > 0 ? state : undefined),
    data: undefined,
  };
}

/** 通用模块（survival/business/dice/talent 等）：data 整体 → moduleConfig */
function normalizeGenericModule(mod: WorldModule, data: Record<string, unknown>): WorldModule {
  return {
    ...mod,
    moduleConfig: mod.moduleConfig || data,
    data: undefined,
  };
}

/** 批量规范化整个 modules 数组 */
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
