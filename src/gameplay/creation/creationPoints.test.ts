import { test, expect } from 'bun:test';
import {
  CREATION_DIFFICULTY_POINT_BASE,
  CREATION_MAX_DRAWS,
  DIVINE_TALENT_COST,
  CREATION_RARITY_WEIGHTS,
  clampPointScale,
  resolveWorldPointScale,
  computeCreationPool,
  statPointGain,
  isDivineTalent,
  talentDirectCost,
  creationDrawCost,
  drawRandomTalent,
  computeCreationSpending,
  materializeStatInitData,
  resolveCreationStatConfig,
} from './creationPoints';
import type { InnateTalentDef, ProfessionModuleSchema } from '../../modules/schema';
import type { WorldDef } from '../../data/worlds-schema';

// ─── 常量 ───

test('CREATION_DIFFICULTY_POINT_BASE 四档齐全且 easy > normal > hard > inferno', () => {
  expect(CREATION_DIFFICULTY_POINT_BASE.easy).toBe(14);
  expect(CREATION_DIFFICULTY_POINT_BASE.normal).toBe(10);
  expect(CREATION_DIFFICULTY_POINT_BASE.hard).toBe(7);
  expect(CREATION_DIFFICULTY_POINT_BASE.inferno).toBe(4);
  expect(CREATION_DIFFICULTY_POINT_BASE.easy).toBeGreaterThan(CREATION_DIFFICULTY_POINT_BASE.normal);
  expect(CREATION_DIFFICULTY_POINT_BASE.normal).toBeGreaterThan(CREATION_DIFFICULTY_POINT_BASE.hard);
  expect(CREATION_DIFFICULTY_POINT_BASE.hard).toBeGreaterThan(CREATION_DIFFICULTY_POINT_BASE.inferno);
});

test('CREATION_MAX_DRAWS = 5', () => {
  expect(CREATION_MAX_DRAWS).toBe(5);
});

test('DIVINE_TALENT_COST = 99999', () => {
  expect(DIVINE_TALENT_COST).toBe(99999);
});

test('CREATION_RARITY_WEIGHTS 五档齐全', () => {
  expect(CREATION_RARITY_WEIGHTS['普通']).toBe(55);
  expect(CREATION_RARITY_WEIGHTS['精良']).toBe(25);
  expect(CREATION_RARITY_WEIGHTS['稀有']).toBe(12);
  expect(CREATION_RARITY_WEIGHTS['史诗']).toBe(6);
  expect(CREATION_RARITY_WEIGHTS['传说']).toBe(2);
});

// ─── clampPointScale ───

test('clampPointScale 非法值归 1.0', () => {
  expect(clampPointScale(undefined)).toBe(1);
  expect(clampPointScale(null)).toBe(1);
  expect(clampPointScale('abc')).toBe(1);
  expect(clampPointScale(NaN)).toBe(1);
  expect(clampPointScale(Infinity)).toBe(1);
});

test('clampPointScale 合法值 clamp 到 [0.5, 2]', () => {
  expect(clampPointScale(0.5)).toBe(0.5);
  expect(clampPointScale(1.0)).toBe(1.0);
  expect(clampPointScale(2.0)).toBe(2.0);
  expect(clampPointScale(0.3)).toBe(0.5);
  expect(clampPointScale(3.0)).toBe(2);
  expect(clampPointScale(1.2)).toBe(1.2);
});

// ─── resolveWorldPointScale ───

test('resolveWorldPointScale 无世界/无 stat 模块 → 1.0', () => {
  expect(resolveWorldPointScale(undefined)).toBe(1);
  expect(resolveWorldPointScale(null)).toBe(1);
  expect(resolveWorldPointScale({} as WorldDef)).toBe(1);
});

test('resolveWorldPointScale stat 模块 disabled → 1.0', () => {
  const world = { modules: [{ moduleId: 'stat', enabled: false, moduleConfig: { pointScale: 1.5 } }] } as unknown as WorldDef;
  expect(resolveWorldPointScale(world)).toBe(1);
});

test('resolveWorldPointScale stat 模块 enabled + pointScale → clamp 后值', () => {
  const world = { modules: [{ moduleId: 'stat', enabled: true, moduleConfig: { pointScale: 1.2 } }] } as unknown as WorldDef;
  expect(resolveWorldPointScale(world)).toBe(1.2);
});

