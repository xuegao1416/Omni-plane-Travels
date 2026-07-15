import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';

/** 统一空状态：Lucide 图标 + 真实中文引导 + 可选行动按钮 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--space-3)',
        padding: 'var(--space-10) var(--space-6)',
        textAlign: 'center',
        color: 'var(--text-muted)',
      }}
    >
      <div
        style={{
          width: '56px',
          height: '56px',
          borderRadius: 'var(--radius-lg)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
        }}
      >
        <Icon size={26} strokeWidth={1.5} />
      </div>
      <div style={{ fontSize: 'var(--font-size-lg)', color: 'var(--text-primary)', fontWeight: 600 }}>
        {title}
      </div>
      {description && (
        <div style={{ fontSize: 'var(--font-size-sm)', maxWidth: '320px', lineHeight: 1.6 }}>
          {description}
        </div>
      )}
      {action}
    </div>
  );
}
