export type ApiProvider = 'openai' | 'deepseek' | 'google' | 'custom';

export interface ApiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  provider: ApiProvider;
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  stream?: boolean;
  contextSize?: number;
  reasoningEffort?: string;
  /** API 调用限流间隔（毫秒），默认 10000 */
  rateLimitMs?: number;
  /** 单次模型请求的超时时间（毫秒）。未设置时按 provider 取默认值（deepseek 300000，其余 120000）。 */
  requestTimeoutMs?: number;
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface JsonSchemaResponseFormat {
  type: 'json_schema';
  name: string;
  schema: Record<string, unknown>;
  strict?: boolean;
}

export interface RequestOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
  stream?: boolean;
  responseFormat?: 'json' | 'text' | JsonSchemaResponseFormat;
}

export interface StreamOptions extends RequestOptions {
  onDelta: (delta: string, accumulated: string) => void;
  onReasoning?: (reasoning: string) => void;
}

export interface CompletionResult {
  text: string;
  reasoning?: string;
  /** Provider-reported stop reason, e.g. stop / length / content_filter. */
  finishReason?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  elapsed: number;
}
