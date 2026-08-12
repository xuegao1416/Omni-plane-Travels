import { requestStreamWithRetry } from '../api/client';
import type { ApiConfig, CompletionResult, Message, StreamOptions } from '../api/types';
import type { CustomGameplayModule, ModuleValidationIssue } from './schema';
import { validateCustomGameplayModule } from './validator';

export interface CustomModuleAgentWorldContext {
  id: string;
  name: string;
  description?: string;
}

export type CustomModuleDraftResult = {
  ok: true;
  module: CustomGameplayModule;
  raw: string;
} | {
  ok: false;
  errors: ModuleValidationIssue[];
  raw: string;
};

export type CustomModuleAgentTurnResult = {
  ok: true;
  message: string;
  status: 'needs_input' | 'draft_ready';
  module?: CustomGameplayModule;
  raw: string;
} | {
  ok: false;
  errors: ModuleValidationIssue[];
  raw: string;
};

export interface CustomModuleConversationMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type CustomModuleRequestField = 'purpose' | 'presentation';

const MODULE_PURPOSE_HINT_RE = /(记录|追踪|管理|统计|显示|计算|控制|累计|提醒|跟踪|进度|record|track|manage|monitor|count|calculate|control|remind|progress)/i;
const MODULE_PRESENTATION_HINT_RE = /(前端|前台|卡片|面板|界面|可见|有前端|后台|后端|无前端|隐形|frontend|card|panel|ui|visible|backend|background|headless)/i;

/** Keeps the first turn conversational when the request has no usable design target. */
export function getMissingCustomModuleRequestFields(
  conversation: CustomModuleConversationMessage[],
): CustomModuleRequestField[] {
  const userText = conversation
    .filter((message) => message.role === 'user')
    .map((message) => message.content)
    .join('\n')
    .trim();
  const missing: CustomModuleRequestField[] = [];
  if (!MODULE_PURPOSE_HINT_RE.test(userText)) missing.push('purpose');
  if (!MODULE_PRESENTATION_HINT_RE.test(userText)) missing.push('presentation');
  return missing;
}

function errorIssue(message: string, code = 'invalid-agent-output'): ModuleValidationIssue {
  return { path: [], code, severity: 'error', message };
}

/** Extracts the first balanced JSON object without executing or evaluating it. */
export function extractCustomModuleJson(text: string): unknown {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* continue with fenced/prose output */ }

  for (let start = 0; start < trimmed.length; start++) {
    if (trimmed[start] !== '{') continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let index = start; index < trimmed.length; index++) {
      const char = trimmed[index];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') { inString = true; continue; }
      if (char === '{') depth++;
      if (char === '}') depth--;
      if (depth === 0) {
        const candidate = trimmed.slice(start, index + 1);
        try { return JSON.parse(candidate); } catch { break; }
      }
    }
  }
  throw new Error('没有找到可解析的 JSON 对象');
}

export function parseCustomModuleDraft(raw: string): CustomModuleDraftResult {
  try {
    const parsed = extractCustomModuleJson(raw);
    const result = validateCustomGameplayModule(parsed);
    if (!result.valid || !result.normalized) {
      return { ok: false, errors: result.errors, raw };
    }
    return { ok: true, module: result.normalized, raw };
  } catch (error) {
    return { ok: false, errors: [errorIssue(error instanceof Error ? error.message : String(error), 'invalid-json')], raw };
  }
}

