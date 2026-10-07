import type { PresetPack, PresetPromptEntry } from './builtinPresets';

/** Controls are projections of prompt.enabled; they never store a second configuration. */
export interface PresetChoiceControl {
  id: string;
  label: string;
  section: string;
  options: { value: string; label: string; promptIds: string[] }[];
  allowOff: boolean;
  /** 同组未提供快捷选项的条目也参与互斥，避免选择普通文风后仍被旧文风覆盖。 */
  exclusivePromptIds?: string[];
}

export interface PresetToggleSection {
  id: string;
  label: string;
  promptIds: string[];
}

export const DRC_PERSPECTIVE_NOTICE = 'DRC 人称与视角由宿主统一管理，请使用现有「玩家视角」设置。';

const SELF_STYLES = [
  ['writing_style', '默认文风'], ['style_light_novel', '轻小说'], ['style_banter', '轻松吐槽'],
  ['style_campus', '校园青春'], ['style_baimiao', '白描'], ['style_wuxia', '古风武侠'],
  ['style_prose', '散文'], ['style_freeform', '自由随性'],
] as const;

// Explicit ordinary-writing allowlists exclude adult content, jailbreaks, internal
// reasoning controls and the legacy perspective entries managed by the host.
const DRC_STYLE_NAMES = [
  '🔖丨N-轻小说', '🔖丨烤面包机@电波系', '🔖丨流转心跳叙事@四神花ル水',
  '🔖丨碎嘴子@YO', '🔖丨吐槽文风@S姐', '🔖丨恋爱小说@呼噜',
  '🧸丨旧录像带质感（测试）', '🧸丨冷冽与梦核', '🧸丨白描文风@凝嘤嘤',
  '🧸丨晋江文学@凝嘤嘤', '🎭丨显性高压', '🎭丨魔幻现实', '🎭丨深渊童谣（测试）',
  '🎭丨后311@natami', '📚丨俄式苦难文风@呼噜', '🖌️丨搞笑网文@呼噜',
  '📚丨暗黑西幻@呼噜', '📚丨写实西幻', '🖌️丨修仙日常文风@高欢',
  '📚丨散文小说（测试 使用者多反馈）', '📚丨西方魔幻', '📚丨辰东网文',
  '📚丨古风言情@呼噜', '🍵丨四字为锋', '🍵丨红楼一梦@四神花ル水',
  '🍵丨花间辞色体@YO姐', '🖌️丨散文', '🖌️丨瞎勾八写吧你就（杀™八股）',
  '🖌️丨群像文风', '🖌️丨自适应文风@小回', '🖌️丨黑色幽默@Q老师力作',
] as const;

const cleanLabel = (name: string) => name.split('丨').at(-1) ?? name;
const byNames = (preset: PresetPack, names: readonly string[]) => names.flatMap(name =>
  preset.prompts.filter(prompt => prompt.name === name),
);
const isDrc = (preset: PresetPack) => preset.prompts.some(p => p.identifier === 'drc_host_perspective_protocol');

function choice(id: string, label: string, entries: PresetPromptEntry[], labels?: string[]): PresetChoiceControl {
  return { id, label, section: '创作偏好', allowOff: true, options: entries.map((entry, index) => ({
    value: entry.identifier, label: labels?.[index] ?? cleanLabel(entry.name), promptIds: [entry.identifier],
  })) };
}

export function getPresetChoiceControls(preset: PresetPack): PresetChoiceControl[] {
  const controls: PresetChoiceControl[] = [];
  const styles = SELF_STYLES.flatMap(([id, label]) => {
    const prompt = preset.prompts.find(p => p.identifier === id);
    return prompt ? [{ prompt, label }] : [];
  });
  if (styles.length) controls.push(choice('writing_style', '文风', styles.map(s => s.prompt), styles.map(s => s.label)));
  if (isDrc(preset)) {
    const writingControl = choice('drc_writing_style', '文风', byNames(preset, DRC_STYLE_NAMES));
    writingControl.exclusivePromptIds = [...new Set([
      ...writingControl.options.flatMap(option => option.promptIds),
      ...preset.prompts.filter(p => !!p.content.match(/\{\{setvar::base_writing::([\s\S]*?)\}\}/i)?.[1]?.trim()).map(p => p.identifier),
    ])];
    controls.push(
      writingControl,
      choice('emotional_tone', '情感基调', byNames(preset, ['🌕丨无基调', '🌕丨治愈', '🌕丨伤感', '🌕丨积极', '🌕丨消极', '🌕丨先苦后甜@YO'])),
      choice('personality', '人格补充', byNames(preset, ['😀丨人格补充（简）', '😀丨人格补充（中）'])),
      choice('word_count', '字数模式', byNames(preset, ['💬丨字数设定', '💬丨无字数需求'])),
      choice('pacing', '叙事节奏', byNames(preset, ['🐢丨慢速·细写', '🚶丨中速·标准', '🚀丨快速·赶路'])),
      choice('inner_monologue', '角色内心独白', byNames(preset, ['❣️丨内心话：全体角色', '❣️丨内心话：仅用户角色', '❣️丨内心话：非用户角色'])),
    );
  }
  return controls.filter(control => control.options.length > 0).map(control => control.id === 'personality'
    ? { ...control, options: control.options.map(option => ({ ...option, label: option.label.includes('（简）') ? '简' : '中' })) }
    : control);
}

