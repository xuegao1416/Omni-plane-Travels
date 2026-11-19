// 骰子模块：种子随机、修正（属性量纲、天赋、状态）、历史记录。
// 第一条由 gameplay/modules/modules.test 的「骰子历史」用例移植。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import { createGameplayHost } from '../../core/registry';
import { createDiceRoll } from '../../gameplay/modules/dice';
import { diceAttributeModifier } from './module';

function world(dice: Record<string, unknown> = {}, extra: unknown[] = [], stat: Record<string, unknown> = {}): WorldDef {
  return {
    id: 'dice_world', name: '骰子', description: '',
    modules: [
      { moduleId: 'stat', enabled: true, moduleConfig: { attrA: { name: '生命', current: 100, max: 100 }, attrB: { name: '体力', current: 100, max: 100 }, dim1: { name: '筋骨', value: 14, range: [0, 20] }, special: [], ...stat } },
      { moduleId: 'dice', enabled: true, moduleConfig: dice },
      ...extra,
    ],
  } as unknown as WorldDef;
}

function setup(def: WorldDef, mutate?: (state: GameState) => void) {
  const state = createDefaultGameState();
  state.玩家.生存状态.dim1 = 14;
  state.gameplay = { rng: { seed: 'dice-seed', counter: 0 } } as never;
  mutate?.(state);
  const host = createGameplayHost(def, state);
  return { host, state: host.prepare(state) };
}

describe('骰子', () => {
  test('检定按配置计算并在历史里保留有限条数，发出 dice.resolved', () => {
    const roll = createDiceRoll({ sides: 20, modifierBase: 10, modifierStep: 2 }, {
      attributeId: 'dim1', attributeName: '筋骨', attributeValue: 14, dc: 15, timestamp: 4,
    }, () => 0.999);
    expect(roll.d20).toBe(20);
    expect(roll.modifier).toBe(2);
    expect(roll.isNatural20).toBe(true);

    const { host, state } = setup(world({ historyLimit: 2 }));
    let current = state;
    const types: string[] = [];
    for (let index = 0; index < 3; index++) {
      const outcome = host.dispatch(current, 'dice.roll', { attribute: '筋骨', dc: 15, requestId: `r${index}` });
      expect(outcome.status).toBe('applied');
      types.push(...outcome.events.map(event => event.type));
      current = outcome.state;
    }
    expect(current.dice?.history?.map(item => item.requestId)).toEqual(['r1', 'r2']);
    expect(current.dice?.lastRoll?.requestId).toBe('r2');
    expect(types.filter(type => type === 'dice.resolved')).toHaveLength(3);
    expect(host.dispatch(current, 'dice.roll', { attribute: '筋骨', dc: 15, requestId: 'r2' }).status).toBe('failed');
  });

  test('同一存档、同样的请求结果相同（种子随机）', () => {
    const a = setup(world());
    const b = setup(world());
    const first = a.host.dispatch(a.state, 'dice.roll', { attribute: 'dim1', dc: 12, requestId: 'x', timestamp: 1 });
    const second = b.host.dispatch(b.state, 'dice.roll', { attribute: 'dim1', dc: 12, requestId: 'x', timestamp: 1 });
    expect(first.state.dice?.lastRoll).toEqual(second.state.dice?.lastRoll);
  });

  test('缺水等状态的检定减值与天赋加成都计入修正', () => {
    const talent = { moduleId: 'talent', enabled: true, moduleConfig: { categories: [{ id: 'c', name: '体魄', description: '', talents: [{ id: 'iron', name: '铁骨', description: '', rarity: '精良', diceModifier: 2 }] }] } };
    const { host, state } = setup(world({}, [talent]), draft => {
      draft.玩家.能力系统 = { 天赋点: 0, 技能点: 0, 已解锁天赋: { iron: { 等级: 1, 解锁轮次: 0 } }, 已掌握技能: {} };
    });
    const thirsty = host.apply(state, [{ op: 'modifier', modifier: { id: 'thirst', target: 'dice.check', mode: 'flat', value: -2, label: '缺水' } }], { source: 'event', label: '缺水' });
    const roll = host.dispatch(thirsty.state, 'dice.roll', { attribute: '筋骨', dc: 10 }).state.dice!.lastRoll!;
    expect(roll.bonuses).toEqual([{ source: '铁骨', value: 2 }, { source: '缺水', value: -2 }]);
    expect(roll.modifier).toBe(2);
  });

  test('0~100 制属性按范围折算修正，避免中等属性必定成功', () => {
    expect(diceAttributeModifier({}, 50, [0, 100])).toBe(0);
    expect(diceAttributeModifier({}, 90, [0, 100])).toBe(4);
    expect(diceAttributeModifier({}, 14, [0, 20])).toBe(2);
    expect(diceAttributeModifier({ modifierBase: 50, modifierStep: 10 }, 70, [0, 100])).toBe(2);
  });

  test('没有可检定属性的世界拒绝掷骰', () => {
    const def = { id: 'no_stat', name: '无属性', description: '', modules: [{ moduleId: 'dice', enabled: true, moduleConfig: {} }] } as unknown as WorldDef;
    const host = createGameplayHost(def, createDefaultGameState());
    expect(host.dispatch(host.prepare(createDefaultGameState()), 'dice.roll', { attribute: '力量', dc: 10 }).reason).toContain('没有可用于检定的属性');
  });
});
