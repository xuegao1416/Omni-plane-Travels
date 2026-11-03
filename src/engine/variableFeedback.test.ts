import { afterEach, expect, test } from 'bun:test';
import { VariableManager } from './variableManager';
import { runTurnVariableExtraction } from './turnVariableExtraction';
import type { GameState } from '../schema/variables';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });
const fixture = async (id: number) => await Bun.file(new URL(`./variableFlashRejected${id}.fixture.json`, import.meta.url)).json() as {
  state: GameState; userText: string; narrative: string; responseText: string;
};
const payload = (text: string) => text.match(/<UpdateVariable>([\s\S]*?)<\/UpdateVariable>/)?.[1] ?? text;

for (const id of [14, 15]) {
  test(`real rejected Flash response ${id} gives an exact rejection reason without modifying the owner`, async () => {
    const data = await fixture(id);
    const manager = new VariableManager();
    manager.setState(data.state);
    const before = manager.getState();
    expect(manager.applyAiUpdateVariable(payload(data.responseText))).toBe(false);
    expect(manager.getLastAiUpdateRejection()).toContain(id === 14 ? 'narrativeDecisions' : 'JSON');
    expect(manager.getState()).toEqual(before);
  });
}

test('existing retry budget repairs the rejected response with its exact output and validation feedback', async () => {
  const data = await fixture(14);
  const manager = new VariableManager(); manager.setState(data.state);
  const corrected = JSON.parse(payload(data.responseText)); delete corrected.narrativeDecisions;
  const requests: string[] = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    requests.push(String(options?.body));
    return new Response(JSON.stringify({ choices: [{ message: { content: requests.length === 1 ? data.responseText : `<UpdateVariable>${JSON.stringify(corrected)}</UpdateVariable>` } }] }));
  }) as unknown as typeof fetch;
  await runTurnVariableExtraction({ varMgr: manager, parsed: { content: data.narrative, thinking: '' }, round: 2, userText: data.userText,
    mainApiConfig: { baseUrl: 'https://validation-feedback.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false },
    worldBook: null, worldId: 'default', delayMs: 0, maxRetries: 1, isCurrent: () => true });
  expect(requests).toHaveLength(2);
  const messages = JSON.parse(requests[1]).messages as Array<{ content: string }>;
  expect(messages.some(message => message.content.includes('narrativeDecisions') && message.content.includes('校验失败'))).toBe(true);
  expect(messages.some(message => message.content.includes(payload(data.responseText).trim()))).toBe(true);
  expect(manager.getState().世界.空间定位.当前位置).toBe('主教学楼·玄关');
});

test('cancellation interrupts the initial variable delay before any paid request', async () => {
  const controller = new AbortController(); let requests = 0;
  globalThis.fetch = (async () => { requests++; throw new Error('must not request'); }) as unknown as typeof fetch;
  const timer = setTimeout(() => controller.abort(), 10);
  const task = runTurnVariableExtraction({ varMgr: new VariableManager(), parsed: { content: '走入教室', thinking: '' }, round: 1, userText: '前行',
    mainApiConfig: { baseUrl: 'https://delay-cancellation.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false },
    worldBook: null, worldId: 'default', delayMs: 30000, maxRetries: 0, isCurrent: () => true, signal: controller.signal });
  let deadline!: ReturnType<typeof setTimeout>;
  try {
    await expect(Promise.race([task, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('delay did not abort')), 200); })])).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toBe(0);
  } finally { clearTimeout(timer); clearTimeout(deadline); }
});

test('malformed real response 15 is repaired through the same retry with JSON feedback', async () => {
  const data = await fixture(15);
  const manager = new VariableManager(); manager.setState(data.state);
  const requests: Array<{ messages: Array<{ content: string }> }> = [];
  globalThis.fetch = (async (_input: RequestInfo | URL, options?: RequestInit) => {
    requests.push(JSON.parse(String(options?.body)));
    const content = requests.length === 1 ? data.responseText : '<UpdateVariable>{"id":"repaired-15","effects":[{"set":{"path":"玩家.当前目标","value":"寻找教室"}}]}</UpdateVariable>';
    return new Response(JSON.stringify({ choices: [{ message: { content } }] }));
  }) as unknown as typeof fetch;
  await runTurnVariableExtraction({ varMgr: manager, parsed: { content: data.narrative, thinking: '' }, round: 2, userText: data.userText,
    mainApiConfig: { baseUrl: 'https://json-feedback.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false },
    worldBook: null, worldId: 'default', delayMs: 0, maxRetries: 1, isCurrent: () => true });
  expect(requests).toHaveLength(2);
  expect(requests[1].messages.some(message => message.content.includes('校验失败') && message.content.includes('JSON解析失败') && message.content.includes(payload(data.responseText).trim()))).toBe(true);
  expect(manager.getState().玩家.当前目标).toBe('寻找教室');
  expect(manager.getLastAiUpdateRejection()).toBeNull();
});

test('valid observation metadata cannot hide a forbidden authoritative clock transaction', async () => {
  const manager = new VariableManager(); const before = manager.getState(); let requests = 0;
  globalThis.fetch = (async () => {
    requests++;
    return new Response(JSON.stringify({ choices: [{ message: { content: `<UpdateVariable>${JSON.stringify({ id: 'forbidden-clock', effects: [{ set: { path: '世界.时间系统.当前时间', value: '8:25' } }], playerObservations: [{ npcId: 'unknown', path: '姓名', value: '同学', quote: '同学', mode: 'disclosed' }] })}</UpdateVariable>` } }] }));
  }) as unknown as typeof fetch;
  await expect(runTurnVariableExtraction({ varMgr: manager, parsed: { content: '同学走过走廊', thinking: '' }, round: 1, userText: '前行',
    mainApiConfig: { baseUrl: 'https://clock-rejection.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false },
    worldBook: null, worldId: 'default', delayMs: 0, maxRetries: 0, isCurrent: () => true })).rejects.toThrow('权威时钟');
  expect(requests).toBe(1);
  expect(manager.getState()).toEqual(before);
});

test('cancellation interrupts retry backoff and prevents the next paid request', async () => {
  const controller = new AbortController(); let requests = 0; let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  globalThis.fetch = (async () => { requests++; requested(); throw new Error('temporary network failure'); }) as unknown as typeof fetch;
  const task = runTurnVariableExtraction({ varMgr: new VariableManager(), parsed: { content: '走入教室', thinking: '' }, round: 1, userText: '前行',
    mainApiConfig: { baseUrl: 'https://backoff-cancellation.test', apiKey: 'test', model: 'test', provider: 'custom', stream: false },
    worldBook: null, worldId: 'default', delayMs: 1000, maxRetries: 1, isCurrent: () => true, signal: controller.signal });
  await started;
  // Let the rejected request enter its retry delay before cancelling it.
  const abortTimer = setTimeout(() => controller.abort(), 10);
  let deadline!: ReturnType<typeof setTimeout>;
  try {
    await expect(Promise.race([task, new Promise((_, reject) => { deadline = setTimeout(() => reject(new Error('backoff did not abort')), 200); })])).rejects.toMatchObject({ name: 'AbortError' });
    expect(requests).toBe(1);
  } finally { clearTimeout(abortTimer); clearTimeout(deadline); }
});
