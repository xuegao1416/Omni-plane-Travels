import { expect, test } from 'bun:test';
import { applyDirectorDecision, decisionSchema, requestDirectorDecision } from './client';
import { createDefaultGameState, type GameState, type NPCData } from '../schema/variables';
import { createEmptySimState } from '../simulation/types';
import { ensureDirectorState, compileDirectorDirective } from './runtime';
import { alignDirectorPlans } from './align';
import type { DirectorReadContext } from './types';

test('unmodified real Flash director response maps the unique player name to its canonical identity', async () => {
  const fixture = await Bun.file(new URL('./directorFlash.fixture.json', import.meta.url)).json() as {
    input: { variables: GameState; committedNarrative: string; memories: DirectorReadContext['memories'] }; responseText: string;
  };
  const decision = decisionSchema.parse(JSON.parse(fixture.responseText));
  const simulation = createEmptySimState();
  const state = ensureDirectorState(simulation);
  const context: DirectorReadContext = { saveId: 'public-audit', worldId: 'japanese_school', completedTurnId: 't', stateVersion: 'v',
    variableProjection: fixture.input.variables, narrative: fixture.input.committedNarrative, memories: fixture.input.memories };
  applyDirectorDecision(state, decision, context);
  expect(state.plans['actor:confirm_class_assignment']?.participants).toEqual(['player']);
  expect(state.plans['actor:confirm_class_assignment']?.basis).toEqual(['memory:thread_find_classroom', 'narrative:t']);
  alignDirectorPlans(state, context);
  expect(compileDirectorDirective(simulation, 't', 'v', 'public-audit', 'next')?.primary?.planId).toBe('actor:confirm_class_assignment');
});

test('director request gives the model canonical actors instead of requiring it to infer player identity', async () => {
  const variables = createDefaultGameState();
  variables.玩家.姓名 = '旅者';
  variables.人物档案.guard = { 姓名: '门卫' } as NPCData;
  const originalFetch = globalThis.fetch;
  let actors: unknown;
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body)) as { messages: Array<{ content: string }> };
    actors = JSON.parse(body.messages[1].content).actors;
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"conditions":[],"plans":[],"offscreen":[]}' } }] }));
  }) as unknown as typeof fetch;
  try {
    await requestDirectorDecision(ensureDirectorState(createEmptySimState()), { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: 'v', variableProjection: variables, memories: [] },
      '校园', { baseUrl: 'https://director-actor-table.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false });
    expect(actors).toEqual([{ id: 'player', name: '旅者' }, { id: 'guard', name: '门卫' }]);
  } finally { globalThis.fetch = originalFetch; }
});

test('player alias normalization rejects unknown names and a display name shared with an NPC', () => {
  const variables = createDefaultGameState();
  variables.玩家.姓名 = '同名角色';
  variables.人物档案.n = { 姓名: '同名角色' } as NPCData;
  const context: DirectorReadContext = { saveId: 's', worldId: 'w', completedTurnId: 't', stateVersion: 'v', variableProjection: variables, narrative: '雨', memories: [] };
  for (const name of ['陌生人物', '同名角色']) {
    const state = ensureDirectorState(createEmptySimState());
    applyDirectorDecision(state, { conditions: [], offscreen: [], plans: [{ id: 'plan', intent: '继续行动', participants: [name], constraints: [], priority: 30,
      visibility: 'foreground', evidence: [{ kind: 'narrative', quote: '雨' }] }] }, context);
    expect(state.plans['actor:plan']).toBeUndefined();
  }
});
