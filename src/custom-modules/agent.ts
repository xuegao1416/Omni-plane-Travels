import { requestStreamWithRetry } from '../api/client';
import type { ApiConfig, CompletionResult, Message, StreamOptions } from '../api/types';
import {
  applyCustomModuleAgentTurn,
  createCustomModuleAgentSession,
  createEmptyCustomModuleDesignBrief,
  type CustomModuleAgentEnvelope,
  type CustomModuleAgentPhase,
  type CustomModuleAgentSession,
  type CustomModuleAgentWorldContext,
  type CustomModuleConversationMessage,
} from './agentSession';
import { buildCustomModuleCapabilityCatalog } from './capabilities';
import type { CustomGameplayModuleDefinition, ModuleValidationIssue } from './schema';
import { validateCustomGameplayModule } from './validator';

export type { CustomModuleAgentWorldContext } from './agentSession';
export type { CustomModuleAgentEnvelope, CustomModuleAgentPhase, CustomModuleAgentSession } from './agentSession';

export type CustomModuleDraftResult = {
  ok: true;
  module: CustomGameplayModuleDefinition;
  raw: string;
} | {
  ok: false;
  errors: ModuleValidationIssue[];
  raw: string;
};

export type CustomModuleAgentTurnResult = {
  ok: true;
  message: string;
  phase: CustomModuleAgentPhase;
  /** V1 compatibility status retained for existing consumers. */
  status: 'needs_input' | 'draft_ready';
  brief: ReturnType<typeof createEmptyCustomModuleDesignBrief>;
  question?: CustomModuleAgentEnvelope['question'];
  module?: CustomGameplayModuleDefinition;
  raw: string;
  session?: CustomModuleAgentSession;
} | {
  ok: false;
  errors: ModuleValidationIssue[];
  raw: string;
  session?: CustomModuleAgentSession;
};

export type { CustomModuleConversationMessage } from './agentSession';

function errorIssue(message: string, code = 'invalid-agent-output'): ModuleValidationIssue {
  return { path: [], code, severity: 'error', message };
}

/** Extracts the first balanced JSON object without executing or evaluating it. */
export function extractCustomModuleJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* continue with fenced/prose output */ }
  for (let start = 0; start < trimmed.length; start += 1) {
    if (trimmed[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index += 1) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{') depth += 1;
      if (char === '}') depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(trimmed.slice(start, index + 1)); } catch { break; }
      }
    }
  }
  throw new Error('没有找到可解析的 JSON 对象');
}

export function parseCustomModuleDraft(raw: string): CustomModuleDraftResult {
  try {
    const extracted = extractCustomModuleJson(raw);
    const value = extracted && typeof extracted === 'object' && !Array.isArray(extracted)
      ? extracted as Record<string, unknown>
      : undefined;
    // Accept a direct module (the compiler contract) and tolerate providers
    // that wrap it in a JSON envelope despite being told not to.
    const candidate = value?.kind === 'custom-gameplay-module' ? value : value?.module ?? extracted;
    const result = validateCustomGameplayModule(candidate);
    if (!result.valid || !result.normalized) return { ok: false, errors: result.errors, raw };
    return { ok: true, module: result.normalized, raw };
  } catch (error) {
    return { ok: false, errors: [errorIssue(error instanceof Error ? error.message : String(error), 'invalid-json')], raw };
  }
}

function phaseFromRaw(value: Record<string, unknown>): CustomModuleAgentPhase | undefined {
  if (typeof value.phase === 'string' && ['discovery', 'designing', 'draft_ready', 'revising'].includes(value.phase)) return value.phase as CustomModuleAgentPhase;
  if (value.status === 'needs_input') return 'designing';
  if (value.status === 'draft_ready') return 'draft_ready';
  return undefined;
}

function asBrief(value: unknown) {
  const source = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const strings = (key: string): string[] => Array.isArray(source[key]) ? source[key].filter((item): item is string => typeof item === 'string') : [];
  return {
    goal: typeof source.goal === 'string' ? source.goal : '',
    presentation: typeof source.presentation === 'string' ? source.presentation : '',
    triggers: strings('triggers'), inputs: strings('inputs'), state: strings('state'),
    behavior: strings('behavior'), outputs: strings('outputs'), assumptions: strings('assumptions'), unresolved: strings('unresolved'),
  };
}

