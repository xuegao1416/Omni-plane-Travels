// 能力模块：天赋、技能、觉醒、装备槽、重置、职业能力，全部走宿主命令。
// 前四条由 gameplay/modules/modules.test 的天赋/技能用例移植，
// 职业三条由 gameplay/profession/profession.test 的解锁用例移植（场景与断言不变）。
import { describe, expect, test } from 'bun:test';
import { createDefaultGameState, type GameState } from '../../schema/variables';
import type { WorldDef } from '../../data/worlds-schema';
import type { ProfessionModuleSchema, TalentModuleSchema } from '../../modules/schema';
import { createGameplayHost } from '../../core/registry';
import { coreModule } from '../../core/coreModule';
import type { HostOutcome } from '../../core/host';
import { initializeProfessionSelection, resolveOwnedAbility, resolveProfessionBonuses } from '../../gameplay/profession/profession';
import { abilitiesModule } from './module';

function talentWorld(config: TalentModuleSchema): WorldDef {
  return { id: 'ability_world', name: '能力', description: '', modules: [{ moduleId: 'talent', enabled: true, moduleConfig: config }] } as unknown as WorldDef;
}

function atTick(state: GameState, tick: number): GameState {
  state.simulationRuntime = { ...(state.simulationRuntime ?? { periodicCounters: {}, effectLog: [], triggeredPeriodicEvents: [], evolvedSteps: [] }), tick } as NonNullable<GameState['simulationRuntime']>;
  return state;
}

function talentHost(config: TalentModuleSchema, state: GameState) {
  const host = createGameplayHost(talentWorld(config), state);
  const run = (current: GameState, tick: number, command: string, args: Record<string, unknown> = {}): HostOutcome =>
    host.dispatch(atTick(structuredClone(current), tick), `abilities.${command}`, args);
  return { host, state: host.prepare(state), run };
}

function professionHost(config: ProfessionModuleSchema, state: GameState) {
  const host = createGameplayHost(undefined, state, [coreModule, { ...abilitiesModule, resolveConfig: () => ({ profession: config }) }]);
  const run = (current: GameState, tick: number, command: string, args: Record<string, unknown> = {}): HostOutcome =>
    host.dispatch(atTick(structuredClone(current), tick), `abilities.${command}`, args);
  return { host, state: host.prepare(state), run };
}