export function getChoiceValue(preset: PresetPack, control: PresetChoiceControl): string {
  const enabledIds = new Set(preset.prompts.filter(p => p.enabled).map(p => p.identifier));
  const active = control.options.filter(option => option.promptIds.some(id => enabledIds.has(id)));
  const mappedIds = new Set(control.options.flatMap(option => option.promptIds));
  if (control.exclusivePromptIds?.some(id => enabledIds.has(id) && !mappedIds.has(id))) return '__mixed__';
  if (!active.length) return '';
  if (active.length > 1 || !active[0]!.promptIds.every(id => enabledIds.has(id))) return '__mixed__';
  return active[0]!.value;
}

export function selectPresetChoice(preset: PresetPack, control: PresetChoiceControl, value: string): PresetPack {
  const option = control.options.find(o => o.value === value);
  if ((!value && !control.allowOff) || (value && !option)) return preset;
  const ids = new Set(control.exclusivePromptIds ?? control.options.flatMap(o => o.promptIds));
  const selectedIds = new Set(option?.promptIds ?? []);
  const enableSlot = control.id === 'writing_style' && !!option;
  return { ...preset, prompts: preset.prompts.map(prompt => {
    const enabled = ids.has(prompt.identifier) ? selectedIds.has(prompt.identifier)
      : enableSlot && prompt.identifier === 'writing_style_slot' ? true : prompt.enabled;
    return enabled === prompt.enabled ? prompt : { ...prompt, enabled };
  }) };
}

export function getPresetToggleSections(preset: PresetPack): PresetToggleSection[] {
  const specs: { id: string; label: string; ids?: string[]; names?: string[] }[] = [
    { id: 'plot', label: '剧情推进', names: ['⚠️丨只复述', '⚠️丨防复述', '⚠️丨扩写后推进', '⚠️丨扩写+加强复述'] },
    { id: 'character', label: '角色表现', ids: ['anti_omniscience', 'anti_pandering_switch', 'emotional_balance', 'figure_crafting', 'calling_consistency', 'dialogue_balance'], names: ['😀丨活人对白', '😀丨叙事推进基准', '💗丨情感浓度', '🤔丨反抢话', '🤔丨NPC引入', '🤔丨生动化', '🤔丨反极端', '🤔丨Char主动', '🤔丨User去中心化', '📢丨增加对白', '📢丨增加NPC对白'] },
    { id: 'correction', label: '表达修正', ids: ['anti_formula', 'anti_metaphor', 'anti_reveal', 'anti_voice_desc', 'anti_synesthesia', 'anti_shaguanlian', 'anti_micro_macro'], names: ['❎丨抗过拟合', '❎丨杀比拟', '❎丨杀定语', '❎丨杀揭示', '❎丨反神化', '❎丨杀说明', '❎丨杀声述', '❎丨白描', '❎丨杀超雄', '❎丨杀骨骼描写', '❎丨杀转折词', '❎丨微观与宏观', '❎丨情绪化通感', '❎丨占有与支配', '❎丨杀过去对比', '🤔丨防重复', '🚫丨反绝望', '🚫丨反科幻', '🚫丨反固定', '❗️丨反贫穷化', '🚫丨反全知'] },
    { id: 'host_compatibility', label: '宿主兼容', ids: ['drc_optional_format_repair', 'drc_dialogue_avatar_protocol'] },
  ];
  return specs.map(spec => ({
    id: spec.id, label: spec.label, promptIds: preset.prompts.filter(p =>
      spec.ids?.includes(p.identifier) || (isDrc(preset) && spec.names?.includes(p.name)),
    ).map(p => p.identifier),
  })).filter(section => section.promptIds.length > 0);
}
