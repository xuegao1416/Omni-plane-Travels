import { describe, expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import type { ProfessionPack } from '../modules/schema';
import {
  createDefaultV3FeatureFlags,
  migrateGameStateToV3,
  migrateProfessionPack,
  normalizeAbilityProposal,
  normalizeCombatEncounterProposal,
  normalizeCombatSessionV2,
  synchronizeV3FeatureFlagsForWorld,
} from './protocols';

describe('v3 core protocols and additive migrations', () => {
  test('keeps AI ability proposals semantic and leaves mechanics to local balancing', () => {
    const proposal = normalizeAbilityProposal({
      id: 'new-skill', name: '星火', description: '一束短促的火光', category: 'dynamic',
      rarity: '稀有', target: 'enemy', damage: 999, cooldownRounds: 0,
    });

    expect(proposal).toMatchObject({ id: 'new-skill', category: 'dynamic', rarity: '稀有', target: 'enemy' });
    expect(proposal && 'damage' in proposal).toBe(false);
  });

  test('migrates a v1 profession pack without changing existing ability ids', () => {
    const legacy: ProfessionPack = {
      manifest: { id: 'legacy-pack', name: '旧包', version: '1.0.0', schemaVersion: 1 },
      professions: [{
        id: 'warrior', name: '战士', description: '旧职业', abilities: [{
          id: 'power-strike', name: '重击', description: '旧能力', type: 'active',
        }],
      }],
      innateTalents: [{ id: 'iron-will', name: '钢铁意志', description: '旧天赋', cost: 1 }],
      freeSkillCatalog: [], creationTalentBudget: 1,
    };

    const migrated = migrateProfessionPack(legacy);

    expect(migrated.manifest.schemaVersion).toBe(2);
    expect(migrated.professions[0]?.abilities[0]?.id).toBe('power-strike');
    expect(migrated.professions[0]?.abilities[0]?.category).toBe('profession');
    expect(migrated.innateTalents[0]?.id).toBe('iron-will');
  });

  test('accepts only semantic encounter proposals and drops AI mechanical numbers', () => {
    const proposal = normalizeCombatEncounterProposal({
      id: 'encounter-1', context: '桥头冲突', threatBand: 'dangerous',
      allies: [{ id: 'ally-1', identity: '同行者' }],
      enemies: [{ id: 'enemy-1', identity: '拦路者', maxHp: 999, damage: 999 }],
    });

    expect(proposal?.enemies).toHaveLength(1);
    expect(proposal?.enemies[0]).toEqual({ id: 'enemy-1', identity: '拦路者', temporary: false });
    expect(normalizeCombatEncounterProposal({
      id: 'too-many', context: '拥挤战场', threatBand: 'boss',
      enemies: [1, 2, 3, 4, 5].map((id) => ({ id: `e-${id}`, identity: '敌人' })),
    })).toMatchObject({ enemies: expect.any(Array) });
    expect(normalizeCombatEncounterProposal({
      id: 'too-many', context: '超过本地阵容上限但可分波', threatBand: 'boss',
      enemies: [1, 2, 3, 4, 5].map((id) => ({ id: `e-${id}`, identity: `敌人${id}` })),
    })?.enemies).toHaveLength(5);
  });

  test('gives a v2 combat session safe defaults and preserves inferno risk', () => {
    const session = normalizeCombatSessionV2({
      id: 'session-1', riskMode: 'inferno', seed: 42,
      participants: [{ id: 'player', side: 'player', identity: '玩家' }],
    });

    expect(session).toMatchObject({ schemaVersion: 2, riskMode: 'inferno', seed: 42, round: 1 });
    expect(session?.participants[0]).toMatchObject({ hp: 1, maxHp: 1, actedRound: 0, cooldowns: {}, items: [] });
    expect(session?.preCombatCheckpoint.sessionId).toBe('session-1');
  });

  test('migrates old saves additively with combat and profession features disabled by default', () => {
    const legacy = createDefaultGameState();
    legacy.玩家.技能系统['旧技能'] = { 品质: '普通', 描述: '保留', 类型: '旧技能' };

    const migrated = migrateGameStateToV3(legacy);

    expect(migrated.玩家.技能系统['旧技能']).toBeDefined();
    expect(migrated.narrativeDecisions).toEqual([]);
    expect(createDefaultV3FeatureFlags()).toEqual({ professionsEnabled: false, combatEnabled: false, combatRiskMode: 'normal' });
  });

  test('reactivates optional v3 systems from the loaded world instead of preserving stale migration flags', () => {
    const migrated = migrateGameStateToV3(createDefaultGameState());
    migrated.v3!.featureFlags = { professionsEnabled: false, combatEnabled: false, combatRiskMode: 'hard' };

    const synchronized = synchronizeV3FeatureFlagsForWorld(migrated, {
      professionsEnabled: true,
      combatEnabled: true,
      fallbackRiskMode: 'normal',
    });

    expect(synchronized.v3?.featureFlags).toEqual({ professionsEnabled: true, combatEnabled: true, combatRiskMode: 'hard' });
  });

  test('copies a legacy active combat into the additive v2 session slot', () => {
    const legacy = createDefaultGameState();
    legacy.combat = {
      active: {
        encounterId: 'legacy-encounter', encounterName: '旧遭遇', status: 'active', round: 2,
        activeActorId: 'player', actionPoints: 1, actionPointsPerTurn: 1,
        participants: [
          { id: 'player', name: '玩家', side: 'player', hp: 8, maxHp: 10, armor: 0, initiative: 1, statuses: [], cooldowns: {} },
          { id: 'enemy', name: '旧敌人', side: 'enemy', hp: 5, maxHp: 5, armor: 0, initiative: 0, statuses: [], cooldowns: {} },
        ],
        log: [],
      },
    };

    const migrated = migrateGameStateToV3(legacy);

    expect(migrated.combat?.active?.encounterId).toBe('legacy-encounter');
    expect(migrated.v3?.combatSession?.id).toBe('legacy-encounter');
    expect(migrated.v3?.combatSession?.participants).toHaveLength(2);
  });
});
