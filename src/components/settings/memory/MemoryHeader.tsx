import { Brain, Repeat } from 'lucide-react';

interface Props {
  modeLabel: string;
  onToggleMode: () => void;
  compact?: boolean;
}

/**
 * 区段头部：Brain 图标、标题、副标题、模式切换按钮。
 * compact 模式用于侧边栏 inline 嵌入，精简间距和副标题。
 */
export function MemoryHeader({ modeLabel, onToggleMode, compact }: Props) {
  const pad = compact ? '12px 16px' : '18px 24px';
  const iconSize = compact ? 32 : 36;
  const gap = compact ? '10px' : '12px';
  const btnPad = compact ? '4px 12px' : '6px 16px';

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap,
      padding: pad, flexShrink: 0,
      borderBottom: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
    }}>
      <div style={{
        width: iconSize, height: iconSize, borderRadius: 'var(--radius-lg)',
        background: 'var(--accent-dim)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        color: 'var(--accent)', flexShrink: 0,
      }}>
        <Brain size={compact ? 18 : 20} />
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: compact ? 'var(--font-size-lg)' : 'var(--font-size-xl)', fontWeight: '700', color: 'var(--text-primary)', letterSpacing: '0.3px' }}>
          记忆系统设置
        </div>
        {!compact && (
          <div style={{ fontSize: 'var(--font-size-xs)', color: 'var(--text-muted)', marginTop: '2px', letterSpacing: '0.5px' }}>
            NARRATIVE MEMORY CONFIGURATION
          </div>
        )}
      </div>
      <button
        onClick={onToggleMode}
        title={`切换记忆模式（当前：${modeLabel}）`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '5px',
          padding: btnPad, border: '1px solid var(--accent)',
          borderRadius: 'var(--radius-lg)', background: 'var(--accent-dim)',
          color: 'var(--accent)', fontSize: compact ? 'var(--font-size-xs)' : 'var(--font-size-sm)', fontWeight: '600',
          cursor: 'pointer', transition: 'all 0.15s', whiteSpace: 'nowrap', flexShrink: 0,
        }}
        onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent)'; e.currentTarget.style.color = '#fff'; }}
        onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.color = 'var(--accent)'; }}
      >
        <Repeat size={compact ? 11 : 13} /><span>{modeLabel}</span>
      </button>
    </div>
  );
}
