import { useEffect } from 'react';

/**
 * 当条件为 true 时锁定 body 滚动，防止弹窗后面的页面跟着滚动。
 * 自动恢复之前的 overflow 值。
 */
export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [locked]);
}
