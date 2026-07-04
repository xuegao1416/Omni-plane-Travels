/**
 * 世界动态面板 — 事件列表标签页
 */

import { Zap, Trash2 } from 'lucide-react';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';
import type { SimEvent } from '../../../../simulation/types';
import { EventCard } from './EventCard';
import { EmptyState } from './EmptyState';

interface EventsTabProps {
  activeEvents: SimEvent[];
  tickCount?: number;
  worldNewsSummary?: string;
  onManualTick?: () => void;
  isSimulating?: boolean;
}

export function EventsTab({ activeEvents, tickCount, worldNewsSummary, onManualTick, isSimulating }: EventsTabProps) {
  return (
    <>
      {worldNewsSummary && (
        <div style={{
          fontSize: 'var(--font-size-xs)', padding: '8px 10px', marginBottom: '10px',
          background: 'var(--accent-dim)', borderRadius: 'var(--radius-md)',
          color: 'var(--text-secondary)', lineHeight: '1.6',
          border: '1px solid var(--accent)',
        }}>
          <div style={{ fontWeight: 600, color: 'var(--accent)', marginBottom: '4px', fontSize: 'var(--font-size-xs)' }}>
            <Zap size={12} style={{ verticalAlign: 'middle', marginRight: '4px' }} />
            世界新闻
          </div>
          {worldNewsSummary}
        </div>
      )}

      {activeEvents.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '8px' }}>
            <button
              onClick={() => getSimulationEngine().clearAllEvents()}
              className="btn-ghost btn-xs"
              style={{ color: 'var(--danger)', fontSize: 'var(--font-size-xs)' }}
            >
              <Trash2 size={10} style={{ marginRight: '4px' }} />
              全部清除
            </button>
          </div>
          {activeEvents.map(evt => (
            <EventCard key={evt.id} event={evt} tickCount={tickCount} />
          ))}
        </>
      )}

      {onManualTick && (
        <button
          onClick={onManualTick}
          disabled={isSimulating}
          className="btn-ghost btn-sm"
          style={{ width: '100%', marginTop: 'var(--space-3)' }}
        >
          {isSimulating ? '推演中...' : '手动推演一次'}
        </button>
      )}
    </>
  );
}