export function parseCustomModuleAgentTurn(raw: string): CustomModuleAgentTurnResult {
  try {
    const parsed = extractCustomModuleJson(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, errors: [errorIssue('Agent 输出必须是 JSON 对象')], raw };
    }
    const value = parsed as Record<string, unknown>;

    // 兼容旧版“直接输出模块 JSON”，让历史提示词仍能被工作台预览。
    if (value.kind === 'custom-gameplay-module') {
      const draft = parseCustomModuleDraft(raw);
      return draft.ok
        ? { ok: true, message: '我已经整理好了模块草案。', status: 'draft_ready', module: draft.module, raw }
        : draft;
    }

    if (typeof value.message !== 'string' || value.message.trim().length === 0 || value.message.length > 2000) {
      return { ok: false, errors: [errorIssue('Agent envelope 缺少有效的 message', 'invalid-agent-envelope')], raw };
    }
    if (value.status !== 'needs_input' && value.status !== 'draft_ready') {
      return { ok: false, errors: [errorIssue('Agent envelope 的 status 必须是 needs_input 或 draft_ready', 'invalid-agent-envelope')], raw };
    }

    if (value.status === 'needs_input') {
      if (value.module !== null && value.module !== undefined) {
        return { ok: false, errors: [errorIssue('needs_input 阶段不应携带 module', 'invalid-agent-envelope')], raw };
      }
      return { ok: true, message: value.message.trim(), status: 'needs_input', raw };
    }

    if (value.module === null || value.module === undefined) {
      return { ok: false, errors: [errorIssue('draft_ready 阶段必须携带 module', 'invalid-agent-envelope')], raw };
    }
    const draft = validateCustomGameplayModule(value.module);
    if (!draft.valid || !draft.normalized) return { ok: false, errors: draft.errors, raw };
    return { ok: true, message: value.message.trim(), status: 'draft_ready', module: draft.normalized, raw };
  } catch (error) {
    return { ok: false, errors: [errorIssue(error instanceof Error ? error.message : String(error), 'invalid-json')], raw };
  }
}

const CUSTOM_MODULE_AGENT_PROTOCOL_EXAMPLES = `
Exact protocol examples (copy the structure, then adapt values):
logic: {
  "onGameStart": [{ "actions": [{ "type": "set", "path": "count", "value": 0 }] }],
  "onTurnEnd": [{ "actions": [{ "type": "add", "path": "count", "value": 1 }] }],
  "onTick": [],
  "onChoice": []
}
Do not output legacy rule fields such as {"action":"add","path":"count","value":1}; every rule must use an actions array.
Minimal legal view components:
{"type":"section","title":"Stats","children":[{"type":"number","label":"Count","path":"count"}]}
{"type":"text","text":"Static text"} or {"type":"text","label":"Count","path":"count"}
{"type":"number","label":"Count","path":"count"}
{"type":"progress","label":"Progress","path":"count","min":0,"max":100}
{"type":"badge","label":"Status","path":"status"}
{"type":"list","label":"Items","path":"items"}
{"type":"table","label":"Rows","path":"rows","columns":[{"key":"name","label":"Name"}]}
{"type":"divider"}
{"type":"conditional","when":{"type":"compare","path":"count","operator":"gt","value":0},"children":[{"type":"text","text":"Active"}]}
{"type":"button","label":"Refresh","event":"refresh"}
The view must be an object with slot and components; components must be an array of the legal component objects above. Only use button when an interactive choice is explicitly requested.
Only return needs_input when the conversation still lacks the module purpose or whether it is a visible frontend module or a background module. A selected world is already supplied by the workspace. If those details are clear, return draft_ready.`;

function buildBaseCustomModuleAgentSystemPrompt(): string {
  return `你是 Omni Plane Travels 的“自定义玩法模块 Agent”。你的任务是把玩家描述转换为一个可审查的 JSON 草案。

协议必须满足：kind 固定为 "custom-gameplay-module"；schemaVersion 固定为 1；scope 固定为 "world"；必须包含 id、name、version、author、state、logic、permissions。
state 只能使用 number、string、boolean、enum、array、object。logic 只能使用 onGameStart、onTurnEnd、onTick、onChoice，以及 set、add、subtract、toggle、append、remove、log 动作。所有 action 和 view 的 path 只能指向本模块自己的 state。
权限必须是 read 数组加 write: "own-state-only"。可视模块才提供 view，slot 只能是 right-panel 或 left-panel，组件只能是 section、text、number、progress、badge、list、table、divider、conditional、button。后台模块可以省略 view。

安全边界（硬限制，违规一律拒绝）：禁止生成 code、script、eval、component、import；禁止 JavaScript、TypeScript、React、Vue、JSX、HTML、网络请求、文件访问、Tauri 调用、API key 或任意外部写入。所有状态读写必须通过 logic 中的规则（onGameStart/onTurnEnd/onTick/onChoice）和 permissions 字段声明的范围进行，游戏内部状态操作是安全的。
只输出一个 JSON 对象，不要 Markdown，不要解释文字。对象必须符合：{"message":"给玩家的回复或追问","status":"needs_input 或 draft_ready","module":null 或完整模块 JSON}。需要澄清时使用 needs_input；信息足够且模块通过你自己的检查时使用 draft_ready。JSON 生成后仍会经过严格校验，不能绕过校验。`;
}

