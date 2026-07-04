import type { ApiConfig, Message, RequestOptions, StreamOptions, CompletionResult } from './types';
import { nativeFetch } from '../utils/nativeFetch';
import { STORAGE_KEYS } from '../config/storageKeys';

// 获取代理 URL（校验协议安全性）
function getProxyUrl(): string | null {
  try {
    const url = localStorage.getItem(STORAGE_KEYS.PROXY_URL)?.trim();
    if (!url) return null;
    // 只允许 http/https 协议，防止 javascript: / file: 等危险协议
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      console.warn('[API] 代理 URL 协议不安全，已忽略:', parsed.protocol);
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

/** 统一准备请求 URL 和 Headers（处理代理逻辑） */
function prepareFetchRequest(endpoint: string, apiKey?: string, extraHeaders?: Record<string, string>): { url: string; headers: Record<string, string> } {
  const proxyUrl = getProxyUrl();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders,
  };
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`;
  }
  if (proxyUrl) {
    headers['X-Target-URL'] = endpoint;
    return { url: proxyUrl, headers };
  }
  return { url: endpoint, headers };
}

// URL拼接 - 支持多种provider
export function buildEndpoint(config: ApiConfig): string {
  const base = config.baseUrl.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  if (base.endsWith('/v1') || base.endsWith('/openai')) return `${base}/chat/completions`;
  if (base.endsWith('/v1beta')) return `${base}/openai/chat/completions`;
  return `${base}/v1/chat/completions`;
}

function buildRequestBody(config: ApiConfig, messages: Message[], options: RequestOptions = {}) {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: options.temperature ?? config.temperature ?? 0.7,
    stream: options.stream ?? config.stream ?? true,
  };
  if (options.maxTokens ?? config.maxTokens) body.max_tokens = options.maxTokens ?? config.maxTokens;
  // 预设的 top_p 优先于全局配置
  const topP = options.topP ?? config.topP;
  if (topP != null) body.top_p = topP;
  if (config.topK != null) body.top_k = config.topK;
  if (config.reasoningEffort && config.reasoningEffort !== '关闭') body.reasoning_effort = config.reasoningEffort;
  if (options.responseFormat === 'json') body.response_format = { type: 'json_object' };
  // Google不支持某些参数
  if (config.provider === 'google') {
    delete body.frequency_penalty;
    delete body.presence_penalty;
  }
  return body;
}

// 多格式内容提取
function extractStreamContent(json: any): string {
  if (!json) return '';
  // OpenAI标准
  const delta = json.choices?.[0]?.delta;
  if (delta?.content) return delta.content;
  if (delta?.reasoning_content) return '';
  // Gemini
  if (json.candidates?.[0]?.content?.parts) {
    const parts = json.candidates[0].content.parts;
    for (const p of parts) { if (p.text) return p.text; }
  }
  // Anthropic
  if (json.delta?.text) return json.delta.text;
  if (json.delta?.type === 'content_block_delta' && json.delta?.content_block?.text) return json.delta.content_block.text;
  // 通用
  if (json.text) return json.text;
  if (json.content) return typeof json.content === 'string' ? json.content : '';
  if (json.output_text) return json.output_text;
  return '';
}

function extractReasoningContent(json: any): string {
  if (!json) return '';
  const delta = json.choices?.[0]?.delta;
  if (delta?.reasoning_content) return delta.reasoning_content;
  if (delta?.reasoning) return delta.reasoning;
  return '';
}

// DeepSeek连续同role合并
function mergeConsecutiveSameRole(messages: Message[]): Message[] {
  const merged: Message[] = [];
  for (const msg of messages) {
    const last = merged[merged.length - 1];
    if (last && last.role === msg.role) {
      last.content += '\n\n' + msg.content;
    } else {
      merged.push({ ...msg });
    }
  }
  return merged;
}

function normalizeMessages(provider: string | undefined, messages: Message[]): Message[] {
  if (provider === 'deepseek') return mergeConsecutiveSameRole(messages);
  return messages;
}

// SSE流解析
async function parseSSEStream(
  response: Response,
  onDelta: (delta: string, accumulated: string) => void,
  onReasoning?: (reasoning: string) => void,
): Promise<{ text: string; reasoning: string }> {
  if (!response.body) {
    throw new Error('SSE 响应体为空（服务端可能未返回流式数据）');
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let accumulated = '';
  let reasoningAccum = '';

  /** 处理一批 SSE 行（主循环和 flush 共用，消除重复代码） */
  const processSSELines = (raw: string) => {
    const parts = raw.split('\n\n');
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed || !trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const content = extractStreamContent(json);
        const reasoning = extractReasoningContent(json);

        if (content) {
          // 累积式provider可能发送全文而非增量
          if (content.length > accumulated.length && content.startsWith(accumulated)) {
            const delta = content.slice(accumulated.length);
            accumulated = content;
            onDelta(delta, accumulated);
          } else {
            accumulated += content;
            onDelta(content, accumulated);
          }
        }
        if (reasoning && onReasoning) {
          reasoningAccum += reasoning;
          onReasoning(reasoningAccum);
        }
      } catch {
        // 跳过解析失败的行
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lastDoubleNewline = buffer.lastIndexOf('\n\n');
    if (lastDoubleNewline === -1) continue;

    const complete = buffer.slice(0, lastDoubleNewline);
    buffer = buffer.slice(lastDoubleNewline + 2);
    processSSELines(complete);
  }

  // Flush remaining buffer content that didn't end with \n\n
  if (buffer.trim()) {
    processSSELines(buffer);
  }

  return { text: accumulated, reasoning: reasoningAccum };
}

// 非流式请求（使用 nativeFetch 绕过 CORS）
export async function requestCompletion(
  config: ApiConfig,
  messages: Message[],
  options: RequestOptions = {},
): Promise<CompletionResult> {
  const start = Date.now();
  const endpoint = buildEndpoint(config);
  const normalized = normalizeMessages(config.provider, messages);
  const body = buildRequestBody(config, normalized, { ...options, stream: false });
  console.log(`🚀 [API] 发起请求 → ${endpoint} (${messages.length} 条消息)`);

  const { url: fetchUrl, headers: fetchHeaders } = prepareFetchRequest(endpoint, config.apiKey);

  const res = await nativeFetch(fetchUrl, {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const json = await res.json();
  const text = json.choices?.[0]?.message?.content || extractStreamContent(json) || '';
  const reasoning = json.choices?.[0]?.message?.reasoning_content || '';
  const usage = json.usage ? {
    promptTokens: json.usage.prompt_tokens || 0,
    completionTokens: json.usage.completion_tokens || 0,
    totalTokens: json.usage.total_tokens || 0,
  } : undefined;

  const elapsed = Date.now() - start;
  console.log(`✅ [API] 请求完成，耗时 ${elapsed}ms，${text.length} 字`);
  return { text, reasoning: reasoning || undefined, usage, elapsed };
}

// 流式请求
export async function requestCompletionStream(
  config: ApiConfig,
  messages: Message[],
  options: StreamOptions,
): Promise<CompletionResult> {
  const start = Date.now();
  const endpoint = buildEndpoint(config);
  const normalized = normalizeMessages(config.provider, messages);
  const body = buildRequestBody(config, normalized, { ...options, stream: true });

  const { url: fetchUrl, headers: fetchHeaders } = prepareFetchRequest(endpoint, config.apiKey);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify(body),
    signal: options.signal,
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`API ${res.status}: ${errText.slice(0, 200)}`);
  }

  const { text, reasoning } = await parseSSEStream(res, options.onDelta, options.onReasoning);
  return { text, reasoning: reasoning || undefined, elapsed: Date.now() - start };
}

// 重试包装
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, baseDelay = 1000): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      const status = errMsg.match(/API (\d+)/)?.[1];
      const retryable = ['408', '429', '500', '502', '503', '504'].includes(status ?? '');
      if (attempt < maxRetries && retryable) {
        const delay = baseDelay * Math.pow(2, attempt) + Math.random() * 500;
        console.warn(`[API] 请求失败 (${status})，${attempt + 1}/${maxRetries} 次重试，等待 ${Math.round(delay)}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

// 流式→非流式降级
async function requestWithFallback(
  config: ApiConfig,
  messages: Message[],
  options: StreamOptions,
): Promise<CompletionResult> {
  if (config.stream === false) {
    return requestCompletion(config, messages, options);
  }
  try {
    const result = await requestCompletionStream(config, messages, options);
    // 内容过短（≤5字符）视为异常响应（429被包装成200、内容审核截断等），触发重试
    if (!result.text || result.text.trim().length <= 5) {
      console.warn(`[API] 流式响应内容过短（${result.text.length} 字符），降级到非流式重试`);
      const fallback = await requestCompletion(config, messages, options);
      if (!fallback.text || fallback.text.trim().length <= 5) {
        throw new Error(`API 429: 流式和非流式均返回过短响应，疑似限流或内容审核`);
      }
      return fallback;
    }
    return result;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('400') && (msg.includes('stream') || msg.includes('Stream'))) {
      return requestCompletion(config, messages, options);
    }
    throw err;
  }
}

// 主入口：重试 + 降级 + 超时
export async function requestStreamWithRetry(
  config: ApiConfig,
  messages: Message[],
  options: StreamOptions,
): Promise<CompletionResult> {
  const timeoutMs = 120_000; // 2分钟超时
  return withRetry(async () => {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const timeoutId = setTimeout(() => {
      if (!options.signal?.aborted) {
        // 超时只用于提示，不强制 abort（用户可能还在等）
        console.warn('[API] 请求已超过2分钟，可能需要手动取消');
      }
    }, timeoutMs);
    try {
      return await requestWithFallback(config, messages, options);
    } finally {
      clearTimeout(timeoutId);
    }
  });
}

// 获取模型列表（使用 nativeFetch 绕过 CORS）
export async function fetchModels(config: ApiConfig): Promise<string[]> {
  const base = config.baseUrl.replace(/\/+$/, '');
  let url: string;
  if (config.provider === 'google') {
    url = `${base}/v1beta/models?key=${config.apiKey}`;
  } else if (base.endsWith('/v1') || base.endsWith('/openai')) {
    url = `${base}/models`;
  } else if (base.endsWith('/v1/chat/completions')) {
    url = base.replace(/\/chat\/completions$/, '/models');
  } else {
    url = `${base}/v1/models`;
  }

  const { url: fetchUrl, headers: fetchHeaders } = prepareFetchRequest(
    url,
    config.provider !== 'google' ? config.apiKey : undefined,
  );

  // 30秒超时，避免请求无响应时按钮永远转圈
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30000);

  try {
    const res = await nativeFetch(fetchUrl, { headers: fetchHeaders, signal: controller.signal });
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`获取模型列表失败: ${res.status} ${errText.slice(0, 200)}`);
    }
    const json = await res.json();
    const models = json.data || json.models || [];
    return models.map((m: any) => m.id || m.name).filter(Boolean);
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('请求超时(30秒)，请检查网络连接或 API 地址是否正确');
    }
    if (errMsg.includes('Failed to fetch') || errMsg.includes('NetworkError')) {
      throw new Error('网络请求失败，请检查 API 地址是否正确');
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

// 测试连接（使用 nativeFetch 绕过 CORS）
export async function testConnection(config: ApiConfig): Promise<{ success: boolean; message: string; elapsed: number }> {
  const start = Date.now();
  try {
    const endpoint = buildEndpoint(config);
    const body = {
      model: config.model,
      messages: [{ role: 'user', content: 'Hi' }],
      max_tokens: 5,
      stream: false,
    };

    const { url: fetchUrl, headers: fetchHeaders } = prepareFetchRequest(endpoint, config.apiKey);

    const res = await nativeFetch(fetchUrl, {
      method: 'POST',
      headers: fetchHeaders,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      return { success: false, message: `API ${res.status}: ${errText.slice(0, 200)}`, elapsed: Date.now() - start };
    }

    return { success: true, message: `连接成功 (${Date.now() - start}ms)`, elapsed: Date.now() - start };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('Network request failed')) {
      return { success: false, message: '网络请求失败，请检查 API 地址是否正确', elapsed: 0 };
    }
    return { success: false, message: msg, elapsed: 0 };
  }
}

// ─── Embedding API (记忆系统向量化) ───

export interface EmbeddingConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export async function fetchEmbedding(
  config: EmbeddingConfig,
  text: string,
): Promise<number[]> {
  const base = config.baseUrl.replace(/\/+$/, '');
  let url = base;
  if (!base.endsWith('/embeddings')) {
    url = base.endsWith('/v1') ? `${base}/embeddings` : `${base}/v1/embeddings`;
  }

  const { url: fetchUrl, headers: fetchHeaders } = prepareFetchRequest(url, config.apiKey);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify({
      model: config.model,
      input: text,
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding 请求失败: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const embedding = json.data?.[0]?.embedding;
  if (!Array.isArray(embedding)) {
    throw new Error('Embedding 响应格式无效');
  }
  return embedding as number[];
}

export async function fetchEmbeddingBatch(
  config: EmbeddingConfig,
  texts: string[],
): Promise<number[][]> {
  const base = config.baseUrl.replace(/\/+$/, '');
  let url = base;
  if (!base.endsWith('/embeddings')) {
    url = base.endsWith('/v1') ? `${base}/embeddings` : `${base}/v1/embeddings`;
  }

  const { url: fetchUrl, headers: fetchHeaders } = prepareFetchRequest(url, config.apiKey);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify({
      model: config.model,
      input: texts,
    }),
  });

  if (!res.ok) {
    throw new Error(`Embedding 批量请求失败: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const data = json.data;
  if (!Array.isArray(data)) {
    throw new Error('Embedding 批量响应格式无效');
  }

  // 按 index 排序
  const sorted = [...data].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return sorted.map(item => {
    if (!Array.isArray(item.embedding)) {
      throw new Error(`Embedding 第 ${item.index} 项格式无效`);
    }
    return item.embedding as number[];
  });
}

// ─── Rerank API (记忆系统精排) ───

export interface RerankConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

export interface RerankResult {
  index: number;
  relevance_score: number;
}

export async function fetchRerank(
  config: RerankConfig,
  query: string,
  documents: string[],
): Promise<RerankResult[]> {
  const base = config.baseUrl.replace(/\/+$/, '');
  let url = base;
  if (!base.endsWith('/rerank') && !base.endsWith('/rerank/')) {
    url = base.endsWith('/v1') ? `${base}/rerank` : `${base}/v1/rerank`;
  }

  const { url: fetchUrl, headers: fetchHeaders } = prepareFetchRequest(url, config.apiKey);

  const res = await fetch(fetchUrl, {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify({
      model: config.model,
      query,
      documents,
      top_n: documents.length,
    }),
  });

  if (!res.ok) {
    throw new Error(`Rerank 请求失败: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  const results = json.results;
  if (!Array.isArray(results)) {
    throw new Error('Rerank 响应格式无效');
  }

  return results.map((item: { index: number; relevance_score: number }) => ({
    index: item.index,
    relevance_score: item.relevance_score,
  }));
}
