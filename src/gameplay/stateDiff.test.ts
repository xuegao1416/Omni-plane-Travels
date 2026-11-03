import { expect, test } from 'bun:test';
import { createGameplayStateDiff } from './kernel';

test('an isolated draft does not log unchanged arrays or immutable module definitions', () => {
  const before = { customModules: { story: { definition: { logic: [{ actions: [{ type: 'set', value: 1 }] }] }, values: { count: 0 }, runtime: { processedEvents: [] } } }, history: [{ changes: [1, 2] }] };
  const after = structuredClone(before);
  after.customModules.story.values.count = 1;
  expect(createGameplayStateDiff(before, after)).toEqual([{ set: { path: 'customModules.story.values.count', value: 1 } }]);
});
