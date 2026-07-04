/**
 * 世界动态面板 — 空状态占位
 */

import { Globe } from 'lucide-react';

export function EmptyState() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: '32px 16px', gap: '8px',
      color: 'var(--text-muted)', textAlign: 'center',
    }}>
      <Globe size={32} opacity={0.4} />
      <div style={{ fontSize: 'var(--font-size-base)' }}>世界正在平静运转中</div>
      <div style={{ fontSize: 'var(--font-size-xs)', opacity: 0.7 }}>
        当重大事件发生时，动态将在此处展示
      </div>
    </div>
  );
}