export function parseCustomModuleAgentTurn(raw: string): CustomModuleAgentTurnResult {
  try {
    const parsed = extractCustomModuleJson(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, errors: [errorIssue('Agent 输出必须是 JSON 对象')], raw };
    const value = parsed as Record<string, unknown>;

    // Accept old direct module JSON during the migration window, but new calls use the envelope below.
    if (value.kind === 'custom-gameplay-module') {
      const draft = parseCustomModuleDraft(raw);
      if (!draft.ok) return draft;
      return {
        ok: true, message: '我已经整理好了模块草案。', phase: 'draft_ready', status: 'draft_ready',
        brief: createEmptyCustomModuleDesignBrief(), module: draft.module, raw,
      };
    }

    if (typeof value.message !== 'string' || !value.message.trim() || value.message.length > 2000) {
      return { ok: false, errors: [errorIssue('Agent envelope 缺少有效的 message', 'invalid-agent-envelope')], raw };
    }
    const phase = phaseFromRaw(value);
    if (!phase) return { ok: false, errors: [errorIssue('Agent envelope 的 phase 必须是 discovery、designing、draft_ready 或 revising', 'invalid-agent-envelope')], raw };
    const brief = asBrief(value.brief);
    let question: CustomModuleAgentEnvelope['question'];
    if (value.question !== undefined && value.question !== null) {
      if (!value.question || typeof value.question !== 'object' || Array.isArray(value.question)) {
        return { ok: false, errors: [errorIssue('question 必须是包含 id 和 text 的对象', 'invalid-agent-envelope')], raw };
      }
      const rawQuestion = value.question as Record<string, unknown>;
      if (typeof rawQuestion.id !== 'string' || !rawQuestion.id.trim()
        || typeof rawQuestion.text !== 'string' || !rawQuestion.text.trim()
        || (rawQuestion.choices !== undefined
          && (!Array.isArray(rawQuestion.choices) || !rawQuestion.choices.every((choice) => typeof choice === 'string')))) {
        return { ok: false, errors: [errorIssue('question 必须包含有效 id、text 和可选字符串 choices', 'invalid-agent-envelope')], raw };
      }
      question = {
        id: rawQuestion.id.trim(),
        text: rawQuestion.text.trim(),
        ...(Array.isArray(rawQuestion.choices)
          ? { choices: [...new Set(rawQuestion.choices.map((choice) => choice.trim()).filter(Boolean))] }
          : {}),
      };
    }
    const moduleValue = value.module;
    if (moduleValue === null || moduleValue === undefined) {
      return { ok: true, message: value.message.trim(), phase, status: 'needs_input', brief, question, raw };
    }
    const draft = validateCustomGameplayModule(moduleValue);
    if (!draft.valid || !draft.normalized) return { ok: false, errors: draft.errors, raw };
    return { ok: true, message: value.message.trim(), phase, status: 'draft_ready', brief, question, module: draft.normalized, raw };
  } catch (error) {
    return { ok: false, errors: [errorIssue(error instanceof Error ? error.message : String(error), 'invalid-json')], raw };
  }
}

export function buildCustomModuleAgentSystemPrompt(world?: CustomModuleAgentWorldContext): string {
  const context = world ?? { id: 'unknown', name: '当前世界' };
  const catalog = buildCustomModuleCapabilityCatalog(context);
  return `你是 Omni Plane Travels 的自定义玩法模块共创 Agent。本阶段只负责通过对话收敛需求，不负责手写模块代码。\n
只输出一个 JSON envelope，结构为：
{"message":"给玩家的自然语言回复","phase":"discovery|designing|draft_ready|revising","brief":{"goal":"","presentation":"","triggers":[],"inputs":[],"state":[],"behavior":[],"outputs":[],"assumptions":[],"unresolved":[]},"question":null,"module":null}

硬性规则：
1. module 始终为 null；宿主会在需求闭合后调用独立编译器。
2. brief 九个字段每轮都返回当前完整结论，不是只返回增量。
3. 每轮最多追问一个真正影响实现的问题；需要追问时 question={"id":"ASCII_ID","text":"问题","choices":["可选项"]}，不需要时写 null。
4. unresolved 为空且实现方向明确时 phase=draft_ready；正在修改已有草案且信息足够时 phase=revising；否则使用 discovery/designing。
5. 玩家说“你看着办”时自行作出合理选择，写入 assumptions，不要继续追问无关细节。
6. 不输出 Markdown、代码围栏、解释文字或第二个 JSON。

当前世界：${context.name}（${context.id}）。可用能力目录如下；用它判断需求是否可实现，不要在对话阶段生成目录外能力：
${JSON.stringify(catalog)}`;
}

