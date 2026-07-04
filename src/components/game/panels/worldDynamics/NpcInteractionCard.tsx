/**
 * 世界动态面板 — NPC 主动交互卡片
 */

import { useState } from 'react';
import { ChevronDown, ChevronRight, MessageSquare, X } from 'lucide-react';
import type { NpcProactiveInteraction } from '../../../../simulation/types';
import { getSimulationEngine } from '../../../../simulation/SimulationApi';

interface NpcInteractionCardProps {
  interaction: NpcProactiveInteraction;
}

export function NpcInteractionCard({ interaction }: NpcInteractionCardProps) {
  const [expanded, setExpanded] = useState(false);
  const priorityColor = interaction.priority <= 100 ? 'var(--danger)'
    : interaction.priority <= 300 ? 'var(--warning)'
    : interaction.priority <= 600 ? 'var(--accent)' : 'var(--text-muted)';
  const priorityLabel = interaction.priority <= 100 ? '紧急'
    : interaction.priority <= 300 ? '重要'
    : interaction.priority <= 600 ? '一般' : '低';

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    getSimulationEngine().removeInteraction(interaction.id);
  };

  return (
    <div style={{
      marginBottom: '8px',
      border: `1px solid var(--border)`,
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
        <MessageSquare size={14} color={priorityColor} />
        <span style={{ flex: 1, fontSize: 'var(--font-size-base)', fontWeight: 600, color: 'var(--text-primary)' }}>
          {interaction.npcName}
        </span>
        <span style={{
          fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: 'var(--radius-sm)',
          background: priorityColor, color: 'var(--color-on-accent)', opacity: 0.85,
        }}>
          {priorityLabel}
        </span>
        <button
          onClick={handleDelete}
          title="移除此交互"
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
          <div style={{
            fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: 'var(--space-2)',
          }}>
            原因：{interaction.contactReason}
          </div>

          {/* NPC 内心想法 */}
          <div style={{
            fontSize: 'var(--font-size-xs)', padding: '6px 8px', marginBottom: 'var(--space-2)',
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-secondary)', fontStyle: 'italic', lineHeight: '1.5',
            borderLeft: '2px solid var(--text-muted)',
          }}>
            💭 {interaction.innerThoughts}
          </div>

          {/* NPC 对白 */}
          <div style={{
            fontSize: 'var(--font-size-sm)', padding: '8px 10px',
            background: 'var(--accent-dim)', borderRadius: 'var(--radius-sm)',
            color: 'var(--text-primary)', lineHeight: '1.6',
            borderLeft: '3px solid var(--accent)',
          }}>
            💬 {interaction.reply}
          </div>

          {/* 变量变更 */}
          {interaction.variableChanges && interaction.variableChanges.length > 0 && (
            <div style={{ marginTop: 'var(--space-2)', display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
              {interaction.variableChanges.map((vc, i) => (
                <span key={i} style={{
                  fontSize: 'var(--font-size-xs)', padding: '1px 6px', borderRadius: 'var(--radius-md)',
                  background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
                }}>
                  {vc}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
