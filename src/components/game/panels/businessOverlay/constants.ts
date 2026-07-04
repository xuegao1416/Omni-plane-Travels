export const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  active: { bg: '#22c55e20', text: '#22c55e', label: '营业中' },
  idle: { bg: '#94a3b820', text: '#94a3b8', label: '闲置' },
  damaged: { bg: '#ef444420', text: '#ef4444', label: '受损' },
  destroyed: { bg: '#6b728020', text: '#6b7280', label: '已毁' },
};

export const RISK_COLORS: Record<string, { color: string; label: string }> = {
  low: { color: '#22c55e', label: '低' },
  medium: { color: '#eab308', label: '中' },
  high: { color: '#ef4444', label: '高' },
};

export const TRANSACTION_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  income: { label: '收入', color: '#22c55e' },
  expense: { label: '支出', color: '#ef4444' },
  acquire: { label: '收购', color: 'var(--accent)' },
  upgrade: { label: '升级', color: '#3b82f6' },
  event: { label: '事件', color: '#eab308' },
};
