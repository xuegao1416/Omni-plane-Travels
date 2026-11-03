import { expect, test } from 'bun:test';
import { enforcePlayerIdentity, resolveDirectorInitialIdentity } from './initialIdentity';
import { createDefaultGameState, type NPCData } from '../schema/variables';
import type { DirectorDefinition } from './definitionTypes';

const definition = { id: 'd', version: 'v', characters: [{ id: 'a', name: '沈砚', aliases: ['小沈'] }, { id: 'b', name: '师父', aliases: [] }], stages: [{ id: 's' }] } as DirectorDefinition;
test('canonical player role cannot reappear as an NPC after variable normalization', () => {
  const state = createDefaultGameState();
  state.playerIdentity = { actorId: 'a', name: '沈砚', aliases: ['小沈'] };
  state.人物档案.a = { 姓名: '沈砚' } as NPCData;
  state.人物档案.duplicate = { 姓名: '小沈' } as NPCData;
  state.人物档案.teacher = { 姓名: '师父' } as NPCData;
  enforcePlayerIdentity(state);
  expect(state.玩家.姓名).toBe('沈砚');
  expect(Object.keys(state.人物档案)).toEqual(['teacher']);
});
test('original role maps once to player and excludes id/name/alias duplicate NPCs', () => {
  const result = resolveDirectorInitialIdentity(definition, { definitionId: 'd', version: 'v', mode: 'original', actorId: 'a', startStageId: 's' }, { n1: { 姓名: '沈砚' }, n2: { 姓名: '小沈' }, n3: { 姓名: '师父' } });
  expect(result.roleBinding).toEqual({ a: 'player', b: 'n3' });
  expect(result.excludedNpcIds).toEqual(['n1', 'n2']);
  expect(result.playerName).toBe('沈砚');
});
test('custom role does not inherit protagonist and stale choices reject', () => {
  expect(resolveDirectorInitialIdentity(definition, undefined, { n: { 姓名: '沈砚' } }).roleBinding).toEqual({ a: 'n' });
  expect(() => resolveDirectorInitialIdentity(definition, { definitionId: 'other', version: 'v', mode: 'original', actorId: 'a', startStageId: 's' }, {})).toThrow();
  expect(() => resolveDirectorInitialIdentity(definition, { definitionId: 'd', version: 'v', mode: 'original', actorId: 'missing', startStageId: 's' }, {})).toThrow();
});
