import { describe, expect, test } from 'bun:test';
import {
  appendDeepSeekRepair,
  buildDeepSeekRepairPrompt,
  ensureDeepSeekResponseFallback,
  isDeepSeekResponseComplete,
} from './deepSeekResponseGuard';

const complete = `<contenttext>完整正文。</contenttext>
[OPTION_START]
[OPTION]{t: "继续前进", d: "沿道路继续探索"}
[OPTION]{t: "观察环境", d: "留意附近的变化"}
[OPTION]{t: "询问同伴", d: "和在场角色交谈"}
[OPTION_END]`;

describe('DeepSeek response completion guard', () => {
  test('accepts only a closed narrative followed by a closed option block', () => {
    expect(isDeepSeekResponseComplete(complete)).toBe(true);
    expect(isDeepSeekResponseComplete('<contenttext>正文写到一半')).toBe(false);
    expect(isDeepSeekResponseComplete('<contenttext>正文</contenttext>')).toBe(false);
    expect(isDeepSeekResponseComplete(complete.replace('[OPTION_END]', ''))).toBe(false);
    expect(isDeepSeekResponseComplete(`[OPTION_START]\n[OPTION]{t: "乱序", d: "选项在正文前"}\n[OPTION_END]\n<contenttext>正文</contenttext>`)).toBe(false);
    expect(isDeepSeekResponseComplete(`${complete}\n未完成的多余尾巴`)).toBe(false);
  });

  test('asks for only the missing suffix without repeating the existing response', () => {
    const prompt = buildDeepSeekRepairPrompt('<contenttext>正文</contenttext>');

    expect(prompt).toContain('只输出缺失的尾部');
    expect(prompt).toContain('[OPTION_START]');
    expect(prompt).toContain('[OPTION_END]');
    expect(prompt).toContain('不要重复正文');
  });

  test('appends a repair suffix without losing the first response', () => {
    const partial = '<contenttext>正文</contenttext>';
    const suffix = '[OPTION_START]\n[OPTION]{t: "继续", d: "继续当前行动"}\n[OPTION_END]';

    expect(appendDeepSeekRepair(partial, suffix)).toBe(`${partial}\n${suffix}`);
  });

  test('locally closes a truncated narrative and guarantees three fallback options', () => {
    const repaired = ensureDeepSeekResponseFallback('<contenttext>尚未写完的正文');

    expect(repaired).toContain('</contenttext>');
    expect(repaired).toContain('[OPTION_START]');
    expect(repaired.match(/\[OPTION\]/g)).toHaveLength(3);
    expect(repaired.trim().endsWith('[OPTION_END]')).toBe(true);
    expect(isDeepSeekResponseComplete(repaired)).toBe(true);
  });

  test('preserves existing options and adds only the missing fallback choices', () => {
    const partial = `<contenttext>正文</contenttext>
[OPTION_START]
[OPTION]{t: "已有选项", d: "保留这个选项"}`;
    const repaired = ensureDeepSeekResponseFallback(partial);

    expect(repaired.match(/已有选项/g)).toHaveLength(1);
    expect(repaired.match(/\[OPTION_START\]/g)).toHaveLength(1);
    expect(repaired.match(/\[OPTION\]/g)).toHaveLength(3);
    expect(repaired.trim().endsWith('[OPTION_END]')).toBe(true);
  });

  test('drops a truncated final option instead of counting its marker as valid', () => {
    const partial = `<contenttext>正文</contenttext>
[OPTION_START]
[OPTION]{t: "继续躲藏", d: "等他们彻底离开"}
[OPTION]{t: "从树后绕走", d: "趁机拉开距离"}
[OPTION]{t: "观察前进方向", d: "记下他们离开的路线"}
[OPTION]{t: "握紧断刀，准备出手", d: "灰袍人若落到他们手里
[OPTION_END]`;
    const repaired = ensureDeepSeekResponseFallback(partial);

    expect(repaired).not.toContain('握紧断刀');
    expect(repaired.match(/\[OPTION\]/g)).toHaveLength(3);
    expect(repaired.trim().endsWith('[OPTION_END]')).toBe(true);
    expect(isDeepSeekResponseComplete(repaired)).toBe(true);
  });
});
