import { describe, expect, spyOn, test } from 'bun:test';
import { callAuxiliaryApi } from './auxiliaryApi';
import type { ApiConfig } from './types';

const config: ApiConfig = { provider: 'custom', apiKey: '', baseUrl: 'https://auxiliary.invalid/v1', model: 'test' };

describe('auxiliary request body lifetime', () => {
  test('external cancellation stays connected after headers arrive', async () => {
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
    const controller = new AbortController();
    let requestSignal: AbortSignal | undefined;
    let ready!: () => void;
    let release!: () => void;
    const reading = new Promise<void>(resolve => { ready = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (_url: unknown, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return { ok: true, json: async () => {
        ready(); await waiting;
        return { choices: [{ message: { content: '{"shouldNotApply":true}' } }] };
      } } as Response;
    }, { preconnect: globalThis.fetch.preconnect }));
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pending = callAuxiliaryApi(config, [], '更新变量', controller.signal);
      await reading;
      controller.abort(new DOMException('cancelled', 'AbortError'));
      const connected = requestSignal?.aborted;
      release();
      const outcome = await pending.then(value => ({ value }), error => ({ error }));
      expect(connected).toBe(true);
      expect('error' in outcome && outcome.error.name).toBe('AbortError');
    } finally {
      release(); fetch.mockRestore(); warn.mockRestore();
      if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });

  test('timeout remains armed until the response body finishes', async () => {
    const priorStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => null } });
    let expire: (() => void) | undefined;
    let armed = false;
    let ready!: () => void; let release!: () => void;
    const reading = new Promise<void>(resolve => { ready = resolve; });
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const realSetTimeout = globalThis.setTimeout;
    const realClearTimeout = globalThis.clearTimeout;
    let timer: ReturnType<typeof setTimeout>;
    const set = spyOn(globalThis, 'setTimeout').mockImplementation(((callback: () => void, ms: number) => {
      if (ms !== 120_000) return realSetTimeout(callback, ms);
      armed = true; expire = callback; timer = realSetTimeout(() => {}, 120_000); return timer;
    }) as typeof setTimeout);
    const clear = spyOn(globalThis, 'clearTimeout').mockImplementation(((id: ReturnType<typeof setTimeout>) => {
      if (id === timer) armed = false;
      realClearTimeout(id);
    }) as typeof clearTimeout);
    const fetch = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async () => ({ ok: true, json: async () => {
      ready(); await waiting; return { choices: [{ message: { content: '{}' } }] };
    } }) as Response, { preconnect: globalThis.fetch.preconnect }));
    const warn = spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const pending = callAuxiliaryApi(config, [], '更新变量');
      await reading;
      const armedDuringBody = armed;
      if (armed) expire?.();
      release();
      const outcome = await pending.then(value => ({ value }), error => ({ error }));
      expect(armedDuringBody).toBe(true);
      expect('error' in outcome && outcome.error.name).toBe('TimeoutError');
      expect(armed).toBe(false);
    } finally {
      release(); clear.mockRestore(); set.mockRestore(); fetch.mockRestore(); warn.mockRestore();
      if (priorStorage) Object.defineProperty(globalThis, 'localStorage', priorStorage); else Reflect.deleteProperty(globalThis, 'localStorage');
    }
  });
});
