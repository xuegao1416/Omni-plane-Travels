// 属性模块：属性点分配、范围与成长上限、加成后的有效值、派生属性。
// 前三条由 gameplay/modules/modules.test 的属性用例移植（同一场景，改走玩法宿主）。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { ProgressionConfig, StatModuleSchema } from '../../modules/schema';
import { createGameplayHost } from '../../core/registry';

function world(stat: Partial<StatModuleSchema>, progression?: ProgressionConfig): WorldDef {
  return {
    id: 'stats_world', name: '属性', description: '',
    modules: [
      { moduleId: 'stat', enabled: true, moduleConfig: { special: [], ...stat } },
      ...(progression ? [{ moduleId: 'progression', enabled: true, moduleConfig: progression }] : []),
    ],
  } as unknown as WorldDef;
}

function setup(def: WorldDef, mutate?: (state: GameState) => void) {
  const state = createDefaultGameState();
  mutate?.(state);
  const host = createGameplayHost(def, state);
  return { host, state: host.prepare(state) };
}

describe('属性', () => {
  test('属性点分配是原子的：点数不够时什么都不改', () => {
    const def = world({ attrA: { name: '生命', current: 100, max: 120 }, attrB: { name: '能量', current: 50, max: 80 }, dim1: { name: '力量', value: 10, range: [0, 20] } });
    const { host, state } = setup(def, draft => { draft.玩家.可用属性点 = 3; draft.玩家.生存状态.dim1 = 10; });
    const first = host.dispatch(state, 'stats.allocate', { stat: 'dim1', amount: 2 });
    const second = host.dispatch(first.state, 'stats.allocate', { stat: 'attrA', amount: 1 });
    expect(second.state.玩家.可用属性点).toBe(0);
    expect(second.state.玩家.生存状态.dim1).toBe(12);
    expect(second.state.玩家.生存状态.血量).toBe(101);
    const refused = host.dispatch(second.state, 'stats.allocate', { stat: '力量', amount: 1 });
    expect(refused.status).toBe('failed');
    expect(refused.reason).toContain('属性点不足');
    expect(refused.state).toBe(second.state);
  });

  test('属性变化遵守配置范围（AI 与事件的增减都会被钳制）', () => {
    const def = world({ attrA: { name: '气血', current: 95, max: 100 }, attrB: { name: '内力', current: 50, max: 80 } });
    const { host, state } = setup(def, draft => { draft.玩家.生存状态.血量 = 95; });
    const healed = host.apply(state, [{ op: 'add', path: '玩家.生存状态.血量', value: 20 }], { source: 'ai', label: '治疗' });
    expect(healed.state.玩家.生存状态.血量).toBe(100);
    const hurt = host.apply(healed.state, [{ op: 'add', path: 'player.stats.attrA', value: -500 }], { source: 'event', label: '重伤' });
    expect(hurt.state.玩家.生存状态.血量).toBe(0);
    expect(hurt.events.some(event => event.type === 'player.downed')).toBe(true);
  });

  test('加成、派生属性与到期：有效值包含加成，到期后恢复', () => {
    const def = world({
      attrA: { name: '生命', current: 50, max: 100 }, attrB: { name: '能量', current: 50, max: 100 },
      derived: [{ id: 'power', name: '战力', inputs: ['attrA'], scale: 2 }],
    });
    const { host, state } = setup(def, draft => { draft.玩家.生存状态.血量 = 50; });
    const buffed = host.apply(state, [{ op: 'modifier', modifier: { id: 'blessing', target: 'stat.attrA', mode: 'flat', value: 10, turns: 2, label: '祝福' } }], { source: 'event', label: '祝福' });
    expect(host.facts.read(buffed.state, 'player.stats.attrA.effective')).toBe(60);
    expect(host.facts.read(buffed.state, 'player.stats.power')).toBe(120);
    expect(buffed.state.gameplay?.stat?.derived?.power).toBe(120);
    let current = buffed.state;
    for (let turn = 1; turn <= 2; turn++) {
      const started = host.startTurn(current, { turnId: `t${turn}`, round: turn });
      current = host.endTurn(started.state, { turnId: `t${turn}`, round: turn }).state;
    }
    expect(host.facts.read(current, 'player.stats.attrA.effective')).toBe(50);
    expect(current.gameplay?.stat?.derived?.power).toBe(100);
  });

  test('有成长体系时属性上限随等级提高；已超出上限的旧值不会被压低', () => {
    const progression: ProgressionConfig = {
      mode: 'level', xpFormula: { baseXP: 100, exponent: 1, scaleFactor: 1 },
      levelData: {
        maxLevel: 5,
        baseStats: { attrAMax: 100, attrBMax: 100, dim1Max: 12, dim2Max: 12, dim3Max: 12, dim4Max: 12, dim5Max: 12, dim6Max: 12 },
        growthPerLevel: { attrAMax: 10, attrBMax: 10, dim1Max: 2, dim2Max: 2, dim3Max: 2, dim4Max: 2, dim5Max: 2, dim6Max: 2 },
      },
    };
    const def = world({ attrA: { name: '生命', current: 100, max: 100 }, attrB: { name: '体力', current: 100, max: 100 }, dim1: { name: '力量', value: 10, range: [0, 20] } }, progression);
    const { host, state } = setup(def, draft => { draft.玩家.生存状态.dim1 = 10; draft.玩家.当前段位索引 = 0; });
    expect(host.apply(state, [{ op: 'add', path: 'player.stats.dim1', value: 5 }], { source: 'event', label: '训练' }).state.玩家.生存状态.dim1).toBe(12);
    const leveled = structuredClone(state);
    leveled.玩家.当前段位索引 = 2;
    expect(host.apply(leveled, [{ op: 'add', path: 'player.stats.dim1', value: 5 }], { source: 'event', label: '训练' }).state.玩家.生存状态.dim1).toBe(15);
    const over = structuredClone(state);
    over.玩家.生存状态.dim1 = 18;
    expect(host.apply(over, [{ op: 'add', path: 'player.stats.dim1', value: -1 }], { source: 'event', label: '疲惫' }).state.玩家.生存状态.dim1).toBe(17);
  });

  test('正文摘要列出属性名与当前值，提取摘要列出变量与范围', () => {
    const def = world({ attrA: { name: '气血', current: 80, max: 200 }, attrB: { name: '内息', current: 50, max: 150 }, dim1: { name: '膂力', value: 40, range: [0, 100] } });
    const { host, state } = setup(def, draft => { draft.玩家.生存状态.血量 = 80; draft.玩家.生存状态.dim1 = 40; });
    const main = host.summarize(state, 'main').find(item => item.moduleId === 'stats')?.text ?? '';
    expect(main).toContain('气血 80/200');
    expect(main).toContain('膂力 40');
    const extraction = host.summarize(state, 'extraction').find(item => item.moduleId === 'stats')?.text ?? '';
    expect(extraction).toContain('dim1=膂力（0~100）');
  });
});
