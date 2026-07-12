import { describe, it, expect } from 'bun:test';
import {
  parseRetryAfter,
  notifyRateLimited,
  waitForRateLimit,
  getRateLimitInterval,
  setRateLimitInterval,
  bucketKeyForConfig,
} from '../api/rateLimiter';

describe('rateLimiter.parseRetryAfter', () => {
  it('解析 delta-seconds', () => {
    expect(parseRetryAfter('30')).toBe(30000);
  });

  it('解析 HTTP-date', () => {
    const future = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).not.toBeNull();
    expect(ms!).toBeGreaterThanOrEqual(4000);
    expect(ms!).toBeLessThanOrEqual(6000);
  });

  it('无效值返回 null', () => {
    expect(parseRetryAfter('garbage')).toBeNull();
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter('')).toBeNull();
    expect(parseRetryAfter(undefined)).toBeNull();
  });
});

describe('rateLimiter — 分桶与 429 反馈', () => {
  it('带有 Retry-After 时按服务端时间抬高间隔', () => {
    setRateLimitInterval(3000, 'a@b');
    notifyRateLimited('10', 'a@b');
    expect(getRateLimitInterval('a@b')).toBeGreaterThanOrEqual(11000);
  });

  it('分桶隔离：一个桶被 429 不影响其他桶', () => {
    setRateLimitInterval(3000, 'x@y');
    setRateLimitInterval(3000, 'p@q');
    notifyRateLimited('20', 'x@y');
    expect(getRateLimitInterval('x@y')).toBeGreaterThan(3000);
    expect(getRateLimitInterval('p@q')).toBe(3000);
  });

  it('无 Retry-After 时间隔翻倍（指数退避）', () => {
    setRateLimitInterval(3000, 'n@o');
    notifyRateLimited(null, 'n@o');
    expect(getRateLimitInterval('n@o')).toBe(6000);
  });

  it('bucketKeyForConfig 按 provider+baseUrl 分桶', () => {
    expect(bucketKeyForConfig({ provider: 'openai', baseUrl: 'https://api.openai.com/v1' }))
      .toBe('openai@https://api.openai.com/v1');
  });
});

describe('rateLimiter.waitForRateLimit — 桶逻辑', () => {
  it('间隔未到则等待约 interval 毫秒', async () => {
    setRateLimitInterval(50, 'w@1');
    const start = Date.now();
    await waitForRateLimit('w@1'); // 首次不等待，仅记录时间戳
    await waitForRateLimit('w@1'); // 第二次应等待约 50ms
    const elapsed = Date.now() - start;
    expect(elapsed).toBeGreaterThanOrEqual(40);
  });

  it('不同桶独立计时', async () => {
    setRateLimitInterval(50, 'w@2');
    setRateLimitInterval(50, 'w@3');
    await waitForRateLimit('w@2');
    const start = Date.now();
    await waitForRateLimit('w@3'); // w@3 尚未调用过，不等待
    expect(Date.now() - start).toBeLessThan(40);
  });
});
