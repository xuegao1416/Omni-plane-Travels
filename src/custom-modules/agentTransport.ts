import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { ApiConfig } from '../api/types';
import { buildEndpoint, prepareFetchRequest } from '../api/client';
import { bucketKeyForConfig, notifyRateLimited, waitForRateLimit } from '../api/rateLimiter';
import { nativeFetch } from '../utils/nativeFetch';

/** 体验接口代理（`/api/trial`）只承载游戏对话，不支持标准工具调用。 */
function isTrialApiConfig(config: ApiConfig): boolean {
  return config.apiKey === '' && config.baseUrl.replace(/\/+$/, '').endsWith('/api/trial');
}

export type WorkshopErrorKind = 'connection' | 'rate-limit' | 'truncated' | 'unsupported-tools' | 'arguments' | 'refusal' | 'cancelled' | 'execution';
export class WorkshopAgentError extends Error {
  constructor(public readonly kind: WorkshopErrorKind, message: string) { super(message); this.name = 'WorkshopAgentError'; }
}

export function classifyWorkshopError(error: unknown): WorkshopAgentError {
  if (error instanceof WorkshopAgentError) return error;
  const source = error as { name?: string; message?: string; status?: number; statusCode?: number; cause?: unknown; lastError?: unknown } | undefined;
  if (source?.lastError) return classifyWorkshopError(source.lastError);
  if (source?.name === 'AbortError') return new WorkshopAgentError('cancelled', '执行已停止，已完成的草稿修改仍然保留。');
  const message = source?.message ?? String(error);
  const status = source?.statusCode ?? source?.status;
  if (status === 429) return new WorkshopAgentError('rate-limit', '服务商限流，请等待后重试；已完成的工具不会自动重放。');
  if (source?.name === 'TimeoutError' || /timeout|timed out/i.test(message)) return new WorkshopAgentError('connection', '模型请求超时，已完成的步骤仍然保留。');
  if (status === 401 || status === 403) return new WorkshopAgentError('connection', '模型服务认证或访问失败，请检查 API 配置。');
  if ((status === 400 || status === 422 || status === 501) && /(?:tool|function.?call)[\s\S]{0,80}(?:not supported|unsupported|not available)|(?:unsupported|not support|not implement)[\s\S]{0,80}(?:tool|function.?call)/i.test(message)) {
    return new WorkshopAgentError('unsupported-tools', '当前模型或接口不支持标准工具调用，请更换支持工具调用的共创模型。');
  }
  if (/ToolChoiceViolation|NoSuchTool|InvalidToolInput/.test(source?.name ?? '')) return new WorkshopAgentError('arguments', '模型返回的工具名称或参数无效，请重试。');
  if (status === 400 || status === 422) return new WorkshopAgentError('arguments', `模型接口拒绝请求参数：${message.slice(0, 220)}`);
  if (status === 408 || (status && status >= 500) || /fetch|network|connection|ECONN|socket/i.test(message)) return new WorkshopAgentError('connection', '连接模型服务失败，请检查网络或代理后重试。');
  return new WorkshopAgentError('execution', message.slice(0, 500));
}

export async function awaitWorkshopRequestSlot(config: ApiConfig, signal?: AbortSignal | null): Promise<void> {
  signal?.throwIfAborted();
  let cancel: (() => void) | undefined;
  const aborted = new Promise<never>((_, reject) => {
    cancel = () => reject(new DOMException('执行已停止', 'AbortError'));
    signal?.addEventListener('abort', cancel, { once: true });
  });
  try { await Promise.race([waitForRateLimit(config), aborted]); }
  finally { if (cancel) signal?.removeEventListener('abort', cancel); }
  signal?.throwIfAborted();
}

export function createWorkshopModel(config: ApiConfig, fetchImpl: typeof nativeFetch = nativeFetch) {
  if (!config.model?.trim() || !config.baseUrl?.trim()) throw new WorkshopAgentError('connection', '请先配置共创使用的模型和 API 地址。');
  if (isTrialApiConfig(config)) throw new WorkshopAgentError('unsupported-tools', '体验接口仅用于游戏对话。请配置支持标准工具调用的 API 后使用玩法工坊。');
  const endpoint = buildEndpoint(config);
  const baseURL = endpoint.replace(/\/chat\/completions$/, '');
  const provider = createOpenAICompatible({
    name: 'workshop', baseURL, apiKey: config.apiKey || undefined, supportsStructuredOutputs: false,
    transformRequestBody: body => ({
      ...body, parallel_tool_calls: false,
      ...(config.reasoningEffort && config.reasoningEffort !== '关闭' ? { reasoning_effort: config.reasoningEffort } : {}),
      ...(config.topK != null ? { top_k: config.topK } : {}),
    }),
    fetch: Object.assign(async (_url: RequestInfo | URL, init?: RequestInit) => {
      await awaitWorkshopRequestSlot(config, init?.signal);
      // The shared router sets these headers. Keeping the SDK's lower-case
      // copies would make Fetch join both values (including two Bearer keys).
      const sdkHeaders = new Headers(init?.headers);
      sdkHeaders.delete('authorization');
      sdkHeaders.delete('content-type');
      const originalHeaders = Object.fromEntries(sdkHeaders.entries());
      const request = prepareFetchRequest(endpoint, config.apiKey || undefined, originalHeaders);
      const response = await fetchImpl(request.url, { ...init, headers: request.headers });
      if (response.status === 429) notifyRateLimited(response.headers.get('Retry-After'), bucketKeyForConfig(config));
      if (response.ok && response.headers.get('Content-Type')?.includes('application/json')) {
        const body = await response.clone().json().catch(() => undefined);
        if (body?.choices?.some((choice: { message?: { refusal?: string }; finish_reason?: string }) => choice.message?.refusal || choice.finish_reason === 'content_filter')) {
          throw new WorkshopAgentError('refusal', '模型服务明确拒绝了本次请求；可查看对话并调整请求内容。');
        }
      }
      return response;
    }, { preconnect: globalThis.fetch.preconnect }),
  });
  return provider.chatModel(config.model);
}