export function buildCustomModuleCompilerSystemPrompt(world?: CustomModuleAgentWorldContext): string {
  const context = world ?? { id: 'unknown', name: '当前世界' };
  const catalog = buildCustomModuleCapabilityCatalog(context);
  return `你是 Omni Plane Travels 的声明式玩法模块编译器。只输出一个完整 V2 模块 JSON 对象，不输出 envelope、Markdown、代码围栏或解释。\n
【固定顶层】
kind="custom-gameplay-module"；schemaVersion=2；scope="world"；version 使用 x.y.z；author 非空；id 必须匹配 ^[a-z0-9][a-z0-9_:-]{2,63}$。除 name/description 的显示文字外，id、state 字段名、input 别名、button event 必须使用 ASCII 标识符。所有对象都禁止额外字段。

【最小合法骨架】
{"kind":"custom-gameplay-module","schemaVersion":2,"id":"module-id","name":"模块名","version":"1.0.0","author":"agent","description":"说明","scope":"world","state":{"counter":{"type":"number","default":0,"min":0}},"inputs":{},"logic":{"onGameStart":[],"onTurnEnd":[],"onTick":[],"onChoice":[],"onButton":[]},"view":{"slot":"right-panel","title":"模块名","components":[{"type":"number","label":"计数","path":"counter"}]},"permissions":{"read":[],"write":"own-state-only"}}

【state 字段精确形状】
number={"type":"number","default":0,"min":0,"max":100}；string={"type":"string","default":"","maxLength":200}；boolean={"type":"boolean","default":false}；enum={"type":"enum","values":["a","b"],"default":"a"}。array 必须同时给出 type/items/default/maxItems/maxDepth/maxSize；object 必须同时给出 type/fields/default/maxProperties/maxDepth/maxSize。不要添加 label、value、initial 等未定义字段。

【inputs 与权限】
inputs 只能是 {"ASCII别名":"能力目录中的宿主路径"}；permissions.read 必须恰好列出 inputs 实际使用的每条宿主路径。逻辑中 source="input" 时 path 写 input 别名，不写宿主路径。无输入时两者都用空对象/空数组。

【规则】
五个 lifecycle 必须全部存在且值为数组。每条规则只能是 {"when":可选条件,"actions":[至少一个动作]}。禁止旧式 action/path/value 平铺规则。
条件优先使用 {"type":"compare","source":"state|input|event","path":"路径或别名","operator":"eq|neq|gt|gte|lt|lte|in|contains","value":字面量或引用}；引用固定为 {"type":"ref","source":"state|input|event","path":"路径"}。
动作只能是 set/add/subtract/toggle/append/remove/log：set/add/subtract/append/remove 使用 path 指向自身 state；toggle 只有 type/path；log 只有 type/message/可选 level。add/subtract 目标必须是 number，toggle 目标必须是 boolean，append/remove 目标必须是 array。

【视图】
slot 只能 left-panel/right-panel。组件只能 section/card/text/number/progress/badge/list/table/divider/conditional/button。number/progress 绑定 number；list/table 绑定 array；button={"type":"button","label":"文字","event":"ASCII_EVENT"}，对应行为写在 onButton 并读取 event.button.event。没有展示需求时可省略 view。

【安全边界】
只能写自身 state；禁止 code、script、eval、import、网络、文件、Tauri 和任意代码执行；不要声明不存在的依赖或能力。当前世界：${context.name}（${context.id}）。运行时能力目录：
${JSON.stringify(catalog)}`;
}

export type CustomModuleAgentRequest = (config: ApiConfig, messages: Message[], options: StreamOptions) => Promise<CompletionResult>;

