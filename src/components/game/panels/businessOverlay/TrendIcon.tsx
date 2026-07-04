import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

export function TrendIcon({ trend }: { trend: string }) {
  if (trend === 'up') return <TrendingUp size={13} color="#22c55e" />;
  if (trend === 'down') return <TrendingDown size={13} color="#ef4444" />;
  return <Minus size={13} color="var(--text-muted)" />;
}
