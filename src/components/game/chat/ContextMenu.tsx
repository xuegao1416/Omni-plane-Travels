import { useEffect, useRef, useCallback } from 'react';

export interface ContextMenuItem {
  label: string;
  icon: React.ReactNode;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export default function ContextMenu({ x, y, items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // 延迟注册，避免触发右键的 mouseup 立即关闭
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handler);
    }, 0);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handler);
    };
  }, [onClose]);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // 确保菜单不超出视口
  const adjustPosition = useCallback(() => {
    if (!menuRef.current) return;
    const rect = menuRef.current.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const el = menuRef.current;

    if (x + rect.width > vw - 8) {
      el.style.left = `${vw - rect.width - 8}px`;
    }
    if (y + rect.height > vh - 8) {
      el.style.top = `${vh - rect.height - 8}px`;
    }
  }, [x, y]);

  useEffect(() => {
    adjustPosition();
  }, [adjustPosition]);

  return (
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label="上下文菜单"
      style={{
        position: 'fixed',
        left: x,
        top: y,
        zIndex: 10000,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.15), 0 1px 4px rgba(0,0,0,0.08)',
        padding: '4px 0',
        minWidth: '160px',
        animation: 'contextMenuIn 0.12s ease-out',
      }}
      onContextMenu={e => e.preventDefault()}
    >
      {items.map((item, i) => (
        <div
          key={i}
          role="menuitem"
          tabIndex={item.disabled ? -1 : 0}
          aria-disabled={item.disabled}
          onClick={() => {
            if (item.disabled) return;
            item.action();
            onClose();
          }}
          style={{
            padding: '10px 14px',
            minHeight: 'var(--touch-min)',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            fontSize: 'var(--font-size-md)',
            color: item.disabled
              ? 'var(--text-muted)'
              : item.danger
                ? 'var(--danger)'
                : 'var(--text-primary)',
            cursor: item.disabled ? 'not-allowed' : 'pointer',
            opacity: item.disabled ? 0.5 : 1,
            transition: 'background 0.1s',
            userSelect: 'none',
          }}
          onMouseEnter={e => {
            if (!item.disabled) {
              e.currentTarget.style.background = item.danger
                ? 'var(--danger-bg-soft)'
                : 'var(--accent-dim)';
            }
          }}
          onMouseLeave={e => {
            e.currentTarget.style.background = 'transparent';
          }}
        >
          <span style={{ width: '18px', textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{item.icon}</span>
          <span>{item.label}</span>
        </div>
      ))}
    </div>
  );
}
