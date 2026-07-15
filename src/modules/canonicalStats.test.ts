// canonicalStats 单测:规范键兜底 + 实时存档键补自定义
import { test, expect } from 'bun:test';
import { getCanonicalStatOptions, getStatOptionsFromState } from './canonicalStats';
import type { GameState } from '../schema/variables';
import { createDefaultGameState } from '../schema/variables';

test('固定规范键含 attrA/attrB/dim1~dim6', () => {
  const opts = getCanonicalStatOptions();
  const vals = opts.map((o) => o.value);
  expect(vals).toContain('attrA');
  expect(vals).toContain('attrB');
  for (let i = 1; i <= 6; i++) expect(vals).toContain(`dim${i}`);
  expect(opts.length).toBe(8);
});

test('无存档时退化为固定规范键', () => {
  expect(getStatOptionsFromState(undefined)).toEqual(getCanonicalStatOptions());
  expect(getStatOptionsFromState({} as GameState)).toEqual(getCanonicalStatOptions());
});

test('实时存档的自定义特殊属性键会被补进下拉', () => {
  const s = createDefaultGameState();
  s.玩家.生存状态['声望'] = 50; // 非规范键
  const opts = getStatOptionsFromState(s);
  const vals = opts.map((o) => o.value);
  expect(vals).toContain('attrA'); // 固定键仍在
  expect(vals).toContain('声望'); // 自定义键补入
});

test('固定键不会被重复列出', () => {
  const s = createDefaultGameState();
  s.玩家.生存状态['dim1'] = 30; // 已是规范键
  const opts = getStatOptionsFromState(s);
  const dim1Count = opts.filter((o) => o.value === 'dim1').length;
  expect(dim1Count).toBe(1);
});
