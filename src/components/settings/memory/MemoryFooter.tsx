import { ArrowLeft, Check } from 'lucide-react';

interface Props {
  mode: 'overlay' | 'inline';
  onClose: () => void;
  onSave: () => void;
}

/**
 * 底部操作栏：overlay 模式下显示返回按钮，始终显示保存按钮。
 */
export function MemoryFooter({ mode, onClose, onSave }: Props) {
  const compact = mode === 'inline';
  const pad = compact ? '10px 16px' : '14px 24px';
  const btnPad = compact ? '7px 18px' : '8px 24px';
  return (
    <div style={{
      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      padding: pad, flexShrink: 0,
      borderTop: '1px solid var(--border)',
      background: 'var(--bg-secondary)',
    }}>
      {mode === 'overlay' ? (
        <button onClick={onClose} style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          padding: '8px 18px', border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)', background: 'var(--bg-secondary)',
          color: 'var(--text-secondary)', fontSize: 'var(--font-size-base)', fontWeight: '500',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.color = 'var(--accent)'; }}
          onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
        >
          <ArrowLeft size={15} /><span>返回</span>
        </button>
      ) : <div />}
      <button onClick={onSave} style={{
        display: 'inline-flex', alignItems: 'center', gap: '6px',
        padding: btnPad, border: 'none',
        borderRadius: 'var(--radius-lg)',
        background: 'var(--accent)', color: '#fff',
        fontSize: compact ? 'var(--font-size-sm)' : 'var(--font-size-base)', fontWeight: '600',
        cursor: 'pointer', transition: 'all 0.15s',
        boxShadow: '0 2px 8px color-mix(in srgb, var(--accent) 30%, transparent)',
      }}
        onMouseEnter={e => { e.currentTarget.style.filter = 'brightness(1.1)'; e.currentTarget.style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { e.currentTarget.style.filter = 'none'; e.currentTarget.style.transform = 'none'; }}
      >
        <Check size={compact ? 14 : 15} /><span>保存配置</span>
      </button>
    </div>
  );
}
