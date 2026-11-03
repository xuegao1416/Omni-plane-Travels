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
const timeAdvance = '<TimeAdvance>{"minutes":20,"reason":"沿路步行","evidence":"走了二十分钟"}</TimeAdvance>';

describe('DeepSeek response completion guard', () => {
  test('accepts only a closed narrative followed by a closed option block', () => {
    expect(isDeepSeekResponseComplete(complete)).toBe(true);
    expect(isDeepSeekResponseComplete('<contenttext>正文写到一半')).toBe(false);
    expect(isDeepSeekResponseComplete('<contenttext>正文</contenttext>')).toBe(false);
    expect(isDeepSeekResponseComplete(complete.replace('[OPTION_END]', ''))).toBe(false);
    expect(isDeepSeekResponseComplete(`[OPTION_START]\n[OPTION]{t: "乱序", d: "选项在正文前"}\n[OPTION_END]\n<contenttext>正文</contenttext>`)).toBe(false);
    expect(isDeepSeekResponseComplete(`${complete}\n未完成的多余尾巴`)).toBe(false);
  });

  test('accepts a single valid host time receipt after the option block', () => {
    expect(isDeepSeekResponseComplete(`${complete}\n${timeAdvance}`)).toBe(true);
    expect(isDeepSeekResponseComplete(`${complete}\n<TimeAdvance>{"minutes":0}</TimeAdvance>`)).toBe(true);
    for (const tail of [
      '<TimeAdvance>{"minutes":20',
      '<TimeAdvance>{"minutes":}</TimeAdvance>',
      '<TimeAdvance>{"minutes":-1}</TimeAdvance>',
      '<TimeAdvance>{"date":"2028-01-01"}</TimeAdvance>',
      `${timeAdvance}\n${timeAdvance}`,
      `${timeAdvance}\n多余尾巴`,
      `多余尾巴\n${timeAdvance}`,
    ]) {
      expect(isDeepSeekResponseComplete(`${complete}\n${tail}`)).toBe(false);
    }
  });

  test('repairs only the time receipt when the narrative and options are already complete', () => {
    for (const tail of ['<TimeAdvance>{"minutes":20', '<TimeAdvance>{"minutes":}</TimeAdvance>']) {
      const partial = `${complete}\n${tail}`;
      const prompt = buildDeepSeekRepairPrompt(partial);
      expect(prompt).toContain('TimeAdvance');
      expect(prompt).not.toContain('补足 3-5');
      expect(prompt).not.toContain('最后输出 [OPTION_END]');
      const repaired = appendDeepSeekRepair(partial, timeAdvance);
      expect(repaired).toBe(`${complete}\n${timeAdvance}`);
      expect(isDeepSeekResponseComplete(repaired)).toBe(true);
    }
  });

  test('preserves a valid receipt while locally rebuilding incomplete options', () => {
    const partial = `<contenttext>正文</contenttext>\n[OPTION_START]\n[OPTION]{t: "已有选项", d: "保留这个选项"}\n[OPTION_END]\n${timeAdvance}`;
    const repaired = ensureDeepSeekResponseFallback(partial);
    expect(repaired).toContain('已有选项');
    expect(repaired.match(/\[OPTION\]/g)).toHaveLength(3);
    expect(repaired.endsWith(timeAdvance)).toBe(true);
    expect(isDeepSeekResponseComplete(repaired)).toBe(true);
  });

  test('keeps the original receipt last when appending missing options before local fallback', () => {
    const partialOptions = '<contenttext>正文</contenttext>\n[OPTION_START]\n[OPTION]{t: "已有选项", d: "保留这个选项"}';
    const suffixOptions = '[OPTION]{t: "补写选项二", d: "执行第二个行动"}\n[OPTION]{t: "补写选项三", d: "执行第三个行动"}\n[OPTION_END]';
    for (const optionTail of ['\n[OPTION_END]', '', '\n[OPTION]{t: "截断选项']) {
      for (const extraReceipt of ['', `\n${timeAdvance}`, '\n<TimeAdvance>{"minutes":999,"reason":"补写冲突"}</TimeAdvance>']) {
        const raw = `${partialOptions}${optionTail}\n${timeAdvance}`;
        const combined = appendDeepSeekRepair(raw, `${suffixOptions}${extraReceipt}`);
        const repaired = ensureDeepSeekResponseFallback(combined);
        expect(repaired.endsWith(timeAdvance)).toBe(true);
        expect(repaired.match(/<TimeAdvance>/g)).toHaveLength(1);
        expect(repaired.match(/\[OPTION\]/g)).toHaveLength(3);
        expect(repaired).toContain('补写选项二');
        expect(repaired).not.toContain('补写冲突');
        expect(isDeepSeekResponseComplete(repaired)).toBe(true);
      }
    }
  });

  test('local fallback drops invalid receipts without inventing elapsed time', () => {
    for (const tail of ['<TimeAdvance>{"minutes":20', '<TimeAdvance>{"minutes":}</TimeAdvance>', `${timeAdvance}\n${timeAdvance}`]) {
      const repaired = ensureDeepSeekResponseFallback(`${complete}\n${tail}`);
      expect(repaired).toBe(complete);
      expect(repaired).not.toContain('TimeAdvance');
    }
  });

  test('keeps a zero-minute receipt when the final option and closing marker are truncated', () => {
    const receipt = '<TimeAdvance>{"minutes":0,"reason":"只是一瞬"}</TimeAdvance>';
    const partial = `${complete.replace('[OPTION_END]', '[OPTION]{t: "未完成')}\n${receipt}`;
    const repaired = ensureDeepSeekResponseFallback(partial);
    expect(repaired).toBe(`${complete}\n${receipt}`);
    expect(isDeepSeekResponseComplete(repaired)).toBe(true);
  });

  test('does not treat another malformed repair as a valid replacement receipt', () => {
    const partial = `${complete}\n<TimeAdvance>{"minutes":`;
    const invalidRepair = '<TimeAdvance>{"minutes":true}</TimeAdvance>';
    const combined = appendDeepSeekRepair(partial, invalidRepair);
    expect(combined).toBe(`${partial}\n${invalidRepair}`);
    expect(isDeepSeekResponseComplete(combined)).toBe(false);
    expect(ensureDeepSeekResponseFallback(combined)).toBe(complete);
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
