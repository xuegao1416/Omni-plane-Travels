import { z } from 'zod';
import { requestCompletion } from './client';
import type { ApiConfig, CompletionResult, Message, RequestOptions } from './types';

type StructuredRequest = typeof requestCompletion;

export interface StructuredOutputOptions<T extends z.ZodType> {
  config: ApiConfig;
  messages: Message[];
  schema: T;
  schemaName: string;
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  signal?: AbortSignal;
  repairAttempts?: number;
  request?: StructuredRequest;
}

export class StructuredOutputValidationError extends Error {
  constructor(
    message: string,
    public readonly rawOutput: string,
    public readonly issues: string[],
  ) {
    super(message);
    this.name = 'StructuredOutputValidationError';
  }
}

const nativeSchemaCapability = new Map<string, boolean>();
const textOnlyCapability = new Set<string>();

function capabilityKey(config: ApiConfig, schemaName: string): string {
  return `${config.baseUrl.replace(/\/+$/, '')}|${config.model}|${schemaName}`;
}

function cleanJsonText(text: string): string {
  return text.trim().replace(/^\s*```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
}

function formatIssues(error: unknown): string[] {
  if (error instanceof z.ZodError) {
    return error.issues.map(issue => {
      const path = issue.path.length ? issue.path.map(part => typeof part === 'number' ? `[${part}]` : String(part)).join('.').replace(/\.\[/g, '[') : '<root>';
      return `${path}: ${issue.message}`;
    });
  }
  if (error instanceof SyntaxError) return [`<json>: ${error.message}`];
  return [`<root>: ${error instanceof Error ? error.message : String(error)}`];
}

function parseAndValidate<T extends z.ZodType>(schema: T, raw: string): z.infer<T> {
  const parsed = JSON.parse(cleanJsonText(raw));
  return schema.parse(parsed);
}

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const converted = z.toJSONSchema(schema, { io: 'output' }) as Record<string, unknown>;
  // $schema is metadata for validators and is unnecessary in provider response_format.
  const { $schema: _ignored, ...providerSchema } = converted;
  return providerSchema;
}

function looksLikeUnsupportedNativeSchema(error: unknown): boolean {
  const status = typeof error === 'object' && error && 'status' in error ? Number((error as { status?: unknown }).status) : undefined;
  if (status !== 400 && status !== 404 && status !== 422) return false;
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  // Gemini 等上游对不兼容的 json_schema 只返回泛化的 400 INVALID_ARGUMENT，
  // 文案里不含 response_format/json_schema 等关键词，因此任何 400 都值得降级重试一次。
  if (status === 400) return true;
  return message.includes('response_format')
    || message.includes('json_schema')
    || message.includes('json schema')
    || message.includes('unsupported')
    || message.includes('unknown parameter');
}

function requestOptions<T extends z.ZodType>(
  options: StructuredOutputOptions<T>,
  responseFormat: RequestOptions['responseFormat'],
): RequestOptions {
  return {
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    topP: options.topP,
    signal: options.signal,
    responseFormat,
  };
}

function assertComplete(result: CompletionResult, signal?: AbortSignal): void {
  signal?.throwIfAborted();
  if (['length', 'max_tokens', 'MAX_TOKENS'].includes(result.finishReason ?? '')) throw new Error('模型输出达到长度上限，结构化结果未采纳，请缩小输入或增加输出上限。');
  if (['content_filter', 'content-filter', 'SAFETY', 'RECITATION'].includes(result.finishReason ?? '')) throw new Error('模型服务拒绝了本次请求，结构化结果未采纳。');
}

function textMessages<T extends z.ZodType>(options: StructuredOutputOptions<T>): Message[] {
  return [{ role: 'system', content: `仅返回完整 JSON，必须符合以下结构，不要附加解释：\n${JSON.stringify(jsonSchemaFor(options.schema))}` }, ...options.messages];
}

async function makeInitialRequest<T extends z.ZodType>(options: StructuredOutputOptions<T>): Promise<{ result: CompletionResult; format: RequestOptions['responseFormat'] }> {
  const request = options.request ?? requestCompletion;
  const key = capabilityKey(options.config, options.schemaName);
  const known = nativeSchemaCapability.get(key);
  options.signal?.throwIfAborted();
  if (textOnlyCapability.has(key)) return {
    result: await request(options.config, textMessages(options), requestOptions(options, 'text')), format: 'text',
  };

  if (known !== false) {
    try {
      const result = await request(options.config, options.messages, requestOptions(options, {
        type: 'json_schema',
        name: options.schemaName,
        schema: jsonSchemaFor(options.schema),
        strict: true,
      }));
      nativeSchemaCapability.set(key, true);
      return { result, format: { type: 'json_schema', name: options.schemaName, schema: jsonSchemaFor(options.schema), strict: true } };
    } catch (error) {
      options.signal?.throwIfAborted();
      if (!looksLikeUnsupportedNativeSchema(error)) throw error;
      nativeSchemaCapability.set(key, false);
      console.info(`[StructuredOutput] ${options.schemaName}: provider 不支持当前 json_schema，自动降级到 JSON mode`);
    }
  }

  try {
    return { result: await request(options.config, options.messages, requestOptions(options, 'json')), format: 'json' };
  } catch (error) {
    options.signal?.throwIfAborted();
    // Only an explicit format rejection warrants removing JSON mode. Other
    // failures (credentials, context length, temperature) must stay visible.
    const message = error instanceof Error ? error.message : String(error);
    if (!looksLikeUnsupportedNativeSchema(error) || !/response_format|json_object|json mode/i.test(message)) throw error;
    const result = await request(options.config, textMessages(options), requestOptions(options, 'text'));
    textOnlyCapability.add(key);
    return { result, format: 'text' };
  }
}

function repairMessages(messages: Message[], raw: string, issues: string[]): Message[] {
  return [
    ...messages,
    { role: 'assistant', content: raw },
    {
      role: 'user',
      content: `上一份 JSON 没有通过结构校验。只修正结构/字段约束错误，保持所有已经合法的内容和语义不变；不要新增剧情事实，不要解释。\n校验错误：\n${issues.map(issue => `- ${issue}`).join('\n')}\n重新输出完整 JSON。`,
    },
  ];
}

export async function requestStructuredCompletion<T extends z.ZodType>(options: StructuredOutputOptions<T>): Promise<z.infer<T>> {
  const request = options.request ?? requestCompletion;
  const attempts = Math.max(0, options.repairAttempts ?? 1);
  const initial = await makeInitialRequest(options);
  assertComplete(initial.result, options.signal);
  let raw = initial.result.text;
  let lastIssues: string[] = [];

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return parseAndValidate(options.schema, raw);
    } catch (error) {
      lastIssues = formatIssues(error);
      if (attempt >= attempts) break;

      const repaired = await request(
        options.config,
        repairMessages(initial.format === 'text' ? textMessages(options) : options.messages, raw, lastIssues),
        requestOptions(options, initial.format),
      );
      assertComplete(repaired, options.signal);
      raw = repaired.text;
    }
  }

  throw new StructuredOutputValidationError(
    `${options.schemaName} 连续 ${attempts + 1} 次未通过结构校验：${lastIssues.join('；')}`,
    raw,
    lastIssues,
  );
}

export function clearStructuredOutputCapabilityCache(): void {
  nativeSchemaCapability.clear();
  textOnlyCapability.clear();
}
