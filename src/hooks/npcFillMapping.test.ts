import { describe, expect, test } from 'bun:test';
import type { CustomNpc } from '../storage/db';
import type { StatModuleSchema } from '../modules/schema';
import { mergeNpcFillResult } from './npcFillMapping';

const baseNpc = {
  id: 'npc-1', name: '阿青', gender: '', age: '', race: '', relationshipType: '',
  occupation: '', socialStatus: '', personality: '', hiddenPersonality: '', currentThought: '',
  appearance: '', currentOutfit: '', currentAction: '', currentLocation: '', currentState: '',
  shortTermGoal: '', longTermGoal: '', background: '', chronicles: [], skillsList: {}, itemsList: {},
  survivalStats: {},
} satisfies CustomNpc;

const statConfig: StatModuleSchema = {
  attrA: { name: '气血', current: 80, max: 100 },
  attrB: { name: '真气', current: 50, max: 80 },
  dim1: { name: '力道', value: 10, range: [0, 20] },
  special: [],
};

describe('NPC AI fill mapping', () => {
  test('keeps generated stats and a valid tier zero while materializing missing values', () => {
    const merged = mergeNpcFillResult(baseNpc, {
      gender: '女',
      survivalStats: { 血量: 65, dim1: 14 },
      tierIndex: 0,
    }, statConfig, true);

    expect(merged.gender).toBe('女');
    expect(merged.survivalStats).toEqual({ 血量: 65, 体力值: 50, dim1: 14 });
    expect(merged.tierIndex).toBe(0);
  });
});
