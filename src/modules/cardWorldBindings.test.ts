import 'fake-indexeddb/auto';
import { afterEach, expect, test } from 'bun:test';
import { installWorldCardWorkflows } from './cardWorldBindings';
import { allWebEvents, deleteWebEvent, getWebEvent } from './eventDb';
import type { CardWorkflowDefinition } from './schema';
import type { WorldDef } from '../data/worlds-schema';

afterEach(async () => {
  const records = await allWebEvents();
  for (const record of records) await deleteWebEvent(record.id);
});

const world = {
  id: 'world-card-bindings-test',
  name: '绑定测试世界',
  description: '测试世界',
  entryId: null,
} satisfies WorldDef;

function workflow(id: string, name: string): CardWorkflowDefinition {
  return {
    version: 1,
    id,
    name,
    nodes: [],
    connections: [],
  };
}

test('installWorldCardWorkflows writes a metadata-only v2 card pack', async () => {
  await installWorldCardWorkflows({
    ...world,
    cardWorkflows: [
      { id: 'bound-event', name: '绑定事件', workflow: workflow('bound-event', '绑定事件') },
    ],
  } as WorldDef & {
    cardWorkflows: Array<{ id: string; name: string; workflow: CardWorkflowDefinition }>;
  });

  const record = await getWebEvent('world-card-world-card-bindings-test-bound-event');
  expect(record).toBeDefined();

  const index = JSON.parse(record!.files['schema/events.json'] as string) as {
    version: number;
    events: Array<Record<string, unknown> & { id: string; name: string }>;
  };
  expect(index.version).toBe(2);
  expect(index.events).toEqual([{ id: 'bound-event', name: '绑定事件' }]);
  expect(index.events.every((entry) => !('cards' in entry))).toBe(true);
  expect(index.events.every((entry) => !('periodicRules' in entry))).toBe(true);
  expect(record!.files['schema/card.json']).toBeUndefined();

  const storedWorkflow = JSON.parse(
    record!.files['schema/event-bound-event.json'] as string,
  ) as CardWorkflowDefinition;
  expect(storedWorkflow).toMatchObject({ id: 'bound-event', name: '绑定事件' });
});
