import { describe, expect, test } from 'bun:test';
import { MockLanguageModelV4 } from 'ai/test';
import type { LanguageModelV4GenerateResult, LanguageModelV4StreamPart } from '@ai-sdk/provider';
import { runWorkshopAgent, workshopMessagesForModel } from './agent';
import { createWorkshopSession, type WorkshopSession } from './workshopSession';
import { normalizeCustomGameplayModule } from './normalize';
import { classifyWorkshopError } from './agentTransport';

const config = { provider: 'custom' as const, model: 'test', baseUrl: 'http://localhost:12345/v1', apiKey: 'test', stream: false };
const world = { id: 'workshop-agent', name: '世界' };
function response(toolName?: string, input: unknown = {}, toolCallId = crypto.randomUUID()): LanguageModelV4GenerateResult {
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
  test('rejects a model that ignores required tools and retains its natural answer', async () => {
    const state = harness();
    const model = new MockLanguageModelV4({ doGenerate: [response()] });
    await expect(runWorkshopAgent({ ...state, config, model, signal: new AbortController().signal, runId: 'unsupported' })).rejects.toThrow('工具调用');
    expect(state.getSession().messages.at(-1)?.parts).toContainEqual({ type: 'text', text: '完成，草稿已经可以试玩。' });
  });
});
