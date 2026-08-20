import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import type { ModuleStateRecord } from '../gameplay/moduleRuntime/types';
import {
  deleteModuleRuntimeForSave,
  getModuleCheckpoint,
  getModuleCheckpoints,
  getModuleStates,
  putModuleCheckpoints,
  putModuleStates,
  pruneModuleCheckpoints,
} from './moduleStateDb';

const record = <T>(saveId: string, moduleId: ModuleStateRecord['moduleId'], revision: number, state: T): ModuleStateRecord<T> => ({
  saveId,
  moduleId,
  revision,
  schemaVersion: 1,
  updatedAt: revision,
  state,
});

describe('moduleStateDb', () => {
  test('persists current module partitions independently', async () => {
    const saveId = `module-state-${Date.now()}-a`;
    await putModuleStates([
      record(saveId, 'stat', 1, { hp: 100 }),
      record(saveId, 'business', 1, { funds: 500 }),
    ]);
    await putModuleStates([record(saveId, 'business', 2, { funds: 480 })]);

    const records = await getModuleStates(saveId);
    expect(records.map(item => [item.moduleId, item.revision])).toEqual([
      ['business', 2],
      ['stat', 1],
    ]);
  });

  test('deduplicates revision checkpoints and removes all module data with the save', async () => {
    const saveId = `module-state-${Date.now()}-b`;
    const checkpoint = record(saveId, 'survival', 3, { water: 2 });
    await putModuleCheckpoints([checkpoint, checkpoint]);

    expect((await getModuleCheckpoint(saveId, 'survival', 3))?.state).toEqual({ water: 2 });
    expect((await getModuleCheckpoints(saveId)).map(item => item.revision)).toEqual([3]);
    await deleteModuleRuntimeForSave(saveId);
    expect(await getModuleStates(saveId)).toEqual([]);
    expect(await getModuleCheckpoint(saveId, 'survival', 3)).toBeUndefined();
  });

  test('prunes checkpoints that are no longer referenced by snapshots', async () => {
    const saveId = `module-state-${Date.now()}-c`;
    await putModuleCheckpoints([
      record(saveId, 'profession', 1, { points: 2 }),
      record(saveId, 'profession', 2, { points: 1 }),
    ]);
    await pruneModuleCheckpoints(saveId, new Set(['profession#2']));
    expect((await getModuleCheckpoints(saveId)).map(item => item.revision)).toEqual([2]);
  });
});
