import { expect, test } from 'bun:test';
import { getBuiltinPreset } from './builtinPresets';
import { DRC_TAIL_INJECTION_MIN_ORDER } from './presetDrcV12';
import { assembleSystemPrompt, injectAtDepthEntries } from '../engine/promptAssembler';
import { MacroEngine } from '../engine/macroEngine';

test('DRC core uses host output without Tavern presentation slots or draft HTML requirements', () => {
  const preset = getBuiltinPreset('drc_v12');
  for (const id of ['d9306d7a-82f4-44e6-919d-b933a9418b27', '43224568-7552-48e9-aaaa-f9d995e6b117']) {
    const core = preset.prompts.find(p => p.identifier === id)!.content;
    expect(core).toContain('<contenttext>');
    expect(core).toContain('[OPTION_START]');
    expect(core).toContain('<TimeAdvance>');
    for (const slot of ['status_top', 'meow_FM', 'char_date', 'branches', 'snow', 'aftertalk', 'Audio', 'Manual', 'mod_fanfic_fmt']) {
      expect(core).not.toContain(`{{getvar::${slot}}}`);
    }
    expect(core).not.toContain('段前草稿HTML');
  }
});

test('active DRC assembly keeps world/player data and word range without mandatory review HTML', () => {
  const preset = getBuiltinPreset('drc_v12');
  const result = assembleSystemPrompt(preset, {
    varSnapshot: '{"location":"测试地点"}', wbInjection: '', playerProfileBlock: '玩家档案：第三人称',
    firewallTitle: '', firewallContent: '', userText: '探索房间', round: 1, macroEngine: new MacroEngine(),
  });
  expect(result.systemPrompt).toContain('测试地点');
  expect(result.systemPrompt).toContain('玩家档案：第三人称');
  expect(result.depthEntries.some(e => e.content.includes('[大于800小于1000]'))).toBe(true);
  expect(result.assistantPrefill).toBeUndefined();
  expect(result.systemPrompt).not.toContain('按已启用格式逐段完成段前草稿HTML');
  expect(result.systemPrompt).not.toContain('每完成一个正文自然段，紧跟段后Prism注释输出');
  expect(result.systemPrompt).not.toContain('每个正文自然段后输出一条HTML注释');
});

test('DRC keeps upstream post-history modules at the tail instead of the prompt head', () => {
  const preset = getBuiltinPreset('drc_v12');
  const enabled = preset.prompts.filter(p => p.enabled && p.content.trim().length > 0);
  const tail = enabled.filter(p => p.order >= DRC_TAIL_INJECTION_MIN_ORDER);
  const head = enabled.filter(p => p.order < DRC_TAIL_INJECTION_MIN_ORDER);

  expect(tail.length).toBeGreaterThanOrEqual(25);
  expect(tail.every(p => p.injectionPosition === 1 && !!p.injectionLabel)).toBe(true);
  expect(head.every(p => p.injectionPosition !== 1)).toBe(true);

  const result = assembleSystemPrompt(preset, {
    varSnapshot: '{"location":"测试地点"}', wbInjection: '', playerProfileBlock: '',
    firewallTitle: '', firewallContent: '', userText: '握住她的手', round: 1, macroEngine: new MacroEngine(),
  });
  const tailLabels = new Set(tail.map(p => p.injectionLabel));
  const headNames = new Set(head.map(p => p.name));
  expect(result.depthEntries.length).toBeGreaterThan(0);
  expect(result.depthEntries.every(e => !!e.label)).toBe(true);
  expect(result.depthEntries.every(e => tailLabels.has(e.label))).toBe(true);
  expect(result.depthEntries.some(e => headNames.has(e.label!))).toBe(false);
  expect(result.depthEntries.filter(e => e.depth === 0).length).toBeGreaterThan(20);
  expect(result.assistantPrefill).toBeUndefined();

  const history = [
    { role: 'user', content: '上一轮' },
    { role: 'assistant', content: '上一轮正文' },
    { role: 'user', content: '吻上去' },
  ];
  const merged = injectAtDepthEntries(history, result.depthEntries);
  const zeroLabels = result.depthEntries.filter(e => e.depth === 0).map(e => e.label!);
  const zeroPos = merged
    .map((m, i) => (zeroLabels.some(l => m.content.startsWith(`[${l} - depth:0]`)) ? i : -1))
    .filter(i => i >= 0);
  expect(merged.length).toBe(history.length + result.depthEntries.length);
  expect(zeroPos.length).toBe(zeroLabels.length);
  // 尾部块连续排在历史末端，宿主在其后再追加本轮玩家输入
  expect(zeroPos[0]).toBe(merged.length - zeroLabels.length);
});

test('localized preset removes Tavern-only features and their macro dependencies', () => {
  const preset = getBuiltinPreset('drc_v12');
  const removed = ['b1f24a1e-d7da-4e63-b030-ca4b673821a6', '6b4b5d2f-5a7e-48f1-a16f-5dd4aad617c7',
    '16c8e083-fbd3-4115-8e44-a89115d7b9e5', 'e546b425-f465-42e4-843a-dde0b93c1af4',
    '13f3cb99-e599-4540-9d73-4f29d7237836', 'e08d9316-881f-4950-8a78-dc9dd3716a58',
    'f00082d2-130e-4eff-84a4-c2ca70e06cdd', 'f46ece1e-68c2-4769-8907-07d8b8449c5b'];
  expect(preset.prompts.some(p => removed.includes(p.identifier))).toBe(false);
  expect(preset.regexScripts.some(s => /MoM-双人成行/.test(s.scriptName))).toBe(false);
  const text = preset.prompts.map(p => p.content).join('\n');
  expect(text).not.toMatch(/\{\{(?:getvar|setvar)::(?:status_top|meow_FM|char_date(?:_1)?|branches|snow|aftertalk(?:_check)?|Audio|Manual|QDGJ|update_variable)::?/i);
  for (const id of ['b72bb590-e23c-4ca8-9f6c-6020534e9b80', '15e519cf-3817-4300-b103-f39e1d27c82c',
    'fec341a1-3ac2-48fb-b011-7307f3dba5e1', '6e508017-24a4-49bd-b9cf-50c3cf161a53',
    'drc_host_perspective_protocol', 'drc_host_world_clock_protocol']) {
    expect(preset.prompts.some(p => p.identifier === id)).toBe(true);
  }
});
