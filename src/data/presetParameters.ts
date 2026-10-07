import type { PresetPack } from './builtinPresets';
import { DRC_WORD_COUNT_PROMPT_ID } from './presetDrcV12';

const WORD_RANGE_MACRO = /\{\{setvar::word_count::\[大于(\d+)小于(\d+)\]\}\}/i;

export function getDrcWordRange(preset: PresetPack): { min: number; max: number } | null {
  const entry = preset.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID);
  const match = entry?.content.match(WORD_RANGE_MACRO);
  return match ? { min: Number(match[1]), max: Number(match[2]) } : null;
}

export function setDrcWordRange(preset: PresetPack, min: number, max: number): PresetPack {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max > 20000 || min >= max) {
    throw new Error('字数应为 100–20000 的整数，且最大字数必须大于最小字数。');
  }
  if (!getDrcWordRange(preset)) throw new Error('此条目使用自定义字数文本，请在高级条目中编辑。');
  return { ...preset, prompts: preset.prompts.map(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID
    ? { ...p, content: p.content.replace(WORD_RANGE_MACRO, `{{setvar::word_count::[大于${min}小于${max}]}}`) }
    : p) };
}
