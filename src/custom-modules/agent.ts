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
    const result = validateCustomGameplayModule(extractCustomModuleJson(raw));
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
    if (value.question !== undefined) {
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

function buildBaseCustomModuleAgentSystemPrompt(
  world?: CustomModuleAgentWorldContext,
): string {
  const catalog = world ? buildCustomModuleCapabilityCatalog(world) : buildCustomModuleCapabilityCatalog({ id: 'unknown', name: '当前世界' });
  return `你是 Omni Plane Travels 的自定义玩法模块共创 Agent。你必须先理解需求，再生成可审查的声明式模块。\n
本轮只输出一个 JSON envelope：message、phase、brief、可选 question、module。phase 只能是 discovery、designing、draft_ready、revising；每轮最多一个 question。需求未闭合时 module 必须为 null；需求足够时直接返回完整模块。修订必须返回完整新模块，未提及部分保持原样。玩家说“你看着办”时，把明确选择写入 brief.assumptions。\n
下面是运行时导出的能力目录，禁止生成目录之外的输入、生命周期、动作、状态类型或视图组件：\n${JSON.stringify(catalog)}\n
V2 模块必须 schemaVersion=2、inputs 只绑定能力目录中的安全路径、logic 包含 onGameStart/onTurnEnd/onTick/onChoice/onButton；permissions.read 必须精确列出 inputs 使用的每一条宿主路径，不要声明未使用路径；条件可读 state/input/event，动作值可用字面量或安全引用，写入只能指向自身 state。可选 dependencies 只声明确实需要的其他模块 id 和版本。禁止 code、script、eval、import、网络、文件、Tauri 或任意代码执行。V1 仅用于兼容历史模块，不作为新生成默认。\n
模块 kind 固定为 "custom-gameplay-module"，scope 固定为 "world"，permissions.write 固定为 "own-state-only"；可视模块使用 right-panel 或 left-panel。规则动作必须使用完整的 actions 数组，不要输出旧式 action/path/value 规则。card 视图可使用 title、body、声明式 children 和最多 4 个安全操作按钮。\n
brief 字段必须完整返回：goal、presentation、triggers、inputs、state、behavior、outputs、assumptions、unresolved。当前世界：${world?.name ?? '当前世界'}（${world?.id ?? 'unknown'}）。`;
}

export function buildCustomModuleAgentSystemPrompt(world?: CustomModuleAgentWorldContext): string {
  return buildBaseCustomModuleAgentSystemPrompt(world);
}

export type CustomModuleAgentRequest = (config: ApiConfig, messages: Message[], options: StreamOptions) => Promise<CompletionResult>;

export function buildCustomModuleAgentRepairPrompt(raw: string, errors: ModuleValidationIssue[], session?: CustomModuleAgentSession): string {
  const issueText = errors.slice(0, 24).map((entry) => `${entry.path.join('.') || '(root)'}: ${entry.message}`).join('\n');
  return `上一轮输出未通过本地校验。只修复这些错误并只返回一个完整 JSON envelope；不要删掉当前有效草案中未涉及的部分。校验错误：\n${issueText || '(invalid envelope)'}\n当前会话快照：\n${session ? JSON.stringify(session) : '(无)'}\n上一轮输出：\n${raw.slice(0, 16000)}`;
}

export function buildCustomModuleAgentUserPrompt(request: string, world: CustomModuleAgentWorldContext): string {
  return `当前世界：${world.name}（${world.id}）\n世界简介：${world.description || '暂无'}\n\n玩家最新消息：\n${request.trim()}\n\n只追问一个真正影响实现的问题；如果信息足够，直接进入 draft_ready 并生成 V2 完整模块。`;
}

function sessionPrompt(session: CustomModuleAgentSession, newestMessage: string, recentConversation: CustomModuleConversationMessage[]): string {
  return `当前结构化会话：\n${JSON.stringify(session)}\n\n玩家最新消息：\n${newestMessage.trim()}\n\n仅保留这些最近对话用于语气参考：\n${JSON.stringify(recentConversation.slice(-8))}`;
}

export async function generateCustomModuleDraft(
  apiConfig: ApiConfig,
  request: string,
  world: CustomModuleAgentWorldContext,
  options: { signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<CustomModuleDraftResult> {
  const response = await requestStreamWithRetry(apiConfig, [
    { role: 'system', content: buildCustomModuleAgentSystemPrompt(world) },
    { role: 'user', content: buildCustomModuleAgentUserPrompt(request, world) },
  ], {
    signal: options.signal, maxTokens: 12000, responseFormat: 'json',
    onDelta: () => options.onText?.('正在整理模块设计……'),
  });
  return parseCustomModuleDraft(response.text);
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

  for (let attempt = 0; attempt < 2; attempt += 1) {
    options.onStatus?.(attempt === 0 ? '正在分析需求……' : '正在按校验结果修复草案……');
    const response = await request(apiConfig, messages, {
      signal: options.signal, maxTokens: 12000, responseFormat: 'json',
      // Never expose the partial JSON stream to the player.
      onDelta: () => options.onText?.(attempt === 0 ? '正在整理设计蓝图……' : '正在修复设计蓝图……'),
    });
    const parsed = parseCustomModuleAgentTurn(response.text);
    if (parsed.ok) {
      const envelope: CustomModuleAgentEnvelope = {
        message: parsed.message, phase: parsed.phase, brief: parsed.brief,
        question: parsed.question, module: parsed.module ?? null,
      };
      const applied = applyCustomModuleAgentTurn(session, envelope);
      return { ...parsed, session: applied.session };
    }
    if (attempt === 1) return { ...parsed, session };
    messages = [
      ...messages,
      { role: 'assistant', content: response.text },
      { role: 'user', content: buildCustomModuleAgentRepairPrompt(response.text, parsed.errors, session) },
    ];
  }
  return { ok: false, errors: [errorIssue('custom module agent retry exhausted')], raw: '', session };
}
