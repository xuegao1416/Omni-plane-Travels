import { describe, expect, test } from 'bun:test';
import { z } from 'zod';
import { clearStructuredOutputCapabilityCache, requestStructuredCompletion } from './structuredOutput';
import type { ApiConfig } from './types';

const config: ApiConfig = { apiKey: 'x', baseUrl: 'https://example.test/v1', model: 'test-model', provider: 'custom' };
const schema = z.object({ priority: z.number().int().min(0).max(70), label: z.string() }).strict();

describe('requestStructuredCompletion', () => {
  test('falls back to schema-guided plain text when both response formats are unsupported', async () => {
    clearStructuredOutputCapabilityCache();
    const formats: unknown[] = [];
    const request = async (_config: ApiConfig, messages: import('./types').Message[], options?: import('./types').RequestOptions) => {
      formats.push(options?.responseFormat);
      if (options?.responseFormat !== 'text') throw Object.assign(new Error('API 400: unsupported response_format'), { status: 400 });
      expect(messages.map(message => message.content).join('\n')).toContain('priority');
      return { text: '{"priority":30,"label":"plain"}', elapsed: 1 };
    };
    const options = { config, messages: [{ role: 'user' as const, content: '生成结果' }], schema, schemaName: 'plain_test', request };
    expect((await requestStructuredCompletion(options)).label).toBe('plain');
    expect((await requestStructuredCompletion(options)).label).toBe('plain');
    expect(formats).toHaveLength(4);
    expect(formats.slice(1)).toEqual(['json', 'text', 'text']);
  });

  test.each(['length', 'content_filter'])('rejects valid-looking JSON with %s finish reason', async finishReason => {
    let calls = 0;
    await expect(requestStructuredCompletion({ config, messages: [], schema, schemaName: `finish_${finishReason}`,
      request: async () => { calls += 1; return { text: '{"priority":40,"label":"incomplete"}', finishReason, elapsed: 1 }; },
    })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('cancelled late responses are not accepted or repaired', async () => {
    const controller = new AbortController(); let calls = 0;
    await expect(requestStructuredCompletion({ config, messages: [], schema, schemaName: 'cancel_test', signal: controller.signal,
      request: async () => { calls += 1; controller.abort(); return { text: '{"priority":40,"label":"late"}', elapsed: 1 }; },
    })).rejects.toThrow();
    expect(calls).toBe(1);
  });

  test('does not downgrade JSON mode for unrelated invalid request parameters', async () => {
    clearStructuredOutputCapabilityCache(); let calls = 0;
    await expect(requestStructuredCompletion({ config, messages: [], schema, schemaName: 'invalid_parameter',
      request: async () => {
        calls += 1;
        throw Object.assign(new Error(calls === 1 ? 'unsupported json_schema' : 'invalid temperature'), { status: 400 });
      },
    })).rejects.toThrow('invalid temperature');
    expect(calls).toBe(2);
  });

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