test('resolveWorldPointScale pointScale 非法 → 1.0', () => {
  const world = { modules: [{ moduleId: 'stat', enabled: true, moduleConfig: { pointScale: 'bad' } }] } as unknown as WorldDef;
  expect(resolveWorldPointScale(world)).toBe(1);
});

// ─── computeCreationPool ───

test('computeCreationPool = round(基准 × 系数)，下限 1', () => {
  expect(computeCreationPool('normal', 1)).toBe(10);
  expect(computeCreationPool('easy', 1)).toBe(14);
  expect(computeCreationPool('inferno', 1)).toBe(4);
  expect(computeCreationPool('normal', 1.2)).toBe(12);  // 武侠 12 点
  expect(computeCreationPool('hard', 0.8)).toBe(6);     // 7×0.8=5.6→6
  expect(computeCreationPool('inferno', 0.5)).toBe(2);  // 4×0.5=2
  expect(computeCreationPool('inferno', 0.1)).toBe(1);  // 下限保护
});

// ─── statPointGain ───

test('statPointGain = ceil(cap × 5%)，下限 1', () => {
  expect(statPointGain(100)).toBe(5);
  expect(statPointGain(20)).toBe(1);
  expect(statPointGain(10)).toBe(1);
  expect(statPointGain(0)).toBe(1);     // 下限
  expect(statPointGain(-5)).toBe(1);    // 下限
  expect(statPointGain(NaN)).toBe(1);   // 下限
});

// ─── isDivineTalent ───

test('isDivineTalent cost ≥ 99999 → true', () => {
  expect(isDivineTalent({ cost: 99999 })).toBe(true);
  expect(isDivineTalent({ cost: 100000 })).toBe(true);
  expect(isDivineTalent({ cost: 3 })).toBe(false);
  expect(isDivineTalent({ cost: 0 })).toBe(false);
});

// ─── talentDirectCost ───

test('talentDirectCost 神技 → Infinity', () => {
  expect(talentDirectCost(99999, 1)).toBe(Infinity);
  expect(talentDirectCost(100000, 1.2)).toBe(Infinity);
});

test('talentDirectCost 普通 = max(1, round(cost × 系数))', () => {
  expect(talentDirectCost(1, 1)).toBe(1);
  expect(talentDirectCost(2, 1)).toBe(2);
  expect(talentDirectCost(3, 1.2)).toBe(4);     // 3×1.2=3.6→4
  expect(talentDirectCost(1, 0.5)).toBe(1);     // 下限
  expect(talentDirectCost(2, 0.8)).toBe(2);     // 2×0.8=1.6→2
});

// ─── creationDrawCost ───

test('creationDrawCost = max(1, round(1 × 系数))', () => {
  expect(creationDrawCost(1)).toBe(1);
  expect(creationDrawCost(1.2)).toBe(1);   // 1×1.2=1.2→1
  expect(creationDrawCost(1.5)).toBe(2);   // 1×1.5=1.5→2
  expect(creationDrawCost(0.5)).toBe(1);   // 下限
});

// ─── drawRandomTalent ───

function makeTalent(overrides: Partial<InnateTalentDef>): InnateTalentDef {
  return {
    id: 't1',
    name: '天赋1',
    description: '',
    cost: 1,
    ...overrides,
  };
}

test('drawRandomTalent 空池 → null', () => {
  expect(drawRandomTalent([], [])).toBeNull();
});

test('drawRandomTalent 全部已拥有 → null', () => {
  const talents = [makeTalent({ id: 'a' }), makeTalent({ id: 'b' })];
  expect(drawRandomTalent(talents, ['a', 'b'])).toBeNull();
});

test('drawRandomTalent 排除互斥组冲突', () => {
  const talents = [
    makeTalent({ id: 'a', exclusiveGroup: 'g1' }),
    makeTalent({ id: 'b', exclusiveGroup: 'g1' }),
  ];
  const result = drawRandomTalent(talents, ['a']);
  expect(result).toBeNull();  // b 与 a 同组，不可抽
});

test('drawRandomTalent 排除前置未满足', () => {
  const talents = [
    makeTalent({ id: 'a' }),
    makeTalent({ id: 'b', prerequisites: ['a'] }),
  ];
  const result = drawRandomTalent(talents, []);
  // a 可抽（无前置），b 需要 a 未满足 → 排除
  expect(result?.id).toBe('a');
});

