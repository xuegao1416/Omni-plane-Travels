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
}

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface RequestOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
  stream?: boolean;
  responseFormat?: 'json' | 'text';
}

export interface StreamOptions extends RequestOptions {
  onDelta: (delta: string, accumulated: string) => void;
  onReasoning?: (reasoning: string) => void;
}

export interface CompletionResult {
  text: string;
  reasoning?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
  elapsed: number;
}
