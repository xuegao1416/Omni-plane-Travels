import { useEffect } from 'react';
import { acquireBodyScrollLock } from './bodyScrollLockManager';

/**
 * 当条件为 true 时锁定 body 滚动，防止弹窗后面的页面跟着滚动。
 * 自动恢复之前的 overflow 值。
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return undefined;
    return acquireBodyScrollLock(document.body);
  }, [locked]);
}
