import { generateText, ToolLoopAgent, ToolChoiceViolationError, isStepCount, tool, type LanguageModel, type ModelMessage, type ToolSet, type JSONValue } from 'ai';
import type { ApiConfig } from '../api/types';
import { getRequestTimeoutMs } from '../api/client';
import { isTauri } from '../utils/nativeFetch';
import { classifyWorkshopError, createWorkshopModel, WorkshopAgentError } from './agentTransport';
import { parseWorkshopText, workshopTextInstructions, workshopTextMessages } from './agentTextProtocol';
import { decodeWorkshopToolInput, executeWorkshopTool, workshopToolDescriptions, workshopWireSchemas, type WorkshopToolName } from './workshopTools';
import { currentWorkshopDraft, type WorkshopMessage, type WorkshopSession, type WorkshopToolPart } from './workshopSession';

export interface WorkshopAgentOptions {
  config: ApiConfig; signal: AbortSignal; runId: string;
  getSession: () => WorkshopSession;
  updateSession: (change: (session: WorkshopSession) => WorkshopSession) => Promise<WorkshopSession>;
  /** A model adapter can be injected for deterministic protocol tests. */
  model?: LanguageModel;
}

export function workshopMessagesForModel(session: WorkshopSession): ModelMessage[] {
  const messages: ModelMessage[] = [];
  for (const message of session.messages) {
    if (message.role === 'user') {
      const text = message.parts.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
      if (text) messages.push({ role: 'user', content: text });
      continue;
    }
    const tools = message.parts.filter((part): part is WorkshopToolPart => part.type === 'tool' && part.status !== 'running');
    const text = message.parts.filter(part => part.type === 'text');
    const content = [
      ...text.filter(part => part.text.length > 0),
      ...tools.map(part => ({ type: 'tool-call' as const, toolCallId: part.toolCallId, toolName: part.name, input: part.input })),
    ];
    if (content.length) messages.push({ role: 'assistant', content });
    if (tools.length) messages.push({ role: 'tool', content: tools.map(part => ({
      type: 'tool-result' as const, toolCallId: part.toolCallId, toolName: part.name,
      output: { type: 'json' as const, value: JSON.parse(JSON.stringify(part.output ?? { error: '执行中断' })) as JSONValue },
    })) });
  }
  return messages;
}

function upsertMessage(session: WorkshopSession, message: WorkshopMessage): WorkshopSession {
  return { ...session, messages: session.messages.some(item => item.id === message.id)
    ? session.messages.map(item => item.id === message.id ? message : item) : [...session.messages, message] };
}

