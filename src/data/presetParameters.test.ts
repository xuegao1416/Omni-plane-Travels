import { expect, test } from 'bun:test';
import { getBuiltinPreset } from './builtinPresets';
import { DRC_WORD_COUNT_PROMPT_ID } from './presetDrcV12';
import { getDrcWordRange, setDrcWordRange } from './presetParameters';
import { MacroEngine } from '../engine/macroEngine';

test('word range changes the existing macro and preserves the rest of the entry', () => {
  const base = getBuiltinPreset('drc_v12');
  expect(getDrcWordRange(base)).toEqual({ min: 800, max: 1000 });
  const edited = setDrcWordRange(base, 600, 1400);
  const before = base.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID)!;
  const after = edited.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID)!;
  expect(after.content.replace('[大于600小于1400]', '[大于800小于1000]')).toBe(before.content);
  expect(after.enabled).toBe(before.enabled);
  const engine = new MacroEngine();
  engine.resolve(after.content);
  expect(engine.getVar('word_count')).toBe('[大于600小于1400]');
  expect(getDrcWordRange(base)).toEqual({ min: 800, max: 1000 });
});

test('does not silently replace custom text or accept invalid ranges', () => {
  const base = getBuiltinPreset('drc_v12');
  for (const [min, max] of [[800, 600], [800, 800], [NaN, 1000], [100.5, 1000], [100, 20001]]) {
    expect(() => setDrcWordRange(base, min!, max!)).toThrow();
  }
  const custom = { ...base, prompts: base.prompts.map(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID
    ? { ...p, content: '{{setvar::word_count::custom}}' } : p) };
  expect(getDrcWordRange(custom)).toBeNull();
  expect(() => setDrcWordRange(custom, 600, 1000)).toThrow();
});
