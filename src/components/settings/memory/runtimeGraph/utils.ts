export function formatDateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function formatRange(start: number | null | undefined, end: number | null | undefined): string {
  if (start == null && end == null) return '—';
  return `${start ?? '?'} ~ ${end ?? '?'}`;
}
