import { expect, test } from 'bun:test';
import { generateConfiguredImage } from './imageGen';
import { DEFAULT_IMAGE_CONFIG } from './imageGenTypes';

test('compatible image queues accept generation with a configured global negative prompt', async () => {
  const previous = globalThis.fetch;
  const requests: Record<string, unknown>[] = [];
  globalThis.fetch = (async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push(body);
    if (Object.hasOwn(body, 'negative_prompt')) {
      return Response.json({ error: { message: 'negative_prompt 不是文生图队列支持的字段' } }, { status: 400 });
    }
    return Response.json({ data: [{ b64_json: btoa('image bytes'), mime_type: 'image/png' }] });
  }) as typeof fetch;
  try {
    const result = await generateConfiguredImage('portrait, dramatic lighting', {
      ...DEFAULT_IMAGE_CONFIG, engine: 'openai_compatible', openaiCompatibleProvider: 'custom',
      openaiCompatibleApiUrl: 'https://agnes.invalid/v1', openaiCompatibleApiKey: 'test-placeholder',
      openaiCompatibleModel: 'test-image', positivePrompt: 'best quality, portrait', negativePrompt: 'blurry, bad anatomy',
    });
    expect(requests).toHaveLength(1);
    expect(Object.keys(requests[0]!).sort()).toEqual(['model', 'n', 'prompt', 'response_format', 'size']);
    expect(requests[0]).toMatchObject({ model: 'test-image', prompt: 'best quality, portrait, dramatic lighting', n: 1 });
    expect(await result.blob.text()).toBe('image bytes');
    expect(result.negativePrompt).toBe('');
  } finally { globalThis.fetch = previous; }
});