test('drawRandomTalent 返回候选之一', () => {
  const talents = [
    makeTalent({ id: 'a' }),
    makeTalent({ id: 'b' }),
    makeTalent({ id: 'c' }),
  ];
  const result = drawRandomTalent(talents, []);
  expect(result).not.toBeNull();
  expect(['a', 'b', 'c']).toContain(result!.id);
});

test('drawRandomTalent 神技可被抽中', () => {
  const talents = [
    makeTalent({ id: 'divine', cost: 99999, rarity: '传说' }),
    makeTalent({ id: 'normal', cost: 1, rarity: '普通' }),
  ];
  // 多次抽卡确保分布稳定（传说权重 2，普通 55）
  let divineHits = 0;
  for (let i = 0; i < 1000; i++) {
    const result = drawRandomTalent(talents, []);
    if (result?.id === 'divine') divineHits++;
  }
  // 传说权重 2/(55+2) ≈ 3.5%，1000 次约 35 次，允许宽松范围
  expect(divineHits).toBeGreaterThan(0);
  expect(divineHits).toBeLessThan(100);
});

// ─── computeCreationSpending ───

function makeConfig(overrides: Partial<ProfessionModuleSchema> = {}): ProfessionModuleSchema {
  return {
    professions: [],
    innateTalents: [],
    creationTalentBudget: 3,
    ...overrides,
  };
}

test('computeCreationSpending 空分配 → pool 全余', () => {
  const config = makeConfig();
  const spending = computeCreationSpending(config, {
    riskMode: 'normal',
    pointScale: 1,
    talentIds: [],
    drawCount: 0,
    allocations: {},
  });
  expect(spending.pool).toBe(10);
  expect(spending.talentSpent).toBe(0);
  expect(spending.drawSpent).toBe(0);
  expect(spending.statSpent).toBe(0);
  expect(spending.remaining).toBe(10);
  expect(spending.ok).toBe(true);
});

test('computeCreationSpending 天赋花费累加（神技为 0）', () => {
  const config = makeConfig({
    innateTalents: [
      makeTalent({ id: 't1', cost: 2 }),
      makeTalent({ id: 'divine', cost: 99999 }),
    ],
  });
  const spending = computeCreationSpending(config, {
    riskMode: 'normal',
    pointScale: 1,
    talentIds: ['t1', 'divine'],
    drawCount: 0,
    allocations: {},
  });
  expect(spending.talentSpent).toBe(2);  // 神技 0 + t1 2
  expect(spending.remaining).toBe(8);
  expect(spending.ok).toBe(true);
});

test('computeCreationSpending 抽中天赋只计抽卡费，不重复计直选价', () => {
  const config = makeConfig({ innateTalents: [makeTalent({ id: 'normal', cost: 3 })] });
  const spending = computeCreationSpending(config, {
    riskMode: 'normal',
    pointScale: 1,
    talentIds: ['normal'],
    drawnTalentIds: ['normal'],
    drawCount: 1,
    allocations: {},
  });
  expect(spending).toMatchObject({ talentSpent: 0, drawSpent: 1, totalSpent: 1, remaining: 9, ok: true });
});

test('computeCreationSpending 抽卡花费 = 次数 × 单价', () => {
  const config = makeConfig();
  const spending = computeCreationSpending(config, {
    riskMode: 'normal',
    pointScale: 1,
    talentIds: [],
    drawCount: 3,
    allocations: {},
  });
  expect(spending.drawSpent).toBe(3);
  expect(spending.remaining).toBe(7);
});

test('computeCreationSpending 属性加点花费累加', () => {
  const config = makeConfig();
  const spending = computeCreationSpending(config, {
    riskMode: 'normal',
    pointScale: 1,
    talentIds: [],
    drawCount: 0,
    allocations: { attrA: 3, dim1: 2, special_x: 1 },
  });
  expect(spending.statSpent).toBe(6);
  expect(spending.remaining).toBe(4);
});

test('computeCreationSpending 超支 → ok:false', () => {
  const config = makeConfig({
    innateTalents: [makeTalent({ id: 't1', cost: 5 })],
  });
  const spending = computeCreationSpending(config, {
    riskMode: 'inferno',
    pointScale: 1,
    talentIds: ['t1'],
    drawCount: 0,
    allocations: { attrA: 1 },
  });
  // pool = 4, talentSpent = 5 → 超支
  expect(spending.pool).toBe(4);
  expect(spending.talentSpent).toBe(5);
  expect(spending.ok).toBe(false);
  expect(spending.reason).toContain('降临点数不足');
});

