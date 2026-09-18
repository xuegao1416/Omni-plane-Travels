import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4GenerateResult, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { runWorkshopAgent, workshopMessagesForModel } from './agent';
import { createWorkshopSession, type WorkshopSession } from './workshopSession';
import { normalizeCustomGameplayModule } from './normalize';
import { classifyWorkshopError } from './agentTransport';

const config = { provider: 'custom' as const, model: 'test', baseUrl: 'http://localhost:12345/v1', apiKey: 'test', stream: false };
const world = { id: 'workshop-agent', name: '世界' };
function response(toolName?: string, input: unknown = {}, toolCallId: string = crypto.randomUUID()): LanguageModelV4GenerateResult {
  return {
    content: toolName ? [{ type: 'tool-call', toolName, toolCallId, input: JSON.stringify(input) }] : [{ type: 'text', text: '完成，草稿已经可以试玩。' }],
    finishReason: { unified: toolName ? 'tool-calls' : 'stop', raw: toolName ? 'tool_calls' : 'stop' },
    usage: { inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 1, text: 1, reasoning: 0 } }, warnings: [],
  };
}
const definition = normalizeCustomGameplayModule({
  kind: 'custom-gameplay-module', schemaVersion: 2, id: 'test-module', name: '模块', author: 'test', version: '1.0.0', scope: 'world',
  inputs: {}, state: { count: { type: 'number', default: 0 } }, logic: { onGameStart: [], onTurnEnd: [], onTick: [], onChoice: [], onButton: [] }, permissions: { read: [], write: 'own-state-only' },
});
if (!definition.ok) throw new Error('fixture invalid');

function harness() {
  let session = createWorkshopSession(world);
  session.messages.push({ id: 'user', role: 'user', parts: [{ type: 'text', text: '做一个计数器' }], status: 'complete', createdAt: 1 });
  return { getSession: () => session, updateSession: async (change: (current: WorkshopSession) => WorkshopSession) => { session = change(session); return session; } };
}

function streamed(value: LanguageModelV4GenerateResult) {
  const chunks: LanguageModelV4StreamPart[] = [{ type: 'stream-start', warnings: [] }];
  for (const part of value.content) {
    if (part.type === 'tool-call') chunks.push(part);
    if (part.type === 'text') chunks.push({ type: 'text-start', id: 'text' }, { type: 'text-delta', id: 'text', delta: part.text }, { type: 'text-end', id: 'text' });
  }
  chunks.push({ type: 'finish', usage: value.usage, finishReason: value.finishReason });
  return { stream: new ReadableStream<LanguageModelV4StreamPart>({ start(controller) { for (const part of chunks) controller.enqueue(part); controller.close(); } }) };
}

