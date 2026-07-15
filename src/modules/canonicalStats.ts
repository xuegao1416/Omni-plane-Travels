// 规范属性键 —— 修 mod 规则 effect.statId 自由字符串"沉默失败"的坑。
//
// 背景:引擎里每个世界的数值都落在 `玩家.生存状态` 上,键是**统一的**:
//   attrA = 生命, attrB = 能量, dim1~dim6 = 六维。
// 显示名随世界不同,但引擎键固定。作者若在 CardEditor 手打「生命」而非
// attrA,applyStatDelta 会因 key 不存在而静默跳过(warn 但不生效)。
// 本模块把可选键收敛成规范下拉,让作者闭眼选也不会写错 key → 事件跨存档自适应。

import type { GameState } from '../schema/variables';

export interface CanonicalStatOption {
  value: string;
  label: string;
}

// 引擎固定键(所有启用数值模块的世界一致)
const FIXED_OPTIONS: CanonicalStatOption[] = [
  { value: 'attrA', label: '生命 (attrA)' },
  { value: 'attrB', label: '能量 (attrB)' },
  { value: 'dim1', label: '六维 dim1' },
  { value: 'dim2', label: '六维 dim2' },
  { value: 'dim3', label: '六维 dim3' },
  { value: 'dim4', label: '六维 dim4' },
  { value: 'dim5', label: '六维 dim5' },
  { value: 'dim6', label: '六维 dim6' },
];

/** 固定规范键(不依赖任何存档) */
export function getCanonicalStatOptions(): CanonicalStatOption[] {
  return FIXED_OPTIONS;
}

/**
 * 从当前存档实际键生成选项:固定键打底,再补上该存档独有的特殊属性键。
 * 这样即便某世界有自定义特殊属性,作者也能在下拉里选中它。
 * 传 undefined 时退化为固定规范键(事件中心编辑、无游戏运行时)。
 */
export function getStatOptionsFromState(state?: GameState): CanonicalStatOption[] {
  const base = FIXED_OPTIONS;
  if (!state?.玩家?.生存状态) return base;
  const live = Object.keys(state.玩家.生存状态);
  const known = new Set(base.map((b) => b.value));
  const extra = live
    .filter((k) => !known.has(k))
    .map((k) => ({ value: k, label: `${k} (自定义)` }));
  return [...base, ...extra];
}

/** 下拉里「自定义…」选项的哨兵值 */
export const CUSTOM_STAT_SENTINEL = '__custom_stat__';