export function buildCustomModuleAgentRepairPrompt(raw: string, errors: ModuleValidationIssue[], session?: CustomModuleAgentSession): string {
  const issueText = errors.slice(0, 24).map((entry) => `${entry.path.join('.') || '(root)'}: ${entry.message}`).join('\n');
  const snapshot = session ? { ...session, conversation: undefined } : undefined;
  return `上一轮对话 envelope 未通过校验。只修复以下错误并返回一个完整 JSON envelope；module 仍须为 null。\n校验错误：\n${issueText || '(invalid envelope)'}\n当前结构化会话：\n${snapshot ? JSON.stringify(snapshot) : '(无)'}\n上一轮输出：\n${raw.slice(0, 12000)}`;
}

export function buildCustomModuleCompilerRepairPrompt(raw: string, errors: ModuleValidationIssue[]): string {
  const issueText = errors.slice(0, 32).map((entry) => `${entry.path.join('.') || '(root)'}: ${entry.message}`).join('\n');
  return `上一版模块未通过本地 V2 校验。根据精确路径只修复这些错误，保留其余设计，并重新输出一个完整模块 JSON 对象。不要输出 envelope 或解释。\n校验错误：\n${issueText || '(invalid module)'}\n上一版模块：\n${raw.slice(0, 16000)}`;
}

export function buildCustomModuleAgentUserPrompt(request: string, world: CustomModuleAgentWorldContext): string {
  return `当前世界：${world.name}（${world.id}）\n世界简介：${world.description || '暂无'}\n\n玩家最新消息：\n${request.trim()}\n\n只追问一个真正影响实现的问题；信息足够时将 unresolved 清空并进入 draft_ready，module 保持 null。`;
}

function sessionPrompt(session: CustomModuleAgentSession, newestMessage: string, recentConversation: CustomModuleConversationMessage[]): string {
  const { conversation: _conversation, ...structuredSession } = session;
  return `当前结构化会话：\n${JSON.stringify(structuredSession)}\n\n玩家最新消息：\n${newestMessage.trim()}\n\n仅保留这些最近对话用于语气参考：\n${JSON.stringify(recentConversation.slice(-8))}`;
}

