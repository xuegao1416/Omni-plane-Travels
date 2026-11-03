import { requestCompletion, requestCompletionStream } from '../api/client';
import { bucketKeyForConfig, setRateLimitInterval, waitForRateLimit } from '../api/rateLimiter';
import type { ApiConfig, CompletionResult } from '../api/types';
import type { NovelAnalysisRequest } from './analysisClient';

interface Pool { active: number; limit: number; blockedUntil: number; }
const pools = new Map<string, Pool>();

/** 可中断的等待竞态：取消任务时不必等完当前的限流间隔。 */
function abortWhen(signal?: AbortSignal): Promise<never> {
  return new Promise((_, reject) => {
    if (!signal) return;
    const reason = () => signal.reason ?? new DOMException('Aborted', 'AbortError');
    if (signal.aborted) { reject(reason()); return; }
    signal.addEventListener('abort', () => reject(reason()), { once: true });
  });
}

/**
 * 小说分析专用限流桶（`novel:analysis:` 前缀），独立于游戏内请求：
 * - 避免拆解批量请求拖慢游戏对话/记忆/模块构建
 * - 仍按 provider@baseUrl 分桶，多个小说任务在同一端点间共享同一桶
 * - 间隔来自小说拆解台配置（注入到 config.rateLimitMs）；收到 429 后自动抬高
 */
function novelAnalysisBucket(config: ApiConfig): string {
  return `novel:analysis:${bucketKeyForConfig(config)}`;
}

export async function applyNovelRateLimit(config: ApiConfig, signal?: AbortSignal): Promise<void> {
  const bucket = novelAnalysisBucket(config);
  if (typeof config.rateLimitMs === 'number' && config.rateLimitMs > 0) {
    setRateLimitInterval(config.rateLimitMs, bucket);
  }
  await Promise.race([waitForRateLimit(bucket), abortWhen(signal)]);
}

export function waitNovelRequest(ms: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const finish = () => { signal?.removeEventListener('abort', abort); resolve(); };
    const timer = setTimeout(finish, Math.max(0, ms));
    const abort = () => { clearTimeout(timer); reject(signal?.reason ?? new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** One bounded pool per endpoint, shared by every novel task in this window. */
export function createNovelAnalysisRequest(onResult?: (result?: CompletionResult, message?: string) => void,
  transport?: NovelAnalysisRequest): NovelAnalysisRequest {
  return async (config, messages, options) => {
    const key = config.baseUrl.replace(/\/+$/, '').toLowerCase();
    const pool = pools.get(key) ?? { active: 0, limit: 2, blockedUntil: 0 }; pools.set(key, pool);
    for (let attempt = 0; ; attempt++) {
      options.signal?.throwIfAborted();
      if (!transport && attempt === 0) {
        const waitStart = Date.now();
        await applyNovelRateLimit(config, options.signal);
        const waited = Date.now() - waitStart;
        if (waited >= 1500) onResult?.(undefined, `按限流间隔等待 ${Math.ceil(waited / 1000)} 秒`);
      }
      while (pool.active >= pool.limit || Date.now() < pool.blockedUntil) await waitNovelRequest(Math.min(250, Math.max(30, pool.blockedUntil - Date.now())), options.signal);
      pool.active++;
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => controller.abort(new Error('小说分析请求超时')), 180_000);
      try {
        onResult?.(undefined, 'request');
        const request = transport ?? (config.stream === false ? requestCompletion : requestCompletionStream);
        const result = await request(config, messages, { ...options, signal: controller.signal });
        if (!result.text.trim()) throw new Error('API 503: 返回内容为空');
        onResult?.(result); return result;
      } catch (error) {
        options.signal?.throwIfAborted();
        const text = error instanceof Error ? error.message : String(error);
        if (/insufficient_quota|quota_exceeded|配额已用尽|余额不足/i.test(text)) throw error;
        const status = Number(/API\s+(\d+)/.exec(text)?.[1]);
        if (![408, 429, 500, 502, 503, 504].includes(status) && !(error instanceof TypeError) && !controller.signal.aborted) throw error;
        if (attempt >= 2) throw new Error(`通道暂时不可用，已暂停：${text}`);
        if (status === 429) pool.limit = 1;
        const retryAfterMs = (error as { retryAfterMs?: number }).retryAfterMs;
        const delay = retryAfterMs ?? 2000 * 2 ** attempt;
        pool.blockedUntil = Math.max(pool.blockedUntil, Date.now() + delay);
        onResult?.(undefined, `等待接口恢复，${Math.ceil(delay / 1000)} 秒后重试`);
      } finally {
        clearTimeout(timer); options.signal?.removeEventListener('abort', abort); pool.active--;
      }
    }
  };
}
