import { expect, test } from 'bun:test';
import { applyNovelRateLimit, createNovelAnalysisRequest, waitNovelRequest } from './requestScheduler';
import { bucketKeyForConfig, getRateLimitInterval } from '../api/rateLimiter';
import type { ApiConfig, CompletionResult } from '../api/types';
const config = (name: string) => ({ baseUrl: `https://${name}.invalid/v1`, model: 'test', apiKey: '', provider: 'custom' } as ApiConfig);
const result = { text: '{}', elapsed: 1, finishReason: 'stop' } as CompletionResult;

test('fatal credentials stop immediately and rate limits obey the shared retry window', async () => {
  let calls = 0;
  const fatal = createNovelAnalysisRequest(undefined, async () => { calls++; throw new Error('API 401: unauthorized'); });
  await expect(fatal(config('fatal'), [], { onDelta: () => {} })).rejects.toThrow('401');
  expect(calls).toBe(1);
  calls = 0; const start = Date.now();
  const retry = createNovelAnalysisRequest(undefined, async () => {
    if (++calls === 1) throw Object.assign(new Error('API 429: limited'), { retryAfterMs: 40 });
    return result;
  });
  expect(await retry(config('retry'), [], { onDelta: () => {} })).toBe(result);
  expect(calls).toBe(2); expect(Date.now() - start).toBeGreaterThanOrEqual(40);
});

test('novel analysis uses an independent bucket with the configured interval', async () => {
  const cfg = { ...config('ratelimited'), rateLimitMs: 1000 } as ApiConfig;
  const bucket = `novel:analysis:${bucketKeyForConfig(cfg)}`;
  await applyNovelRateLimit(cfg);
  expect(getRateLimitInterval(bucket)).toBe(1000);
  // 游戏内同端点的桶不受影响
  expect(getRateLimitInterval(bucketKeyForConfig(cfg))).toBe(3000);
  const start = Date.now();
  await applyNovelRateLimit(cfg);
  expect(Date.now() - start).toBeGreaterThanOrEqual(900);
});

test('queued and backoff requests can be cancelled before transport', async () => {
  const controller = new AbortController();
  const waiting = waitNovelRequest(60_000, controller.signal); controller.abort();
  await expect(waiting).rejects.toThrow();
  let calls = 0;
  const request = createNovelAnalysisRequest(undefined, async () => { calls++; return result; });
  await expect(request(config('aborted'), [], { signal: controller.signal, onDelta: () => {} })).rejects.toThrow();
  expect(calls).toBe(0);
});
