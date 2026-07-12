export function getQualityColor(q: string) {
  switch (q) {
    case '传说': return 'var(--warning)';
    case '史诗': return '#8b5cf6';
    case '稀有': return '#3b82f6';
    case '精良': return 'var(--success)';
    default: return '#9ca3af';
  }
}
