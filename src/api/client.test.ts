import { describe,expect,test,spyOn } from 'bun:test';
import { buildEndpoint,extractFinishReason,fetchModels,getRequestTimeoutMs,requestCompletion,requestCompletionStream,requestStreamWithRetry,testConnection } from './client';
import type { ApiConfig,Message } from './types';

const config = (provider: ApiConfig['provider']): ApiConfig => ({
  provider,
  apiKey: 'test-key',
  baseUrl: 'https://example.com/v1',
  model: provider === 'deepseek' ? 'deepseek-reasoner' : 'test-model',
});

describe('request timeout policy', () => {
  test('allows DeepSeek reasoning responses to finish', () => {
    expect(getRequestTimeoutMs(config('deepseek'))).toBe(300_000);
  });

  test('keeps the standard timeout for other providers', () => {
    expect(getRequestTimeoutMs(config('openai'))).toBe(120_000);
  });

  test('recognizes DeepSeek through compatible providers by official host or explicit model name', () => {
    for (const provider of ['openai', 'custom'] as const) {
      expect(getRequestTimeoutMs({ ...config(provider), baseUrl: 'https://api.deepseek.com/v1' })).toBe(300_000);
      for (const model of ['deepseek-chat', 'deepseek/deepseek-v4-pro', 'DeepSeek-V4.1-Flash-1017']) {
        expect(getRequestTimeoutMs({ ...config(provider), model })).toBe(300_000);
      }
    }
  });

  test('does not mistake lookalike hosts and unrelated model names for DeepSeek', () => {
    for (const baseUrl of ['https://api.deepseek.com.evil/v1', 'https://api.deepseek.com@evil.test/v1', 'https://example.com/api.deepseek.com']) {
      expect(getRequestTimeoutMs({ ...config('custom'), baseUrl })).toBe(120_000);
    }
    for (const model of ['notdeepseek-chat', 'deepseeker-v4', 'mydeepseek']) {
      expect(getRequestTimeoutMs({ ...config('openai'), model })).toBe(120_000);
    }
  });

  test('honors a valid explicit timeout before provider defaults', () => {
    expect(getRequestTimeoutMs({ ...config('deepseek'), requestTimeoutMs: 42_000 })).toBe(42_000);
    expect(getRequestTimeoutMs({ ...config('custom'), model: 'deepseek-chat', requestTimeoutMs: 45_000 })).toBe(45_000);
  });
});

describe('DeepSeek compatible requests', () => {
  for (const stream of [false, true]) {
    test(`normalizes ${stream ? 'streaming' : 'non-streaming'} DeepSeek messages without changing inputs or request parameters`, async () => {
      const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
      const responseFetch = Object.assign(async () => stream
        ? new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        : new Response(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }] })),
      { preconnect: globalThis.fetch.preconnect });
      const fetch = spyOn(globalThis, 'fetch').mockImplementation(responseFetch);
      try {
        const messages: Message[] = [
          { role: 'system', content: '文风' }, { role: 'system', content: '规则' },
          { role: 'user', content: '你好' }, { role: 'user', content: '继续' },
        ];
        const original = structuredClone(messages);
        const configs: ApiConfig[] = [
          config('deepseek'),
          { ...config('openai'), baseUrl: 'https://api.deepseek.com/v1' },
          { ...config('custom'), model: 'deepseek/deepseek-v4-pro' },
          config('openai'),
        ];
        for (const [index, requestConfig] of configs.entries()) {
          const options = { maxTokens: 456, topP: 0.8, temperature: 0.6 };
          const result = stream
            ? await requestCompletionStream(requestConfig, messages, { ...options, onDelta: () => {} })
            : await requestCompletion(requestConfig, messages, options);
          expect(result.text).toBe('好');
          const [url, init] = fetch.mock.calls[index]!;
          expect(String(url)).toBe(`${requestConfig.baseUrl}/chat/completions`);
          expect(JSON.parse(String(init?.body))).toEqual({
            model: requestConfig.model,
            messages: index === 3 ? original : [
              { role: 'system', content: '文风\n\n规则' }, { role: 'user', content: '你好\n\n继续' },
            ],
            temperature: 0.6, top_p: 0.8, max_tokens: 456, stream,
            ...(requestConfig.provider === 'deepseek' ? { thinking: { type: 'disabled' } } : {}),
          });
          expect(messages).toEqual(original);
        }
      } finally {
        fetch.mockRestore();
        if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
        else Reflect.deleteProperty(globalThis, 'localStorage');
      }
    });
  }
});

