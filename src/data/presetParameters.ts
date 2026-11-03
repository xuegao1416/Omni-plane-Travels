import type { PresetPack } from './builtinPresets';
import { DRC_WORD_COUNT_PROMPT_ID } from './presetDrcV12';

const WORD_RANGE_MACRO = /\{\{setvar::word_count::\[大于(\d+)小于(\d+)\]\}\}/i;
const BUILTIN_WORD_RANGE = /(正文字数要求：<contenttext> 正文内容每次必须在 )(\d+)-(\d+)( 字之间)/;

export function getPresetWordRangeEntry(preset: PresetPack) {
  const drcEntry = preset.prompts.find(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID);
  if (drcEntry) return drcEntry;
  return preset.prompts.find(p => p.identifier === 'output_format' && BUILTIN_WORD_RANGE.test(p.content));
}

export function getPresetWordRange(preset: PresetPack): { min: number; max: number } | null {
  const entry = getPresetWordRangeEntry(preset);
  if (!entry) return null;
  const macroMatch = entry.content.match(WORD_RANGE_MACRO);
  if (macroMatch) return { min: Number(macroMatch[1]), max: Number(macroMatch[2]) };
  const builtinMatch = entry.content.match(BUILTIN_WORD_RANGE);
  return builtinMatch ? { min: Number(builtinMatch[2]), max: Number(builtinMatch[3]) } : null;
}

export function setPresetWordRange(preset: PresetPack, min: number, max: number): PresetPack {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max > 20000 || min >= max) {
    throw new Error('字数应为 100–20000 的整数，且最大字数必须大于最小字数。');
  }
  const entry = getPresetWordRangeEntry(preset);
  if (!entry || !getPresetWordRange(preset)) throw new Error('此条目使用自定义字数文本，请在高级条目中编辑。');
  return { ...preset, prompts: preset.prompts.map(p => {
    if (p.identifier !== entry.identifier) return p;
    const content = WORD_RANGE_MACRO.test(p.content)
      ? p.content.replace(WORD_RANGE_MACRO, `{{setvar::word_count::[大于${min}小于${max}]}}`)
      : p.content.replace(BUILTIN_WORD_RANGE, `$1${min}-${max}$4`);
    return { ...p, content };
  }) };
}

/**
 * 把已改成自定义文本的字数条目重置回规范区间宏，让「字数模式」的快捷输入重新可用。
 *
 * 与 setPresetWordRange 的区别：本函数用于双人成行的结构化字数条目被改成自定义文本的情况，
 * 会覆盖该条目的自定义正文。必须由用户显式点击触发，不做静默替换。
 */
export function resetPresetWordRange(preset: PresetPack, min = 800, max = 1000): PresetPack {
  if (!Number.isInteger(min) || !Number.isInteger(max) || min < 100 || max > 20000 || min >= max) {
    throw new Error('字数应为 100–20000 的整数，且最大字数必须大于最小字数。');
  }
  if (!preset.prompts.some(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID)) {
    throw new Error('当前预设没有字数条目，无法改用区间模式。');
  }
  const content = `{{setvar::word_count::[大于${min}小于${max}]}}{{trim}}\n{{//字数设定，如:[大于600小于1400]字，600为最小字数，1000为最大字数}}{{trim}}`;
  return { ...preset, prompts: preset.prompts.map(p => p.identifier === DRC_WORD_COUNT_PROMPT_ID
    ? { ...p, content }
    : p) };
}
