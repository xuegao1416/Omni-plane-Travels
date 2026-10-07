import { expect, test } from 'bun:test';
import { LeaveJourney, LoadJourney } from './journeyNavigation';

const deferred = () => { let resolve!: () => void; const promise = new Promise<void>(r => resolve = r); return { promise, resolve }; };
test('failed complete save keeps the journey open and can retry', async () => {
  let fail = true, exits = 0;
  const task = new LeaveJourney({ busy: () => false, version: () => '1', confirmStop: async () => true, stop: () => {}, flush: async () => { if (fail) throw Error('quota'); }, navigate: () => exits++ });
  await expect(task.run('start')).rejects.toThrow('quota'); expect(exits).toBe(0);
  fail = false; await task.run('start'); expect(exits).toBe(1);
});
test('double navigation shares one save and retains the first destination', async () => {
  const gate = deferred(); let writes = 0; const exits: string[] = [];
  const task = new LeaveJourney({ busy: () => false, version: () => '1', confirmStop: async () => true, stop: () => {}, flush: async () => { writes++; await gate.promise; }, navigate: target => exits.push(target) });
  const first = task.run('start'), second = task.run('settings'); gate.resolve(); await Promise.all([first, second]);
  expect(writes).toBe(1); expect(exits).toEqual(['start']);
});
test('state change or new generation during persistence cannot switch pages', async () => {
  const gate = deferred(); let version = '1', exits = 0;
  const task = new LeaveJourney({ busy: () => false, version: () => version, confirmStop: async () => true, stop: () => {}, flush: async () => gate.promise, navigate: () => exits++ });
  const run = task.run('start'); version = '2'; gate.resolve(); await expect(run).rejects.toThrow('变化'); expect(exits).toBe(0);
});
test('stopping generation requires player consent before partial text is saved', async () => {
  let stops = 0, saves = 0;
  const task = new LeaveJourney({ busy: () => true, version: () => '1', confirmStop: async () => false, stop: () => { stops++; }, flush: async () => { saves++; }, navigate: () => {} });
  expect(await task.run('start')).toBe('cancelled'); expect(stops).toBe(0); expect(saves).toBe(0);
});
test('confirmed stop preserves partial text before complete persistence', async () => {
  let generating = true, text = '已生成一半', saved = '', exits = 0;
  const task = new LeaveJourney({ busy: () => generating, version: () => text, confirmStop: async () => true, stop: () => { generating = false; }, flush: async () => { saved = text; }, navigate: () => exits++ });
  await task.run('start'); expect(saved).toBe('已生成一半'); expect(exits).toBe(1);
});

test('settings keep the journey running without confirmation, capture or persistence', async () => {
  const unexpected = () => { throw Error('settings must not leave the journey'); };
  const targets: string[] = [];
  const task = new LeaveJourney({ busy: () => true, blocked: () => true, version: unexpected,
    confirmStop: async () => unexpected(), stop: unexpected, flush: async () => unexpected(), navigate: target => targets.push(target) });
  expect(await task.run('settings')).toBe('left');
  expect(targets).toEqual(['settings']);
});

test('an asynchronous stop must finish before saving and may not cross into another journey', async () => {
  const gate = deferred(); let identity = 'one', writes = 0, exits = 0;
  const task = new LeaveJourney({ busy: () => true, identity: () => identity, version: () => '1', confirmStop: async () => true, stop: () => gate.promise, flush: async () => { writes++; }, navigate: () => exits++ });
  const run = task.run('start'); await Promise.resolve(); identity = 'two'; gate.resolve();
  await expect(run).rejects.toThrow('变更'); expect(writes).toBe(0); expect(exits).toBe(0);
});
test('a new generation during flush prevents navigation even without a new commit yet', async () => {
  const gate = deferred(); let generating = false, exits = 0;
  const task = new LeaveJourney({ busy: () => generating, version: () => '1', confirmStop: async () => true, stop: () => {}, flush: async () => gate.promise, navigate: () => exits++ });
  const run = task.run('start'); generating = true; gate.resolve(); await expect(run).rejects.toThrow('变化'); expect(exits).toBe(0);
});
test('an unfinished command blocks leaving without silently cancelling it', async () => {
  let stops = 0, writes = 0;
  const task = new LeaveJourney({ busy: () => false, blocked: () => true, version: () => '1', confirmStop: async () => true, stop: () => { stops++; }, flush: async () => { writes++; }, navigate: () => {} });
  await expect(task.run('start')).rejects.toThrow('行动'); expect(stops).toBe(0); expect(writes).toBe(0);
});
test('closing the leave owner while saving cannot navigate on late success', async () => {
  const gate = deferred(); let exits = 0;
  const task = new LeaveJourney({ busy: () => false, version: () => '1', confirmStop: async () => true, stop: () => {}, flush: async () => gate.promise, navigate: () => exits++ });
  const run = task.run('start'); task.cancel(); gate.resolve(); await expect(run).rejects.toThrow('停止'); expect(exits).toBe(0);
});
test('missing or rejected restore never activates metadata or navigation', async () => {
  const activated: string[] = [];
  const task = new LoadJourney<{ id: string }>({ read: async id => id === 'missing' ? null : { id }, restore: () => { throw Error('invalid checkpoint'); }, activate: save => activated.push(save.id) });
  await expect(task.run('missing')).rejects.toThrow('不存在');
  await expect(task.run('broken')).rejects.toThrow('invalid checkpoint'); expect(activated).toEqual([]);
});
test('a second load cannot overtake an outstanding read', async () => {
  const gate = deferred(), activated: string[] = [];
  const task = new LoadJourney<{ id: string }>({ read: async id => { await gate.promise; return { id }; }, restore: () => {}, activate: save => activated.push(save.id) });
  const first = task.run('one'); await expect(task.run('two')).rejects.toThrow('读取'); gate.resolve(); await first;
  expect(activated).toEqual(['one']);
});
test('a closed load owner cannot activate a late read', async () => {
  const gate = deferred(); let restores = 0;
  const task = new LoadJourney<{ id: string }>({ read: async id => { await gate.promise; return { id }; }, restore: () => { restores++; }, activate: () => {} });
  const run = task.run('one'); task.cancel(); gate.resolve(); await expect(run).rejects.toThrow('停止'); expect(restores).toBe(0);
});