describe('native DeepSeek protocol', () => {
  for (const stream of [false, true]) {
    test(`uses Flash thinking sampling for official aliases in ${stream ? 'streaming' : 'non-streaming'} requests`, async () => {
      const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
      const responseFetch = Object.assign(async () => stream
        ? new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        : new Response(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }] })),
      { preconnect: globalThis.fetch.preconnect });
      const fetch = spyOn(globalThis, 'fetch').mockImplementation(responseFetch);
      try {
        for (const model of [
          'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp',
          'deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash-vision-exp',
          'DeepSeek-V4.1-Flash-1017', 'deepseek/DeepSeek-V4.1-Flash-1017',
        ]) {
          const native = { ...config('deepseek'), model, reasoningEffort: 'high', topP: 0.8 };
          const messages: Message[] = [{ role: 'user', content: '继续' }];
          if (stream) await requestCompletionStream(native, messages, { onDelta: () => {} });
          else await requestCompletion(native, messages);
          const body = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
          expect(body.top_p).toBe(0.95);
          expect(body.temperature).toBeUndefined();
          expect(body.thinking).toEqual({ type: 'enabled' });
        }
      } finally {
        fetch.mockRestore();
        if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
        else Reflect.deleteProperty(globalThis, 'localStorage');
      }
    });
  }

  test('defaults to beta while preserving explicit third-party endpoints and generic routing', () => {
    const native = config('deepseek');
    for (const baseUrl of ['', 'https://api.deepseek.com', 'https://api.deepseek.com/', 'https://api.deepseek.com/beta']) {
      expect(buildEndpoint({ ...native, baseUrl })).toBe('https://api.deepseek.com/beta/chat/completions');
    }
    for (const baseUrl of ['https://third-party.test/v4', 'https://third-party.test/beta']) {
      expect(buildEndpoint({ ...native, baseUrl })).toBe(`${baseUrl}/chat/completions`);
    }
    expect(buildEndpoint({ ...native, baseUrl: 'https://third-party.test/custom/chat/completions' })).toBe('https://third-party.test/custom/chat/completions');
    expect(buildEndpoint({ ...native, baseUrl: 'https://api.deepseek.com/v1' })).toBe('https://api.deepseek.com/v1/chat/completions');
    expect(buildEndpoint({ ...config('openai'), baseUrl: 'https://api.deepseek.com' })).toBe('https://api.deepseek.com/v1/chat/completions');
  });

  for (const stream of [false, true]) {
    test(`applies native message conversion and explicit thinking to ${stream ? 'streaming' : 'non-streaming'} requests`, async () => {
      const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
      Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
      const responseFetch = Object.assign(async () => stream
        ? new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n')
        : new Response(JSON.stringify({ choices: [{ message: { content: '好' }, finish_reason: 'stop' }] })),
      { preconnect: globalThis.fetch.preconnect });
      const fetch = spyOn(globalThis, 'fetch').mockImplementation(responseFetch);
      try {
        // Historical flags must not spread, and the two leading system messages remain system.
        const messages: Message[] = [
          { role: 'system', content: '规则一' }, { role: 'system', content: '规则二' },
          { role: 'user', content: '开场' }, { role: 'system', content: '场景' },
          { role: 'system', content: '状态' }, { role: 'user', content: '行动' },
          { role: 'assistant', content: '历史', prefix: true },
          { role: 'user', content: '继续' },
          { role: 'assistant', content: '预填一' }, { role: 'assistant', content: '预填二' },
        ];
        const original = structuredClone(messages);
        const expectedMessages = [
          { role: 'system', content: '规则一\n\n规则二' },
          { role: 'user', content: '开场\n\n场景\n\n状态\n\n行动' },
          { role: 'assistant', content: '历史' }, { role: 'user', content: '继续' },
          { role: 'assistant', content: '预填一\n\n预填二', prefix: true },
        ];
        const cases = [
          { baseUrl: '', reasoningEffort: undefined, model: 'deepseek-v4-pro', url: 'https://api.deepseek.com/beta/chat/completions', enabled: false },
          { baseUrl: 'https://api.deepseek.com/v1', reasoningEffort: '关闭', model: 'deepseek-v4-pro', url: 'https://api.deepseek.com/beta/chat/completions', enabled: false },
          { baseUrl: 'https://api.deepseek.com/v1/chat/completions', reasoningEffort: 'low', model: 'deepseek-v4-pro', url: 'https://api.deepseek.com/beta/chat/completions', enabled: true, effort: 'low' },
          { baseUrl: 'https://third-party.test/v4', reasoningEffort: 'medium', model: 'deepseek-v4-pro', url: 'https://third-party.test/v4/chat/completions', enabled: true, effort: 'high' },
          { baseUrl: 'https://third-party.test/custom/chat/completions', reasoningEffort: 'high', model: 'deepseek-flash', url: 'https://third-party.test/custom/chat/completions', enabled: true, effort: 'high' },
          { baseUrl: 'https://api.deepseek.com.evil/v1', reasoningEffort: '关闭', model: 'deepseek-v4-pro', url: 'https://api.deepseek.com.evil/v1/chat/completions', enabled: false },
        ];
        for (const [index, entry] of cases.entries()) {
          const requestConfig = { ...config('deepseek'), ...entry, topK: 45, maxTokens: 60000 };
          const options = { temperature: 0.6, topP: 0.8, maxTokens: 456 };
          if (stream) await requestCompletionStream(requestConfig, messages, { ...options, onDelta: () => {} });
          else await requestCompletion(requestConfig, messages, options);
          const [url, init] = fetch.mock.calls[index]!;
          expect(String(url)).toBe(entry.url);
          const body = JSON.parse(String(init?.body));
          expect(body).toEqual({
            model: entry.model, messages: expectedMessages, max_tokens: 456, stream,
            thinking: { type: entry.enabled ? 'enabled' : 'disabled' },
            ...(entry.enabled ? { reasoning_effort: entry.effort } : { temperature: 0.6, top_p: 0.8 }),
            ...(entry.model === 'deepseek-flash' && entry.enabled ? { top_p: 0.95 } : {}),
          });
          expect(messages).toEqual(original);
        }

        const userEnding = messages.slice(0, -2);
        const native = { ...config('deepseek'), baseUrl: 'https://api.deepseek.com/v1' };
        if (stream) await requestCompletionStream(native, userEnding, { onDelta: () => {} });
        else await requestCompletion(native, userEnding);
        const [userEndingUrl, userEndingInit] = fetch.mock.calls.at(-1)!;
        expect(String(userEndingUrl)).toBe('https://api.deepseek.com/v1/chat/completions');
        expect(JSON.parse(String(userEndingInit?.body)).messages).toEqual(expectedMessages.slice(0, -1));
        expect(messages).toEqual(original);

        // Generic DeepSeek detection provides timeout/merge compatibility, not the native protocol.
        for (const provider of ['openai', 'custom'] as const) {
          const requestConfig = { ...config(provider), model: 'deepseek-v4-pro', reasoningEffort: 'medium', topK: 45 };
          if (stream) await requestCompletionStream(requestConfig, original, { onDelta: () => {} });
          else await requestCompletion(requestConfig, original);
          const body = JSON.parse(String(fetch.mock.calls.at(-1)?.[1]?.body));
          expect(body.thinking).toBeUndefined();
          expect(body.reasoning_effort).toBe('medium');
          expect(body.top_k).toBe(45);
          expect(body.temperature).toBe(0.7);
          expect(body.messages.at(-1).prefix).toBeUndefined();
          expect(body.messages.some((message: Message, index: number) => index > 0 && message.role === 'system')).toBe(true);
          expect(messages).toEqual(original);
        }
      } finally {
        fetch.mockRestore();
        if (storage) Object.defineProperty(globalThis, 'localStorage', storage);
        else Reflect.deleteProperty(globalThis, 'localStorage');
      }
    });
  }

  test('connection tests disable thinking by default and model listing resolves the official default', async () => {
    const requests: { url: string; body: any }[] = [];
    const responseFetch = Object.assign(async (url: string | URL | Request, init?: RequestInit) => {
      requests.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify({ data: [{ id: 'deepseek-flash' }] }));
    }, { preconnect: globalThis.fetch.preconnect });
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(responseFetch);
    try {
      const native = { ...config('deepseek'), baseUrl: '' };
      expect((await testConnection(native, { proxyUrl: '' })).success).toBe(true);
      expect(requests[0]?.url).toBe('https://api.deepseek.com/beta/chat/completions');
      expect(requests[0]?.body.thinking).toEqual({ type: 'disabled' });
      expect(requests[0]?.body.max_tokens).toBe(5);
      expect(await fetchModels(native, { proxyUrl: '' })).toEqual(['deepseek-flash']);
      expect(requests[1]?.url).toBe('https://api.deepseek.com/models');
    } finally { fetch.mockRestore(); }
  });
});

describe('completion finish reason', () => {
  test('accepts short streaming prose without a fabricated 429 or fallback request', async () => {
    const storage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
    const responseFetch = Object.assign(async () => new Response('data: {"choices":[{"delta":{"content":"好"},"finish_reason":null}]}\n\ndata: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }), { preconnect: globalThis.fetch.preconnect });
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(responseFetch);
    try {
      const result = await requestStreamWithRetry(config('custom'), [{ role: 'user', content: '回答一个字' }], { onDelta: () => {} });
      expect(result.text).toBe('好');
      expect(fetch).toHaveBeenCalledTimes(1);
    } finally { fetch.mockRestore(); if (storage) Object.defineProperty(globalThis, 'localStorage', storage); else Reflect.deleteProperty(globalThis, 'localStorage'); }
  });
  test('reads OpenAI-compatible and Gemini finish reasons', () => {
    expect(extractFinishReason({ choices: [{ finish_reason: 'length' }] })).toBe('length');
    expect(extractFinishReason({ candidates: [{ finishReason: 'STOP' }] })).toBe('STOP');
    expect(extractFinishReason({ stop_reason: 'end_turn' })).toBe('end_turn');
  });
});