describe('天赋与技能', () => {
  test('解锁天赋是一个事务，效果可以写到别的模块', () => {
    const initial = createDefaultGameState();
    initial.玩家.能力系统 = { 天赋点: 2, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    initial.玩家.经营资产 = { 资金: 100, 资产列表: [] };
    const { state, run } = talentHost({
      categories: [{
        id: 'trade', name: '商道', description: '', talents: [{
          id: 'keen_eye', name: '慧眼', description: '', rarity: '精良', pointCost: 1,
          mechanics: { onUnlock: [{ add: { path: '玩家.经营资产.资金', delta: 5 } }] },
        }],
      }],
    }, initial);

    const result = run(state, 3, 'unlockTalent', { id: 'keen_eye' });
    expect(result.status).toBe('applied');
    expect(result.state.玩家.能力系统?.天赋点).toBe(1);
    expect(result.state.玩家.能力系统?.已解锁天赋.keen_eye).toEqual({ 等级: 1, 解锁轮次: 3 });
    expect(result.state.玩家.经营资产?.资金).toBe(105);
    expect(result.events.map(event => event.type)).toContain('talent.unlocked');
  });

  test('技能学习与使用：消耗、冷却、跨模块效果', () => {
    const initial = createDefaultGameState();
    initial.玩家.能力系统 = { 天赋点: 0, 技能点: 2, 已解锁天赋: {}, 已掌握技能: {} };
    initial.玩家.生存状态.体力值 = 20;
    initial.玩家.经营资产 = { 资金: 10, 资产列表: [] };
    const { state, run } = talentHost({
      categories: [],
      skills: [{
        id: 'bargain', name: '议价', description: '', rarity: '普通',
        pointCost: 1, cooldownTicks: 2,
        activation: {
          costs: [{ path: '玩家.生存状态.体力值', amount: 3 }],
          effects: [{ add: { path: '玩家.经营资产.资金', delta: 5 } }],
        },
      }],
    } as TalentModuleSchema, initial);

    const learned = run(state, 7, 'learnSkill', { id: 'bargain' });
    expect(learned.status).toBe('applied');
    expect(learned.state.玩家.能力系统?.技能点).toBe(1);
    expect(learned.state.玩家.技能系统.议价).toBeDefined();
    const used = run(learned.state, 8, 'useSkill', { id: 'bargain' });
    expect(used.status).toBe('applied');
    expect(used.state.玩家.生存状态.体力值).toBe(17);
    expect(used.state.玩家.经营资产?.资金).toBe(15);
    expect(used.state.玩家.能力系统?.已掌握技能.bargain.冷却至轮次).toBe(10);
    const cooling = run(used.state, 9, 'useSkill', { id: 'bargain' });
    expect(cooling.status).not.toBe('applied');
    expect(cooling.reason).toContain('冷却');
    expect(cooling.state.玩家.生存状态.体力值).toBe(17);
  });

  test('天赋树的前置与互斥分支', () => {
    const initial = createDefaultGameState();
    initial.玩家.能力系统 = { 天赋点: 3, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    const { state, run } = talentHost({ categories: [{ id: 'rpg', name: '流派', description: '', talents: [
      { id: 'root', name: '根基', description: '', rarity: '普通', pointCost: 1 },
      { id: 'blade', name: '剑术', description: '', rarity: '稀有', prerequisites: ['root'], exclusiveGroup: 'style', pointCost: 1 },
      { id: 'magic', name: '法术', description: '', rarity: '稀有', prerequisites: ['root'], exclusiveGroup: 'style', pointCost: 1 },
    ] }] }, initial);

    const early = run(state, 1, 'unlockTalent', { id: 'blade' });
    expect(early.status).not.toBe('applied');
    expect(early.reason).toContain('前置');
    const root = run(state, 2, 'unlockTalent', { id: 'root' });
    const blade = run(root.state, 3, 'unlockTalent', { id: 'blade' });
    expect(blade.status).toBe('applied');
    const magic = run(blade.state, 4, 'unlockTalent', { id: 'magic' });
    expect(magic.status).not.toBe('applied');
    expect(magic.reason).toContain('互斥');
    expect(magic.state.玩家.能力系统?.天赋点).toBe(1);
  });

  test('熟练度升级、觉醒、装备槽与重置', () => {
    const initial = createDefaultGameState();
    initial.玩家.能力系统 = { 天赋点: 0, 技能点: 2, 已解锁天赋: {}, 已掌握技能: {} };
    const { state, run } = talentHost({ categories: [], equipmentSlots: [{ id: 'core', name: '核心', capacity: 1 }], respec: { enabled: true }, skills: [{
      id: 'focus', name: '专注', description: '', rarity: '普通', pointCost: 1, maxRank: 2, proficiency: { gainPerUse: 10, thresholdPerRank: 10 }, equipmentSlot: 'core',
      awakening: { name: '心流', description: '', pointCost: 0 },
    }] } as TalentModuleSchema, initial);

    const learned = run(state, 1, 'learnSkill', { id: 'focus' });
    const used = run(learned.state, 2, 'useSkill', { id: 'focus' });
    expect(used.state.玩家.能力系统?.已掌握技能.focus.等级).toBe(2);
    const equipped = run(used.state, 3, 'equip', { id: 'focus', slotId: 'core' });
    expect(equipped.state.玩家.能力系统?.装备槽?.core).toEqual(['focus']);
    const awakened = run(equipped.state, 4, 'awaken', { id: 'focus' });
    expect(awakened.state.玩家.能力系统?.已觉醒?.focus).toBeDefined();
    const reset = run(awakened.state, 5, 'respec');
    expect(reset.status).toBe('applied');
    expect(reset.state.玩家.能力系统?.已掌握技能).toEqual({});
    expect(reset.state.玩家.能力系统?.技能点).toBe(3);
  });

  test('点数只能由命令、成长和事件改，AI 直接改写会被拒绝', () => {
    const initial = createDefaultGameState();
    initial.玩家.能力系统 = { 天赋点: 1, 技能点: 0, 已解锁天赋: {}, 已掌握技能: {} };
    const { host, state } = talentHost({ categories: [] }, initial);
    const ai = host.apply(state, [{ op: 'set', path: '玩家.能力系统.天赋点', value: 99 }], { source: 'ai', label: 'AI 更新' });
    expect(ai.state.玩家.能力系统?.天赋点).toBe(1);
    const event = host.apply(state, [{ op: 'add', path: '玩家.能力系统.天赋点', value: 2 }], { source: 'event', label: '奇遇' });
    expect(event.state.玩家.能力系统?.天赋点).toBe(3);
    const clamped = host.apply(state, [{ op: 'add', path: '玩家.能力系统.天赋点', value: -5 }], { source: 'event', label: '惩罚' });
    expect(clamped.state.玩家.能力系统?.天赋点).toBe(0);
    const strict = host.apply(state, [{ op: 'add', path: '玩家.能力系统.天赋点', value: -5, strict: true }], { source: 'event', label: '交换', strict: true });
    expect(strict.status).toBe('failed');
  });

  test('未启用天赋的世界没有这些命令', () => {
    const state = createDefaultGameState();
    const host = createGameplayHost({ id: 'plain', name: '无', description: '', modules: [] } as unknown as WorldDef, state);
    expect(host.dispatch(host.prepare(state), 'abilities.unlockTalent', { id: 'x' }).status).toBe('failed');
  });
});

const professionConfig: ProfessionModuleSchema = {
  creationTalentBudget: 3,
  allowNoProfession: true,
  initialAbilityPoints: 2,
  innateTalents: [
    { id: 'brave', name: '无畏', description: '', cost: 1, exclusiveGroup: 'temper', mechanics: { checks: [{ statIds: ['dim5'], value: 1 }] } },
    { id: 'calm', name: '冷静', description: '', cost: 1, exclusiveGroup: 'temper' },
    { id: 'lucky', name: '幸运儿', description: '', cost: 2 },
  ],
  professions: [{
    id: 'warrior', name: '战士', description: '', abilities: [
      { id: 'guard', name: '守势', description: '', type: 'passive', pointCost: 1, mechanics: { combat: { armor: 2 }, checks: [{ statIds: ['dim2'], value: 1 }] } },
      { id: 'slash', name: '重斩', description: '', type: 'active', pointCost: 1, prerequisites: ['guard'] },
      { id: 'last_stand', name: '背水一战', description: '', type: 'ultimate', pointCost: 2, prerequisites: ['slash'], requiredProfessionLevel: 3 },
    ],
  }],
};

describe('职业能力', () => {
  test('只解锁所选职业的能力树，受前置与职业等级限制', () => {
    const { state, run } = professionHost(professionConfig, initializeProfessionSelection(createDefaultGameState(), professionConfig, 'warrior', []));
    expect(run(state, 1, 'unlockProfession', { id: 'slash' }).status).not.toBe('applied');
    const guard = run(state, 2, 'unlockProfession', { id: 'guard' });
    expect(guard.status).toBe('applied');
    const slash = run(guard.state, 3, 'unlockProfession', { id: 'slash' });
    expect(slash.state.玩家.能力系统?.职业状态?.已解锁能力.slash.等级).toBe(1);
    expect(slash.state.v3?.abilityInstances?.['warrior:slash'] ?? Object.values(slash.state.v3?.abilityInstances ?? {}).find(item => item.definitionId.endsWith('slash'))).toBeDefined();
    const last = run(slash.state, 4, 'unlockProfession', { id: 'last_stand' });
    expect(last.status).not.toBe('applied');
    expect(last.reason).toContain('职业等级');
  });

  test('任务里的能力按稳定 id 或显示名都能认出来', () => {
    const { state, run } = professionHost(professionConfig, initializeProfessionSelection(createDefaultGameState(), professionConfig, 'warrior', []));
    const unlocked = run(state, 1, 'unlockProfession', { id: 'guard' }).state;
    expect(resolveOwnedAbility(unlocked, professionConfig, 'guard')?.id).toBe('guard');
    expect(resolveOwnedAbility(unlocked, professionConfig, '守势')?.id).toBe('guard');
    expect(resolveOwnedAbility(unlocked, professionConfig, '重斩')).toBeUndefined();
  });

  test('加成只来自选中的先天天赋和真正解锁的职业节点', () => {
    const { state, run } = professionHost(professionConfig, initializeProfessionSelection(createDefaultGameState(), professionConfig, 'warrior', ['brave']));
    expect(resolveProfessionBonuses(state, professionConfig).combat.armor).toBe(0);
    const unlocked = run(state, 1, 'unlockProfession', { id: 'guard' }).state;
    const bonuses = resolveProfessionBonuses(unlocked, professionConfig);
    expect(bonuses.combat.armor).toBe(2);
    expect(bonuses.checks.map(item => item.source)).toEqual(expect.arrayContaining(['无畏', '守势']));
    expect(bonuses.checks.some(item => item.source === '重斩')).toBe(false);
  });

  test('主动能力的使用次数与冷却', () => {
    const config: ProfessionModuleSchema = {
      ...professionConfig,
      professions: [{ ...professionConfig.professions[0], abilities: professionConfig.professions[0].abilities.map(item => item.id === 'slash' ? { ...item, cooldownTicks: 2 } : item) }],
    } as ProfessionModuleSchema;
    const { state, run } = professionHost(config, initializeProfessionSelection(createDefaultGameState(), config, 'warrior', []));
    const guard = run(state, 1, 'unlockProfession', { id: 'guard' });
    const slash = run(guard.state, 2, 'unlockProfession', { id: 'slash' });
    expect(run(slash.state, 3, 'useProfession', { id: 'guard' }).status).not.toBe('applied');
    const used = run(slash.state, 3, 'useProfession', { id: 'slash' });
    expect(used.status).toBe('applied');
    expect(used.state.玩家.能力系统?.职业状态?.已解锁能力.slash.使用次数).toBe(1);
    expect(run(used.state, 4, 'useProfession', { id: 'slash' }).status).not.toBe('applied');
    expect(run(used.state, 5, 'useProfession', { id: 'slash' }).status).toBe('applied');
  });
});
