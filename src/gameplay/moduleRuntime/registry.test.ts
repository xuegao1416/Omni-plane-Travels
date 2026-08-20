import { describe, expect, test } from 'bun:test';
import { ModuleRuntimeRegistry } from './registry';

describe('ModuleRuntimeRegistry', () => {
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
