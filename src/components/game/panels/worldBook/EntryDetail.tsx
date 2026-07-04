import { ChevronDown, ChevronRight } from 'lucide-react';
import type { EntryCardProps } from './types';

/** A single world-book entry card; shows title row and expands to detail */
export function EntryCard({ entry, expanded, onToggle }: EntryCardProps) {
  return (
    <div style={{
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      overflow: 'hidden',
      opacity: entry.enabled ? 1 : 0.5,
    }}>
      {/* Title row */}
      <button
        onClick={onToggle}
        className="wb-entry-toggle"
        style={{
          background: expanded ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
        }}
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <span style={{
          flex: 1,
          fontSize: 'var(--font-size-sm)',
          fontWeight: '500',
          color: 'var(--text-primary)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}>
          {entry.comment}
        </span>
        {/* Badges */}
        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
          {entry.constant && (
            <span style={{
              fontSize: 'var(--font-size-xs)', padding: '1px 5px', borderRadius: 'var(--radius-sm)',
              background: 'var(--accent-dim)', color: 'var(--accent)',
            }}>常驻</span>
          )}
          {entry.keys.length > 0 && (
            <span style={{
              fontSize: 'var(--font-size-xs)', padding: '1px 5px', borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-tertiary)', color: 'var(--text-muted)',
            }}>{entry.keys.length} 词</span>
          )}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div style={{
          padding: '10px',
          borderTop: '1px solid var(--border)',
          background: 'var(--bg-primary)',
        }}>
          {/* Keywords */}
          {entry.keys.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginBottom: '4px' }}>
                触发关键词
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                {entry.keys.map((k, i) => (
                  <span key={i} style={{
                    padding: '2px 8px', borderRadius: 'var(--radius-sm)',
                    fontSize: 'var(--font-size-xs)',
                    background: 'var(--bg-tertiary)',
                    color: 'var(--text-secondary)',
                  }}>{k}</span>
                ))}
              </div>
            </div>
          )}

          {/* Meta info */}
          <div style={{
            display: 'flex', gap: '12px', marginBottom: '8px',
            fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)',
          }}>
            <span>位置: {entry.position === 'before_char' ? '角色定义前' : '角色定义后'}</span>
            <span>排序: {entry.order}</span>
            {entry.depth > 0 && <span>深度: {entry.depth}</span>}
          </div>

          {/* Content */}
          <div style={{
            fontSize: 'var(--font-size-sm)',
            lineHeight: '1.6',
            color: 'var(--text-secondary)',
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '300px',
            overflow: 'auto',
            padding: '8px',
            background: 'var(--bg-secondary)',
            borderRadius: 'var(--radius-sm)',
            border: '1px solid var(--border)',
          }}>
            {entry.content || '（空内容）'}
          </div>
        </div>
      )}
    </div>
  );
}
