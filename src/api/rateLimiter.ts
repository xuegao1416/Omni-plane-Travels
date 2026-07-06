// ============================================================
// API 调用限流器 — 避免连续调用触发 429 错误
// ============================================================

let lastCallTime = 0;
let currentInterval = 3000; // 默认 3 秒（可通过 setRateLimitInterval 或 detectOptimalRateLimit 调整）

/**
 * 设置限流间隔
 * @param intervalMs 间隔毫秒数
 */
export function setRateLimitInterval(intervalMs: number): void {
  currentInterval = Math.max(1000, Math.min(60000, intervalMs)); // 限制在 1-60 秒
}

/**
 * 获取当前限流间隔
 */
export function getRateLimitInterval(): number {
  return currentInterval;
}

/**
 * 等待直到可以进行下一次 API 调用
 * 在每次 API 调用前调用此函数
 */
export async function waitForRateLimit(): Promise<void> {
  const now = Date.now();
  const timeSinceLastCall = now - lastCallTime;
  if (timeSinceLastCall < currentInterval) {
    const waitTime = currentInterval - timeSinceLastCall;
    console.debug(`⏳ [限流] 等待 ${Math.round(waitTime)}ms（间隔 ${currentInterval}ms）`);
    await new Promise(resolve => setTimeout(resolve, waitTime));
  }
  lastCallTime = Date.now();
}

/**
 * 测试 API 限流间隔
 * @param testApiCall 测试用的 API 调用函数
 * @param onProgress 进度回调
 * @returns 推荐的限流间隔（毫秒）
 */
export async function detectOptimalRateLimit(
  testApiCall: () => Promise<void>,
  onProgress?: (message: string) => void
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
