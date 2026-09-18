import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { clearStructuredOutputCapabilityCache, requestStructuredCompletion } from './structuredOutput';
import type { ApiConfig } from './types';

const config: ApiConfig = { apiKey: 'x', baseUrl: 'https://example.test/v1', model: 'test-model', provider: 'custom' };
const schema = z.object({ priority: z.number().int().min(0).max(70), label: z.string() }).strict();

describe('requestStructuredCompletion', () => {
  test('prefers native json_schema and validates the returned value', async () => {
    clearStructuredOutputCapabilityCache();
    const formats: unknown[] = [];
    const value = await requestStructuredCompletion({
      config, messages: [{ role: 'user', content: 'return JSON' }], schema, schemaName: 'native_test', repairAttempts: 1,
      request: async (_config, _messages, options) => {
        formats.push(options?.responseFormat);
        return { text: '{"priority":50,"label":"ok"}', elapsed: 1 };
      },
    });
    expect(value.priority).toBe(50);
    expect((formats[0] as any).type).toBe('json_schema');
  });

  test('falls back to JSON mode when provider rejects json_schema', async () => {
    clearStructuredOutputCapabilityCache();
    const formats: unknown[] = [];
    const value = await requestStructuredCompletion({
      config, messages: [{ role: 'user', content: 'return JSON' }], schema, schemaName: 'fallback_test',
      request: async (_config, _messages, options) => {
        formats.push(options?.responseFormat);
        if (typeof options?.responseFormat === 'object') {
          throw Object.assign(new Error('API 400: unsupported response_format json_schema'), { status: 400 });
        }
        return { text: '{"priority":40,"label":"fallback"}', elapsed: 1 };
      },
    });
    expect(value.label).toBe('fallback');
    expect((formats[0] as any).type).toBe('json_schema');
    expect(formats[1]).toBe('json');
  });

  test('re-asks instead of clamping an invalid semantic value', async () => {
    clearStructuredOutputCapabilityCache();
    let calls = 0;
    const value = await requestStructuredCompletion({
      config, messages: [{ role: 'user', content: 'return JSON' }], schema, schemaName: 'repair_test', repairAttempts: 1,
      request: async (_config, messages) => {
        calls += 1;
        if (calls === 1) return { text: '{"priority":90,"label":"same"}', elapsed: 1 };
        expect(messages.at(-1)?.content).toContain('priority');
        expect(messages.at(-1)?.content).toContain('70');
        return { text: '{"priority":70,"label":"same"}', elapsed: 1 };
      },
    });
    expect(calls).toBe(2);
    expect(value).toEqual({ priority: 70, label: 'same' });
  });
});
