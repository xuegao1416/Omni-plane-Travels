import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import type { ApiConfig } from '../api/types';
import { eventBus, EVENTS } from '../engine/eventBus';
import { createDefaultGameState } from '../schema/variables';
import { deleteWebEvent, putWebEvent } from '../modules/eventDb';
import { eventWorldEvolution } from '../modules/eventIntegration';
import type { EventRule, Manifest } from '../modules/schema';
import { WorldSimulationEngine } from './engine';

const apiConfig: ApiConfig = {
  apiKey: 'test-key',
  baseUrl: 'https://example.test',
  model: 'test-model',
  provider: 'custom',
  stream: false,
};

const cardPackId = 'e2e-card-pack';
const cardEventId = 'e2e-card-event';
const rulePackId = 'e2e-rule-pack';

const cardManifest: Manifest = {
  id: cardPackId,
  name: 'E2E card pack',
  version: '1.0.0',
  author: 'test',
  engine: 'opt-event',
  schemaVersion: 1,
  minAppVersion: '2.7.0',
  type: 'card',
  coverColor: '#3b82f6',
  icon: 'FileText',
  permissions: ['add_card'],
};

const cardFiles = {
  'schema/events.json': JSON.stringify({
    version: 2,
    events: [{ id: cardEventId, name: 'E2E card' }],
  }),
  [`schema/event-${cardEventId}.json`]: JSON.stringify({
    version: 1,
    id: cardEventId,
    name: 'E2E card',
    nodes: [],
    connections: [],
  }),
};

test('a completed simulation tick evaluates deterministic rules and broadcasts a canonical card', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{}' } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;

  const addEventRule: EventRule = {
    id: 'e2e-every-tick',
    when: { all: [] },
    then: [{ addEvent: { eventId: cardEventId, eventPackId: cardPackId } }],
  };
  const received: Array<{ cardId: string; eventPackId: string }> = [];
  const off = eventBus.on(EVENTS.EVENT_CARD, (event: { cardId: string; eventPackId: string }) => {
    received.push(event);
  });

  await putWebEvent({
    id: cardPackId,
    manifest: cardManifest,
    enabled: true,
    status: 'enabled',
    installedAt: new Date().toISOString(),
    files: cardFiles,
  });

  eventWorldEvolution.clear();
  eventWorldEvolution.registerPack({
    eventPackId: rulePackId,
    rules: [addEventRule],
    permissions: ['add_card'],
    runtime: { onceFired: {}, cooldownRemaining: {} },
  });

  try {
    const engine = new WorldSimulationEngine();
    engine.setApiConfig(apiConfig);
    const result = await engine.tick(
      createDefaultGameState(),
      { current: 'E2E tick' },
      1,
      'E2E world',
    );

    expect(result).not.toBeNull();
    expect(engine.state.tickCount).toBe(1);
    expect(received).toEqual([{ cardId: cardEventId, eventPackId: cardPackId }]);
  } finally {
    off();
    eventWorldEvolution.clear();
    await deleteWebEvent(cardPackId);
    globalThis.fetch = originalFetch;
  }
});

test('a pending simulation request does not block deterministic addEvent rules or duplicate them', async () => {
  const originalFetch = globalThis.fetch;
  let markFetchStarted!: () => void;
  let releaseFetch: (() => void) | undefined;
  const fetchStarted = new Promise<void>((resolve) => {
    markFetchStarted = resolve;
  });

  globalThis.fetch = (async () => {
    markFetchStarted();
    return new Promise<Response>((resolve) => {
      releaseFetch = () => resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '{}' } }],
      }), { status: 200, headers: { 'content-type': 'application/json' } }));
    });
  }) as unknown as typeof fetch;

  const addEventRule: EventRule = {
    id: 'e2e-pending-current-state',
    once: true,
    when: {
      state: {
        path: '\u4e16\u754c.\u65f6\u95f4\u7cfb\u7edf.\u5f53\u524d\u65f6\u95f4',
        op: '==',
        value: '',
      },
    },
    then: [{ addEvent: { eventId: cardEventId, eventPackId: cardPackId } }],
  };
  const received: Array<{ cardId: string; eventPackId: string }> = [];
  const off = eventBus.on(EVENTS.EVENT_CARD, (event: { cardId: string; eventPackId: string }) => {
    received.push(event);
  });

  let tickPromise: Promise<unknown> | undefined;
  await putWebEvent({
    id: cardPackId,
    manifest: cardManifest,
    enabled: true,
    status: 'enabled',
    installedAt: new Date().toISOString(),
    files: cardFiles,
  });
  eventWorldEvolution.clear();
  eventWorldEvolution.registerPack({
    eventPackId: rulePackId,
    rules: [addEventRule],
    permissions: ['add_card'],
    runtime: { onceFired: {}, cooldownRemaining: {} },
  });

  try {
    const engine = new WorldSimulationEngine();
    engine.setApiConfig(apiConfig);
    tickPromise = engine.tick(
      createDefaultGameState(),
      { current: 'E2E pending tick' },
      1,
      'E2E world',
    );

    await fetchStarted;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(received).toEqual([{ cardId: cardEventId, eventPackId: cardPackId }]);

    releaseFetch?.();
    await tickPromise;
    expect(received).toHaveLength(1);
  } finally {
    releaseFetch?.();
    await tickPromise?.catch(() => undefined);
    off();
    eventWorldEvolution.clear();
    await deleteWebEvent(cardPackId);
    globalThis.fetch = originalFetch;
  }
});
