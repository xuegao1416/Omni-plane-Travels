import { test, expect } from 'bun:test';
import type { EventRuntimePack } from './eventApi';
import { selectRuntimePacksForWorld } from './eventRuntime';

const runtimePack = (id: string, worldId?: string): EventRuntimePack => ({
  id,
  manifest: {
    id,
    name: id,
    version: '1.0.0',
    author: 'tester',
    engine: 'opt-event',
    schemaVersion: 1,
    minAppVersion: '2.7.0',
    type: 'rule',
    coverColor: '#000000',
    icon: 'Zap',
    worldId,
  },
  files: {},
});

test('selectRuntimePacksForWorld keeps global and matching world packs', () => {
  const selected = selectRuntimePacksForWorld(
    [runtimePack('global'), runtimePack('current', 'world-a'), runtimePack('other', 'world-b')],
    'world-a',
  );

  expect(selected.map(pack => pack.id)).toEqual(['global', 'current']);
});
