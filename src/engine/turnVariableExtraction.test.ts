import { expect, test } from 'bun:test';
import { VariableManager } from './variableManager';
import { runTurnVariableExtraction } from './turnVariableExtraction';
import { eventBus, EVENTS } from './eventBus';

test('variable response cannot overwrite a player edit made while awaiting the API', async () => {
  const originalFetch = globalThis.fetch;
  let release!: () => void;
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  const response = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = (async () => {
    requested(); await response;
    return new Response(JSON.stringify({ choices: [{ message: { content: '<UpdateVariable>{"id":"late-variable","moduleId":"core","source":"ai","effects":[{"set":{"path":"玩家.姓名","value":"旧结果"}}]}</UpdateVariable>' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
  try {
    const manager = new VariableManager();
    const operation = runTurnVariableExtraction({ varMgr: manager, parsed: { content: '完成行动。', thinking: '' }, round: 1, userText: '前行', mainApiConfig: { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', provider: 'custom', stream: false }, worldBook: null, worldId: 'default', delayMs: 0, maxRetries: 0, isCurrent: () => true });
    await started;
    const edited = manager.getState(); edited.玩家.姓名 = '玩家修改'; manager.setState(edited);
    release();
    await expect(operation).rejects.toThrow();
    expect(manager.getState().玩家.姓名).toBe('玩家修改');
    expect(manager.getState()).toEqual(edited);
  } finally { release?.(); globalThis.fetch = originalFetch; }
});

test('variable update observers see the accepted state, with one notification', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '<UpdateVariable>{"id":"fresh-variable","moduleId":"core","source":"ai","effects":[{"set":{"path":"玩家.生存状态.体力值","value":77}}]}</UpdateVariable>' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch;
  const manager = new VariableManager();
  const observed: number[] = [];
  const unsubscribe = eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, () => { observed.push(manager.getState().玩家.生存状态.体力值); });
  try {
    await runTurnVariableExtraction({ varMgr: manager, parsed: { content: '完成行动。', thinking: '' }, round: 1, userText: '前行', mainApiConfig: { apiKey: 'test', baseUrl: 'https://example.test', model: 'test', provider: 'custom', stream: false }, worldBook: null, worldId: 'default', delayMs: 0, maxRetries: 0, isCurrent: () => true });
    expect(manager.getState().玩家.生存状态.体力值).toBe(77);
    expect(observed).toEqual([77]);
  } finally { unsubscribe(); globalThis.fetch = originalFetch; }
});
