import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleSystemPrompt } from './promptAssembler';
import { MacroEngine } from './macroEngine';
import { getBuiltinPresets, type PresetPack } from '../data/builtinPresets';

/**
 * 内置预设的组装结果锁定。
 *
 * 前置区块输入全部为空时，系统提示词就是预设主体；这里锁住主体、深度注入、prefill 与工具通道的逐字节结果，
 * 以及占位标记在各通道里的数量。逻辑层重构新增的提示词块只能在有输入时出现，不能挪动预设条目的位置。
 * 失败时回退改动；只有项目所有者替换预设正文时才允许用 UPDATE_PRESET_GOLDEN=1 重新生成。
 */
const MARKER = '【占位条目】';
const GOLDEN = join(import.meta.dir, '__fixtures__/promptAssembler.golden.json');

function sha(value: unknown): string {
  return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value ?? null)).digest('hex');
}

function markers(value: string | undefined): number {
  return value ? value.split(MARKER).length - 1 : 0;
}

function fingerprint(preset: PresetPack, userText: string) {
  const result = assembleSystemPrompt(structuredClone(preset), {
    varSnapshot: '### 【变量快照】\n- 玩家：测试者',
    wbInjection: '',
    playerProfileBlock: '',
    firewallTitle: '',
    firewallContent: '',
    userText,
    round: 3,
    macroEngine: new MacroEngine({ rng: () => 0.25 }),
    userPersonaName: '测试者',
  });
  const depthText = result.depthEntries.map(entry => entry.content).join('\n');
  return {
    systemPrompt: sha(result.systemPrompt),
    depthEntries: sha(result.depthEntries),
    assistantPrefill: sha(result.assistantPrefill ?? ''),
    toolChannel: sha(result.toolChannel ?? null),
    markers: {
      systemPrompt: markers(result.systemPrompt),
      depthEntries: markers(depthText),
      assistantPrefill: markers(result.assistantPrefill),
      toolChannel: markers(JSON.stringify(result.toolChannel ?? '')),
    },
  };
}

function presetFingerprints() {
  const out: Record<string, unknown> = {};
  for (const preset of getBuiltinPresets()) {
    const keywords = [...new Set(preset.prompts.flatMap(prompt => prompt.triggerKeywords ?? []))].join(' ');
    out[preset.id] = {
      idle: fingerprint(preset, ''),
      triggered: fingerprint(preset, keywords || '继续'),
      entries: preset.prompts.map(prompt => [prompt.identifier, prompt.role, prompt.enabled, prompt.order, prompt.injectionPosition ?? 0,
        prompt.injectionDepth ?? null, markers(prompt.content)]),
    };
  }
  return out;
}

describe('内置预设组装结果锁定', () => {
  const actual = presetFingerprints();
  if (process.env.UPDATE_PRESET_GOLDEN === '1') {
    writeFileSync(GOLDEN, `${JSON.stringify(actual, null, 2)}\n`);
  }
  if (!existsSync(GOLDEN)) throw new Error('缺少预设锁定文件 promptAssembler.golden.json');
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as Record<string, unknown>;

  test('内置预设列表不变', () => {
    expect(Object.keys(actual)).toEqual(Object.keys(golden));
  });
  for (const id of Object.keys(golden)) {
    test(`${id} 的条目与组装输出逐字节不变`, () => {
      expect(actual[id]).toEqual(golden[id] as never);
    });
  }
});
