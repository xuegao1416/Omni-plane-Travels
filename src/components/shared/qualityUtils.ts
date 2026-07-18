export function getQualityColor(q: string) {
  switch (q) {
    case '传说': return '#d97706';
    case '史诗': return '#8b5cf6';
    case '稀有': return '#3b82f6';
    case '精良': return '#16a34a';
    default: return '#9ca3af';
  }
}

/**
 * 给颜色加透明度 — 兼容 CSS 变量和 hex。
 * 用法：withAlpha('#3b82f6', 0.25) → 'color-mix(in srgb, #3b82f6 25%, transparent)'
 */
export function withAlpha(color: string, alpha: number): string {
  return `color-mix(in srgb, ${color} ${Math.round(alpha * 100)}%, transparent)`;
}
