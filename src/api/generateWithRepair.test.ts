import { describe, expect, test } from 'bun:test';
import type { Message } from './types';
import { GenerationFormatError, generateWithRepair, parseJsonObject } from './generateWithRepair';

type Issue = { level: 'error' | 'warning'; message: string };

function scripted(...replies: string[]) {
  const seen: Message[][] = [];
  return {
    seen,
    request: async (messages: Message[]) => {
      seen.push(messages);
      const reply = replies.shift();
      if (reply === undefined) throw new Error('没有更多回复');
      if (reply === 'ABORT') { const error = new Error('aborted'); error.name = 'AbortError'; throw error; }
      if (reply === 'FAIL') throw new Error('网络错误');
      return reply;
    },
  };
}

const validate = (value: { n?: number }): Issue[] => (value.n === 2 ? [] : [{ level: 'error', message: `n 应为 2，现在是 ${value.n}` }]);
const base = { messages: [{ role: 'user' as const, content: '生成' }], parse: (text: string) => parseJsonObject(text) as { n?: number }, validate, repairPrompt: (issues: readonly Issue[]) => `请修正：${issues.map(item => item.message).join('；')}` };

describe('生成 → 校验 → 修复', () => {
  test('一次就合格时不修复', async () => {
    const api = scripted('{"n":2}');
    const result = await generateWithRepair({ ...base, request: api.request });
    expect(result).toMatchObject({ value: { n: 2 }, issues: [], repaired: false, requests: 1 });
  });

  test('校验错误交回去修一次，带上原文与原因', async () => {
    const api = scripted('{"n":1}', '{"n":2}');
    const result = await generateWithRepair({ ...base, request: api.request });
    expect(result).toMatchObject({ value: { n: 2 }, repaired: true, requests: 2 });
    const repair = api.seen[1];
    expect(repair.at(-2)).toEqual({ role: 'assistant', content: '{"n":1}' });
    expect(repair.at(-1)?.content).toContain('n 应为 2，现在是 1');
  });

  test('格式坏了先按格式修，修好后照常校验', async () => {
    const api = scripted('不是 JSON', '{"n":2}');
    const result = await generateWithRepair({ ...base, request: api.request });
    expect(result.value).toEqual({ n: 2 });
    expect(api.seen[1].at(-1)?.content).toContain('无法解析');
  });

  test('格式修复用掉次数后仍坏则报错；修复版更差时保留原版', async () => {
    await expect(generateWithRepair({ ...base, request: scripted('坏', '还是坏').request })).rejects.toBeInstanceOf(GenerationFormatError);
    const worse = await generateWithRepair({ ...base, validate: (value: { n?: number }) => value.n === 1 ? [{ level: 'error', message: 'a' }] : [{ level: 'error', message: 'a' }, { level: 'error', message: 'b' }], request: scripted('{"n":1}', '{"n":3}').request });
    expect(worse).toMatchObject({ value: { n: 1 }, repaired: false });
  });

  test('修复请求失败保留原版；取消直接抛出', async () => {
    const kept = await generateWithRepair({ ...base, request: scripted('{"n":1}', 'FAIL').request });
    expect(kept).toMatchObject({ value: { n: 1 }, repaired: false });
    expect(kept.issues).toHaveLength(1);
    await expect(generateWithRepair({ ...base, request: scripted('{"n":1}', 'ABORT').request })).rejects.toThrow('aborted');
  });

  test('只有警告不触发修复', async () => {
    const api = scripted('{"n":5}');
    const result = await generateWithRepair({ ...base, validate: () => [{ level: 'warning', message: '提示' }], request: api.request });
    expect(result.requests).toBe(1);
  });
});
