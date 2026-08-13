import { describe, expect, test } from 'bun:test';
import { extractFinishReason, getRequestTimeoutMs } from './client';
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
  test('reads OpenAI-compatible and Gemini finish reasons', () => {
    expect(extractFinishReason({ choices: [{ finish_reason: 'length' }] })).toBe('length');
    expect(extractFinishReason({ candidates: [{ finishReason: 'STOP' }] })).toBe('STOP');
    expect(extractFinishReason({ stop_reason: 'end_turn' })).toBe('end_turn');
  });
});
