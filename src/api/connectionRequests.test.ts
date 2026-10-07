import { expect, spyOn, test } from 'bun:test';
import { fetchModels, testConnection } from './client';

const config = { provider: 'openai' as const, apiKey: 'synthetic-key', baseUrl: 'https://draft-api.invalid', model: 'draft-model' };
test('testing a draft proxy does not change the committed proxy', async () => {
  const calls: string[] = [];
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => 'https://committed-proxy.invalid', setItem: () => { throw Error('draft must not write'); } } });
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (url: string | URL | Request) => {
    calls.push(String(url)); return new Response(JSON.stringify({ data: [{ id: 'listed' }] }));
  }, { preconnect: globalThis.fetch.preconnect }));
  try {
    expect(await fetchModels(config, { proxyUrl: 'https://draft-proxy.invalid' })).toEqual(['listed']);
    expect((await testConnection(config, { proxyUrl: 'https://draft-proxy.invalid' })).success).toBe(true);
    expect(calls).toEqual(['https://draft-proxy.invalid', 'https://draft-proxy.invalid']);
  } finally {
    fetch.mockRestore();
    if (previousStorage) Object.defineProperty(globalThis, 'localStorage', previousStorage);
    else Reflect.deleteProperty(globalThis, 'localStorage');
  }
});
test('leaving a draft cancels even a stalled model-directory body', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Response(new ReadableStream<Uint8Array>({ start() {} })), { preconnect: globalThis.fetch.preconnect }));
  const controller = new AbortController();
  try {
    const pending = fetchModels(config, { signal: controller.signal, proxyUrl: '' });
    await Promise.resolve(); controller.abort(); await expect(pending).rejects.toThrow();
  } finally { fetch.mockRestore(); }
});
test('leaving a connection test cancels without issuing another request', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Promise<Response>(() => {}), { preconnect: globalThis.fetch.preconnect }));
  const controller = new AbortController();
  try {
    const pending = testConnection(config, { signal: controller.signal, proxyUrl: '' });
    await Promise.resolve(); controller.abort(); await expect(pending).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally { fetch.mockRestore(); }
});
test('a configured connection-test deadline settles the request instead of leaving the button busy', async () => {
  const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => new Promise<Response>(() => {}), { preconnect: globalThis.fetch.preconnect }));
  try {
    const result = await testConnection({ ...config, requestTimeoutMs: 5 }, { proxyUrl: '' });
    expect(result.success).toBe(false); expect(result.message).toContain('超时');
  } finally { fetch.mockRestore(); }
}, 200);
