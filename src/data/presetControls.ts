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

const SPEC_LABEL = { plot: '剧情推进', character: '角色表现', correction: '表达修正' } as const;

export const DRC_PERSPECTIVE_NOTICE = 'DRC 人称与视角由宿主统一管理，请使用现有「玩家视角」设置。';

const SELF_STYLES = [
  ['writing_style', '默认文风'], ['style_light_novel', '轻小说'], ['style_banter', '轻松吐槽'],
  ['style_campus', '校园青春'], ['style_baimiao', '白描'], ['style_wuxia', '古风武侠'],
  ['style_prose', '散文'], ['style_freeform', '自由随性'],
] as const;

// Explicit ordinary-writing allowlists exclude placeholder entries, internal
// reasoning controls and the legacy perspective entries managed by the host.
const DRC_STYLE_IDS = [
  '7f5a80d3-8b2a-443d-9bea-b25b5a4bf15e',
  '542eb285-7582-47f4-a0ca-aa3781f88ddd',
  'c8e99048-132d-4cdd-a77d-0e0eb30ef093',
  '08df7bf2-01a7-43f3-9a41-e61805b91fbf',
  '2c06edd7-2ba0-4388-b095-95526e916f8a',
  'hulu-style-romance-1f5fb0de-6171-49bd-a3b8-2a7820be53f4',
  '28906fc6-9b8b-484c-a5d1-7c41a1f5a7d6',
  '34ead477-4c68-49e1-a2ee-004d823e9482',
  'fb97d0f8-db42-4561-a18a-fb03827099fd',
  '657ed44d-cc9e-43c5-af81-7ee548933833',
  '8daa005a-79c7-4e45-8b93-d0d1ca65afca',
  '17939e9f-38b7-4f84-92be-5d2d66fd3760',
  'b665f40e-f8e7-4f41-a081-9612f9a1558c',
  '276458a7-26ed-4bab-bfd9-ef767834a2bc',
  'hulu-style-russian-suffering-e7e698ad-24a2-4efa-a481-d85a6aa19bc2',
  'hulu-style-comedy-webnovel-3edc4691-e05a-4f5b-bb01-b68d0920e43b',
  'hulu-style-dark-fantasy-111cf67d-9e76-45d6-b117-8445a7893496',
  '2224b8e7-d998-4359-933c-db0f066385c9',
  '91748f9e-8a1a-4fde-942e-0310bdc4b100',
  'f859b478-7dc2-4f8d-9cc6-1ef520bfe6b3',
  '9c79c34c-1c00-4948-b4a5-bc9ffe154702',
  '1ba3a44c-e9a2-461b-ba70-f60e0857025e',
  '4caf4987-e5c4-45ce-872a-b7cebfe7d951',
  '67d1b236-d330-4344-b29f-fe6df921f01f',
  '57b73db3-c1de-4422-9ebd-47b0258de3a3',
  'de77fbcc-c265-4cab-8ca7-ca4cd63fec81',
  'a1daf5fe-5d7b-4e16-b4f8-768facbe13c0',
  '3fb2e533-2cb8-4117-847c-1f69139b1d0f',
  'd52f1dd3-297b-4a58-a1d3-3628d8cb6ccb',
  'd11f572d-89b6-4226-9431-511639eaf49f',
  '1d67cc23-a146-474c-98cf-3a271a2a85fa',
] as const;

const byIds = (preset: PresetPack, ids: readonly string[]) => ids.flatMap(id =>
  preset.prompts.filter(prompt => prompt.identifier === id),
);
const isDrc = (preset: PresetPack) => preset.prompts.some(p => p.identifier === 'drc_host_perspective_protocol');

