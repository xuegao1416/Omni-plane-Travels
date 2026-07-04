export function getQualityColor(q: string) {
  switch (q) {
    case '传说': return '#f59e0b';
    case '史诗': return '#8b5cf6';
    case '稀有': return '#3b82f6';
    case '精良': return '#22c55e';
    default: return '#9ca3af';
  }
}