describe('native tool workshop agent', () => {
  test('streaming persists complete tool pairs and a valid revision before normal prose', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doStream: [streamed(response('capabilities')), streamed(response('createDraft', { baseRevision: 0, summary: '创建', moduleJson: JSON.stringify(definition.data) })), streamed(response())] });
    await runWorkshopAgent({ ...state, config: { ...config, stream: true }, model, signal: new AbortController().signal, runId: 'stream' });
    expect(state.getSession().currentRevision).toBe(1);
    expect(state.getSession().messages.at(-1)?.parts).toContainEqual({ type: 'text', text: '完成，草稿已经可以试玩。' });
    const parts = state.getSession().messages.flatMap(message => message.parts).filter(part => part.type === 'tool');
    expect(parts).toHaveLength(2);
    expect(parts.every(part => part.status === 'complete' && part.output)).toBe(true);
    expect(model.doStreamCalls).toHaveLength(3);
  });
  test('stops at twelve SDK steps with every completed result retained', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: Array.from({ length: 12 }, () => response('capabilities')) });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'limit' })).rejects.toThrow('12 步');
    expect(model.doGenerateCalls).toHaveLength(12);
    expect(state.getSession().messages.filter(message => message.role === 'assistant')).toHaveLength(12);
  });
  test.each(['length', 'content-filter'] as const)('reports %s while retaining completed draft writes', async finish => {
    const state = harness(); const end = { ...response(), finishReason: { unified: finish, raw: finish } };
    const model = new MockLanguageModelV4({ doGenerate: [response('capabilities'), response('createDraft', { baseRevision: 0, summary: '创建', moduleJson: JSON.stringify(definition.data) }), end] });
    let error: unknown;
    try { await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: finish }); } catch (caught) { error = caught; }
    expect(classifyWorkshopError(error).kind).toBe(finish === 'length' ? 'truncated' : 'refusal');
    expect(state.getSession().currentRevision).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(3);
  });
  test('retains the concrete schema error and stops repeated invalid arguments', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response('capabilities'), response('patchDraft', { baseRevision: 'invalid' }), response('patchDraft', { baseRevision: 'invalid' })] });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'invalid-schema' })).rejects.toThrow('连续两次');
    const errors = state.getSession().messages.flatMap(message => message.parts).filter(part => part.type === 'tool' && part.status === 'failed');
    expect(errors).toHaveLength(2);
    expect(JSON.stringify(errors[0])).toContain('baseRevision');
    expect(state.getSession().currentRevision).toBe(0);
  });
  test('decodes tool JSON arguments but rejects invalid module edits before creating a revision', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response('capabilities'), response('createDraft', { baseRevision: 0, summary: '创建', moduleJson: JSON.stringify(definition.data) }),
      response('patchDraft', { baseRevision: 1, summary: '非法字段', operations: [{ op: 'replace', path: '/state/count/type', valueJson: '"invalid"' }] }),
      response('patchDraft', { baseRevision: 1, summary: '有效改名', operations: [{ op: 'replace', path: '/name', valueJson: '"新模块"' }] }), response()] });
    await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'decoded-validation' });
    expect(state.getSession().revisions.map(revision => revision.module.name)).toEqual(['模块', '新模块']);
    expect(state.getSession().currentRevision).toBe(2);
    const errors = state.getSession().messages.flatMap(message => message.parts).filter(part => part.type === 'tool' && part.status === 'failed');
    expect(errors).toHaveLength(1);
    expect(JSON.stringify(errors)).toContain('state.count');
  });
  test('runs SDK tools and keeps normal prose separate from revision writes', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response('capabilities'), response('createDraft', { baseRevision: 0, summary: '创建', moduleJson: JSON.stringify(definition.data) }), response()] });
    await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'run-1' });
    expect(state.getSession().currentRevision).toBe(1);
    expect(state.getSession().messages.at(-1)?.parts).toContainEqual({ type: 'text', text: '完成，草稿已经可以试玩。' });
    expect(model.doGenerateCalls[0].toolChoice).toMatchObject({ type: 'tool', toolName: 'capabilities' });
    expect(workshopMessagesForModel(state.getSession()).some(message => message.role === 'tool')).toBe(true);
  });
  test('stops two consecutive identical tool failures without a draft replacement', async () => {
    const state = harness();
    const patch = { baseRevision: 0, summary: '错误修改', operations: [{ op: 'replace', path: '/name', valueJson: JSON.stringify('名称') }] };
    const model = new MockLanguageModelV4({ doGenerate: [response('capabilities'), response('patchDraft', patch), response('patchDraft', patch)] });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'fail' })).rejects.toThrow('连续两次');
    expect(model.doGenerateCalls).toHaveLength(3);
    expect(state.getSession().currentRevision).toBe(0);
  });
  test('falls back to plain text operations when a model ignores required tools', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response(), textResponse({ tool: 'createDraft', input: { baseRevision: 0, summary: '创建', module: definition.data } }), textResponse('已创建草稿。')] });
    await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'unsupported' });
    expect(state.getSession().currentRevision).toBe(1);
    expect(model.doGenerateCalls[1].tools).toBeUndefined();
    expect(model.doGenerateCalls[1].prompt.every(message => message.role !== 'tool')).toBe(true);
    expect(state.getSession().messages.at(-1)?.parts).toContainEqual({ type: 'text', text: '已创建草稿。' });
  });
});

function textResponse(value: unknown): LanguageModelV4GenerateResult {
  return { ...response(), content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }] };
}