export function buildCustomModuleAgentSystemPrompt(): string {
  return `${buildBaseCustomModuleAgentSystemPrompt()}\n${CUSTOM_MODULE_AGENT_PROTOCOL_EXAMPLES}`;
}

export type CustomModuleAgentRequest = (
  config: ApiConfig,
  messages: Message[],
  options: StreamOptions,
) => Promise<CompletionResult>;

export function buildCustomModuleAgentRepairPrompt(
  raw: string,
  errors: ModuleValidationIssue[],
): string {
  const issueText = errors
    .slice(0, 24)
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  return `The previous JSON response failed validation. Repair it once and return only one complete JSON object using the exact protocol examples above. Do not explain the repair and do not use legacy rule fields such as action/path/value at rule level.
Validator errors:
${issueText || '(invalid agent envelope)'}
Previous output:
${raw.slice(0, 12000)}`;
}

export function buildCustomModuleAgentUserPrompt(
  request: string,
  world: CustomModuleAgentWorldContext,
): string {
  return `当前世界：${world.name}（${world.id}）
世界简介：${world.description || '暂无'}

玩家需求：
${request.trim()}

请设计一个第一版可运行的自定义玩法模块。优先保持状态字段少、规则确定、可解释；如果玩家要求的是可见卡片，请提供 right-panel view；如果玩家要求后台运行，请省略 view。`;
}

export async function generateCustomModuleDraft(
  apiConfig: ApiConfig,
  request: string,
  world: CustomModuleAgentWorldContext,
  options: { signal?: AbortSignal; onText?: (text: string) => void } = {},
): Promise<CustomModuleDraftResult> {
  const response = await requestStreamWithRetry(
    apiConfig,
    [
      { role: 'system', content: buildCustomModuleAgentSystemPrompt() },
      { role: 'user', content: buildCustomModuleAgentUserPrompt(request, world) },
    ],
    {
      signal: options.signal,
      maxTokens: 12000,
      responseFormat: 'json',
      onDelta: (_delta, accumulated) => options.onText?.(accumulated),
    },
  );
  return parseCustomModuleDraft(response.text);
}

export async function runCustomModuleAgentTurn(
  apiConfig: ApiConfig,
  world: CustomModuleAgentWorldContext,
  conversation: CustomModuleConversationMessage[],
  options: { signal?: AbortSignal; onText?: (text: string) => void; request?: CustomModuleAgentRequest } = {},
): Promise<CustomModuleAgentTurnResult> {
  const worldContext = `当前创作目标世界：${world.name}（${world.id}）\n世界简介：${world.description || '暂无'}\n所有模块最终绑定到这个世界。`;
  const request = options.request ?? requestStreamWithRetry;
  let messages: Message[] = [
    { role: 'system', content: `${buildCustomModuleAgentSystemPrompt()}\n${worldContext}` },
    ...conversation,
  ];
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await request(apiConfig, messages, {
      signal: options.signal,
      maxTokens: 12000,
      responseFormat: 'json',
      onDelta: (_delta, accumulated) => options.onText?.(accumulated),
    });
    const parsed = parseCustomModuleAgentTurn(response.text);
    if (parsed.ok || attempt === 1) return parsed;

    options.onText?.('');
    messages = [
      ...messages,
      { role: 'assistant', content: response.text },
      { role: 'user', content: buildCustomModuleAgentRepairPrompt(response.text, parsed.errors) },
    ];
  }
  throw new Error('custom module agent retry exhausted');
}
