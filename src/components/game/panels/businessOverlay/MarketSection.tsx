import type { MarketItem } from '../../../../modules/schema';
import { TrendIcon } from './TrendIcon';

export function MarketSection({ items }: { items: MarketItem[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
      {items.map((item) => (
        <MarketRow key={item.name} item={item} />
      ))}
    </div>
  );
}

function MarketRow({ item }: { item: MarketItem }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: 'var(--font-size-sm)' }}>
      <span style={{ flex: 1 }}>{item.name}</span>
      <span style={{ fontWeight: 600 }}>{item.basePrice}</span>
      <TrendIcon trend={item.trend} />
      <span style={{
        fontSize: 'var(--font-size-xs)', fontWeight: 600,
        color: item.trend === 'up' ? 'var(--success)' : item.trend === 'down' ? 'var(--danger)' : 'var(--text-muted)',
      }}>
        {item.changePercent > 0 ? '+' : ''}{item.changePercent}%
      </span>
    </div>
  );
}