describe('workshop compatibility recovery', () => {
  test('switches after an explicit tools rejection and executes a fenced operation', async () => {
    const state = harness(); let count = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      if (count++ === 0) throw Object.assign(new Error('tools are not supported'), { statusCode: 400 });
      if (count === 2) return textResponse('```json\n' + JSON.stringify({ tool: 'createDraft', input: { baseRevision: 0, summary: '创建', module: definition.data } }) + '\n```');
      return textResponse('草稿已创建');
    } });
    await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'rejected' });
    expect(state.getSession().currentRevision).toBe(1);
    expect(model.doGenerateCalls).toHaveLength(3);
  });
  test('bounds malformed operation repairs and never creates a partial draft', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response(), textResponse('{"tool":"createDraft"'), textResponse('{"tool":"createDraft"')] });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'malformed' })).rejects.toThrow('格式');
    expect(state.getSession().currentRevision).toBe(0);
    expect(model.doGenerateCalls).toHaveLength(3);
  });
  test('does not execute a complete-looking operation when the response was truncated', async () => {
    const state = harness();
    const truncated = { ...textResponse({ tool: 'createDraft', input: { baseRevision: 0, summary: '创建', module: definition.data } }), finishReason: { unified: 'length' as const, raw: 'length' } };
    const model = new MockLanguageModelV4({ doGenerate: [response(), truncated] });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'text-length' })).rejects.toThrow('长度');
    expect(state.getSession().currentRevision).toBe(0);
  });
  test('does not switch modes for authentication errors', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw Object.assign(new Error('unauthorized'), { statusCode: 401 }); } });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'auth' })).rejects.toThrow('unauthorized');
    expect(model.doGenerateCalls).toHaveLength(1);
  });
  test('accepts a final answer on the twelfth step', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [...Array.from({ length: 11 }, () => response('capabilities')), response()] });
    await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'final-limit' });
    expect(model.doGenerateCalls).toHaveLength(12);
  });
  test('streaming tools rejection switches to non-streaming compatibility requests', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doStream: [streamed(response())], doGenerate: [textResponse('可以先说说希望的玩法。')] });
    await runWorkshopAgent({ ...state, config: { ...config, stream: true }, model, signal: new AbortController().signal, runId: 'stream-fallback' });
    expect(model.doStreamCalls).toHaveLength(1);
    expect(model.doGenerateCalls).toHaveLength(1);
    expect(model.doGenerateCalls[0].tools).toBeUndefined();
    expect(state.getSession().messages.every(message => message.status !== 'running')).toBe(true);
  });
  test('switching after a saved native edit reads its current revision without replay', async () => {
    const state = harness(); let count = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      count += 1;
      if (count === 1) return response('capabilities');
      if (count === 2) return response('createDraft', { baseRevision: 0, summary: '创建', moduleJson: JSON.stringify(definition.data) });
      if (count === 3) throw Object.assign(new Error('tool calling is not supported'), { statusCode: 400 });
      if (count === 4) return textResponse({ tool: 'patchDraft', input: { baseRevision: 1, summary: '改名', operations: [{ op: 'replace', path: '/name', value: '修改后' }] } });
      return textResponse('已修改');
    } });
    await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'resume' });
    expect(state.getSession().revisions.map(revision => revision.module.name)).toEqual(['模块', '修改后']);
    expect(model.doGenerateCalls[3].prompt.every(message => message.role !== 'tool')).toBe(true);
    expect(JSON.stringify(model.doGenerateCalls[3].prompt)).toContain('readDraft');
  });
  test('canonical text operations still reject unsafe patches and stale revisions', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response(),
      textResponse({ tool: 'createDraft', input: { baseRevision: 0, summary: '创建', module: definition.data } }),
      textResponse({ tool: 'patchDraft', input: { baseRevision: 0, summary: '过期', operations: [{ op: 'replace', path: '/name', value: '错误' }] } }),
      textResponse({ tool: 'patchDraft', input: { baseRevision: 1, summary: '非法路径', operations: [{ op: 'add', path: '/__proto__/polluted', value: true }] } }),
      textResponse('修改没有通过校验，保留原草稿。'),
    ] });
    await runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'unsafe' });
    expect(state.getSession().currentRevision).toBe(1);
    expect(state.getSession().messages.flatMap(message => message.parts).filter(part => part.type === 'tool' && part.status === 'failed')).toHaveLength(2);
  });
  test('cancelled compatibility response cannot write a draft or trigger another request', async () => {
    const state = harness(); const controller = new AbortController(); let calls = 0;
    const model = new MockLanguageModelV4({ doGenerate: async () => {
      if (calls++ === 0) return response();
      controller.abort();
      return textResponse({ tool: 'createDraft', input: { baseRevision: 0, summary: '迟到', module: definition.data } });
    } });
    await expect(runWorkshopAgent({ ...state, config, model, signal: controller.signal, runId: 'cancel' })).rejects.toThrow();
    expect(state.getSession().currentRevision).toBe(0);
    expect(calls).toBe(2);
  });
  test('compatibility requests share the twelve-step budget with the native probe', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response(), ...Array.from({ length: 11 }, () => textResponse({ tool: 'readDraft', input: {} }))] });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'text-limit' })).rejects.toThrow('12 步');
    expect(model.doGenerateCalls).toHaveLength(12);
  });
  test('empty native completion is not reported as successful', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response('capabilities'), textResponse('')] });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'empty' })).rejects.toThrow('空内容');
  });
  test('gateways may reuse tool call IDs across separate turns without replaying old results', async () => {
    const state = harness();
    const first = new MockLanguageModelV4({ doGenerate: [response('capabilities', {}, 'call_0'), response('createDraft', { baseRevision: 0, summary: '创建', moduleJson: JSON.stringify(definition.data) }, 'call_1'), response()] });
    await runWorkshopAgent({ ...state, config, model: first, signal: new AbortController().signal, runId: 'first-turn' });
    const second = new MockLanguageModelV4({ doGenerate: [response('capabilities', {}, 'call_0'), response('patchDraft', { baseRevision: 1, summary: '改名', operations: [{ op: 'replace', path: '/name', valueJson: '"下一轮"' }] }, 'call_1'), response()] });
    await runWorkshopAgent({ ...state, config, model: second, signal: new AbortController().signal, runId: 'second-turn' });
    expect(state.getSession().revisions.map(revision => revision.module.name)).toEqual(['模块', '下一轮']);
    const ids = state.getSession().messages.flatMap(message => message.parts).flatMap(part => part.type === 'tool' ? [part.toolCallId] : []);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
