import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import type { ApiConfig } from '../api/types';
import { eventBus, EVENTS } from '../engine/eventBus';
import { createDefaultGameState } from '../schema/variables';
import { deleteWebEvent, putWebEvent } from '../modules/eventDb';
import { eventWorldEvolution } from '../modules/eventIntegration';
import type { EventRule, Manifest } from '../modules/schema';
import { DirectorRuntime as WorldSimulationEngine } from './engine';
import { requestDirectorDecision } from '../director/client';
import { createEmptyDirectorState } from '../director/types';
import { createDefaultSimulationRuntimeState } from '../modules/schema';

test('mechanics settles once without an API or enabled background branch', async () => {
  const engine = new WorldSimulationEngine();
  engine.state.config.enabled = false;
  engine.state.config.autoTickInterval = 20;
  const gs = createDefaultGameState();
  gs.simulationRuntime = createDefaultSimulationRuntimeState();
  const original = structuredClone(gs);
  const first = await engine.settleMechanics(gs, { current: 'day1' }, 1, '', undefined, [], 'turn1');
  expect(first.settled).toBe(true);
  expect(gs.simulationRuntime.tick).toBe(1);
  expect(engine.state.mechanics).toBeUndefined();
  const retry = await engine.settleMechanics(original, { current: 'day1' }, 1, '', undefined, [], 'turn1');
  expect(retry.nextMechanics?.tickCount).toBe(1);
  engine.commitMechanics(retry);
  const second = await engine.settleMechanics(gs, { current: 'day1' }, 1, '', undefined, [], 'turn1');
  expect(second.settled).toBe(false);
  expect(gs.simulationRuntime.tick).toBe(1);
  engine.state.config.autoTickInterval = 0;
  const nextTurn = await engine.settleMechanics(gs, { current: 'day1' }, 2, '', undefined, [], 'turn2');
  expect(nextTurn.settled).toBe(true);
  expect(gs.simulationRuntime.tick).toBe(2);
  engine.commitMechanics(nextTurn);
  const oldRound = await engine.settleMechanics(gs, { current: 'day1' }, 1, '', undefined, [], 'different-id');
  expect(oldRound.settled).toBe(false);
});

test('mechanical proposals leave global rule runtimes and UI notifications untouched until commit', async () => {
  eventWorldEvolution.clear();
  const runtime = { onceFired: {}, cooldownRemaining: {} };
  eventWorldEvolution.registerPack({
    eventPackId: 'isolated', runtime, permissions: ['add_card'],
    rules: [{ id: 'once', once: true, when: { all: [] }, then: [{ addEvent: { eventId: 'card', eventPackId: 'pack' } }] }],
    periodicRules: [{ id: 'periodic', intervalTicks: 1, actions: [{ set: { path: '玩家.生存状态.血量', value: 90 } }] }],
  });
  try {
    const engine = new WorldSimulationEngine();
    engine.state.config.autoTickInterval = 1;
    const gs = createDefaultGameState();
    const result = await engine.settleMechanics(gs, { current: 'day1' }, 1, '');
    expect(runtime.onceFired).toEqual({});
    expect(result.notifications.eventCards).toEqual([{ eventId: 'card', eventPackId: 'pack' }]);
    expect(gs.simulationRuntime?.eventRuntimes?.isolated.onceFired.once).toBe(true);
    expect(result.mechanicalEffects).toEqual({});
    expect(result.effectLog).toContainEqual(expect.objectContaining({ variable: '玩家.生存状态.血量', before: 100, after: 90 }));
    engine.commitMechanics(result);
    const next = await engine.settleMechanics(gs, { current: 'day2' }, 2, '');
    expect(next.notifications.eventCards).toEqual([]);
  } finally { eventWorldEvolution.clear(); }
});

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

test('a committed mechanical settlement broadcasts a canonical card without a background request', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({
    choices: [{ message: { content: '{"conditions":[],"plans":[],"offscreen":[]}' } }],
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
    engine.state.config.autoTickInterval = 1;
    const result = await engine.settleMechanics(
      createDefaultGameState(),
      { current: 'E2E tick' },
      1,
      'E2E world',
    );

    expect(result.settled).toBe(true);
    expect(received).toEqual([]);
    engine.commitMechanics(result);
    await engine.publishMechanicalEvents(result);
    expect(engine.state.mechanics?.tickCount).toBe(1);
    expect(received).toEqual([{ cardId: cardEventId, eventPackId: cardPackId }]);
  } finally {
    off();
    eventWorldEvolution.clear();
    await deleteWebEvent(cardPackId);
    globalThis.fetch = originalFetch;
  }
});

test('a pending director request does not block deterministic addEvent rules or duplicate them', async () => {
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
        choices: [{ message: { content: '{"conditions":[],"plans":[],"offscreen":[]}' } }],
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
    engine.state.config.autoTickInterval = 1;
    const gs = createDefaultGameState();
    const settled = await engine.settleMechanics(gs, { current: 'E2E pending tick' }, 1, 'E2E world');
    engine.commitMechanics(settled);
    await engine.publishMechanicalEvents(settled);
    tickPromise = requestDirectorDecision(createEmptyDirectorState(), { saveId: 'save', worldId: 'world', completedTurnId: 'turn1', stateVersion: '1', variableProjection: gs, memories: [] }, 'E2E world', apiConfig);

    await fetchStarted;
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(received).toEqual([{ cardId: cardEventId, eventPackId: cardPackId }]);

    releaseFetch?.();
    await tickPromise;
    await engine.publishMechanicalEvents(settled);
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
