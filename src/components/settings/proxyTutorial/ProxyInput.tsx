import { Target } from 'lucide-react';

export function ProxyInput({
  proxyUrl,
  onProxyUrlChange,
  onApply,
}: {
  proxyUrl: string;
  onProxyUrlChange: (url: string) => void;
  onApply: () => void;
}) {
  return (
    <div
      style={{
        marginTop: '24px',
        padding: '20px',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
      }}
    >
      <div style={{ fontWeight: '600', fontSize: 'var(--font-size-md)', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <Target size={16} />
        已经部署好了？直接填入代理地址
      </div>
      <div style={{ display: 'flex', gap: '10px' }}>
        <input
          type="text"
          value={proxyUrl}
          onChange={e => onProxyUrlChange(e.target.value)}
          placeholder="https://你的worker名字.workers.dev"
          style={{
            flex: 1,
            padding: '10px 14px',
            border: '1px solid var(--border)',
            borderRadius: '8px',
            background: 'var(--bg-tertiary)',
            color: 'var(--text-primary)',
            fontSize: 'var(--font-size-sm)',
            outline: 'none',
          }}
          onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
        <button
          onClick={onApply}
          disabled={!proxyUrl.trim()}
          style={{
            padding: '10px 20px',
            background: proxyUrl.trim() ? 'var(--accent)' : 'var(--bg-tertiary)',
            color: proxyUrl.trim() ? '#fff' : 'var(--text-muted)',
            border: 'none',
            borderRadius: '8px',
            fontSize: 'var(--font-size-sm)',
            fontWeight: '600',
            cursor: proxyUrl.trim() ? 'pointer' : 'default',
            transition: 'all 0.2s',
          }}
        >
          应用
        </button>
      </div>
    </div>
  );
}
