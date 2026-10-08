import { expect, spyOn, test } from 'bun:test';
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

test('save notifications contain only status metadata rather than another full history capture', async () => {
  const saves = new SaveCoordinator({ save: async () => {} });
  let notification: unknown;
  saves.subscribe(outcome => { notification = outcome; });
  await saves.request(capture('one'));
  expect(notification).toEqual({ status: 'saved', saveId: 'one', revision: 1 });
});

test('deferred autosaves coalesce before building or cloning the latest complete capture', async () => {
  const written: GameSave[] = [];
  const saves = new SaveCoordinator({ save: async value => { written.push(value); } });
  const latest = capture('one');
  let builds = 0;
  const clone = spyOn(globalThis, 'structuredClone');
  const scheduled: Promise<void>[] = [];
  try {
    for (let index = 0; index < 23; index++) {
      scheduled.push(saves.scheduleCapture('one', () => { builds++; return latest; }, 5000));
    }
    expect(builds).toBe(0);
    expect(clone).not.toHaveBeenCalled();
    latest.messages[0].rawText = '最终结算的完整进度';
    await saves.flush();
    await Promise.all(scheduled);
    expect(builds).toBe(1);
    expect(clone).toHaveBeenCalledTimes(1);
    expect(written).toHaveLength(1);
    latest.messages[0].rawText = '保存后再修改';
    expect(written[0].messages[0].rawText).toBe('最终结算的完整进度');
  } finally { saves.cancelScheduled(); clone.mockRestore(); }
});

test('manual saves supersede delayed builders without building stale progress', async () => {
  const written: string[] = [];
  const saves = new SaveCoordinator({ save: async value => { written.push(value.name); } });
  let builds = 0;
  const scheduled = saves.scheduleCapture('one', () => { builds++; return capture('one', 'old'); }, 5000);
  await saves.request(capture('one', 'current'));
  await scheduled;
  expect(builds).toBe(0);
  expect(written).toEqual(['current']);
});

test('the debounce timer invokes only the latest builder for each independent journey', async () => {
  const written: string[] = [];
  const saves = new SaveCoordinator({ save: async value => { written.push(value.name); } });
  let replacedBuilds = 0, latestBuilds = 0;
  const first = saves.scheduleCapture('one', () => { replacedBuilds++; return capture('one', 'old'); }, 10);
  const latest = saves.scheduleCapture('one', () => { latestBuilds++; return capture('one', 'latest'); }, 10);
  const other = saves.scheduleCapture('two', () => capture('two'), 10);
  await Promise.all([first, latest, other]);
  expect(replacedBuilds).toBe(0);
  expect(latestBuilds).toBe(1);
  expect(written).toEqual(['latest', 'two']);
});

test('deferred builders cannot persist another journey under their scheduled identity', async () => {
  const written: GameSave[] = [];
  const saves = new SaveCoordinator({ save: async value => { written.push(value); } });
  const scheduled = saves.scheduleCapture('one', () => capture('two'), 5000);
  const rejected = scheduled.catch(error => error);
  await expect(saves.flush()).rejects.toThrow('身份');
  expect((await rejected).message).toContain('身份');
  expect(written).toEqual([]);
});

test('a failed deferred save retains the isolated full capture for retry and export', async () => {
  let fail = true;
  const written: GameSave[] = [];
  const saves = new SaveCoordinator({ save: async value => { if (fail) { fail = false; throw Error('quota'); } written.push(value); } });
  const latest = capture('one');
  const scheduled = saves.scheduleCapture('one', () => latest, 5000);
  const rejected = scheduled.catch(error => error);
  await expect(saves.flush()).rejects.toThrow('quota');
  expect((await rejected).message).toBe('quota');
  latest.messages[0].rawText = '失败后修改';
  expect(saves.getFailedCapture('one')?.messages[0].rawText).toBe('原始行动');
  await saves.retryFailed('one');
  expect(written[0].messages[0].rawText).toBe('原始行动');
});
