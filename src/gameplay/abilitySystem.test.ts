import { describe, expect, test } from 'bun:test';
import type { GameplayEffect } from './types';
import type { ProfessionAbilityDef } from '../modules/schema';
import { createDefaultGameState } from '../schema/variables';
import {
  abilityDefinitionFromInnateTalent,
  abilityDefinitionFromProfessionAbility,
  abilityDefinitionFromSkill,
  balanceAbilityProposal,
  confirmAbilityProposal,
  createAbilityInstance,
  createAbilityLibraryRuntime,
  isMechanicalAbilityDefinition,
  resolveAbilityProposalOnGameState,
  stageAbilityProposal,
  stageAbilityProposalOnGameState,
} from './abilitySystem';
import { migrateGameStateToV3, normalizeAbilityProposal, migrateProfessionPack } from './protocols';
import { isProfessionModuleEnabled } from './profession/featureGate';
import { BUILTIN_PROFESSION_PACKS, BUILTIN_PROFESSION_PACKS_V2, validateProfessionPack } from '../data/professions/professionLibrary';

const effect: GameplayEffect = { add: { path: '玩家.生存状态.血量', delta: 2, min: 0 } };

describe('unified ability system', () => {
  test('adapts legacy profession, innate and free skill definitions to one mechanical protocol', () => {
    const legacy: ProfessionAbilityDef = {
      id: 'legacy-strike',
      name: '旧式打击',
      description: '保留旧字段的可执行能力。',
      type: 'active',
      pointCost: 2,
      cooldownTicks: 3,
      diceModifier: 2,
      prerequisites: ['root'],
      prerequisiteMode: 'any',
      exclusiveGroup: 'path',
      activation: {
        costs: [{ path: '玩家.能力系统.职业状态.能力点', amount: 1, label: '能力点' }],
        effects: [effect],
        rewards: [{ id: 'legacy-reward', effects: [effect] }],
        combatAction: { id: 'legacy-strike', name: '旧式打击', target: 'enemy', actionCost: 1, accuracy: 10, damage: 7 },
      },
      passiveEffects: [effect],
    };
    const profession = abilityDefinitionFromProfessionAbility(legacy, 'warrior');
    const innate = abilityDefinitionFromInnateTalent({ id: 'born', name: '天生', description: '出生机制', cost: 1, effects: [effect] });
    const skill = abilityDefinitionFromSkill({ id: 'skill', name: '自由技', description: '熟练机制', rarity: '普通', cooldownTicks: 2, activation: { effects: [effect] }, proficiency: { gainPerUse: 2, thresholdPerRank: 5, maxRank: 3 } });

    expect(profession.category).toBe('profession');
    expect(profession.mechanics?.combatAction?.damage).toBe(7);
    expect(profession.prerequisiteMode).toBe('any');
    expect(profession.mechanics?.costs).toEqual(legacy.activation?.costs);
    expect(profession.mechanics?.effects).toEqual(legacy.activation?.effects);
    expect(profession.mechanics?.rewards).toEqual(legacy.activation?.rewards);
    expect(profession.mechanics?.passiveEffects).toEqual(legacy.passiveEffects);
    expect(profession.mechanics?.cooldownRounds).toBe(3);
    expect(innate.category).toBe('innate_talent');
    expect(skill.category).toBe('free_skill');
    expect(skill.mechanics?.proficiency?.gainPerUse).toBe(2);
    expect(isMechanicalAbilityDefinition(profession)).toBe(true);
    expect(createAbilityInstance(profession, 'profession', 12).runtime.cooldownRemaining).toBe(0);
  });

  test('assigns every combat-ready profession action a non-zero controlled runtime cost unless a cost is explicitly configured', () => {
    const active = abilityDefinitionFromProfessionAbility({
      id: 'costed-active', name: '战技', description: '普通主动能力', type: 'active', tier: 2,
      activation: { combatAction: { id: 'costed-active', name: '战技', target: 'enemy', actionCost: 1, accuracy: 10, damage: 4 } },
    });
    const ultimate = abilityDefinitionFromProfessionAbility({
      id: 'costed-ultimate', name: '终极战技', description: '终极能力', type: 'ultimate', tier: 4,
      activation: { combatAction: { id: 'costed-ultimate', name: '终极战技', target: 'enemy', actionCost: 1, accuracy: 12, damage: 12 } },
    });
    const explicit = abilityDefinitionFromProfessionAbility({
      id: 'blood-art', name: '血术', description: '以生命施放', type: 'active', tier: 3,
      activation: {
        costs: [{ path: 'health', amount: 5, label: '生命' }],
        combatAction: { id: 'blood-art', name: '血术', target: 'enemy', actionCost: 1, accuracy: 11, damage: 7 },
      },
    });

    expect(active.mechanics?.costs).toEqual([{ path: 'resource', amount: 2, label: '能量' }]);
    expect(ultimate.mechanics?.costs?.[0].amount).toBeGreaterThan(active.mechanics?.costs?.[0].amount ?? 0);
    expect(explicit.mechanics?.costs).toEqual([{ path: 'health', amount: 5, label: '生命' }]);
  });

  test('migrates v1 mechanics without loss and is idempotent', () => {
    const source = {
      schemaVersion: 1,
      manifest: { id: 'legacy-pack', name: '旧包', version: '1.0.0', schemaVersion: 1 },
      professions: [{
        id: 'legacy-class', name: '旧职业', description: '旧职业', abilities: [{
          id: 'legacy-node', name: '旧节点', description: '旧节点', type: 'active', tier: 2,
          prerequisites: ['legacy-root'], exclusiveGroup: 'legacy-path', pointCost: 2,
          cooldownTicks: 4, diceModifier: 3, passiveEffects: [effect],
          customLegacyField: { keep: true },
          activation: {
            costs: [{ path: '玩家.能力系统.职业状态.能力点', amount: 2, label: '能力点' }],
            effects: [effect], rewards: [{ id: 'legacy-reward', effects: [effect] }],
            combatAction: { id: 'legacy-node', name: '旧节点', target: 'enemy', actionCost: 1, accuracy: 11, damage: 9 },
          },
        }],
      }],
      innateTalents: [],
      freeSkillCatalog: [],
    };
    const migrated = migrateProfessionPack(source);
    const node = migrated.professions[0].abilities[0];
    expect(migrated.schemaVersion).toBe(2);
    expect(node.mechanics?.combatAction?.damage).toBe(9);
    expect(node.mechanics?.costs?.[0].amount).toBe(2);
    expect(node.mechanics?.effects).toEqual([effect]);
    expect(node.mechanics?.rewards?.[0].effects).toEqual([effect]);
    expect(node.mechanics?.passiveEffects).toEqual([effect]);
    expect(node.mechanics?.cooldownRounds).toBe(4);
    expect(node.legacy?.activation).toBeDefined();
    expect(node.legacy?.customLegacyField).toEqual({ keep: true });
    expect(migrateProfessionPack(migrated)).toEqual(migrated);
  });

  test('keeps unified definitions, instances, and pending proposals in old saves', () => {
    const proposal = normalizeAbilityProposal({ id: 'saved-ability', name: '存档能力', description: '保留', category: 'dynamic', rarity: '普通', target: 'self', tags: [] })!;
    const definition = balanceAbilityProposal(proposal);
    const instance = createAbilityInstance(definition, 'dynamic', 10);
    const state = createDefaultGameState();
    state.v3 = {
      schemaVersion: 3,
      featureFlags: { professionsEnabled: true, combatEnabled: false, combatRiskMode: 'normal' },
      abilityDefinitions: { [definition.id]: definition },
      abilityInstances: { [definition.id]: instance },
      pendingAbilityProposals: { [proposal.id]: proposal },
    };
    const migrated = migrateGameStateToV3(state);
    expect(migrated.v3?.abilityDefinitions).toEqual({ [definition.id]: definition });
    expect(migrated.v3?.abilityInstances).toEqual({ [definition.id]: instance });
    expect(migrated.v3?.pendingAbilityProposals).toEqual({ [proposal.id]: proposal });
  });

  test('ignores AI mechanics, balances deterministically, and requires confirmation before catalog insertion', () => {
    const proposal = normalizeAbilityProposal({
      schemaVersion: 2, id: 'dynamic-fire', name: '动态火花', description: '语义提案',
      category: 'dynamic', rarity: '史诗', target: 'enemy', tags: ['火焰'],
      damage: 999999, hp: 999999, cooldownRounds: 0,
    });
    expect(proposal).toBeDefined();
    expect(proposal).not.toHaveProperty('damage');
    const first = balanceAbilityProposal(proposal!);
    const second = balanceAbilityProposal(proposal!);
    expect(first).toEqual(second);
    expect(first.mechanics?.combatAction?.damage).toBeLessThan(999999);
    expect(first.mechanics?.combatAction?.cooldownRounds).toBeGreaterThan(0);
    expect(first.mechanics?.costs?.[0]).toMatchObject({ path: 'resource' });
    expect(first.mechanics?.combatAction?.appliesStatus?.name).toBe('灼烧');

    const pending = stageAbilityProposal(createAbilityLibraryRuntime(), proposal!);
    expect(pending.state.definitions).toEqual({});
    expect(pending.state.pending['dynamic-fire']).toBeDefined();
    const confirmed = confirmAbilityProposal(pending.state, 'dynamic-fire');
    expect(confirmed.state.definitions['dynamic-fire']).toEqual(first);
    expect(confirmed.state.pending).toEqual({});
  });

  test('stages semantic story abilities and only writes a locally balanced owned skill after confirmation', () => {
    const state = migrateGameStateToV3(createDefaultGameState());
    const staged = stageAbilityProposalOnGameState(state, {
      id: 'story-flame', name: '余烬术', description: '在剧情中完成训练后掌握。', category: 'dynamic', rarity: '稀有', target: 'enemy', tags: ['火焰'],
      damage: 999999, cooldownRounds: 0,
    });
    expect(staged.staged).toBe(true);
    expect(staged.state.v3?.abilityDefinitions).toBeUndefined();
    const accepted = resolveAbilityProposalOnGameState(staged.state, 'story-flame', 'accept', 12);
    expect(accepted.definition?.mechanics?.combatAction?.damage).toBeLessThan(999999);
    expect(accepted.state.v3?.pendingAbilityProposals).toBeUndefined();
    expect(accepted.state.v3?.abilityInstances?.['story-flame'].acquiredAt).toBe(12);
    expect(accepted.state.玩家.技能系统['story-flame'].描述).toContain('训练');
    expect(accepted.state.玩家.能力系统?.已掌握技能['story-flame'].等级).toBe(1);
  });

  test('gates profession UI and context on both enabled module and v3 flag', () => {
    const enabled = { modules: [{ moduleId: 'profession', name: '职业', enabled: true, moduleConfig: { professionsEnabled: true } }] };
    const disabled = { modules: [{ moduleId: 'profession', name: '职业', enabled: false, moduleConfig: { professionsEnabled: true } }] };
    expect(isProfessionModuleEnabled(enabled)).toBe(true);
    expect(isProfessionModuleEnabled(enabled, { professionsEnabled: false })).toBe(false);
    expect(isProfessionModuleEnabled(disabled)).toBe(false);
    expect(isProfessionModuleEnabled({ modules: [{ moduleId: 'profession', name: '职业', enabled: true, moduleConfig: {} }] })).toBe(false);
  });

  test('strictly rejects duplicate ids, bad prerequisites, cycles, tier inversion, and empty mechanics', () => {
    const source = structuredClone(BUILTIN_PROFESSION_PACKS[0]);
    const profession = source.professions[0];
    profession.abilities[1].prerequisites = ['missing-node'];
    profession.abilities[2].prerequisites = [profession.abilities[2].id];
    profession.abilities[3].tier = 1;
    profession.abilities[3].mechanics = undefined;
    profession.abilities[3].id = profession.abilities[0].id;
    const result = validateProfessionPack(source);
    expect(result.ok).toBe(false);
    expect(result.errors.map(error => error.code)).toEqual(expect.arrayContaining([
      'duplicate-id', 'missing-prerequisite', 'cycle', 'tier-inversion', 'missing-mechanics',
    ]));
  });

  test('ships both approved packs with all twelve professions, four tiers, two branches, one ultimate, and 12+12 shared abilities', () => {
    expect(BUILTIN_PROFESSION_PACKS.map(pack => pack.professions.map(profession => profession.id))).toEqual([
      ['warrior', 'mage', 'ranger', 'rogue', 'cleric', 'paladin'],
      ['swordsman', 'bladesman', 'spearmaster', 'unarmed', 'healer', 'qimen'],
    ]);
    for (const pack of BUILTIN_PROFESSION_PACKS) {
      expect(pack.manifest.schemaVersion).toBe(2);
      expect(pack.innateTalents.length).toBeGreaterThanOrEqual(12);
      expect(pack.freeSkillCatalog?.length ?? 0).toBeGreaterThanOrEqual(12);
      for (const profession of pack.professions) {
        expect(new Set(profession.abilities.map(ability => ability.tier ?? 1))).toEqual(new Set([1, 2, 3, 4]));
        expect(profession.abilities.length).toBeGreaterThanOrEqual(8);
        expect(profession.abilities.filter(ability => ability.type === 'ultimate')).toHaveLength(1);
        const branchCounts = new Map<string, number>();
        for (const ability of profession.abilities) if (ability.exclusiveGroup) branchCounts.set(ability.exclusiveGroup, (branchCounts.get(ability.exclusiveGroup) ?? 0) + 1);
        expect([...branchCounts.values()].some(count => count >= 2)).toBe(true);
        expect(profession.abilities.every(ability => isMechanicalAbilityDefinition(abilityDefinitionFromProfessionAbility(ability, profession.id)))).toBe(true);
      }
      expect(pack.professions.some(profession => profession.abilities.some(ability => ability.prerequisiteMode === 'any'))).toBe(true);
    }
    expect(BUILTIN_PROFESSION_PACKS_V2.every(pack => validateProfessionPack(pack).ok)).toBe(true);
  });
});
