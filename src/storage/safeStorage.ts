/**
 * localStorage 写入保护层
 *
 * 背景：localStorage 配额耗尽时浏览器抛出同步的 QuotaExceededError。
 * 若写入发生在 effect / store 的同步路径上，异常会冒泡到顶层 ErrorBoundary，
 * 整个界面被替换成错误面板；而"重试"只是重新挂载组件，下一次写入仍然失败，
 * 表现为"卡死、刷新也没用"。
 *
 * 因此这里把配额异常收敛成两类行为：
 * 1) 只清理可再生的纯缓存后重试一次；
 * 2) 仍然失败时抛出信息可读的 StorageQuotaError，交给调用方决定如何提示，
 *    不再让裸 DOMException 掀翻整个界面。
 */

/** 配额耗尽错误的统一标记 */
export const STORAGE_QUOTA_ERROR_CODE = 'STORAGE_QUOTA_EXCEEDED';

export class StorageQuotaError extends Error {
  readonly code = STORAGE_QUOTA_ERROR_CODE;

  constructor(message = '本地存储空间已满，请清理旧存档、旧世界或模板后重试。') {
    super(message);
    this.name = 'StorageQuotaError';
  }
}

/** 判断异常是否由存储配额耗尽引起（各浏览器抛出的形态不一致） */
export function isQuotaExceededError(err: unknown): boolean {
  if (!err) return false;
  if (err instanceof StorageQuotaError) return true;
  if (typeof DOMException !== 'undefined' && err instanceof DOMException) {
    if (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED') return true;
    if (err.code === 22 || err.code === 1014) return true;
  }
  const name = (err as { name?: unknown }).name;
  if (typeof name === 'string' && /quota/i.test(name)) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /quota.?exceed|exceeded the quota|quota has been exceeded|存储空间不足|超出配额/i.test(message);
}

/**
 * 可安全丢弃的纯缓存键：重新打开页面会自动重建，不含任何用户创作内容。
 * 注意——世界、草稿、模板、预设、存档一律不在此列。
 */
const REGENERABLE_CACHE_KEYS: readonly string[] = [
  'omni-plane-travels.local-embedding-models.v1',
];

/** 释放纯缓存，返回释放的键数量（绝不触碰用户数据） */
export function releaseRegenerableCache(): number {
  if (typeof localStorage === 'undefined') return 0;
  let released = 0;
  for (const key of REGENERABLE_CACHE_KEYS) {
    try {
      if (localStorage.getItem(key) !== null) {
        localStorage.removeItem(key);
        released += 1;
      }
    } catch {
      // localStorage 本身不可用时无需处理
    }
  }
  return released;
}

/**
 * 带配额保护的 localStorage 写入。
 *
 * @param key 存储键
 * @param value 待写入字符串
 * @throws StorageQuotaError 配额耗尽且释放缓存后仍无法写入
 * @throws 其他原生异常（与 localStorage.setItem 行为一致）
 */
export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
    return;
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
    releaseRegenerableCache();
    try {
      localStorage.setItem(key, value);
      return;
    } catch (retryErr) {
      if (!isQuotaExceededError(retryErr)) throw retryErr;
      console.error(
        `[存储] 本地配额已耗尽，写入失败：${key}（约 ${Math.round(value.length / 1024)} KB）。` +
        '请删除不再使用的存档或自建世界。',
      );
      throw new StorageQuotaError();
    }
  }
}

/**
 * 尽力写入：用于自动保存等"失败也不应打断玩家"的路径。
 * @returns 是否写入成功
 */
export function trySetItem(key: string, value: string): boolean {
  try {
    safeSetItem(key, value);
    return true;
  } catch (err) {
    if (!isQuotaExceededError(err)) throw err;
    return false;
  }
}
