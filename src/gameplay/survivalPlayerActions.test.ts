import { expect, test } from 'bun:test';
import { VariableManager } from '../engine/variableManager';
import { createDefaultGameState } from '../schema/variables';
import type { WorldDef } from '../data/worlds-schema';
import type { ApiConfig } from '../api/types';
import type { SurvivalRecipe } from '../modules/schema';
import { ensureWorldClockOnGameState } from '../time/worldClock';
import { craftSurvivalRecipe } from './modules/survival';
import { SurvivalPlayerActions, type RecipeGenerationRequest } from './survivalPlayerActions';

const recipe: SurvivalRecipe = { id: 'plank', name: '加工木板', inputs: { wood: 2 }, output: { resourceId: 'plank', amount: 5 }, craftTimeMinutes: 15, description: '' };
function fixture(production = false) {
  const world = { id: 'survival_test', name: '生存世界', modules: [{ moduleId: 'survival', enabled: true, moduleConfig: {
    resources: [{ id: 'wood', name: '木材', amount: 8, max: 10, gatherAmount: 5, gatherTimeMinutes: 30, gatherStaminaCost: 4 },
      { id: 'plank', name: '木板', amount: 8, max: 10 }], recipes: [recipe],
  } }] } as unknown as WorldDef;
  const initial = createDefaultGameState(); initial.玩家.生存资源 = { wood: { 数量: 8, 最大值: 10 }, plank: { 数量: 8, 最大值: 10 } };
  initial.玩家.物品栏.绳索 = { 数量: 2, 类型: '工具', 品质: '普通', 备注: '' };
  ensureWorldClockOnGameState(initial, world);
  let manager = new VariableManager(initial), saveId = 'save-one', generating = false, readOnly = false;
  let commits = 0; const messages: string[] = [], busy: boolean[] = [];
  const requests: Array<{ input: RecipeGenerationRequest; signal: AbortSignal; resolve(text: string): void }> = [];
  const engine = { get variableManager() { return manager; }, get isGenerating() { return generating; }, get isReadOnly() { return readOnly; },
    commitPlayerState: (state: typeof initial) => { commits++; manager.setState(state); return true; } };
  const service = new SurvivalPlayerActions({ getEngine: () => engine, getWorld: () => world, getSaveId: () => saveId,
    getApiConfig: () => ({ apiKey: 'private', baseUrl: 'https://example.test', model: 'test', provider: 'custom', stream: false } as ApiConfig),
    publish: text => messages.push(text), busy: flag => busy.push(flag), accepted: () => {},
  }, production ? undefined : (input, signal) => new Promise(resolve => { requests.push({ input, signal, resolve }); }));
  return { service, world, engine, requests, messages, busy, state: () => manager.getState(), commits: () => commits,
    setState: (state: typeof initial) => manager.setState(state),
    switchSave: () => { saveId = 'save-two'; manager = new VariableManager(initial); },
    generating: () => { generating = true; }, readOnly: () => { readOnly = true; },
  };
}
const response = JSON.stringify({ id: 'generated', name: '新木板', inputs: { wood: 1 }, output: { resourceId: 'plank', amount: 2 }, craftTimeMinutes: 5 });

