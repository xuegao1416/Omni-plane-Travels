/**
 * 世界动态面板 — 角色暗线条目
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, PersonStanding, X } from 'lucide-react';
import { useSimulationStore } from '../../../../stores/simulationStore';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';

interface StorylineEntryProps {
  npcId: string;
  npcName: string;
}

export function StorylineEntry({ npcId, npcName }: StorylineEntryProps) {
  const state = useSimulationStore(s => s.simState);
  const storyline = state.storylines[npcId];
  const [expanded, setExpanded] = useState(false);

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    getSimulationEngine().removeStoryline(npcId);
  };

  if (!storyline || storyline.beats.length === 0) return null;

  const recentBeats = storyline.beats.filter(b => !b.merged).slice(-5);

  return (
    <div style={{
      marginBottom: '8px',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-md)',
      background: 'var(--bg-secondary)',
      overflow: 'hidden',
    }}>
      <div
        onClick={() => setExpanded(!expanded)}
        style={{
          display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
          padding: '8px 10px', cursor: 'pointer', userSelect: 'none',
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <PersonStanding size={14} color="var(--accent)" />
        <span style={{ flex: 1, fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {npcName}
        </span>
        <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)' }}>
          {recentBeats.length} 个新进展
        </span>
        <button
          onClick={handleDelete}
          title="删除此暗线"
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

      {expanded && (
        <div style={{ padding: '0 10px 10px 10px' }}>
          {storyline.summary && (
            <p style={{
              fontSize: 'var(--font-size-xs)', color: 'var(--text-secondary)',
              lineHeight: '1.5', fontStyle: 'italic', margin: '0 0 var(--space-2) 0',
              padding: '6px 8px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            }}>
              {storyline.summary}
            </p>
          )}
          {recentBeats.map((beat, bi) => (
            <div key={bi} style={{
              fontSize: 'var(--font-size-xs)', padding: '4px 0', borderBottom: '1px solid var(--border)',
              color: 'var(--text-secondary)', lineHeight: '1.5',
            }}>
              <span style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{beat.title}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 'var(--font-size-xs)', marginLeft: '6px' }}>
                {beat.time}
              </span>
              <div>{beat.narrative}</div>
              {beat.locationChange && (
                <span style={{ fontSize: 'var(--font-size-xs)', color: 'var(--accent)' }}>
                  移至: {beat.locationChange}
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
