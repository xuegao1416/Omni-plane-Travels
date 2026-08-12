import { describe, expect, test } from 'bun:test';
import { isNpcDraftDirty } from './npcModalState';
import type { CustomNpc } from '../../storage/db';

const npc = (overrides: Partial<CustomNpc> = {}): CustomNpc => ({
  id: 'npc-1', name: '', gender: '', age: '', race: '', relationshipType: '',
  occupation: '', socialStatus: '', personality: '', hiddenPersonality: '', currentThought: '',
  appearance: '', currentOutfit: '', currentAction: '', currentLocation: '', currentState: '',
  shortTermGoal: '', longTermGoal: '', background: '', chronicles: [], skillsList: {}, itemsList: {},
  ...overrides,
});

describe('NPC draft close guard', () => {
  test('does not mark a blank new NPC as dirty', () => {
    expect(isNpcDraftDirty(npc(), null)).toBe(false);
  });

  test('marks a new NPC dirty after an editable field changes', () => {
    expect(isNpcDraftDirty(npc({ name: 'Luna' }), null)).toBe(true);
  });

  test('compares edits against the original NPC without using its id', () => {
    const original = npc({ name: 'Luna' });
    expect(isNpcDraftDirty({ ...original, id: 'new-id' }, original)).toBe(false);
    expect(isNpcDraftDirty({ ...original, id: 'new-id', background: 'A changed past' }, original)).toBe(true);
  });
});