test('shared crafting respects resource capacity atomically while preserving material/time rules', () => {
  const fixtureState = fixture(), original = fixtureState.state();
  const result = craftSurvivalRecipe(original, recipe, { tick: 0, enabledModules: ['survival'] });
  expect(result.status).toBe('applied'); expect(result.state.玩家.生存资源?.plank.数量).toBe(10);
  expect(result.state.玩家.生存资源?.wood.数量).toBe(6); expect(original.玩家.生存资源?.wood.数量).toBe(8);
});
test('gathering and crafting feedback report actual production, costs, time and capacity', () => {
  const fixtureState = fixture(); const gathered = fixtureState.service.perform({ type: 'gather', resourceId: 'wood' });
  expect(gathered.status).toBe('accepted'); expect(gathered.feedback).toContain('木材 +2'); expect(gathered.feedback).toContain('体力 -4');
  expect(gathered.feedback).toContain('30分钟'); expect(gathered.feedback).toContain('容量');
  const crafted = fixtureState.service.perform({ type: 'craft', recipeId: recipe.id });
  expect(crafted.feedback).toContain('木板 +2'); expect(crafted.feedback).toContain('木材 -2'); expect(crafted.feedback).toContain('15分钟');
  expect(fixtureState.commits()).toBe(2);
});
test.each(['generating', 'readOnly'] as const)('actions reject during %s without spending or committing', mode => {
  const fixtureState = fixture(); fixtureState[mode](); const before = fixtureState.state();
  expect(fixtureState.service.perform({ type: 'gather', resourceId: 'wood' }).status).toBe('rejected');
  expect(fixtureState.state()).toEqual(before); expect(fixtureState.commits()).toBe(0);
});
test('full output and insufficient inputs never spend costs or advance time', () => {
  const fixtureState = fixture(), state = fixtureState.state(); state.玩家.生存资源!.plank.数量 = 10; fixtureState.setState(state);
  const before = fixtureState.state(); expect(fixtureState.service.perform({ type: 'craft', recipeId: recipe.id }).status).toBe('rejected');
  expect(fixtureState.state()).toEqual(before); expect(fixtureState.commits()).toBe(0);
  state.玩家.生存资源!.plank.数量 = 0; state.玩家.生存资源!.wood.数量 = 1; fixtureState.setState(state);
  expect(fixtureState.service.perform({ type: 'craft', recipeId: recipe.id }).status).toBe('rejected'); expect(fixtureState.commits()).toBe(0);
});
test('legacy resource records missing runtime max still use the frozen world capacity', () => {
  const fixtureState = fixture(), state = fixtureState.state(); delete state.玩家.生存资源!.plank.最大值; fixtureState.setState(state);
  const crafted = fixtureState.service.perform({ type: 'craft', recipeId: recipe.id });
  expect(crafted.status).toBe('accepted'); expect(fixtureState.state().玩家.生存资源?.plank.数量).toBe(10);
  expect(crafted.feedback).toContain('木板 +2'); expect(crafted.feedback).toContain('容量');
});
test('recipe generation merges latest unrelated state, commits once, and deletion uses the same owner', async () => {
  const fixtureState = fixture(); const pending = fixtureState.service.generate('木板');
  const latest = fixtureState.state(); latest.玩家.姓名 = 'Later author edit'; fixtureState.setState(latest);
  fixtureState.requests[0].resolve(response); expect((await pending).status).toBe('accepted');
  expect(fixtureState.state().玩家.姓名).toBe('Later author edit'); expect(fixtureState.state().玩家.生存配方).toHaveLength(1);
  expect(fixtureState.commits()).toBe(1);
  expect(fixtureState.service.perform({ type: 'delete-recipe', recipeId: 'generated' }).status).toBe('accepted');
  expect(fixtureState.state().玩家.生存配方).toEqual([]); expect(fixtureState.commits()).toBe(2);
  expect(fixtureState.service.perform({ type: 'delete-recipe', recipeId: recipe.id }).status).toBe('rejected');
});
test.each(['cancel', 'dispose', 'switchSave'] as const)('late recipe after %s never writes or releases a replacement request', async mode => {
  const fixtureState = fixture(), first = fixtureState.service.generate('old');
  if (mode === 'switchSave') fixtureState.switchSave(); else fixtureState.service[mode]();
  const replacement = mode !== 'dispose' ? fixtureState.service.generate('new') : undefined;
  fixtureState.requests[0].resolve(response); expect((await first).status).toBe('rejected'); expect(fixtureState.commits()).toBe(0);
  if (mode !== 'dispose') {
    expect(fixtureState.requests[1].signal.aborted).toBe(false); expect(fixtureState.busy.at(-1)).toBe(true);
    fixtureState.requests[1].resolve(response); expect((await replacement!).status).toBe('accepted');
  }
});

test('the production recipe HTTP path is canceled without retry or commit', async () => {
  const previousFetch = globalThis.fetch, fixtureState = fixture(true); let calls = 0; let observedSignal!: AbortSignal;
  let started!: () => void; const reached = new Promise<void>(resolve => { started = resolve; });
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    calls++; observedSignal = options!.signal!; started();
    return new Promise<Response>((_resolve, reject) => { observedSignal.addEventListener('abort', () => reject(observedSignal.reason), { once: true }); });
  }) as typeof fetch;
  try {
    const pending = fixtureState.service.generate('生产路径'); await reached;
    fixtureState.service.cancel(); expect((await pending).status).toBe('rejected');
    expect(observedSignal.aborted).toBe(true); expect(calls).toBe(1); expect(fixtureState.commits()).toBe(0);
  } finally { globalThis.fetch = previousFetch; fixtureState.service.dispose(); }
});
test('changed resource read-set or world rules rejects paid recipe acceptance while retaining current state', async () => {
  const fixtureState = fixture(), pending = fixtureState.service.generate('wood');
  const latest = fixtureState.state(); latest.玩家.生存资源!.wood.数量 = 7; fixtureState.setState(latest);
  fixtureState.requests[0].resolve(response); expect((await pending).status).toBe('rejected'); expect(fixtureState.state().玩家.生存资源?.wood.数量).toBe(7);
  expect(fixtureState.commits()).toBe(0);
  const changedWorld = fixture(), pendingWorld = changedWorld.service.generate('wood'); changedWorld.world.modules![0].enabled = false;
  changedWorld.requests[0].resolve(response); expect((await pendingWorld).status).toBe('rejected'); expect(changedWorld.commits()).toBe(0);
});
test('invalid generated quantities and duplicate immutable recipe IDs cannot create free or replaced recipes', async () => {
  const fixtureState = fixture(), pending = fixtureState.service.generate('invalid');
  fixtureState.requests[0].resolve(JSON.stringify({ id: 'generated', inputs: { wood: -1 }, output: { resourceId: 'plank', amount: 1 } }));
  expect((await pending).status).toBe('rejected'); expect(fixtureState.commits()).toBe(0);
  const duplicate = fixtureState.service.generate('duplicate'); fixtureState.requests[1].resolve(response.replace('generated', 'plank'));
  expect((await duplicate).status).toBe('rejected'); expect(recipe.output.amount).toBe(5);
  const zero = fixtureState.service.generate('zero'); fixtureState.requests[2].resolve(JSON.stringify({ id: 'zero', inputs: { wood: 1 }, output: { resourceId: 'plank', amount: 0 } }));
  expect((await zero).status).toBe('rejected'); expect(fixtureState.commits()).toBe(0);
});
