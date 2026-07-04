/**
 * 统一断点常量 — CSS 与 JS 的单一来源
 *
 * CSS @media 查询无法引用 CSS 自定义属性，因此断点数值必须以裸数值
 * 出现在 @media 中。此文件作为 JS 侧的单一来源，CSS 侧的 @media
 * 裸数值必须与此处保持一致。
 *
 * 断点策略（max-width，desktop-first 逐步降级）：
 * - xs  360px  iPhone SE 等极窄屏
 * - sm  480px  主流手机
 * - md  768px  平板
 * - lg  1024px 平板横屏 / 小桌面
 */
export const BREAKPOINTS = {
  xs: 360,
  sm: 480,
  md: 768,
  lg: 1024,
} as const;

export type BreakpointKey = keyof typeof BREAKPOINTS;
export type BreakpointValue = typeof BREAKPOINTS[BreakpointKey];
