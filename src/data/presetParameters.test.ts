import { expect, test } from 'bun:test';
import { getBuiltinPreset } from './builtinPresets';
import { DRC_WORD_COUNT_PROMPT_ID } from './presetDrcV12';
import { getPresetWordRange, resetPresetWordRange, setPresetWordRange } from './presetParameters';
import { MacroEngine } from '../engine/macroEngine';

test('word range changes the existing macro and preserves the rest of the entry', () => {
  const base = getBuiltinPreset('drc_v12');
  expect(getPresetWordRange(base)).toEqual({ min: 800, max: 1000 });
  const edited = setPresetWordRange(base, 600, 1400);
  const before = base.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID)!;
  const after = edited.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID)!;
  expect(after.content.replace('[大于600小于1400]', '[大于800小于1000]')).toBe(before.content);
  expect(after.enabled).toBe(before.enabled);
  const engine = new MacroEngine();
  engine.resolve(after.content);
  expect(engine.getVar('word_count')).toBe('[大于600小于1400]');
  expect(getPresetWordRange(base)).toEqual({ min: 800, max: 1000 });
});

test('does not silently replace custom text or accept invalid ranges', () => {
  const base = getBuiltinPreset('drc_v12');
  for (const [min, max] of [[800, 600], [800, 800], [NaN, 1000], [100.5, 1000], [100, 20001]]) {
    expect(() => setPresetWordRange(base, min!, max!)).toThrow();
  }
  const custom = { ...base, prompts: base.prompts.map(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID
    ? { ...p, content: '{{setvar::word_count::custom}}' } : p) };
  expect(getPresetWordRange(custom)).toBeNull();
  expect(() => setPresetWordRange(custom, 600, 1000)).toThrow();
});

test('resetPresetWordRange 把自定义文本恢复为可解析的区间宏，且不动其他条目', () => {
  const base = getBuiltinPreset('drc_v12');
  const custom = { ...base, prompts: base.prompts.map(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID
    ? { ...p, content: '{{setvar::word_count::custom}}' } : p) };
  expect(getPresetWordRange(custom)).toBeNull();

  const restored = resetPresetWordRange(custom, 1200, 1800);
  expect(getPresetWordRange(restored)).toEqual({ min: 1200, max: 1800 });
  // 原预设不被就地修改
  expect(getPresetWordRange(custom)).toBeNull();
  expect(restored.prompts).toHaveLength(custom.prompts.length);

  // 默认区间与非法区间
  expect(getPresetWordRange(resetPresetWordRange(custom))).toEqual({ min: 800, max: 1000 });
  expect(() => resetPresetWordRange(custom, 1800, 1200)).toThrow();
  expect(() => resetPresetWordRange(custom, NaN, 1000)).toThrow();
});

test('默认内置预设也可在快捷配置中修改字数范围', () => {
  const base = getBuiltinPreset('default');
  expect(getPresetWordRange(base)).toEqual({ min: 1000, max: 2000 });

  const edited = setPresetWordRange(base, 1200, 1800);
  expect(getPresetWordRange(edited)).toEqual({ min: 1200, max: 1800 });
  expect(edited.prompts.find(p => p.identifier === 'output_format')?.content).toContain('必须在 1200-1800 字之间');
  expect(getPresetWordRange(base)).toEqual({ min: 1000, max: 2000 });
});
