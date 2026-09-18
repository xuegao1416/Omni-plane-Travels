import { afterAll, describe, expect, test } from 'bun:test';
import { generateText } from 'ai';
import { createWorkshopModel, classifyWorkshopError, awaitWorkshopRequestSlot } from './agentTransport';
import { executeWorkshopTool, workshopWireSchemas } from './workshopTools';
import { createWorkshopSession } from './workshopSession';
import { z } from 'zod';

const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
afterAll(() => { if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else Reflect.deleteProperty(globalThis, 'localStorage'); });
const config = () => ({ provider: 'custom' as const, baseUrl: `https://test-${crypto.randomUUID()}.invalid/v1`, model: 'test', apiKey: 'test-key', stream: false });
const completion = (message: Record<string, unknown>) => Response.json({ id: 'test', object: 'chat.completion', created: 1, model: 'test', choices: [{ index: 0, message: { role: 'assistant', ...message }, finish_reason: 'stop' }] });

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
      expect(await request.json()).toMatchObject({ model: 'test', parallel_tool_calls: false });
      return completion({ content: '好' });
    });
    expect((await generateText({ model, prompt: '你好', maxRetries: 0 })).text).toBe('好');
    expect(called).toBe(true);
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
