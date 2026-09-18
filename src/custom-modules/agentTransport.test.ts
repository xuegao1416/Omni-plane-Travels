import { afterAll, describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { createWorkshopModel, classifyWorkshopError, awaitWorkshopRequestSlot } from './agentTransport';
import { executeWorkshopTool, workshopWireSchemas } from './workshopTools';
import { createWorkshopSession } from './workshopSession';
import { z } from 'zod';
import { bucketKeyForConfig, setRateLimitInterval } from '../api/rateLimiter';

const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
afterAll(() => { if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });
const config = () => ({ provider: 'custom' as const, baseUrl: `https://test-${crypto.randomUUID()}.invalid/v1`, model: 'test', apiKey: 'test-key', stream: false });
const completion = (message: Record<string, unknown>) => Response.json({ id: 'test', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }] });
const tools = { inspect: { description: 'Inspect draft', inputSchema: z.object({}) } };

describe('workshop OpenAI-compatible transport', () => {
  test('keeps schema references inside text so Gemini does not interpret them as attachment references', () => {
    const { output } = executeWorkshopTool(createWorkshopSession({ id: 'test', name: '测试世界' }), 'capabilities', {}, 'test-event');
    const value = output as { moduleSchemaJson: string };
    expect(typeof value.moduleSchemaJson).toBe('string');
    expect(JSON.parse(value.moduleSchemaJson)).toMatchObject({ type: 'object' });
    const visit = (entry: unknown): void => {
      if (!entry || typeof entry !== 'object') return;
      expect(Object.keys(entry)).not.toContain('$ref');
      Object.values(entry).forEach(visit);
    };
    visit(output);
  });
  test('advertises portable tool parameters and distinguishes unsupported tools from a rejected schema', () => {
    const schema = JSON.stringify(Object.fromEntries(Object.entries(workshopWireSchemas).map(([name, value]) => [name, z.toJSONSchema(value)])));
    expect(schema).not.toContain('"$ref"');
    expect(schema).not.toContain('"const"');
    expect(classifyWorkshopError({ statusCode: 400, message: 'tool calling is not supported' }).kind).toBe('unsupported-tools');
    expect(classifyWorkshopError({ statusCode: 400, message: 'Invalid JSON payload. Unknown name "$ref" at request.tools' }).kind).toBe('arguments');
  });
  test('sends exactly one authorization and content type header; accepts a one-character answer', async () => {
    let called = false;
    const model = createWorkshopModel(config(), async (url, init) => {
      const request = new Request(url, init);
      called = true;
      expect(request.headers.get('authorization')).toBe('Bearer test-key');
      expect(request.headers.get('content-type')).toBe('application/json');
      const body = await request.json();
      expect(body).toMatchObject({ model: 'test' });
      expect(body).not.toHaveProperty('parallel_tool_calls');
      return completion({ content: '好' });
    });
    expect((await generateText({ model, prompt: '你好', maxRetries: 0 })).text).toBe('好');
    expect(called).toBe(true);
  });
  test('adds parallel_tool_calls only to native tool requests', async () => {
    const model = createWorkshopModel(config(), async (_url, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ parallel_tool_calls: false, tools: [expect.anything()] });
      return completion({ content: 'done' });
    });
    await generateText({ model, tools, prompt: 'test', maxRetries: 0 });
  });
  test('text-only mode strips tool parameters even when the caller supplies tools', async () => {
    const model = createWorkshopModel(config(), async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      for (const key of ['tools', 'tool_choice', 'parallel_tool_calls', 'response_format']) expect(body).not.toHaveProperty(key);
      return completion({ content: 'done' });
    }, { textOnly: true });
    await generateText({ model, tools, toolChoice: 'auto', prompt: 'test', maxRetries: 0 });
  });
  test('text-only mode cannot bypass the trial API scope', () => {
    expect(() => createWorkshopModel({ ...config(), apiKey: '', baseUrl: 'https://example.invalid/api/trial/' }, undefined, { textOnly: true })).toThrow('体验接口');
  });
  test.each(['parallel_tool_calls', 'reasoning_effort', 'top_k'])('removes only the explicitly rejected %s parameter', async parameter => {
    const api = { ...config(), reasoningEffort: 'low' as const, topK: 10 };
    setRateLimitInterval(1000, bucketKeyForConfig(api));
    const bodies: Record<string, unknown>[] = [];
    const model = createWorkshopModel(api, async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      if (bodies.length === 1) return Response.json({ error: { message: `Unsupported parameter: '${parameter}'` } }, { status: 400 });
      return completion({ content: 'done' });
    });
    expect((await generateText({ model, tools, prompt: 'test', maxRetries: 0 })).text).toBe('done');
    expect(bodies).toHaveLength(2);
    const expected = { ...bodies[0] }; delete expected[parameter];
    expect(bodies[1]).toEqual(expected);
  });
  test.each([
    [401, 'Unsupported parameter: top_k'], [429, 'Unsupported parameter: top_k'],
    [503, 'Unsupported parameter: top_k'], [422, 'Invalid value for top_k'],
    [400, 'Unsupported schema in tools: $ref; top_k is 10'],
  ])('does not retry HTTP %s: %s', async (status, message) => {
    let calls = 0;
    const model = createWorkshopModel({ ...config(), topK: 10 }, async () => {
      calls++;
      return Response.json({ error: { message } }, { status: Number(status), headers: { 'Retry-After': '0' } });
    });
    await expect(generateText({ model, tools, prompt: 'test', maxRetries: 0 })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  test('bounds sequential 422 parameter downgrades and stops when no rejected field remains', async () => {
    const api = { ...config(), reasoningEffort: 'low' as const, topK: 10 };
    setRateLimitInterval(1000, bucketKeyForConfig(api));
    const parameters = ['parallel_tool_calls', 'reasoning_effort', 'top_k'];
    let calls = 0;
    const model = createWorkshopModel(api, async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      for (const parameter of parameters.slice(0, calls)) expect(body).not.toHaveProperty(parameter);
      const rejected = parameters[calls++] ?? 'top_k';
      return Response.json({ error: { message: `'${rejected}' is not supported` } }, { status: 422 });
    });
    await expect(generateText({ model, tools, prompt: 'test', maxRetries: 0 })).rejects.toThrow();
    expect(calls).toBe(4);
  });
  test('does not retry an optional parameter after cancellation', async () => {
    const controller = new AbortController();
    let calls = 0;
    const model = createWorkshopModel({ ...config(), topK: 10 }, async () => {
      calls++; controller.abort();
      return Response.json({ error: { message: "Unsupported parameter: 'top_k'" } }, { status: 400 });
    });
    await expect(generateText({ model, prompt: 'test', maxRetries: 0, abortSignal: controller.signal })).rejects.toThrow();
    expect(calls).toBe(1);
  });
  test.each([
    ['Unknown parameter: tools', 'unsupported-tools'],
    ["Unsupported parameter: 'tool_choice'", 'unsupported-tools'],
    ["Unrecognized request argument supplied: tools", 'unsupported-tools'],
    ['Invalid JSON payload. Unknown name "$ref" at request.tools', 'arguments'],
    ['Unsupported schema keyword in tools: $ref', 'arguments'],
    ['tools[0].function.parameters contains unsupported schema', 'arguments'],
    ["Unsupported parameter: 'parallel_tool_calls'", 'arguments'],
  ] as const)('classifies precise capability error: %s', (message, kind) => {
    expect(classifyWorkshopError({ statusCode: 400, message }).kind).toBe(kind);
  });
  test.each([429, 503, 401, 422])('classifies HTTP %s without mistaking a short response for moderation', async status => {
    const model = createWorkshopModel(config(), async () => Response.json({ error: { message: status === 422 ? 'invalid temperature' : 'service unavailable' } }, { status, headers: { 'Retry-After': '0' } }));
    let error: unknown;
    try { await generateText({ model, prompt: 'test', maxRetries: 0 }); } catch (caught) { error = caught; }
    expect(classifyWorkshopError(error).kind).toBe(status === 429 ? 'rate-limit' : status === 422 ? 'arguments' : 'connection');
  });
  test('recognizes an explicit refusal, and a later request can succeed', async () => {
    const failed = createWorkshopModel(config(), async () => completion({ content: null, refusal: 'declined' }));
    let error: unknown;
    try { await generateText({ model: failed, prompt: 'test', maxRetries: 0 }); } catch (caught) { error = caught; }
    expect(classifyWorkshopError(error).kind).toBe('refusal');
    const recovered = createWorkshopModel(config(), async () => completion({ content: '可以继续' }));
    expect((await generateText({ model: recovered, prompt: 'test', maxRetries: 0 })).text).toBe('可以继续');
  });
  test('classifies a connection interruption and aborts queued requests', async () => {
    const model = createWorkshopModel(config(), async () => { throw new TypeError('fetch failed: ECONNRESET'); });
    let error: unknown;
    try { await generateText({ model, prompt: 'test', maxRetries: 0 }); } catch (caught) { error = caught; }
    expect(classifyWorkshopError(error).kind).toBe('connection');
    const controller = new AbortController(); controller.abort();
    await expect(awaitWorkshopRequestSlot(config(), controller.signal)).rejects.toThrow();
  });
});
