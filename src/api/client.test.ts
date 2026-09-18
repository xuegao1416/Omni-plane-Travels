import { describe,expect,test,spyOn } from 'bun:test';
import { extractFinishReason,getRequestTimeoutMs,requestStreamWithRetry } from './client';
import type { ApiConfig } from './types';

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
