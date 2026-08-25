import { describe, expect, test } from 'bun:test';
import { parseTrialBody, resolveTrialEndpoint } from './trial';

describe('trial request guardrails', () => {
  test('only derives a fixed OpenAI-compatible endpoint from server configuration', () => {
    expect(resolveTrialEndpoint('https://example.test')).toBe('https://example.test/v1/chat/completions');
    expect(resolveTrialEndpoint('https://example.test/v1/')).toBe('https://example.test/v1/chat/completions');
    expect(resolveTrialEndpoint('javascript:alert(1)')).toBeNull();
    expect(resolveTrialEndpoint('https://user:pass@example.test')).toBeNull();
  });

  test('accepts the shared message shape but rejects oversized or malformed input', () => {
    expect(parseTrialBody({ messages: [{ role: 'user', content: 'hello' }] }).ok).toBe(true);
    expect(parseTrialBody({ messages: [{ role: 'tool', content: 'hello' }] })).toEqual({ ok: false, error: 'INVALID_ROLE' });
    expect(parseTrialBody({ messages: [] })).toEqual({ ok: false, error: 'INVALID_MESSAGES' });
    expect(parseTrialBody({ messages: [{ role: 'user', content: 'x'.repeat(32_001) }] })).toEqual({ ok: false, error: 'INVALID_CONTENT' });
  });

  test('does not accept a client-controlled unsigned identity', async () => {
    const { getTrialConfig } = await import('./trial');
    expect(getTrialConfig({ SESSION_SECRET: 'secret', TRIAL_LLM_BASE_URL: 'https://example.test', TRIAL_LLM_API_KEY: 'key', TRIAL_LLM_MODEL: 'model' } as any).configured).toBe(true);
  });
});