function choice(id: string, label: string, entries: PresetPromptEntry[], labels?: string[]): PresetChoiceControl {
  return { id, label, section: '创作偏好', allowOff: true, options: entries.map((entry, index) => ({
    value: entry.identifier, label: labels?.[index] ?? entry.name, promptIds: [entry.identifier],
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
    const writingControl = choice('drc_writing_style', '文风', byIds(preset, DRC_STYLE_IDS));
    writingControl.exclusivePromptIds = [...new Set([
      ...writingControl.options.flatMap(option => option.promptIds),
      ...preset.prompts.filter(p => !!p.content.match(/\{\{setvar::base_writing::([\s\S]*?)\}\}/i)?.[1]?.trim()).map(p => p.identifier),
    ])];
    controls.push(
      writingControl,
      choice('emotional_tone', '情感基调', byIds(preset, [
      'c8b215ef-c7c5-484f-9cfe-ffd747d86410',
      'fd134cc1-c391-4a14-9419-2facf220cbd5',
      '63d32a0f-e881-4ec1-9c5d-ee4e506dd75d',
      'aa825723-2c20-4491-842f-f2ae6417da5f',
      'ae90e752-d3ea-469c-9723-fa406abe88ca',
      'b061c539-3c15-4130-be66-881c95d034d2',
    ])),
      choice('word_count', '字数模式', byIds(preset, [
      '4b3a89f3-09fb-4586-a5e3-bc2f90f2de97',
      '7587cb6d-3805-4799-bdfd-985088bd834f',
    ])),
      choice('pacing', '叙事节奏', byIds(preset, [
      '97d55b7f-d84b-4733-9d6a-88e749ea307f',
      'a477edba-e51b-4957-af5b-6d8c6128589e',
      'f202e58f-0f66-4f41-b419-5862e97a874c',
    ])),
      choice('inner_monologue', '角色内心独白', byIds(preset, [
      '53e3d71b-988f-4198-a429-2de05a1cf673',
      'c13f872c-82ca-423c-9c13-702ff403f0d8',
      '5ce29ea8-3b55-4c80-aff6-cdd3df3d68f7',
    ])),
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
  const specs: { id: string; label: string; ids?: string[] }[] = [
    { id: 'kunlun_stitch_slots', label: '昆仑缝合槽位', ids: ['c3dcdb36-962b-406f-a1bd-d561e02fad78', 'cdd0e08a-13ff-461c-b4c0-327b98ee7763', 'd95d83e2-6437-499d-a4ea-5342c72dcb02', '37ec235a-3941-436a-b199-1d9941c6e1ac', '379c9c90-0684-41f8-bd7a-abc7e6055b70', '495fde01-a8db-4687-96c6-c9d0fbb64f64', '20ed10e2-3771-4e83-9121-186259b5fa81', '3febb15d-c852-48aa-acbf-3652a6dcf5f8'] },
    { id: 'gemini_compatibility', label: 'Gemini 兼容', ids: ['exp_tail_sensitive'] },
    { id: 'plot', label: SPEC_LABEL['plot'], ids: ['017ca920-6057-4a08-944f-37a08cb81ab8', 'fe46236a-427d-4a08-8e2a-6f6405f1d524', '4350c77d-8c88-41c9-a1e2-407368da0790', 'a0bc9bd6-db57-4938-b2de-22d6c95968ea'] },
    { id: 'character', label: SPEC_LABEL['character'], ids: [
      'anti_omniscience',
      'anti_pandering_switch',
      'emotional_balance',
      'figure_crafting',
      'calling_consistency',
      'dialogue_balance',
      '7c2d9e84-1a5f-4b36-9d08-2e6f7a8b9c0d',
      'f6d5d3fb-7d75-4f9f-8c6d-4b5d0b8c2c5a',
      'b7e2f4c1-6a9d-4f83-9c2e-5d7a1b8f3046',
      '9a5fe514-2b7c-46f0-a730-c7903ba6c821',
      '90892916-902a-495e-a24d-3a5816d725e5',
      '60d89cd3-b49f-4990-befa-6b1f477fd2c8',
      'dfad3d39-ed1a-44a6-b808-72c9d7feb93d',
      '76a49a05-1443-412d-9f6b-0add04a3c3bc',
      'bda99b2d-dffb-4e0f-9e6d-a7b5abc24f6f',
      '809aa33c-54a3-46e5-97fd-db5f3b1e2d65',
      '7463f7c8-6f41-486c-94ea-11baaea78173',
    ] },
    { id: 'correction', label: SPEC_LABEL['correction'], ids: [
      'anti_formula',
      'anti_metaphor',
      'anti_reveal',
      'anti_voice_desc',
      'anti_synesthesia',
      'anti_shaguanlian',
      'anti_micro_macro',
      '61353a1a-7f0a-406d-9179-86b036f870e3',
      'd95bdac6-6e68-422f-b525-ea3989a74f09',
      'efb69955-b5eb-4744-ad28-57f9e352b747',
      'e63cfaff-0ce0-493e-91d1-6cc9fa205191',
      'c73e6224-5063-4275-a107-0181691e4030',
      'd60f4718-f053-44c2-bf0d-fece187ef1ff',
      '42d19d3b-5bc3-4757-a269-f638434173d6',
      'ded39ef4-dbca-4d54-8eb0-d992603b44b1',
      'f93a3cad-a3b1-401d-a758-e8918ec681e9',
      'e2553a13-f789-4097-953d-052e61c35636',
      '2ea831e6-4b97-40f0-a5ad-307ee8cbcbe7',
      'f458bf04-6951-4810-9136-0a05dca5ff93',
      'e91b322d-445a-48ae-b288-dbb298d3bcbd',
      '4b892b37-3cbc-4d36-af69-b07d0db9c8bd',
      '58b1885f-0f3a-4cd2-9af4-94b29219e38b',
      '6775f10c-bba4-4161-b5da-1a1e3e240ca9',
      '3f43d947-d3f6-47a5-a2bf-258b29b90e04',
      'a4c72e19-5f38-4d6a-9b21-e7c30f845162',
      '006f4504-3b87-40ce-a6b7-c490192e9798',
    ] },
    { id: 'host_compatibility', label: '宿主兼容', ids: ['drc_optional_format_repair', 'drc_dialogue_avatar_protocol'] },
  ];
  return specs.map(spec => ({
    id: spec.id, label: spec.label,
    promptIds: preset.prompts.filter(p => spec.ids?.includes(p.identifier)).map(p => p.identifier),
  })).filter(section => section.promptIds.length > 0);
}
