import { describe, expect, test } from 'bun:test';
import { getBuiltinPreset, getEnabledPrompts } from './builtinPresets';
import { MacroEngine } from '../engine/macroEngine';
import { getChoiceValue, getPresetChoiceControls, getPresetToggleSections, selectPresetChoice } from './presetControls';

describe('preset graphical controls', () => {
  test('DRC pacing and fictional character monologue options are mutually exclusive', () => {
    const preset = getBuiltinPreset('drc_v12');
    for (const id of ['pacing', 'inner_monologue']) {
      const control = getPresetChoiceControls(preset).find(c => c.id === id)!;
      expect(control.options).toHaveLength(3);
      const first = selectPresetChoice(preset, control, control.options[0]!.value);
      const last = selectPresetChoice(first, control, control.options[2]!.value);
      expect(getChoiceValue(last, control)).toBe(control.options[2]!.value);
      expect(last.prompts.find(p => p.identifier === control.options[0]!.value)?.enabled).toBe(false);
      expect(last.prompts.filter(p => p.identifier.startsWith('drc_host_'))).toEqual(preset.prompts.filter(p => p.identifier.startsWith('drc_host_')));
    }
  });
  test('ordinary DRC style selections also disable unmapped previous writing styles', () => {
    const base = getBuiltinPreset('drc_v12');
    const preset = { ...base, prompts: [...base.prompts, {
      identifier: 'synthetic_old_style', name: '自定义普通文风', role: 'system' as const,
      content: '{{setvar::base_writing::old style}}', enabled: true, order: 900,
    }] };
    const control = getPresetChoiceControls(preset).find(c => c.id === 'drc_writing_style')!;
    expect(getChoiceValue(preset, control)).toBe('__mixed__');
    const selected = selectPresetChoice(preset, control, control.options[0]!.value);
    expect(selected.prompts.find(p => p.identifier === 'synthetic_old_style')?.enabled).toBe(false);
    expect(getChoiceValue(selected, control)).toBe(control.options[0]!.value);
  });
  test('selecting a style disables every old choice without mutating the original', () => {
    const preset = getBuiltinPreset();
    const control = getPresetChoiceControls(preset).find(c => c.id === 'writing_style')!;
    const mixed = { ...preset, prompts: preset.prompts.map(p => p.identifier === 'style_wuxia' ? { ...p, enabled: true } : p) };
    expect(getChoiceValue(mixed, control)).toBe('__mixed__');
    const selected = selectPresetChoice(mixed, control, 'style_campus');
    expect(getChoiceValue(selected, control)).toBe('style_campus');
    expect(getChoiceValue(mixed, control)).toBe('__mixed__');
    selected.prompts.forEach((p, i) => {
      expect({ ...p, enabled: mixed.prompts[i]!.enabled }).toEqual(mixed.prompts[i]);
      if (!control.options.some(o => o.promptIds.includes(p.identifier))) expect(p).toEqual(mixed.prompts[i]);
    });
  });

  test('off clears the whole optional group and invalid choices leave the preset unchanged', () => {
    const preset = getBuiltinPreset('drc_v12');
    const control = getPresetChoiceControls(preset).find(c => c.id === 'word_count')!;
    const selected = selectPresetChoice(preset, control, '');
    expect(getChoiceValue(selected, control)).toBe('');
    expect(control.options.every(o => o.promptIds.every(id => !selected.prompts.find(p => p.identifier === id)?.enabled))).toBe(true);
    expect(selectPresetChoice(preset, control, '__mixed__')).toBe(preset);
  });

  test('selected style activates its injection slot and resolves to actual writing content', () => {
    const builtin = getBuiltinPreset();
    const preset = { ...builtin, prompts: builtin.prompts.map(p => p.identifier === 'writing_style_slot' ? { ...p, enabled: false } : p) };
    const control = getPresetChoiceControls(preset).find(c => c.id === 'writing_style')!;
    const selected = selectPresetChoice(preset, control, 'style_campus');
    const output = new MacroEngine().resolve(getEnabledPrompts(selected).map(p => p.content).join('\n\n'));
    expect(output).toContain('文风：校园青春');
    expect(output).not.toContain('整体基调轻松明亮');
    expect(output).not.toContain('{{getvar::');
  });

  test('DRC groups only expose ordinary styles and keep baseline and host protocols unchanged', () => {
    const preset = getBuiltinPreset('drc_v12');
    const controls = getPresetChoiceControls(preset);
    expect(controls.map(c => c.id)).toEqual(['drc_writing_style', 'emotional_tone', 'personality', 'word_count', 'pacing', 'inner_monologue']);
    const personality = controls.find(c => c.id === 'personality')!;
    expect(personality.options.map(o => o.label)).toEqual(['简', '中']);
    const selected = selectPresetChoice(preset, personality, personality.options[0]!.value);
    expect(selected.prompts.find(p => p.identifier === '0a989020-3030-4c5c-bdcc-cb6af78c8c60')).toEqual(preset.prompts.find(p => p.identifier === '0a989020-3030-4c5c-bdcc-cb6af78c8c60'));
    expect(selected.prompts.filter(p => p.identifier.startsWith('drc_host_'))).toEqual(preset.prompts.filter(p => p.identifier.startsWith('drc_host_')));
    const ids = [...controls.flatMap(c => c.options.flatMap(o => o.promptIds)), ...getPresetToggleSections(preset).flatMap(s => s.promptIds)];
    const names = preset.prompts.filter(p => ids.includes(p.identifier)).map(p => p.name).join('\n');
    expect(names).not.toMatch(/NSFW|Nsfw|黄文|色情|情欲|破甲|破限|思维链|COT|CoT|人称|视角|Prism|Core/);
  });

  test('unrecognized packs and removed entries do not create phantom controls', () => {
    const preset = getBuiltinPreset();
    expect(getPresetChoiceControls({ ...preset, prompts: [] })).toEqual([]);
    expect(getPresetToggleSections({ ...preset, prompts: [] })).toEqual([]);
    const drc = getBuiltinPreset('drc_v12');
    const reduced = { ...drc, prompts: drc.prompts.filter(p => p.name !== '😀丨人格补充（简）') };
    expect(getPresetChoiceControls(reduced).find(c => c.id === 'personality')?.options.map(o => o.label)).toEqual(['中']);
  });
});
