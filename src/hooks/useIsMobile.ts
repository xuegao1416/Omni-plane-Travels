import { useState, useEffect, useMemo } from 'react';
import { BREAKPOINTS, type BreakpointKey } from '../constants/breakpoints';

/**
 * 检测当前视口是否为移动端
 * @param breakpoint - 断点宽度，默认 768px（BREAKPOINTS.md）
 * @returns boolean
 *
 * @deprecated 推荐使用 useBreakpoint() 获取精确档位，便于针对不同设备适配。
 *             现有调用点暂保留以向后兼容，后续阶段逐步迁移到 useBreakpoint。
 */
export function useIsMobile(breakpoint = BREAKPOINTS.md) {
  const [isMobile, setIsMobile] = useState(() =>
    typeof window !== 'undefined' ? window.innerWidth <= breakpoint : false
  );

  useEffect(() => {
    const mq = window.matchMedia(`(max-width: ${breakpoint}px)`);

    const handler = (e: MediaQueryListEvent | MediaQueryList) => {
      setIsMobile(e.matches);
    };

    // 初始化
    handler(mq);

    // 监听变化
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [breakpoint]);

  return isMobile;
}

/**
 * 获取当前视口的断点档位。
 * @returns 'xs'(≤360) | 'sm'(≤480) | 'md'(≤768) | 'lg'(≤1024) | 'xl'(>1024)
 *
 * 断点数值与 src/constants/breakpoints.ts 及 CSS @media 裸数值保持一致。
 */
export function useBreakpoint(): BreakpointKey | 'xl' {
  const compute = (): BreakpointKey | 'xl' => {
    if (typeof window === 'undefined') return 'xl';
    const w = window.innerWidth;
    if (w <= BREAKPOINTS.xs) return 'xs';
    if (w <= BREAKPOINTS.sm) return 'sm';
    if (w <= BREAKPOINTS.md) return 'md';
    if (w <= BREAKPOINTS.lg) return 'lg';
    return 'xl';
  };

  const [bp, setBp] = useState<BreakpointKey | 'xl'>(compute);

  useEffect(() => {
    const handler = () => setBp(compute());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  return bp;
}

/**
 * 便捷谓词：当前是否为手机（≤768px）
 */
export function useIsPhone(): boolean {
  const bp = useBreakpoint();
  return bp === 'xs' || bp === 'sm' || bp === 'md';
}

/**
 * 通用媒体查询 hook — 用于非标准断点（如 640px、900px）
 * @param query CSS 媒体查询字符串，如 '(max-width: 640px)'
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    setMatches(mq.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
