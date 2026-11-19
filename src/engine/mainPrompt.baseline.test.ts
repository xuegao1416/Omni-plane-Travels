import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { resolve } from 'node:path';
import baseline from './__fixtures__/mainPrompt.baseline.json';
import { captureMainPrompts } from '../../scripts/fixtures/captureMainPrompts';

/**
 * 回合编排拆分后的回归：用假模型在 6 个交接存档上各跑一回合，把发给正文模型的请求与重构起点 10b4eec
 * 的结果逐行比对（基线由 scripts/fixtures/captureMainPrompts.ts 在旧代码树上生成）。
 *
 * 规则：旧提示词的每一行都必须按原顺序出现；只允许多出玩法宿主的新块（【玩法状态】【玩法结算】【玩法线索】）。
 * 唯一的例外是荒岛世界旧版的“热态常驻层 / 当前资源”区块：资源模块重写后，同样的物资信息改由【玩法状态】给出。
 */
const NEW_BLOCK_LINE = /^(【玩法(状态|结算|线索)[^】]*】|- .+|)$/;
const SUPERSEDED_START = '[叙事运行时上下文]';
/**
 * 模块概览行（`> 生存:…` / `> 经营:…`）：重构把生存/经营信息改由【玩法状态】给出，概览行的措辞与数值口径随之变化，
 * 属于本次重构的预期差异，逐行文本不再锁死；其余每一行仍必须逐字出现。
 */
const SUPERSEDED_MODULE_LINE = /^> (生存|经营):/;
/**
 * 商号模块把「钱袋」并进了主货币，带 `> 经营:` 的存档连 `> 主货币:` 的数量口径也会变（500→1000）。
 * 只在出现经营行时放宽，其余存档的 `> 主货币:` 仍然逐字锁死。
 */
const PURSE_LINE = /^> 主货币:/;
const BUSINESS_LINE = /^> 经营:/;

type Messages = Array<{ role: string; content: string }>;

function withoutSupersededBlock(lines: string[]): { lines: string[]; removed: string[] } {
  const start = lines.indexOf(SUPERSEDED_START);
  if (start < 0) return { lines, removed: [] };
  const end = lines.findIndex((line, index) => index > start && line.startsWith('💧'));
  if (end < 0) return { lines, removed: [] };
  return { lines: [...lines.slice(0, start), ...lines.slice(end + 1)], removed: lines.slice(start, end + 1) };
}

/** 旧行按顺序全部出现；新多出的行必须属于玩法宿主的新块。返回不符合规则的行。 */
function compare(oldText: string, newText: string): { lost: string[]; unexpected: string[]; removed: string[] } {
  const { lines: oldLines, removed } = withoutSupersededBlock(oldText.split('\n'));
  const newLines = newText.split('\n');
  const relaxPurse = oldLines.some(line => BUSINESS_LINE.test(line));
  const skippable = (line: string) => SUPERSEDED_MODULE_LINE.test(line) || (relaxPurse && PURSE_LINE.test(line));
  const unexpected: string[] = [];
  let oldIndex = 0;
  for (const line of newLines) {
    if (oldIndex < oldLines.length && line === oldLines[oldIndex]) {
      oldIndex += 1;
      continue;
    }
    if (NEW_BLOCK_LINE.test(line)) continue;
    // 概览行被重构改写过：新旧都跳过，不参与顺序比对。
    if (skippable(line)) {
      while (oldIndex < oldLines.length && skippable(oldLines[oldIndex]!)) oldIndex += 1;
      continue;
    }
    unexpected.push(line);
  }
  while (oldIndex < oldLines.length && skippable(oldLines[oldIndex]!)) oldIndex += 1;
  return { lost: oldLines.slice(oldIndex), unexpected, removed };
}

describe('正文请求与重构起点逐段比对（假模型跑回合）', async () => {
  const current = await captureMainPrompts(resolve(import.meta.dir, '../..'), resolve(import.meta.dir, '../__tests__/fixtures/saves/handoff'));
  const expected = baseline as Record<string, Messages>;

  test('六个交接存档都捕获到了正文请求', () => {
    expect(Object.keys(current).sort()).toEqual(Object.keys(expected).sort());
  });

  for (const name of Object.keys(expected)) {
    test(`${name}：系统提示词只多出玩法宿主的新块，历史与本轮输入不变`, () => {
      const before = expected[name];
      const after = current[name];
      expect(after.map(message => message.role)).toEqual(before.map(message => message.role));
      expect(after.slice(1)).toEqual(before.slice(1));
      const result = compare(before[0].content, after[0].content);
      expect(result.lost).toEqual([]);
      expect(result.unexpected).toEqual([]);
      if (result.removed.length) {
        // 被取代的旧资源区块，其物资信息必须出现在【玩法状态】里。
        expect(after[0].content).toContain('【玩法状态】');
        expect(after[0].content).toMatch(/- 物资：淡水 \d+\/\d+/);
      }
    });
  }
});
