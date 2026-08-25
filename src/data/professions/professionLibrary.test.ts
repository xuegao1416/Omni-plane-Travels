import { describe, expect, test } from 'bun:test';
import type { GameState } from '../../schema/variables';
import {
  BUILTIN_PROFESSION_PACKS,
  exportProfessionPack,
  importProfessionPack,
  resolveProfessionBinding,
  professionAbilityToCombatAction,
  normalizeProfessionPack,
} from './professionLibrary';
import { fallbackProfessionEmblem } from './professionVisuals';

describe('independent profession package boundary', () => {
  test('keeps built-in profession ids on their matching emblem keys', () => {
    expect(fallbackProfessionEmblem('warrior')).toBe('warrior');
    expect(fallbackProfessionEmblem('qimen')).toBe('qimen');
  });

  test('ships a reusable six-profession pack with four-tier trees', () => {
    const pack = BUILTIN_PROFESSION_PACKS.find(item => item.manifest.id === 'fantasy-core');
    expect(pack?.professions).toHaveLength(6);
    for (const profession of pack?.professions ?? []) {
      expect(profession.abilities.length).toBeGreaterThanOrEqual(8);
      expect(new Set(profession.abilities.map(item => item.tier ?? 1))).toEqual(new Set([1, 2, 3, 4]));
      expect(profession.abilities.filter(item => item.type === 'ultimate')).toHaveLength(1);
      const ids = new Set(profession.abilities.map(item => item.id));
      expect(profession.abilities.every(item => (item.prerequisites ?? []).every(id => ids.has(id)))).toBe(true);
      expect(profession.abilities.filter(item => item.type === 'active' || item.type === 'ultimate').every(item => (
        Boolean(item.activation?.combatAction?.scaling?.length)
      ))).toBe(true);
      expect(profession.abilities.filter(item => item.type === 'passive' || item.type === 'specialization').every(item => (
        Boolean(item.mechanics?.combat || item.mechanics?.checks?.length)
      ))).toBe(true);
    }
    expect(pack?.innateTalents.every(item => Boolean(item.mechanics?.combat || item.mechanics?.checks?.length))).toBe(true);
  });

  test('world bindings resolve package references without embedding the package', () => {
    const binding = { packIds: ['fantasy-core'], enabledProfessionIds: ['warrior'] };
    expect(JSON.stringify(binding)).not.toContain('abilities');
    const resolved = resolveProfessionBinding(binding);
    expect(resolved.professions.map(item => item.id)).toEqual(['warrior']);
  });

  test('exports and imports a standalone package envelope', () => {
    const source = BUILTIN_PROFESSION_PACKS[0];
    const imported = importProfessionPack(exportProfessionPack(source));
    expect(imported.manifest.name).toBe(source.manifest.name);
    expect(imported.professions.length).toBe(source.professions.length);
    expect(imported.manifest.builtin).toBe(false);
  });

  test('keeps local visual keys and drops invalid visual injection fields', () => {
    const source = BUILTIN_PROFESSION_PACKS[0];
    const normalized = normalizeProfessionPack({
      ...structuredClone(source),
      professions: [{
        ...structuredClone(source.professions[0]),
        visual: { emblemKey: 'https://invalid.example/emblem.png', accentKey: 'crimson' },
        abilities: [{ ...structuredClone(source.professions[0].abilities[0]), iconKey: '/tmp/injected.png' }],
      }],
    });
    expect(normalized.professions[0].visual?.emblemKey).toBeUndefined();
    expect(normalized.professions[0].visual?.accentKey).toBe('crimson');
    expect(normalized.professions[0].abilities[0].iconKey).toBeUndefined();
  });

  test('maps unlocked active abilities into executable combat actions', () => {
    const config = resolveProfessionBinding({ packIds: ['fantasy-core'], enabledProfessionIds: ['warrior'] });
    const ability = config.professions[0].abilities.find(item => item.type === 'active' && item.activation?.combatAction);
    expect(ability).toBeDefined();
    const action = professionAbilityToCombatAction(ability!, {
      玩家: { 能力系统: { 职业状态: { 已解锁能力: { [ability!.id]: { 名称: ability!.name, 等级: 1 } } } } },
    } as unknown as GameState);
    expect(action?.id).toBe(`profession:${ability!.id}`);
    expect((action?.damage ?? 0) + (action?.healing ?? 0)).toBeGreaterThan(0);
  });
});
