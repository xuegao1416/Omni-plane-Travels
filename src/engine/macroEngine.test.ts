// 宏引擎：原有宏的回归用例，以及经变量表（别名）只读访问游戏变量。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import { MacroEngine } from './macroEngine';
import { createFactMacroAccess, formatMacroValue } from '../core/macroFacts';
import { createGameplayHost } from '../core/registry';

function sequence(...values: number[]): () => number {
  let index = 0;
  return () => values[index++ % values.length];
}

describe('原有宏（回归）', () => {
  test('预设变量的写入、追加、加减与读取', () => {
    const engine = new MacroEngine();
    expect(engine.resolve('{{setvar::base_style::冷峻}}风格：{{getvar::base_style}}')).toBe('风格：冷峻');
    expect(engine.resolve('{{addvar::base_style::克制}}{{getvar::BASE_STYLE}}')).toBe('冷峻克制');
    expect(engine.resolve('{{incvar::word_count}}{{incvar::word_count}}{{decvar::word_count}}{{getvar::word_count}}')).toBe('1');
    expect(engine.resolve('{{getvar::missing}}|{{missing_key}}')).toBe('|{{missing_key}}');
  });

  test('随机、掷骰、条件、注释与嵌套', () => {
    const engine = new MacroEngine({ rng: sequence(0.99, 0, 0.5) });
    expect(engine.resolve('{{random::甲::乙::丙}}')).toBe('丙');
    expect(engine.resolve('{{roll 2d6+1}}')).toBe('6');
    expect(engine.resolve('{{#if::a == a::是::否}}{{#if::0::真::假}}')).toBe('是假');
    expect(engine.resolve('前{{// 作者备注\n多行}}后')).toBe('前后');
    expect(engine.resolve('{{setvar::sys_lang::中文}}{{#if::{{getvar::sys_lang}} == 中文::中::外}}')).toBe('中');
  });

  test('上下文变量与 {{user}}', () => {
    const engine = new MacroEngine();
    engine.updateContext({ Mood: '紧张' });
    engine.setVar('user', '林舟');
    expect(engine.resolve('{{user}}：{{mood}}')).toBe('林舟：紧张');
  });
});

describe('游戏变量（只读）', () => {
  const world = { id: 'macro_world', name: '宏', description: '', modules: [] } as unknown as WorldDef;

  function engineFor() {
    const state = createDefaultGameState();
    state.玩家.姓名 = '林舟';
    state.玩家.货币资源.主货币.数量 = 42.5;
    state.玩家.生存状态.血量 = 77;
    return { state, engine: new MacroEngine({ facts: createFactMacroAccess(world, state) }) };
  }

  test('带点路径、变量表 id 与别名都能读', () => {
    const { engine } = engineFor();
    expect(engine.resolve('{{getvar::player.currency}}')).toBe('42.5');
    expect(engine.resolve('{{getvar::玩家.货币资源.主货币.数量}}')).toBe('42.5');
    expect(engine.resolve('{{getvar::currency}}')).toBe('42.5');
    expect(engine.resolve('{{getvar::玩家.生存状态.血量}}')).toBe('77');
    expect(engine.resolve('你好，{{玩家.姓名}}')).toBe('你好，林舟');
  });

  test('宏写不进游戏变量，预设变量照常', () => {
    const { state, engine } = engineFor();
    expect(engine.resolve('{{setvar::player.currency::9999}}{{incvar::玩家.生存状态.血量}}{{getvar::player.currency}}/{{getvar::玩家.生存状态.血量}}')).toBe('42.5/77');
    expect(state.玩家.货币资源.主货币.数量).toBe(42.5);
    expect(engine.resolve('{{setvar::story.stage::2}}{{getvar::story.stage}}')).toBe('2');
  });

  test('隐藏变量、不存在的根与单段根名不读', () => {
    const { engine } = engineFor();
    expect(engine.resolve('[{{getvar::secret.thing}}]')).toBe('[]');
    expect(engine.resolve('[{{getvar::玩家}}]')).toBe('[]');
    const island = { id: 'island', name: '岛', description: '', modules: [{ moduleId: 'survival', enabled: true, moduleConfig: {
      description: '', resources: [{ id: 'water', name: '淡水', symbol: '💧', amount: 3, max: 10, scarce: true, description: '' }], recipes: [], rules: { cycleName: '一天', consumePerCycle: '' },
    } }] } as unknown as WorldDef;
    const host = createGameplayHost(island, createDefaultGameState());
    const state = host.prepare(createDefaultGameState());
    const survival = new MacroEngine({ facts: createFactMacroAccess(island, state) });
    expect(survival.resolve('{{getvar::player.resources.water}}')).toBe('3');
    // 旧整条记录的别名是隐藏变量（只为兼容旧 AI 写入），宏读不到。
    expect(survival.resolve('[{{getvar::玩家.生存资源.water}}]')).toBe('[]');
  });

  test('值的文字形式', () => {
    expect(formatMacroValue(3)).toBe('3');
    expect(formatMacroValue(1 / 3)).toBe('0.33');
    expect(formatMacroValue(true)).toBe('true');
    expect(formatMacroValue(['刀', '剑'])).toBe('刀、剑');
    expect(formatMacroValue({ a: 1 })).toBe('{"a":1}');
    expect(formatMacroValue(Number.NaN)).toBeUndefined();
  });
});
