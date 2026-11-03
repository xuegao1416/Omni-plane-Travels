import { expect, test } from 'bun:test';
import { createDefaultGameState } from '../schema/variables';
import { buildCustomModuleHostContext, readCustomModuleHostInput } from './context';
import { getCustomModuleSafeInputType } from './capabilities';

test('director travel uses canonical elapsed minutes and preserves missing-clock uncertainty', () => {
  const state = createDefaultGameState();
  state.世界.时间系统.时钟 = { schemaVersion: 2, elapsedMinutes: 4321 };
  expect(getCustomModuleSafeInputType('game.elapsedMinutes')).toBe('number');
  expect(readCustomModuleHostInput(buildCustomModuleHostContext(state), 'game.elapsedMinutes')).toBe(4321);
  delete state.世界.时间系统.时钟;
  expect(readCustomModuleHostInput(buildCustomModuleHostContext(state), 'game.elapsedMinutes')).toBeUndefined();
});

test('world routes read current canonical player location rather than a model supplied module flag', () => {
  const state = createDefaultGameState();
  state.世界.空间定位.当前位置 = '贝希摩斯牧场';
  expect(getCustomModuleSafeInputType('game.location')).toBe('string');
  expect(readCustomModuleHostInput(buildCustomModuleHostContext(state), 'game.location')).toBe('贝希摩斯牧场');
});
