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

describe('built-in profession packs', () => {
  test('ships the six classic fantasy professions with valid trees', () => {
    validatePack(FANTASY_CORE_PROFESSION_PACK);
    expect(FANTASY_CORE_PROFESSION_PACK.professions.map(item => item.id)).toEqual([
      'warrior', 'mage', 'ranger', 'rogue', 'cleric', 'paladin',
    ]);
  });

  test('keeps wuxia weapon paths in professions and life arts in free skills', () => {
    validatePack(WUXIA_CORE_PROFESSION_PACK);
    const professionAbilityIds = new Set(WUXIA_CORE_PROFESSION_PACK.professions.flatMap(item => item.abilities.map(ability => ability.id)));
    expect(WUXIA_CORE_PROFESSION_PACK.freeSkillCatalog?.map(item => item.id)).toContain('medicine');
    expect(professionAbilityIds.has('medicine')).toBe(false);
  });
});
