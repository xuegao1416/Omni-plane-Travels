import { describe, expect, test } from 'bun:test';
import { FANTASY_CORE_PROFESSION_PACK, WUXIA_CORE_PROFESSION_PACK } from '.';

function validatePack(pack: typeof FANTASY_CORE_PROFESSION_PACK) {
  const professionIds = pack.professions.map(item => item.id);
  expect(new Set(professionIds).size).toBe(professionIds.length);
  for (const profession of pack.professions) {
    const ids = new Set(profession.abilities.map(item => item.id));
    expect(ids.size).toBe(profession.abilities.length);
    for (const ability of profession.abilities) {
      expect(ability.prerequisites?.every(id => ids.has(id)) ?? true).toBe(true);
    }
    expect(profession.abilities.some(item => item.type === 'passive')).toBe(true);
    expect(profession.abilities.some(item => item.type === 'active')).toBe(true);
    expect(profession.abilities.some(item => item.type === 'ultimate')).toBe(true);
  }
}

function validateDivineTalents(pack: typeof FANTASY_CORE_PROFESSION_PACK, expectedNames: string[]) {
  const divineTalents = pack.innateTalents.filter(talent => talent.tags?.includes('神技'));
  expect(divineTalents.map(talent => talent.name)).toEqual(expectedNames);
  for (const talent of divineTalents) {
    expect(talent.cost).toBe(99999);
    expect(talent.rarity).toBe('传说');
    expect(talent.mechanics?.combat).toBeTruthy();
    expect(talent.mechanics?.checks?.length).toBeGreaterThan(0);
  }
}

describe('built-in profession packs', () => {
  test('ships the six classic fantasy professions with valid trees', () => {
    validatePack(FANTASY_CORE_PROFESSION_PACK);
    expect(FANTASY_CORE_PROFESSION_PACK.professions.map(item => item.id)).toEqual([
      'warrior', 'mage', 'ranger', 'rogue', 'cleric', 'paladin',
    ]);
    validateDivineTalents(FANTASY_CORE_PROFESSION_PACK, ['龙心觉醒', '命运纺锤', '世界低语']);
  });

  test('keeps wuxia weapon paths in professions and life arts in free skills', () => {
    validatePack(WUXIA_CORE_PROFESSION_PACK);
    const professionAbilityIds = new Set(WUXIA_CORE_PROFESSION_PACK.professions.flatMap(item => item.abilities.map(ability => ability.id)));
    expect(WUXIA_CORE_PROFESSION_PACK.freeSkillCatalog?.map(item => item.id)).toContain('medicine');
    expect(professionAbilityIds.has('medicine')).toBe(false);
    validateDivineTalents(WUXIA_CORE_PROFESSION_PACK, ['天人合一', '剑心通明·神会', '宿命轮回']);
  });
});