export async function runWorkshopAgent(options: WorkshopAgentOptions): Promise<void> {
  const { config, signal, runId, getSession, updateSession } = options;
  signal.throwIfAborted();
  const initial = getSession();
  const messages = workshopMessagesForModel(initial);
  const draft = currentWorkshopDraft(initial);
  let stepNumber = 0;
  let lastFailure = '';
  let consecutiveFailures = 0;
  let stopError: WorkshopAgentError | undefined;
  let stepCount = 0;
  let lastStepHasTools = false;
  const completedSteps = new Set<number>();
  const countedFailures = new Set<string>();
  const callIds = new Map<string, string>();
  const storedCallId = (step: number, id: string) => {
    const key = `${step}:${id}`;
    let scoped = callIds.get(key);
    if (!scoped) { scoped = crypto.randomUUID(); callIds.set(key, scoped); }
    return scoped;
  };
  const stepId = (step: number) => `${runId}:step:${step}`;
  const ensureMessage = (session: WorkshopSession, step: number): WorkshopMessage => session.messages.find(item => item.id === stepId(step)) ?? {
    id: stepId(step), role: 'assistant', parts: [], status: 'running', createdAt: Date.now(),
  };
  const recordFailure = (callId: string, name: string, error: string) => {
    if (countedFailures.has(callId)) return;
    countedFailures.add(callId);
    const key = `${name}:${error}`;
    consecutiveFailures = key === lastFailure ? consecutiveFailures + 1 : 1;
    lastFailure = key;
    if (consecutiveFailures >= 2) stopError = new WorkshopAgentError('arguments', '连续两次出现相同工具错误，已停止本轮执行。请查看工具结果后调整要求或重试。');
  };

  const tracked = async (name: WorkshopToolName, input: unknown, rawCallId: string, wireInput = true) => {
    signal.throwIfAborted();
    const step = stepNumber;
    // Some gateways restart IDs at call_0 for every response. Scope persisted
    // IDs per step/run, keeping same-step retries idempotent and IDs portable.
    const callId = storedCallId(step, rawCallId);
    const previous = getSession().messages.flatMap(item => item.parts).find((part): part is WorkshopToolPart => part.type === 'tool' && part.toolCallId === callId);
    if (previous && previous.status !== 'running') {
      if (previous.name !== name || JSON.stringify(previous.input) !== JSON.stringify(input)) throw new WorkshopAgentError('arguments', '工具调用标识重复且参数不同');
      return previous.output;
    }
    await updateSession(session => {
      const message = ensureMessage(session, step);
      if (message.parts.some(part => part.type === 'tool' && part.toolCallId === callId)) return session;
      return upsertMessage(session, { ...message, parts: [...message.parts, { type: 'tool', toolCallId: callId, name, input, status: 'running' }] });
    });
    let output: Record<string, unknown> = {};
    await updateSession(session => {
      signal.throwIfAborted();
      let next = session;
      let status: WorkshopToolPart['status'] = 'complete';
      try {
        if (stopError) throw stopError;
        const result = executeWorkshopTool(session, name, wireInput ? decodeWorkshopToolInput(name, input) : input, `${runId}:${callId}`);
        next = result.session; output = result.output;
        consecutiveFailures = 0; lastFailure = '';
      } catch (error) {
        if (signal.aborted) throw error;
        const message = error instanceof Error ? error.message : String(error);
        output = { error: message }; status = 'failed'; recordFailure(callId, name, message);
      }
      const message = ensureMessage(next, step);
      return upsertMessage(next, { ...message, parts: message.parts.map(part => part.type === 'tool' && part.toolCallId === callId
        ? { ...part, output, status } : part) });
    });
    return output;
  };

  const instructions = [
    '你是玩法模块工坊助手，通过真实工具帮助用户设计、制作、修订和试玩声明式游戏模块。',
    '用自然语言与用户交流，不伪造工具结果或声称已经保存/发布。目标不清时简洁追问；明确时直接制作。',
    '先查询 capabilities。创建使用 createDraft；已有模块先 readDraft，再以基础版本号 patchDraft 做局部修改。修改后使用 validateDraft 与 simulate 验证，并说明实际结果。',
    '错误工具结果是修正依据，不能假装成功。保存、绑定世界、应用实际存档和发布由用户界面完成。',
    '仅使用声明的能力、模块自身状态和现有界面组件，不执行 JavaScript、系统命令或任意宿主变量写入。',
    '对话删除与模块版本独立：当前有效草稿始终由 readDraft 返回。',
    `世界：${JSON.stringify(initial.world)}。当前草稿：${draft ? `${draft.name} (${draft.id}), revision ${initial.currentRevision}` : '无'}。`,
  ].join('\n');

  const runTextFallback = async () => {
    signal.throwIfAborted();
    stopError = undefined;
    // Keep completed native calls. Only an unfinished probe is replaced by the
    // mode notice, so switching transports cannot replay an already saved edit.
    await updateSession(session => {
      const message = ensureMessage(session, stepNumber);
      return upsertMessage(session, { ...message, status: 'complete', parts: [
        { type: 'text', text: '已切换到普通文本兼容模式，操作仍会经过本地校验。正在继续创作…' },
        ...message.parts.filter(part => part.type === 'tool'),
      ] });
    });
    stepNumber += 1;
    await tracked('capabilities', {}, `${runId}:text:capabilities`, false);
    await tracked('readDraft', {}, `${runId}:text:readDraft`, false);
    await updateSession(session => upsertMessage(session, { ...ensureMessage(session, stepNumber), status: 'complete' }));
    const model = options.model ?? createWorkshopModel(config, undefined, { textOnly: true });
    let formatFailures = 0;
    let repair: ModelMessage[] = [];
    while (stepCount < 12) {
      signal.throwIfAborted();
      stepNumber += 1;
      stepCount += 1;
      await updateSession(session => upsertMessage(session, ensureMessage(session, stepNumber)));
      const result = await generateText({
        model, system: `${instructions}\n${workshopTextInstructions}`,
        messages: [...workshopTextMessages(getSession()), ...repair],
        abortSignal: signal, timeout: getRequestTimeoutMs(config), maxRetries: 2,
        temperature: config.temperature ?? 0.4, topP: config.topP,
        maxOutputTokens: Math.min(config.maxTokens ?? 12000, 16000),
      });
      signal.throwIfAborted();
      // Do not execute even a syntactically complete operation from a cut-off response.
      if (result.finishReason === 'length') throw new WorkshopAgentError('truncated', '模型输出达到长度上限，本轮操作未执行。已通过校验的版本仍然保留。');
      if (result.finishReason === 'content-filter') throw new WorkshopAgentError('refusal', '模型服务明确拒绝了本次请求；已完成的草稿修改仍然保留。');
      let parsed: ReturnType<typeof parseWorkshopText>;
      try { parsed = parseWorkshopText(result.text); }
      catch (error) {
        formatFailures += 1;
        const detail = error instanceof Error ? error.message.slice(0, 1000) : String(error);
        await updateSession(session => upsertMessage(session, { ...ensureMessage(session, stepNumber), status: 'failed',
          parts: [{ type: 'text', text: '模型操作格式无效，未执行任何修改。' }] }));
        if (formatFailures >= 2) throw new WorkshopAgentError('arguments', '模型连续两次返回无效操作格式，已停止。草稿仍然保留，可调整要求后继续。');
        repair = [
          { role: 'assistant', content: result.text.slice(0, 8000) || '（空回复）' },
          { role: 'user', content: `系统格式校验失败：${detail}。请修正为单个 {"tool":"工具名称","input":{参数}} 对象；未执行任何操作。` },
        ];
        continue;
      }
      formatFailures = 0; repair = [];
      if ('reply' in parsed) {
        await updateSession(session => upsertMessage(session, { ...ensureMessage(session, stepNumber), status: 'complete', parts: [{ type: 'text', text: parsed.reply }] }));
        return;
      }
      await tracked(parsed.tool, parsed.input, `${runId}:text:${stepNumber}`, false);
      await updateSession(session => upsertMessage(session, { ...ensureMessage(session, stepNumber), status: 'complete' }));
      if (stopError) throw stopError;
    }
    throw new WorkshopAgentError('execution', '本轮已达到 12 步上限。有效草稿和工具结果已保留，可以继续说明下一步要求。');
  };

  const tools = Object.fromEntries((Object.keys(workshopWireSchemas) as WorkshopToolName[]).map(name => [name, tool<unknown, unknown, {}>({
    description: workshopToolDescriptions[name], inputSchema: workshopWireSchemas[name],
    execute: (input, { toolCallId }) => tracked(name, input, toolCallId),
  })])) as ToolSet;
  const streaming = config.stream !== false && !isTauri();
  const agent = new ToolLoopAgent({
    id: 'module-workshop', model: options.model ?? createWorkshopModel(config), tools,
    instructions,
    temperature: config.temperature ?? 0.4, topP: config.topP,
    maxOutputTokens: Math.min(config.maxTokens ?? 12000, 16000), maxRetries: 2,
    stopWhen: [isStepCount(12), () => Boolean(stopError)],
    prepareStep: ({ stepNumber: step }) => step === 0 ? { activeTools: ['capabilities'], toolChoice: { type: 'tool', toolName: 'capabilities' } } : {},
    onStepStart: async event => {
      signal.throwIfAborted(); stepNumber = event.stepNumber;
      stepCount = Math.max(stepCount, event.stepNumber + 1);
      await updateSession(session => upsertMessage(session, ensureMessage(session, event.stepNumber)));
    },
    onStepEnd: async event => {
      signal.throwIfAborted();
      stepCount = Math.max(stepCount, event.stepNumber + 1);
      lastStepHasTools = event.toolCalls.length > 0;
      completedSteps.add(event.stepNumber);
      await updateSession(session => {
        let message = ensureMessage(session, event.stepNumber);
        const existingTools = message.parts.filter((part): part is WorkshopToolPart => part.type === 'tool');
        for (const call of event.toolCalls) {
          const callId = storedCallId(event.stepNumber, call.toolCallId);
          if (existingTools.some(part => part.toolCallId === callId)) continue;
          const result = event.toolResults.find(result => result.toolCallId === call.toolCallId);
          const failure = event.content.find(part => part.type === 'tool-error' && part.toolCallId === call.toolCallId);
          const cause = failure?.type === 'tool-error' ? failure.error : undefined;
          const error = cause instanceof Error ? cause.message : cause ? String(cause) : '工具参数未通过校验或执行未完成';
          existingTools.push({ type: 'tool', toolCallId: callId, name: call.toolName, input: call.input, status: result ? 'complete' : 'failed', output: result?.output ?? { error } });
          if (!result) recordFailure(callId, call.toolName, error);
        }
        message = { ...message, status: 'complete', parts: [...(event.text ? [{ type: 'text' as const, text: event.text }] : []), ...existingTools] };
        return upsertMessage(session, message);
      });
      if (event.finishReason === 'content-filter') stopError = new WorkshopAgentError('refusal', '模型服务明确拒绝了本次请求；已完成的草稿修改仍然保留。');
      else if (event.finishReason === 'length') stopError = new WorkshopAgentError('truncated', '模型输出达到长度上限，本轮未完成。已通过校验的版本仍然保留。');
      else if (event.stepNumber === 0 && !event.toolCalls.some(call => call.toolName === 'capabilities')) stopError = new WorkshopAgentError('unsupported-tools', '当前模型没有按接口要求调用工具，请更换支持标准工具调用的模型。');
      else if (!event.toolCalls.length && !event.text.trim()) stopError = new WorkshopAgentError('arguments', '模型返回了空内容，本轮未完成。请重试；已完成的草稿修改仍然保留。');
    },
  });
  try {
  if (streaming) {
    const result = await agent.stream({ messages, abortSignal: signal, timeout: { stepMs: getRequestTimeoutMs(config) } });
    let streamStep = -1;
    let text = '';
    let lastWrite = 0;
    for await (const part of result.fullStream) {
      signal.throwIfAborted();
      if (part.type === 'error') throw part.error;
      if (part.type === 'abort') {
        signal.throwIfAborted();
        if (part.reason && /timeout|timed out/i.test(part.reason)) throw new WorkshopAgentError('connection', '模型请求超时，已完成的步骤仍然保留。');
        throw new DOMException('执行已停止', 'AbortError');
      }
      if (part.type === 'start-step') { streamStep += 1; text = ''; lastWrite = 0; }
      if (part.type === 'text-delta') {
        text += part.text;
        if (!completedSteps.has(streamStep) && Date.now() - lastWrite > 100) {
          lastWrite = Date.now();
          const step = streamStep; const snapshot = text;
          await updateSession(session => {
            if (completedSteps.has(step)) return session;
            const message = ensureMessage(session, step);
            return upsertMessage(session, { ...message, parts: [{ type: 'text', text: snapshot }, ...message.parts.filter(item => item.type !== 'text')] });
          });
        }
      }
    }
  } else {
    await agent.generate({ messages, abortSignal: signal, timeout: { stepMs: getRequestTimeoutMs(config) } });
  }
  } catch (error) {
    signal.throwIfAborted();
    if (ToolChoiceViolationError.isInstance(error)) {
      const text = error.content.flatMap(part => part.type === 'text' ? [part.text] : []).join('\n');
      if (text && !signal.aborted) await updateSession(session => {
        const message = ensureMessage(session, stepNumber);
        return upsertMessage(session, { ...message, status: 'failed', parts: [{ type: 'text', text }, ...message.parts.filter(part => part.type !== 'text')] });
      });
      if (error.finishReason === 'content-filter') throw new WorkshopAgentError('refusal', '模型服务明确拒绝了本次请求。');
      if (error.finishReason === 'length') throw new WorkshopAgentError('truncated', '模型输出达到长度上限，工具调用未完成。');
      await runTextFallback();
      return;
    }
    if (classifyWorkshopError(error).kind === 'unsupported-tools') { await runTextFallback(); return; }
    throw error;
  }
  signal.throwIfAborted();
  if (stopError?.kind === 'unsupported-tools') { await runTextFallback(); return; }
  if (stopError) throw stopError;
  if (stepCount >= 12 && lastStepHasTools) throw new WorkshopAgentError('execution', '本轮已达到 12 步上限。有效草稿和工具结果已保留，可以继续说明下一步要求。');
}
