/**
 * 世界动态面板 — 事件卡片
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, Target, X } from 'lucide-react';
import type { SimEvent } from '../../../../simulation/types';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';
import { LEVEL_ICONS, LEVEL_COLORS, getLevelLabel } from './constants';
import { PlayerHookItem } from './PlayerHookItem';

interface EventCardProps {
  event: SimEvent;
  depth?: number;
  tickCount?: number;
}

export function EventCard({ event, depth = 0, tickCount }: EventCardProps) {
  const [expanded, setExpanded] = useState(false);
  const severityBar = Math.min(100, event.severity * 10);
  const severityColor = event.severity >= 7 ? 'var(--danger)' : event.severity >= 4 ? 'var(--warning)' : 'var(--text-muted)';
  const staleTicks = tickCount != null ? tickCount - (event.lastUpdatedTick ?? 0) : 0;
  const isStale = staleTicks > 5;

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    getSimulationEngine().removeEvent(event.id);
  };

  return (
    <div style={{
      marginBottom: '8px',
      marginLeft: `${depth * 16}px`,
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
    }}>
      {/* 头部 */}
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--space-2)',
          padding: '8px 10px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{ color: LEVEL_COLORS[event.level], display: 'flex', alignItems: 'center', gap: '4px' }}>
          {LEVEL_ICONS[event.level]}
          <span style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600 }}>{getLevelLabel(event.level)}</span>
        </span>
        <span style={{ flex: 1, fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {event.title}
        </span>
        {/* 严重度条 */}
        <div style={{
          width: '40px', height: '4px', borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-tertiary)', overflow: 'hidden',
        }}>
          <div style={{
            width: `${severityBar}%`, height: '100%',
            background: severityColor, borderRadius: 'var(--radius-sm)',
          }} />
        </div>
        <span className={`event-badge ${event.status}`}>
          {event.status === 'brewing' ? '酝酿' : event.status === 'active' ? '进行中' : '已结束'}
        </span>
        {isStale && event.status === 'active' && (
          <span className="event-badge brewing" style={{ fontSize: 'var(--font-size-xs)', padding: '1px 4px' }}>
            沉寂
          </span>
        )}
        <button
          onClick={handleDelete}
          title="删除此事件"
          style={{
            background: 'none', border: 'none', cursor: 'pointer', padding: '2px',
            color: 'var(--text-muted)', display: 'flex', alignItems: 'center',
            opacity: 0.5, transition: 'opacity 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
          onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
        >
          <X size={12} />
        </button>
      </div>

      {/* 展开内容 */}
      {expanded && (
        <div style={{ padding: '0 10px 10px 10px' }}>
          <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--text-secondary)', lineHeight: '1.6', margin: '0 0 var(--space-2) 0' }}>
            {event.description}
          </p>

          {/* 受影响实体 */}
          {((event.affectedNpcIds?.length ?? 0) > 0 || (event.affectedFactions?.length ?? 0) > 0) && (
            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', marginBottom: 'var(--space-2)' }}>
              {(event.affectedFactions ?? []).map(f => (
                <span key={f} className="event-badge active" style={{ fontSize: 'var(--font-size-xs)', padding: '1px 6px' }}>
                  {f}
                </span>
              ))}
              {(event.affectedNpcIds ?? []).map(n => (
                <span key={n} style={{
                  fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: 'var(--radius-sm)',
                  background: 'var(--bg-tertiary)', color: 'var(--text-secondary)',
                }}>
                  {n}
                </span>
              ))}
            </div>
          )}

          {/* 玩家切入点 */}
          {(event.playerHooks?.length ?? 0) > 0 && (
            <div style={{ marginTop: 'var(--space-2)' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', fontWeight: 600, color: 'var(--accent)', marginBottom: '4px' }}>
                <Target size={12} style={{ marginRight: '4px', verticalAlign: 'middle' }} />
                玩家可介入
              </div>
              {event.playerHooks.map((hook, hi) => (
                <PlayerHookItem key={hi} hook={hook} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
