import { expect, test } from 'bun:test';
import { exportPresetJSON, parsePresetJSON } from './presetIO';
import type { PresetPack } from '../data/builtinPresets';

const pack: PresetPack = { id: 'synthetic', name: '配置测试', regexScripts: [], prompts: [
  { identifier: 'last', name: '最后', role: 'system', content: '最后的规则', enabled: false, order: 900 },
  { identifier: 'first', name: '首项', role: 'system', content: '文风', enabled: true, order: 100,
    triggerMode: 'green', triggerKeywords: ['探索'], injectionPosition: 1, injectionDepth: 2, injectionLabel: '创作规则' },
] };

test('export/import retains switches, canonical order, keyword triggers and depth injection', () => {
  const result = parsePresetJSON(exportPresetJSON(pack));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.prompts.find(p => p.identifier === 'first')).toEqual(pack.prompts[1]);
  expect(result.data.prompts.find(p => p.identifier === 'last')).toEqual(pack.prompts[0]);
});

test('assistant prompts imported after chatHistory become system tail injections', () => {
  const result = parsePresetJSON(JSON.stringify({
    name: 'assistant tail',
    prompts: [
      { identifier: 'chatHistory', name: 'Chat History', role: 'system', content: '' },
      { identifier: 'tail-ack', name: 'Tail acknowledgement', role: 'assistant', content: 'Understood' },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'chatHistory', enabled: true },
      { identifier: 'tail-ack', enabled: true },
    ] }],
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.prompts.find(p => p.identifier === 'tail-ack')).toMatchObject({
    role: 'system',
    injectionPosition: 1,
    injectionDepth: 0,
    injectionLabel: 'Tail acknowledgement',
  });
});

test('SillyTavern prompt_order is authoritative for enabled flags and relative order', () => {
  const result = parsePresetJSON(JSON.stringify({ ...pack, prompts: pack.prompts.map(p => ({ ...p, enabled: true })),
    prompt_order: [{ character_id: 100001, order: [{ identifier: 'last', enabled: false }, { identifier: 'first', enabled: true }] }] }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.prompts.find(p => p.identifier === 'last')?.enabled).toBe(false);
  expect(result.data.prompts.find(p => p.identifier === 'last')!.order).toBeLessThan(result.data.prompts.find(p => p.identifier === 'first')!.order);
});

test('legacy string order disables unlisted prompts and remains importable', () => {
  const result = parsePresetJSON(JSON.stringify({ ...pack, prompt_order: [{ character_id: 100001, order: ['first'] }] }));
  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.prompts.find(p => p.identifier === 'first')?.enabled).toBe(true);
  expect(result.data.prompts.find(p => p.identifier === 'last')?.enabled).toBe(false);
});

test('SillyTavern chatHistory anchor keeps tail prompts next to the generation point', () => {
  const result = parsePresetJSON(JSON.stringify({
    name: '锚点测试',
    prompts: [
      { identifier: 'head', name: '头部', role: 'system', content: '头部规则' },
      { identifier: 'handshake', name: '握手', role: 'assistant', content: '已阅读规则' },
      { identifier: 'chatHistory', name: 'Chat History', role: 'system', content: '' },
      { identifier: 'tail', name: '尾部强化', role: 'system', content: '紧邻生成点的规则', injection_position: 0, injection_depth: 4 },
      { identifier: 'explicit-depth', name: '显式深度', role: 'system', content: '保留原始深度', injection_position: 1, injection_depth: 2 },
    ],
    prompt_order: [{ character_id: 100001, order: [
      { identifier: 'head', enabled: true },
      { identifier: 'handshake', enabled: true },
      { identifier: 'chatHistory', enabled: true },
      { identifier: 'tail', enabled: true },
      { identifier: 'explicit-depth', enabled: true },
    ] }],
  }));

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.data.prompts.find(p => p.identifier === 'head')?.injectionPosition).toBeUndefined();
  expect(result.data.prompts.find(p => p.identifier === 'handshake')?.role).toBe('system');
  expect(result.data.prompts.find(p => p.identifier === 'tail')).toMatchObject({
    injectionPosition: 1,
    injectionDepth: 0,
    injectionLabel: '尾部强化',
  });
  expect(result.data.prompts.find(p => p.identifier === 'explicit-depth')).toMatchObject({
    injectionPosition: 1,
    injectionDepth: 2,
  });
});
