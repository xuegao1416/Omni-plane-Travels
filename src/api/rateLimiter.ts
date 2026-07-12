// ============================================================
// API 调用限流器 — 避免连续调用触发 429
// - 支持按 provider+baseUrl 分桶（L-17），不同 LLM 端点独立限流
// - 尊重服务端 429 的 Retry-After（delta-seconds / HTTP-date）
// ============================================================

import type { ApiConfig } from './types';

const DEFAULT_BUCKET = 'default';

interface BucketState {
  lastCallTime: number; // 上次调用时间戳（绝对毫秒）
  interval: number; // 当前最小限流间隔（毫秒）
  retryAfterUntil: number; // 因 429 被屏蔽到的绝对时间戳（毫秒）
}

const buckets = new Map<string, BucketState>();
const MIN_INTERVAL = 1000;
const MAX_INTERVAL = 60000;

function getBucket(bucket: string): BucketState {
  let b = buckets.get(bucket);
  if (!b) {
    b = { lastCallTime: 0, interval: 3000, retryAfterUntil: 0 };
    buckets.set(bucket, b);
  }
  return b;
}

/**
 * 由 ApiConfig 生成分桶 key（L-17）：provider@baseUrl（小写、去尾斜杠）。
 * 同 provider 同 baseUrl 的请求共享一个限流桶。
 */
export function bucketKeyForConfig(config?: { provider?: string; baseUrl?: string } | null): string {
  if (!config) return DEFAULT_BUCKET;
  const provider = (config.provider || 'unknown').toLowerCase();
  const base = (config.baseUrl || '').replace(/\/+$/, '').toLowerCase();
  return `${provider}@${base || 'no-baseurl'}`;
}

/**
 * 解析 429 响应的 Retry-After 头。
 * - delta-seconds：纯数字 → 毫秒
 * - HTTP-date：RFC1123 日期 → 距现在的毫秒
 * 无法解析（空 / 非法 / null / undefined）返回 null。
 */
export function parseRetryAfter(headerValue: string | null | undefined): number | null {
  if (headerValue == null) return null;
  const value = String(headerValue).trim();
  if (!value) return null;
  // delta-seconds
  if (/^\d+$/.test(value)) {
    return parseInt(value, 10) * 1000;
  }
  // HTTP-date
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

/**
 * 收到 429 时调用（L-17）：记录 Retry-After 屏蔽期，并抬高该桶限流间隔。
 * @param retryAfterHeader 原始 Retry-After 头（可为空）
 * @param bucket 分桶 key
 */
export function notifyRateLimited(retryAfterHeader: string | null | undefined, bucket: string): void {
  const b = getBucket(bucket || DEFAULT_BUCKET);
  const parsed = parseRetryAfter(retryAfterHeader);
  const now = Date.now();

  // 1) 设置屏蔽期（尊重服务端 Retry-After；无头则用当前间隔作为退避）
  const blockMs = parsed == null ? b.interval * 2 : parsed;
  b.retryAfterUntil = Math.max(b.retryAfterUntil, now + blockMs);

  // 2) 抬高间隔：有 Retry-After → 服务端等待 + 一倍余量；无 → 指数退避（×2）
  const next = parsed == null ? b.interval * 2 : parsed + b.interval;
  b.interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, Math.round(next)));

  console.warn(
    `[限流] 桶 ${bucket} 收到 429，暂停至 ${new Date(b.retryAfterUntil).toLocaleTimeString()}，间隔调整为 ${b.interval}ms`,
  );
}

/** 设置某桶限流间隔（兼容旧 API：不传 bucket 则改默认桶） */
export function setRateLimitInterval(intervalMs: number, bucket: string = DEFAULT_BUCKET): void {
  const b = getBucket(bucket || DEFAULT_BUCKET);
  b.interval = Math.min(MAX_INTERVAL, Math.max(MIN_INTERVAL, intervalMs));
}

/** 获取某桶限流间隔 */
export function getRateLimitInterval(bucket: string = DEFAULT_BUCKET): number {
  return getBucket(bucket || DEFAULT_BUCKET).interval;
}

/**
 * 等待直到该桶可进行下一次调用（尊重 429 屏蔽期 + 最小间隔）。
 * - 传字符串 → 视为桶 key
 * - 传 ApiConfig → 自动分桶
 * - 不传 → 默认桶
 * 每次 API 调用前调用。
 */
export async function waitForRateLimit(
  bucketOrConfig?: string | { provider?: string; baseUrl?: string } | null,
): Promise<void> {
  const bucket =
    typeof bucketOrConfig === 'string'
      ? bucketOrConfig || DEFAULT_BUCKET
      : bucketKeyForConfig(bucketOrConfig);
  const b = getBucket(bucket);
  const now = Date.now();

  // 1) 429 屏蔽期优先
  const blockWait = b.retryAfterUntil - now;
  if (blockWait > 0) {
    console.debug(`⏳ [限流] 桶 ${bucket} 处于 429 屏蔽期，等待 ${Math.round(blockWait)}ms`);
    await new Promise((resolve) => setTimeout(resolve, blockWait));
  }

  // 2) 最小间隔
  const since = Date.now() - b.lastCallTime;
  if (since < b.interval) {
    const waitTime = b.interval - since;
    console.debug(`⏳ [限流] 桶 ${bucket} 间隔等待 ${Math.round(waitTime)}ms（间隔 ${b.interval}ms）`);
    await new Promise((resolve) => setTimeout(resolve, waitTime));
  }
  b.lastCallTime = Date.now();
}

/**
 * 测试 API 限流间隔
 * @param testApiCall 测试用的 API 调用函数
 * @param onProgress 进度回调
 * @returns 推荐的限流间隔（毫秒）
 */
export async function detectOptimalRateLimit(
  testApiCall: () => Promise<void>,
  onProgress?: (message: string) => void,
): Promise<number> {
  const testIntervals = [1000, 2000, 3000, 5000, 8000, 10000, 15000, 20000];
  let lastSuccessInterval = 20000; // 默认保守值

  onProgress?.('开始测试 API 限流间隔...');

  const originalInterval = 10000;
  try {
    for (const interval of testIntervals) {
      onProgress?.(`测试间隔: ${interval}ms`);

      // 设置间隔并等待
      setRateLimitInterval(interval);
      await waitForRateLimit();

      try {
        await testApiCall();
        lastSuccessInterval = interval;
        onProgress?.(`✓ ${interval}ms 成功`);
      } catch (err: unknown) {
        const errMsg = err instanceof Error ? err.message : String(err);
        const is429 = errMsg.includes('429') || errMsg.includes('rate limit');
        if (is429) {
          onProgress?.(`✗ ${interval}ms 触发限流，停止测试`);
          break;
        }
        // 非 429 错误，继续测试
        onProgress?.(`✗ ${interval}ms 失败（非限流错误）`);
      }
    }

    // 推荐值：最后成功的间隔 + 20% 余量
    const recommended = Math.ceil(lastSuccessInterval * 1.2 / 1000) * 1000;
    onProgress?.(`推荐限流间隔: ${recommended}ms`);
    return recommended;
  } finally {
    // 无论成功失败，始终恢复默认间隔
    setRateLimitInterval(originalInterval);
  }
}
