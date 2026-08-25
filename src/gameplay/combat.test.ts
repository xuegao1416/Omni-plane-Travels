import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import type { CombatModuleSchema } from '../modules/schema';
import { performCombatAction, resolveCombatActionScaling, startCombat, summarizeCombatSession } from './combat';
import { normalizeCombatConfig } from '../modules/prompts/combat';
import { prepareGameplayState } from './migrations';

const config: CombatModuleSchema = {
  actionPointsPerTurn: 1,
  playerHpPath: '玩家.生存状态.血量',
  playerAttackPath: '玩家.生存状态.dim1',
  playerActions: [{ id: 'strike', name: '攻击', target: 'enemy', actionCost: 1, accuracy: 10, damage: 20 }],
  encounters: [{ id: 'test', name: '测试遭遇', enemies: [{ id: 'slime', name: '史莱姆', maxHp: 10, armor: 0, actions: [] }] }],
};

describe('combat domain', () => {
  test('starts an encounter and resolves a deterministic victory through gameplay events', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.dim1 = 10;
    const started = startCombat(state, config, 'test', { tick: 1, random: () => 0.95 });
    expect(started.status).toBe('applied');
    const acted = performCombatAction(started.state, config, 'strike', 'slime', { tick: 2, random: () => 0.95 });
    expect(acted.status).toBe('applied');
    expect(acted.state.combat?.active).toBeUndefined();
    expect(acted.state.combat?.history?.[0].status).toBe('victory');
    expect(acted.state.gameplay?.eventHistory.some(event => event.type === 'combat.victory')).toBe(true);
  });

  test('worlds without combat state remain untouched by the domain', () => {
    const state = createDefaultGameState();
    const result = performCombatAction(state, config, 'strike', 'slime', { tick: 1 });
    expect(result.status).toBe('blocked');
    expect(result.state.combat).toBeUndefined();
  });

  test('keeps percentage profession scaling meaningful in low-value worlds', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.dim1 = 8;
    expect(resolveCombatActionScaling(state, {
      id: 'scaled', name: '蓄力猛击', damage: 2,
      scaling: [{ statId: 'dim1', coefficient: 0.05, appliesTo: 'damage' }],
    }, 'damage')).toBe(1);
  });

  test('supports self-target healing, status damage, visible turn order and rewards', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.血量 = 50;
    state.玩家.生存状态.dim1 = 10;
    const fullConfig: CombatModuleSchema = {
      ...config,
      playerMaxHp: 100,
      playerActions: [
        { id: 'mend', name: '治疗', target: 'self', actionCost: 1, healing: 20, cooldownRounds: 1 },
        { id: 'burn', name: '灼烧', target: 'enemy', actionCost: 1, accuracy: 10, damage: 1,
          appliesStatus: { id: 'burning', name: '灼烧', durationRounds: 2, damagePerRound: 4 } },
      ],
      encounters: [{
        id: 'test', name: '测试遭遇', roundLimit: 4,
        enemies: [{ id: 'slime', name: '史莱姆', maxHp: 10, armor: 0, initiative: 5, actions: [] }],
        rewards: [{ add: { path: '玩家.当前经验值', delta: 25, create: true } }],
      }],
    };
    const started = startCombat(state, fullConfig, 'test', { tick: 1, random: () => 0.95 });
    expect(started.state.combat?.active?.turnOrder).toEqual(['slime', 'player']);
    expect(summarizeCombatSession(started.state.combat!.active!)).toContain('第 1 回合');
    const healed = performCombatAction(started.state, fullConfig, 'mend', 'player', { tick: 2, random: () => 0.95 });
    expect(healed.status).toBe('applied');
    expect(healed.state.combat?.active?.participants.find(item => item.id === 'player')?.hp).toBe(68);
    const burned = performCombatAction(healed.state, fullConfig, 'burn', 'slime', { tick: 3, random: () => 0.95 });
    expect(burned.status).toBe('applied');
    expect(burned.state.combat?.active?.participants.find(item => item.id === 'slime')?.statuses[0].id).toBe('burning');
    const won = performCombatAction(burned.state, { ...fullConfig, playerActions: [{ id: 'finish', name: '终结', target: 'enemy', actionCost: 1, accuracy: 10, damage: 20 }] }, 'finish', 'slime', { tick: 4, random: () => 0.95 });
    expect(won.status).toBe('applied');
    expect(won.state.玩家.当前经验值).toBe(25);
  });

  test('normalizes generated combat JSON into runnable bounded definitions', () => {
    const normalized = normalizeCombatConfig({
      actionPointsPerTurn: 99,
      playerActions: [{ id: 'hit', name: '命中', target: 'enemy', damage: '4' }, null, { id: '', name: '' }],
      encounters: [{ id: 'e', name: '遭遇', enemies: [{ id: 'x', name: '敌', maxHp: 20, actions: [{ id: 'a', name: '打', target: 'enemy', damage: 3 }] }] }],
    });
    expect(normalized?.actionPointsPerTurn).toBe(5);
    expect(normalized?.playerActions).toHaveLength(1);
    expect(normalized?.playerActions?.[0].damage).toBe(4);
    expect(normalized?.encounters[0].enemies[0].maxHp).toBe(20);
  });

  test('uses action points to allow multiple player actions before enemy turn', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.dim1 = 10;
    const apConfig: CombatModuleSchema = {
      actionPointsPerTurn: 2,
      playerMaxHp: 100,
      playerActions: [{ id: 'poke', name: '试探', target: 'enemy', actionCost: 1, accuracy: 10, damage: 1 }],
      encounters: [{ id: 'ap', name: '行动点测试', enemies: [{ id: 'enemy', name: '敌人', maxHp: 20, actions: [{ id: 'hit', name: '反击', target: 'enemy', accuracy: 10, damage: 5 }] }] }],
    };
    const started = startCombat(state, apConfig, 'ap', { tick: 1, random: () => 0.95 });
    const first = performCombatAction(started.state, apConfig, 'poke', 'enemy', { tick: 2, random: () => 0.95 });
    expect(first.state.combat?.active?.actionPoints).toBe(1);
    expect(first.state.玩家.生存状态.血量).toBe(100);
    const second = performCombatAction(first.state, apConfig, 'poke', 'enemy', { tick: 3, random: () => 0.95 });
    expect(second.state.combat?.active?.round).toBe(2);
    expect(second.state.玩家.生存状态.血量).toBe(95);
  });

  test('honors deterministic rolls, status modifiers and enemy ally targets', () => {
    const state = createDefaultGameState();
    state.玩家.生存状态.血量 = 100;
    state.玩家.生存状态.dim1 = 10;
    const supportConfig: CombatModuleSchema = {
      deterministic: true,
      actionPointsPerTurn: 1,
      playerInitiative: 20,
      playerActions: [{ id: 'chip', name: '削弱', target: 'enemy', actionCost: 1, accuracy: 10, damage: 5 }],
      encounters: [{
        id: 'support', name: '协同测试', enemies: [
          {
            id: 'healer', name: '治疗者', maxHp: 10, initiative: 10,
            statuses: [{ id: 'focused', name: '专注', modifiers: { healing: 2 } }],
            actions: [{ id: 'heal', name: '治疗同伴', target: 'ally', healing: 4 }],
          },
          {
            id: 'guard', name: '守卫', maxHp: 10, initiative: 5,
            statuses: [{ id: 'fury', name: '愤怒', modifiers: { damage: 4 } }],
            actions: [{ id: 'hit', name: '打击', target: 'enemy', accuracy: 10, damage: 1 }],
          },
        ],
      }],
    };
    const started = startCombat(state, supportConfig, 'support', { tick: 1 });
    const acted = performCombatAction(started.state, supportConfig, 'chip', 'guard', { tick: 2 });
    const session = acted.state.combat?.active;
    expect(session?.participants.find(item => item.id === 'guard')?.hp).toBe(10);
    expect(acted.state.玩家.生存状态.血量).toBe(95);
  });

  test('migrates legacy combat saves without resetting the active encounter', () => {
    const state = createDefaultGameState();
    const legacy = {
      ...state,
      combat: {
        active: {
          encounterId: 'legacy', encounterName: '旧遭遇', status: 'active', round: 2,
          activeActorId: '', actionPoints: 1, actionPointsPerTurn: 1,
          participants: [
            { id: 'player', name: '玩家', side: 'player', hp: 10, maxHp: 20, armor: 0, initiative: 0, statuses: [], cooldowns: {} },
            { id: 'enemy', name: '敌人', side: 'enemy', hp: 5, maxHp: 5, armor: 0, initiative: 4, statuses: [], cooldowns: {} },
          ], log: [],
        }, history: [],
      },
    } as typeof state;
    const migrated = prepareGameplayState(legacy, [], { mode: 'load' });
    expect(migrated.state.combat?.active?.turnOrder).toEqual(['enemy', 'player']);
    expect(migrated.state.combat?.active?.participants[0].cooldowns).toEqual({});
  });
});
