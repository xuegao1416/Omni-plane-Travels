// 选择卡（路径 C）反馈单测：
//   (1) 单选非累加：A=+3, C=+6，切换后只保留最终选中项（基准值始终为选中那一刻的当前值）
//   (2) 结算落库：选中→下一 tick，仅最终项 delta 写入 stat，且只有一个选项生效
//   (3) aiNote：选中后玩家决策日志含该 aiNote；promptAssembler 拼出的上下文含它
import { test, expect, beforeEach } from 'bun:test';
import type { GameState } from '../schema/variables';
import { createDefaultGameState } from '../schema/variables';
import {
  selectChoice,
  getPendingForSave,
  resolvePendingChoices,
  _clearAllPending,
} from './eventChoiceState';
import {
  recordPlayerDecision,
  getRecentDecisions,
  getPlayerDecisionContext,
  clearPlayerDecisionLog,
} from './playerDecisionLog';
import { assembleSystemPrompt } from '../engine/promptAssembler';
import type { PresetPack } from '../data/builtinPresets';
import { MacroEngine } from '../engine/macroEngine';

const SAVE = 'test-save';

function makeState(): GameState {
  const s = createDefaultGameState();
  s.玩家.生存状态.生命 = 76;
  return s;
}

beforeEach(() => {
  _clearAllPending();
  clearPlayerDecisionLog();
});

test('(1) 单选非累加：A=+3 → 切 C=+6，仅保留 C，基准值=当前值 76', () => {
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { statId: '生命', delta: 3 }, baseStatValue: 76 });
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 2, effect: { statId: '生命', delta: 6 }, baseStatValue: 76 });

  const pend = getPendingForSave(SAVE);
  expect(pend.length).toBe(1);           // 单选：永远只有一条待选记录
  expect(pend[0].selectedIndex).toBe(2);
  expect(pend[0].effect!.delta).toBe(6);
  expect(pend[0].baseStatValue).toBe(76); // 预览 = 76 + 6 = 82（非 79 + 6）
});

test('(1b) 已是选中再点=无操作：不新增记录', () => {
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 1, effect: { statId: '生命', delta: 3 }, baseStatValue: 76 });
  const before = getPendingForSave(SAVE).length;
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 1, effect: { statId: '生命', delta: 3 }, baseStatValue: 76 });
  expect(getPendingForSave(SAVE).length).toBe(before);
});

test('(2) 结算落库：仅选 A → 生命 76 +3 = 79', () => {
  const s = makeState();
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { statId: '生命', delta: 3 }, baseStatValue: 76 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.生存状态.生命).toBe(79);
  expect(getPendingForSave(SAVE).length).toBe(0); // 结算后清空
});

test('(2b) 结算落库：A→C 切换后只 +6（非 +9），且单选项生效', () => {
  const s = makeState();
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { statId: '生命', delta: 3 }, baseStatValue: 76 });
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 2, effect: { statId: '生命', delta: 6 }, baseStatValue: 76 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.生存状态.生命).toBe(82); // 76 + 6，绝不是 85
});

test('(3a) aiNote：选中并结算后玩家决策日志含该 note', () => {
  const s = makeState();
  selectChoice({
    saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 1,
    effect: { statId: '生命', delta: 6 },
    aiNote: '玩家选择了激进路线',
    baseStatValue: 76,
  });
  resolvePendingChoices(s, SAVE);
  const notes = getRecentDecisions().map((d) => d.note);
  expect(notes).toContain('玩家选择了激进路线');
  expect(getPlayerDecisionContext()).toContain('玩家选择了激进路线');
});

test('(3b) promptAssembler：玩家决策上下文被拼入系统提示', () => {
  recordPlayerDecision('玩家选择了激进路线');
  const ctxText = getPlayerDecisionContext();
  expect(ctxText).toContain('玩家选择了激进路线');

  const preset: PresetPack = { id: 'p', name: 'p', prompts: [], regexScripts: [] };
  const out = assembleSystemPrompt(preset, {
    varSnapshot: '',
    wbInjection: '',
    playerProfileBlock: '',
    firewallTitle: '',
    firewallContent: '',
    userText: '',
    round: 1,
    macroEngine: new MacroEngine(),
    playerDecisionContext: ctxText,
  });
  expect(out).toContain('玩家选择了激进路线');
});

// ─── 阶段 B：effect 支持 resourcePath（决策B）───

function spyWarn(): { calls: string[]; restore: () => void } {
  const calls: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => { calls.push(String(args[0])); };
  return { calls, restore: () => { console.warn = orig; } };
}

function makeStateWithFood(): GameState {
  const s = makeState();
  s.玩家.生存资源 = { 食物: { 数量: 10, 最大值: 100, name: '食物', symbol: '🍖' } };
  return s;
}

test('(B1) 选择卡 effect resourcePath=生存资源.食物 且世界有 food → 结算后数量变化', () => {
  const s = makeStateWithFood();
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { resourcePath: '生存资源.食物', delta: 5 }, baseStatValue: 0 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.生存资源!.食物.数量).toBe(15);
});

test('(B2) 选择卡 effect resourcePath=生存资源.食物 但世界无 food → 不崩、food 仍 undefined、warn 被调用', () => {
  const s = makeState(); // 默认无生存资源
  if (!s.玩家.生存资源) s.玩家.生存资源 = {};
  const warn = spyWarn();
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { resourcePath: '生存资源.食物', delta: 5 }, baseStatValue: 0 });
  expect(() => resolvePendingChoices(s, SAVE)).not.toThrow();
  expect(s.玩家.生存资源!.食物).toBeUndefined();
  expect(warn.calls.some((c) => c.includes('生存资源.食物'))).toBe(true);
  warn.restore();
});

test('(B3) 选择卡 effect resourcePath=经营资产.资金 → 资金变化并 clamp >= 0', () => {
  const s = makeState(); // 默认无经营资产
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { resourcePath: '经营资产.资金', delta: 50 }, baseStatValue: 0 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.经营资产!.资金).toBe(50);

  // 再次结算：负值 clamp 到 0（不出现负数幽灵资金）
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { resourcePath: '经营资产.资金', delta: -100 }, baseStatValue: 50 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.经营资产!.资金).toBe(0);
});

test('(B4) 选择卡 effect resourcePath=货币资源.主货币 → 主货币.数量 变化并 clamp >= 0', () => {
  const s = makeState(); // 默认货币资源.主货币.数量 = 500
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { resourcePath: '货币资源.主货币', delta: 30 }, baseStatValue: 0 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.货币资源.主货币.数量).toBe(530);
});

test('(B5) 兼容旧数据：effect 只有 statId 仍正常（回归）', () => {
  const s = makeState();
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { statId: '生命', delta: 3 }, baseStatValue: 76 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.生存状态.生命).toBe(79);
  expect(getPendingForSave(SAVE).length).toBe(0);
});

test('(B6) resourcePath 优先于 statId：两者同时填时只应用 resourcePath', () => {
  const s = makeStateWithFood();
  selectChoice({ saveId: SAVE, eventPackId: 'm', cardId: 'c1', blockId: 'b1', selectedIndex: 0, effect: { statId: '生命', resourcePath: '生存资源.食物', delta: 7 }, baseStatValue: 76 });
  resolvePendingChoices(s, SAVE);
  expect(s.玩家.生存资源!.食物.数量).toBe(17); // 只应用 resourcePath
  expect(s.玩家.生存状态.生命).toBe(76);        // statId 被忽略
});
