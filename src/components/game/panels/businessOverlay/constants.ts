export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: 'color-mix(in srgb, var(--success) 20%, transparent)', text: 'var(--success)', label: '营业中' },
  idle: { bg: '#94a3b820', text: '#94a3b8', label: '闲置' },
  damaged: { bg: 'var(--danger-bg-soft)', text: 'var(--danger)', label: '受损' },
  destroyed: { bg: '#6b728020', text: '#6b7280', label: '已毁' },
};

export const RISK_COLORS: Record<string, { color: string; label: string }> = {
  low: { color: 'var(--success)', label: '低' },
  medium: { color: 'var(--warning)', label: '中' },
  high: { color: 'var(--danger)', label: '高' },
};

export const TRANSACTION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  income: { label: '收入', color: 'var(--success)' },
  expense: { label: '支出', color: 'var(--danger)' },
  acquire: { label: '收购', color: 'var(--accent)' },
  upgrade: { label: '升级', color: '#3b82f6' },
  event: { label: '事件', color: 'var(--warning)' },
};
