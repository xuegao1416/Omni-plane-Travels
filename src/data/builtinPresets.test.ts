import { describe, expect, test } from 'bun:test';
import { getBuiltinPreset, getEnabledPrompts } from './builtinPresets';

describe('DeepSeek built-in preset', () => {
  const preset = getBuiltinPreset('deepseek');
  const byId = (identifier: string) => preset.prompts.find(prompt => prompt.identifier === identifier);

  test('does not ask DeepSeek to emit a second visible reasoning pass', () => {
    expect(byId('thinking')?.enabled).toBe(false);
    expect(byId('writing_process')?.enabled).toBe(false);
    expect(byId('integrity_statement')?.enabled).toBe(false);
  });

  test('uses a concise DeepSeek output contract with options before the final marker', () => {
    const outputFormat = byId('output_format')?.content ?? '';

    expect(outputFormat).not.toContain('<thinking>');
    expect(outputFormat).toContain('600-1000');
    expect(outputFormat.indexOf('[OPTION_START]')).toBeGreaterThan(outputFormat.indexOf('<contenttext>'));
    expect(outputFormat).toContain('[OPTION_END]');
  });

  test('contains balanced writing-style tags and no Claude-only compatibility text', () => {
    const enabledText = getEnabledPrompts(preset).map(prompt => prompt.content).join('\n');
    const openingTags = enabledText.match(/<WritingStyle>/g) ?? [];
    const closingTags = enabledText.match(/<\/WritingStyle>/g) ?? [];

    expect(openingTags).toHaveLength(closingTags.length);
    expect(enabledText).not.toContain('Claude 4.8');
    expect(enabledText).not.toContain('Constitutional AI');
  });

  test('keeps the DeepSeek task short and avoids adversarial model-specific baggage', () => {
    const task = byId('task')?.content ?? '';

    expect(task.length).toBeLessThan(1_200);
    expect(task).toContain('虚构创作');
    expect(task).not.toContain('DeepSeek 倾向');
    expect(task).not.toContain('未成年');
    expect(task).not.toContain('不受现实法律法规');
  });

  test('automatically applies the compact intimacy rules without a manual mode switch', () => {
    const nsfw = byId('nsfw_content')?.content ?? '';

    expect(nsfw.length).toBeLessThan(1_200);
    expect(nsfw).toContain('无需用户手动开启');
    expect(nsfw).toContain('用户明确要求');
    expect(nsfw).toContain('上下文已经进入');
  });

  test('disables redundant anti-style modules in the DeepSeek preset', () => {
    const redundantIds = [
      'anti_metaphor',
      'anti_reveal',
      'anti_voice_desc',
      'anti_synesthesia',
      'anti_shaguanlian',
      'anti_micro_macro',
    ];

    for (const identifier of redundantIds) {
      expect(byId(identifier)?.enabled).toBe(false);
    }
  });

  test('uses one compact final completion lock and keeps the enabled prompt lean', () => {
    const outputFormat = byId('output_format')?.content ?? '';
    const enabledText = getEnabledPrompts(preset).map(prompt => prompt.content).join('\n\n');

    expect(outputFormat.length).toBeLessThan(800);
    expect(outputFormat).toContain('只有输出 [OPTION_END] 后才算完成');
    expect(outputFormat).toContain('空间不足时立即缩短正文');
    expect(enabledText.length).toBeLessThan(8_000);
  });
});
