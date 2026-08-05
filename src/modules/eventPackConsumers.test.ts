import { describe, expect, test } from 'bun:test';
import 'fake-indexeddb/auto';
import type { CardWorkflowDefinition, EventIndexEntry, Manifest } from './schema';
import { EventPackFormatError, readCanonicalEventPack } from './eventPackFormat';
import { deleteWebEvent, putWebEvent } from './eventDb';
import { emitCanonicalEventCard } from '../simulation/engine';
import { eventBus, EVENTS } from '../engine/eventBus';

function workflow(entry: EventIndexEntry, withNode = false): CardWorkflowDefinition {
  return {
    version: 1,
    id: entry.id,
    name: entry.name,
    nodes: withNode ? [{
      id: `${entry.id}-title`,
      typeId: 'narrative.title',
      position: { x: 0, y: 0 },
      widgetValues: { title: entry.name },
    }] : [],
    connections: [],
  };
}

function canonicalFixture(): Record<string, string> {
  const first = { id: 'event-one', name: '事件一' };
  const second = { id: 'event-two', name: '事件二' };
  return {
    'schema/events.json': JSON.stringify({ version: 2, name: '测试包', events: [first, second] }),
    'schema/event-event-one.json': JSON.stringify(workflow(first, true)),
    'schema/event-event-two.json': JSON.stringify(workflow(second)),
    'schema/event-stale.json': JSON.stringify(workflow({ id: 'stale', name: '残留' }, true)),
  };
}

describe('readCanonicalEventPack', () => {
  test('returns indexed workflows, IDs, event count, and actual workflow node count', () => {
    const view = readCanonicalEventPack(canonicalFixture());

    expect(view.eventIds).toEqual(['event-one', 'event-two']);
    expect(view.eventCount).toBe(2);
    expect(view.workflowNodeCount).toBe(1);
    expect(view.workflows.map((item) => item.id)).toEqual(['event-one', 'event-two']);
    expect(view.workflowByEventId.get('event-one')?.nodes).toHaveLength(1);
    expect(view.workflowByEventId.has('stale')).toBe(false);
  });

  test('does not accept a legacy embedded-card index at runtime', () => {
    const files = canonicalFixture();
    files['schema/events.json'] = JSON.stringify({
      version: 1,
      events: [{ id: 'event-one', name: '事件一', cards: [] }],
    });

    expect(() => readCanonicalEventPack(files)).toThrow(EventPackFormatError);
  });

  test('rejects a legacy card file even when a canonical index is present', () => {
    const files = canonicalFixture();
    files['schema/card.json'] = JSON.stringify({ version: 1, cards: [] });

    expect(() => readCanonicalEventPack(files)).toThrow(EventPackFormatError);
  });

  test('reports a missing indexed workflow with its canonical file path', () => {
    const files = canonicalFixture();
    delete files['schema/event-event-two.json'];

    try {
      readCanonicalEventPack(files);
      throw new Error('expected readCanonicalEventPack to fail');
    } catch (error) {
      expect(error).toBeInstanceOf(EventPackFormatError);
      expect(error).toMatchObject({
        code: 'WORKFLOW_MISSING',
        filePath: 'schema/event-event-two.json',
      });
    }
  });
});

function manifest(id: string): Manifest {
  return {
    id,
    name: id,
    version: '1.0.0',
    author: 'test',
    engine: 'opt-event',
    schemaVersion: 1,
    minAppVersion: '2.7.0',
    type: 'card',
    coverColor: '#000000',
    icon: 'Package',
  };
}

test('simulation emits only an indexed canonical workflow', async () => {
  const packId = 'consumer-engine-pack';
  await putWebEvent({
    id: packId,
    manifest: manifest(packId),
    enabled: true,
    status: 'enabled',
    installedAt: new Date().toISOString(),
    files: canonicalFixture(),
  });
  const received: Array<{ cardId: string; eventPackId: string }> = [];
  const off = eventBus.on(EVENTS.EVENT_CARD, (event: { cardId: string; eventPackId: string }) => {
    received.push(event);
  });

  try {
    expect(await emitCanonicalEventCard('event-one', [packId])).toBe(true);
    expect(await emitCanonicalEventCard('stale', [packId])).toBe(false);
    expect(received).toEqual([{ cardId: 'event-one', eventPackId: packId }]);
  } finally {
    off();
    await deleteWebEvent(packId);
  }
});

test('simulation rejects a legacy embedded-card pack without emitting', async () => {
  const packId = 'consumer-legacy-pack';
  await putWebEvent({
    id: packId,
    manifest: manifest(packId),
    enabled: true,
    status: 'enabled',
    installedAt: new Date().toISOString(),
    files: {
      'schema/events.json': JSON.stringify({
        version: 1,
        events: [{ id: 'legacy-event', name: '旧事件', cards: [{ id: 'legacy-card' }] }],
      }),
    },
  });
  let emitted = false;
  const off = eventBus.on(EVENTS.EVENT_CARD, () => { emitted = true; });

  try {
    await expect(emitCanonicalEventCard('legacy-event', [packId])).rejects.toBeInstanceOf(EventPackFormatError);
    expect(emitted).toBe(false);
  } finally {
    off();
    await deleteWebEvent(packId);
  }
});
