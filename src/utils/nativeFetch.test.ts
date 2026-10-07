import { describe, expect, test } from 'bun:test';
import { createNativeFetch, type NativeFetchDependencies } from './nativeFetch';

function setup(native: NativeFetchDependencies['loadNativeFetch'], tauri = true) {
  let browserCalls = 0;
  const request = createNativeFetch({
    isTauri: () => tauri,
    loadNativeFetch: native,
    browserFetch: async () => { browserCalls++; return new Response('browser'); },
  });
  return { request, browserCalls: () => browserCalls };
}

describe('platform HTTP transport', () => {
  test('browser environments never load the native module', async () => {
    let loaded = false;
    const transport = setup(async () => { loaded = true; throw new Error('should never load'); }, false);
    expect(await (await transport.request('https://provider.invalid')).text()).toBe('browser');
    expect(loaded).toBe(false);
  });
  test('uses native streaming without changing URL, headers or body', async () => {
    const controller = new AbortController();
    const transport = setup(async () => async (url, init) => {
      expect(url).toBe('https://proxy.invalid');
      expect(init?.headers).toEqual({ 'X-Target-URL': 'https://provider.invalid/v4/chat/completions' });
      expect(init?.body).toBe('{"stream":true}');
      expect(init?.signal).toBe(controller.signal);
      return new Response('data: {"choices":[]}\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
    });
    const response = await transport.request('https://proxy.invalid', {
      method: 'POST', headers: { 'X-Target-URL': 'https://provider.invalid/v4/chat/completions' },
      body: '{"stream":true}', signal: controller.signal,
    });
    expect(await response.text()).toContain('data:');
    expect(response.headers.get('Content-Type')).toBe('text/event-stream');
    expect(transport.browserCalls()).toBe(0);
  });
  test('falls back only if the native module cannot load', async () => {
    const transport = setup(async () => { throw new Error('module unavailable'); });
    expect(await (await transport.request('https://provider.invalid')).text()).toBe('browser');
    expect(transport.browserCalls()).toBe(1);
  });
  test.each(['scope denied', 'network failure'])('never repeats an issued native request after %s', async message => {
    const failure = new Error(message);
    const transport = setup(async () => async () => { throw failure; });
    await expect(transport.request('https://provider.invalid')).rejects.toBe(failure);
    expect(transport.browserCalls()).toBe(0);
  });
  test('a pre-cancelled request neither loads the plugin nor sends HTTP', async () => {
    const controller = new AbortController(); controller.abort();
    let loaded = false;
    const transport = setup(async () => { loaded = true; return async () => new Response('native'); });
    await expect(transport.request('https://provider.invalid', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(loaded).toBe(false);
    expect(transport.browserCalls()).toBe(0);
  });
  test('normalizes native cancellation to the caller reason without a second request', async () => {
    const controller = new AbortController();
    const transport = setup(async () => async () => {
      controller.abort(); throw new Error('Request cancelled');
    });
    await expect(transport.request('https://provider.invalid', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport.browserCalls()).toBe(0);
  });
  test('cancels a stalled response body and releases native stream resources', async () => {
    const controller = new AbortController(); let cancelled = false;
    const transport = setup(async () => async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    const response = await transport.request('https://provider.invalid', { signal: controller.signal });
    const reading = response.text(); controller.abort();
    await expect(reading).rejects.toMatchObject({ name: 'AbortError' });
    expect(cancelled).toBe(true);
  });
  test('keeps a deadline active after headers and aborts a stalled body', async () => {
    let requestSignal: AbortSignal | null | undefined;
    const transport = setup(async () => async (_url, init) => {
      requestSignal = init?.signal;
      return new Response(new ReadableStream());
    });
    const response = await transport.request('https://provider.invalid', { timeoutMs: 15 });
    await expect(response.text()).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(requestSignal?.aborted).toBe(true);
  });
  test('clears the deadline when a body completes', async () => {
    let requestSignal: AbortSignal | null | undefined;
    const transport = setup(async () => async (_url, init) => { requestSignal = init?.signal; return new Response('done'); });
    expect(await (await transport.request('https://provider.invalid', { timeoutMs: 10 })).text()).toBe('done');
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(requestSignal?.aborted).toBe(false);
  });
  test('consumer stream cancellation releases the underlying response', async () => {
    let cancelled = false;
    const transport = setup(async () => async () => new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    const response = await transport.request('https://provider.invalid', { timeoutMs: 1000 });
    await response.body!.cancel();
    expect(cancelled).toBe(true);
  });
  test('cancelled plugin loading settles promptly without issuing a request', async () => {
    let finishLoading!: (value: Awaited<ReturnType<NativeFetchDependencies['loadNativeFetch']>>) => void;
    let nativeCalls = 0;
    const transport = setup(() => new Promise(resolve => { finishLoading = resolve; }));
    const controller = new AbortController();
    const pending = transport.request('https://provider.invalid', { signal: controller.signal });
    controller.abort();
    const outcome = await Promise.race([
      pending.then(() => 'resolved', error => error.name),
      new Promise(resolve => setTimeout(() => resolve('still waiting'), 50)),
    ]);
    finishLoading(async () => { nativeCalls++; return new Response('late'); });
    expect(outcome).toBe('AbortError');
    expect(nativeCalls).toBe(0);
    expect(transport.browserCalls()).toBe(0);
  });
  test('cancelled requests promptly reject and cancel bodies of late responses', async () => {
    let finishRequest!: (response: Response) => void;
    let issued!: () => void;
    const started = new Promise<void>(resolve => { issued = resolve; });
    let cancelled = false;
    const transport = setup(async () => () => new Promise(resolve => { finishRequest = resolve; issued(); }));
    const controller = new AbortController();
    const pending = transport.request('https://provider.invalid', { signal: controller.signal });
    await started;
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    finishRequest(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
    await Promise.resolve();
    expect(cancelled).toBe(true);
    expect(transport.browserCalls()).toBe(0);
  });
});
