import { expect, test } from 'bun:test';
import { SaveCoordinator } from './saveCoordinator';
import { createDefaultGameState } from '../schema/variables';
import type { GameSave } from './db';

const capture = (id: string, name = id): GameSave => ({ id, name, timestamp: 1, worldId: 'default', gameState: createDefaultGameState(), messages: [{ id: `${id}:0`, role: 'user', rawText: '原始行动', seq: 0, round: 1, timestamp: 1 }] });
test('save captures remain frozen and separate journeys cannot coalesce into one another', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const written: GameSave[] = [];
  const saves = new SaveCoordinator({ save: async value => { written.push(value); if (value.name === 'first') await gate; } });
  const original = capture('one', 'first');
  const first = saves.request(original);
  original.messages[0].rawText = '界面随后修改';
  const second = saves.request(capture('one', 'second'));
  const third = saves.request(capture('one', 'third'));
  await saves.request(capture('two'));
  expect(written.map(value => value.name)).toEqual(['first', 'two']);
  release(); await Promise.all([first, second, third]);
  expect(written.map(value => value.name)).toEqual(['first', 'two', 'third']);
  expect(written[0].messages[0].rawText).toBe('原始行动');
});
test('a manual save replaces an older delayed capture rather than letting it revert progress', async () => {
  const written: string[] = [];
  const saves = new SaveCoordinator({ save: async value => { written.push(value.name); } });
  const scheduled = saves.schedule(capture('one', 'old'), 5000);
  await saves.request(capture('one', 'current')); await scheduled;
  expect(written).toEqual(['current']);
});
test('failed progress can be recovered without allowing an old retry to replace newer progress', async () => {
  let fail = true; const written: GameSave[] = [];
  const saves = new SaveCoordinator({ save: async value => { if (fail) { fail = false; throw Error('quota'); } written.push(value); } });
  const original = capture('one');
  await expect(saves.request(original)).rejects.toThrow('quota');
  original.messages[0].rawText = '界面随后修改';
  expect(saves.getFailedCapture('one')?.messages[0].rawText).toBe('原始行动');
  const newer = saves.schedule(capture('one', 'newer'), 5000);
  await expect(saves.retryFailed('one')).rejects.toThrow('更新');
  await saves.flush(); await newer;
  expect(written.map(value => value.name)).toEqual(['newer']);
  expect(saves.getFailedCapture('one')).toBeUndefined();
});
