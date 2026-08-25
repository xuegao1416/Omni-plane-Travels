import { expect, test } from 'bun:test';
import type { WorldDef } from '../../data/worlds-schema';
import { isProfessionModuleEnabled } from './featureGate';

function world(moduleConfig: Record<string, unknown>, enabled = true): WorldDef {
  return { id: 'test', name: '测试世界', description: '', modules: [{ moduleId: 'profession', name: '职业典藏', description: '', enabled, moduleConfig }] } as WorldDef;
}

test('enables referenced profession packs without embedding their content', () => {
  expect(isProfessionModuleEnabled(world({ packIds: ['fantasy-core'] }))).toBe(true);
  expect(isProfessionModuleEnabled(world({ packIds: [] }))).toBe(false);
  expect(isProfessionModuleEnabled(world({ packIds: ['fantasy-core'] }, false))).toBe(false);
});