test('computeCreationSpending 非法分配值忽略', () => {
  const config = makeConfig();
  const spending = computeCreationSpending(config, {
    riskMode: 'normal',
    pointScale: 1,
    talentIds: [],
    drawCount: 0,
    allocations: { attrA: -2, dim1: NaN, dim2: 1.5 },
  });
  expect(spending.statSpent).toBe(1);  // -2 和 NaN 忽略，1.5 floor 为 1
});

// ─── materializeStatInitData ───

test('materializeStatInitData 输出形状对齐 StatsTab', () => {
  const statConfig = {
    attrA: { name: '生命', current: 80, max: 100 },
    attrB: { name: '能量', current: 60, max: 100 },
    dim1: { name: '力量', value: 5, range: [0, 10] },
    special: [{ id: 'sp1', name: '灵气', value: 3, range: [0, 20], description: '' }],
  };
  const result = materializeStatInitData(statConfig, { attrA: 2, dim1: 1, sp1: 1 });
  // attrA: 80 + 2×5(ceil(100×5%)) = 90
  expect(result.attrA).toEqual({ current: 90 });
  // attrB 未分配 → 不出现在输出（materializeStatInitData 只写分配了的？）
  // 实际上代码会对所有存在的 attr 都写入（base + 0×gain = base）
  expect(result.attrB).toEqual({ current: 60 });
  // dim1: 5 + 1×1(ceil(10×5%)) = 6
  expect(result.dim1).toEqual({ value: 6 });
  // special sp1: 3 + 1×1(ceil(20×5%)) = 4
  expect(result.special).toEqual({ sp1: { value: 4 } });
});

test('materializeStatInitData 空分配 → 基础值', () => {
  const statConfig = {
    attrA: { name: '生命', current: 80, max: 100 },
  };
  const result = materializeStatInitData(statConfig, {});
  expect(result.attrA).toEqual({ current: 80 });
  expect(result.special).toBeUndefined();
});

test('materializeStatInitData 增益 clamp 到上限', () => {
  const statConfig = {
    attrA: { name: '生命', current: 95, max: 100 },
  };
  // 95 + 2×5 = 105 → clamp 到 100
  const result = materializeStatInitData(statConfig, { attrA: 2 });
  expect(result.attrA).toEqual({ current: 100 });
});

test('materializeStatInitData 保留合法小数并按属性下限 clamp', () => {
  const result = materializeStatInitData({
    attrA: { name: '生命', current: 0.5, max: 10 },
    dim1: { name: '寒热', value: -10, range: [-10, 100] },
    special: [{ id: 'balance', name: '平衡', value: -1.5, range: [-3, 5], description: '' }],
  }, { dim1: 1 });

  expect(result.attrA).toEqual({ current: 0.5 });
  expect(result.dim1).toEqual({ value: -5 });
  expect(result.special).toEqual({ balance: { value: -1.5 } });
});

test('materializeStatInitData 无 statConfig → 空对象', () => {
  expect(materializeStatInitData({}, {})).toEqual({});
});

test('resolveCreationStatConfig merges module initialState and supplies finite base values', () => {
  const resolved = resolveCreationStatConfig({
    attrA: { name: '气血', max: 200 },
    attrB: { name: '内息', current: 40, max: 150 },
    dim1: { name: '膂力', range: [0, 100] },
    dim2: { name: '根骨', value: 20, range: [0, 100] },
    dim3: { name: '身法', range: [-10, 100] },
    special: [
      { id: 'reputation', name: '内功', range: [0, 100] },
      { id: 'melancholy', name: '外功', value: 7, range: [0, 100] },
    ],
  }, {
    attrA: 120,
    dim1: 45,
    dim2Value: 55,
    special: { reputation: 10 },
  });

  expect(resolved).toMatchObject({
    attrA: { current: 120 },
    attrB: { current: 40 },
    dim1: { value: 45 },
    dim2: { value: 55 },
    dim3: { value: -10 },
    special: [
      { id: 'reputation', value: 10 },
      { id: 'melancholy', value: 7 },
    ],
  });
});
