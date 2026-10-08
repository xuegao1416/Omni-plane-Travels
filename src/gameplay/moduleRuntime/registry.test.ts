import { describe, expect, test } from 'bun:test';
import { ModuleRuntimeRegistry } from './registry';

describe('ModuleRuntimeRegistry', () => {
  test('unchanged module payloads share history across revisions, captures and reload without exposing mutable owners', () => {
    const registry = new ModuleRuntimeRegistry('shared');
    const payload = { text: '模块事实'.repeat(500), embedding: [1, 2, 3] };
    registry.initialize('stat', { hp: 100, payload });
    for (let turn = 1; turn <= 30; turn++) registry.update('stat', state => ({ ...state, hp: 100 - turn }));
    const history = registry.listCheckpointRecords();
    expect((history[30]!.state as any).payload).toBe((history[0]!.state as any).payload);
    const loaded = new ModuleRuntimeRegistry('shared');
    for (const record of JSON.parse(JSON.stringify(history))) loaded.importHistoryRecord(record);
    const restoredHistory = loaded.listCheckpointRecords();
    expect((restoredHistory[30]!.state as any).payload).toBe((restoredHistory[0]!.state as any).payload);
    loaded.restore({ stat: 7 });
    expect(loaded.read<any>('stat').hp).toBe(93);
    registry.update('stat', state => ({ ...state, payload: { ...state.payload, text: '改变' } }));
    expect((history[0]!.state as any).payload.text).toBe(payload.text);
    loaded.read<any>('stat').payload.embedding[0] = 99;
    expect((restoredHistory[0]!.state as any).payload.embedding).toEqual([1, 2, 3]);
  });

  test('tracks and drains only changed module partitions', () => {
    const registry = new ModuleRuntimeRegistry('save-a');
    registry.initialize('stat', { values: { hp: 100 } });
    registry.initialize('business', { funds: 500 });
    registry.drainDirtyRecords();

    registry.update('business', state => ({ ...state, funds: state.funds - 20 }));

    expect(registry.read<{ values: { hp: number } }>('stat')).toEqual({ values: { hp: 100 } });
    expect(registry.read<{ funds: number }>('business')).toEqual({ funds: 480 });
    expect(registry.drainDirtyRecords().map(record => record.moduleId)).toEqual(['business']);
    expect(registry.drainDirtyRecords()).toEqual([]);
  });

  test('restores independent revisions without copying unchanged partitions', () => {
    const registry = new ModuleRuntimeRegistry('save-a');
    registry.initialize('survival', { quantities: { water: 3 } });
    registry.initialize('profession', { skillPoints: 2 });
    const checkpoint = registry.checkpoint();

    registry.update('survival', state => ({ quantities: { ...state.quantities, water: 2 } }));
    registry.update('profession', state => ({ ...state, skillPoints: 1 }));
    registry.restore({ ...registry.checkpoint(), survival: checkpoint.survival });

    expect(registry.read<{ quantities: { water: number } }>('survival')?.quantities.water).toBe(3);
    expect(registry.read<{ skillPoints: number }>('profession')?.skillPoints).toBe(1);
  });

  test('reports serialized bytes per partition', () => {
    const registry = new ModuleRuntimeRegistry('save-a');
    registry.initialize('dice', { lastRoll: { total: 17 } });

    const metrics = registry.measure();
    expect(metrics.totalBytes).toBeGreaterThan(0);
    expect(metrics.partitions.dice).toBeGreaterThan(0);
  });

  test('keeps imported checkpoint history without replacing the current revision', () => {
    const registry = new ModuleRuntimeRegistry('save-a');
    registry.importHistoryRecord({
      saveId: 'save-a', moduleId: 'stat', revision: 0, schemaVersion: 1,
      updatedAt: 1, state: { hp: 10 },
    });
    registry.importRecord({
      saveId: 'save-a', moduleId: 'stat', revision: 1, schemaVersion: 1,
      updatedAt: 2, state: { hp: 8 },
    });

    expect(registry.read<{ hp: number }>('stat')).toEqual({ hp: 8 });
    registry.restore({ stat: 0 });
    expect(registry.read<{ hp: number }>('stat')).toEqual({ hp: 10 });
  });

  test('falls back to the nearest older revision when an imported checkpoint is missing', () => {
    const registry = new ModuleRuntimeRegistry('save-a');
    registry.importHistoryRecord({ saveId: 'save-a', moduleId: 'survival', revision: 1, schemaVersion: 1, updatedAt: 1, state: { water: 3 } });
    registry.importHistoryRecord({ saveId: 'save-a', moduleId: 'survival', revision: 3, schemaVersion: 1, updatedAt: 3, state: { water: 1 } });
    registry.importRecord({ saveId: 'save-a', moduleId: 'survival', revision: 3, schemaVersion: 1, updatedAt: 3, state: { water: 1 } });
    registry.restore({ survival: 2 });
    expect(registry.read<{ water: number }>('survival')?.water).toBe(3);
    expect(registry.checkpoint().survival).toBe(1);
  });
});