export async function generateCustomModuleDraft(
  apiConfig: ApiConfig,
  request: string,
  world: CustomModuleAgentWorldContext,
  options: { signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<CustomModuleDraftResult> {
  const response = await requestStreamWithRetry(apiConfig, [
    { role: 'system', content: buildCustomModuleCompilerSystemPrompt(world) },
    { role: 'user', content: `玩家需求：\n${request.trim()}\n\n直接编译为一个完整 V2 模块 JSON。` },
  ], {
    signal: options.signal, maxTokens: 12000, responseFormat: 'json',
    onDelta: () => options.onText?.('正在整理模块设计……'),
  });
  return parseCustomModuleDraft(response.text);
}

function compilerPrompt(session: CustomModuleAgentSession, newestMessage: string): string {
  const previousDraft = session.lastValidDraft ?? session.draft;
  return `已确认的设计 brief：\n${JSON.stringify(session.brief)}\n\n玩家最新要求：\n${newestMessage.trim()}\n\n${previousDraft
    ? `当前有效模块（本轮必须返回包含修改的完整替代版本，未提及部分保持不变）：\n${JSON.stringify(previousDraft)}`
    : '当前没有旧模块，请根据 brief 生成最小且完整的第一版。'}\n\n只输出模块 JSON 对象。`;
}

type AgentRunOptions = {
  signal?: AbortSignal;
  onText?: (text: string) => void;
  onStatus?: (status: string) => void;
  request?: CustomModuleAgentRequest;
  conversation?: CustomModuleConversationMessage[];
};

export async function runCustomModuleAgentTurn(
  apiConfig: ApiConfig,
  sessionOrWorld: CustomModuleAgentSession | CustomModuleAgentWorldContext,
  newestMessageOrConversation: string | CustomModuleConversationMessage[],
  options: AgentRunOptions = {},
): Promise<CustomModuleAgentTurnResult> {
  const isSession = 'sessionVersion' in sessionOrWorld;
  const session = isSession
    ? sessionOrWorld as CustomModuleAgentSession
    : createCustomModuleAgentSession(sessionOrWorld as CustomModuleAgentWorldContext);
  const conversation = Array.isArray(newestMessageOrConversation)
    ? newestMessageOrConversation
    : options.conversation ?? [];
  const newestMessage = typeof newestMessageOrConversation === 'string'
    ? newestMessageOrConversation
    : conversation.filter((item) => item.role === 'user').at(-1)?.content ?? '';
  const request = options.request ?? requestStreamWithRetry;
  let messages: Message[] = [
    { role: 'system', content: buildCustomModuleAgentSystemPrompt(session.world) },
    { role: 'user', content: isSession ? sessionPrompt(session, newestMessage, conversation) : buildCustomModuleAgentUserPrompt(newestMessage, session.world) },
  ];
  let plannedResult: Extract<CustomModuleAgentTurnResult, { ok: true }> | undefined;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    options.onStatus?.(attempt === 0 ? '正在分析需求……' : '正在修复对话结构……');
    const response = await request(apiConfig, messages, {
      signal: options.signal, maxTokens: 6000, responseFormat: 'json',
      // Never expose the partial JSON stream to the player.
      onDelta: () => options.onText?.(attempt === 0 ? '正在理解你的需求……' : '正在修复对话结构……'),
    });
    const parsed = parseCustomModuleAgentTurn(response.text);
    if (parsed.ok) {
      plannedResult = parsed;
      break;
    }
    if (attempt === 1) return { ...parsed, session };
    messages = [
      ...messages,
      { role: 'assistant', content: response.text },
      { role: 'user', content: buildCustomModuleAgentRepairPrompt(response.text, parsed.errors, session) },
    ];
  }
  if (!plannedResult) return { ok: false, errors: [errorIssue('custom module agent retry exhausted')], raw: '', session };

  const planningEnvelope: CustomModuleAgentEnvelope = {
    message: plannedResult.message,
    phase: plannedResult.phase,
    brief: plannedResult.brief,
    question: plannedResult.question,
    module: plannedResult.module ?? null,
  };
  const planned = applyCustomModuleAgentTurn(session, planningEnvelope).session;

  // Migration compatibility: older providers may still return a complete,
  // already-valid module in the conversational envelope.
  if (plannedResult.module) return { ...plannedResult, session: planned };

  const compileRequested = (plannedResult.phase === 'draft_ready' || plannedResult.phase === 'revising')
    && planned.brief.unresolved.length === 0;
  if (!compileRequested) {
    const phase = plannedResult.phase === 'draft_ready' ? 'designing' : plannedResult.phase;
    return {
      ...plannedResult,
      phase,
      status: 'needs_input',
      session: phase === planned.phase ? planned : { ...planned, phase },
    };
  }

  let compilerMessages: Message[] = [
    { role: 'system', content: buildCustomModuleCompilerSystemPrompt(planned.world) },
    { role: 'user', content: compilerPrompt(planned, newestMessage) },
  ];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    options.onStatus?.(attempt === 0 ? '需求已确认，正在编译模块……' : '正在按校验结果修复模块……');
    const response = await request(apiConfig, compilerMessages, {
      signal: options.signal, maxTokens: 12000, responseFormat: 'json',
      onDelta: () => options.onText?.(attempt === 0 ? '正在编译设计蓝图……' : '正在修复设计蓝图……'),
    });
    const draft = parseCustomModuleDraft(response.text);
    if (draft.ok) {
      const applied = applyCustomModuleAgentTurn(planned, {
        message: plannedResult.message,
        phase: 'draft_ready',
        brief: planned.brief,
        module: draft.module,
      });
      return {
        ok: true,
        message: plannedResult.message,
        phase: 'draft_ready',
        status: 'draft_ready',
        brief: applied.session.brief,
        module: draft.module,
        raw: response.text,
        session: applied.session,
      };
    }
    if (attempt === 1) return { ...draft, session: planned };
    compilerMessages = [
      ...compilerMessages,
      { role: 'assistant', content: response.text },
      { role: 'user', content: buildCustomModuleCompilerRepairPrompt(response.text, draft.errors) },
    ];
  }
  return { ok: false, errors: [errorIssue('custom module compiler retry exhausted')], raw: '', session: planned };
}
