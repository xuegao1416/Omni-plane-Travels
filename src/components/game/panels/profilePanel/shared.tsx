import { getQualityColor } from '../../../shared/qualityUtils';

// ─── 详情弹窗 ───
export function DetailModal({ title, quality, onClose, children, icon }: {
  title: string; quality?: string; onClose: () => void; children: React.ReactNode; icon?: React.ReactNode;
}) {
  const qColor = quality ? getQualityColor(quality) : 'var(--accent)';
  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 9999,
        background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: 'var(--bg-secondary)',
          border: `1px solid ${qColor}30`,
          borderRadius: '16px',
          maxWidth: '340px',
          width: '92%',
          overflow: 'hidden',
          boxShadow: `0 8px 32px rgba(0,0,0,0.2), 0 0 0 1px ${qColor}15`,
        }}
      >
        {/* 头部 */}
        <div style={{
          background: `linear-gradient(135deg, ${qColor}15, ${qColor}05)`,
          padding: '16px 20px',
          borderBottom: `1px solid ${qColor}20`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            {icon || <span style={{ color: qColor, fontSize: '16px' }}>●</span>}
            <div>
              <div style={{ fontWeight: '700', fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)' }}>{title}</div>
              {quality && (
                <span style={{
                  fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                  background: qColor + '20', color: qColor, fontWeight: '600',
                  display: 'inline-block', marginTop: '4px',
                }}>{quality}</span>
              )}
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'var(--bg-tertiary)', border: 'none', color: 'var(--text-muted)', cursor: 'pointer',
              width: '28px', height: '28px', borderRadius: '8px', display: 'flex',
              alignItems: 'center', justifyContent: 'center', fontSize: '14px',
            }}
          >✕</button>
        </div>
        {/* 内容 */}
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── 详情行 ───
export function DetailRow({ label, value, icon }: { label: string; value: string | number; icon?: React.ReactNode }) {
  if (!value && value !== 0) return null;
  return (
    <div style={{ display: 'flex', gap: '10px', fontSize: 'var(--font-size-sm)' }}>
      <span style={{ color: 'var(--text-muted)', minWidth: '60px', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '4px' }}>
        {icon}
        {label}
      </span>
      <span style={{ color: 'var(--text-primary)', lineHeight: '1.6', flex: 1 }}>{String(value)}</span>
    </div>
  );
}

// ─── 信息条目 ───
export function InfoItem({ label, text }: { label: string; text: string }) {
  return (
    <div style={{ fontSize: 'var(--font-size-sm)', lineHeight: '1.5' }}>
      <span style={{ fontWeight: '600', color: 'var(--text-muted)', marginRight: '4px' }}>[{label}]</span>
      {text}
    </div>
  );
}
