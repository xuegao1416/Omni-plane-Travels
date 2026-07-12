import { useState, useEffect, useRef } from 'react';
import { X } from 'lucide-react';

// 侧滑抽屉面板组件（桌面端）
// 对齐 MobileOverlay 的可访问性：role=dialog / aria-modal / aria-label / Esc 关闭 / 焦点陷阱
const FOCUSABLE =
  'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export default function DrawerPanel({
  open,
  title,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const prevFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => setAnimating(true));
    } else {
      setAnimating(false);
      const timer = setTimeout(() => setVisible(false), 250);
      return () => clearTimeout(timer);
    }
  }, [open]);

  // 打开时记录触发元素，关闭后归还焦点（与 MobileOverlay 一致的焦点管理）
  useEffect(() => {
    if (open) {
      prevFocusRef.current = document.activeElement as HTMLElement | null;
    } else if (prevFocusRef.current) {
      prevFocusRef.current.focus?.();
      prevFocusRef.current = null;
    }
  }, [open]);

  // 打开后立即把焦点移入面板（优先第一个可聚焦元素，否则聚焦面板自身）
  useEffect(() => {
    if (!open || !visible) return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = panel.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (focusables.length > 0) focusables[0].focus();
    else panel.focus();
  }, [open, visible]);

  // 焦点陷阱 + Esc 关闭
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== 'Tab') return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
      el => el.getClientRects().length > 0,
    );
    if (focusables.length === 0) {
      e.preventDefault();
      panel.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!visible) return null;

  return (
    <>
      {/* 背景遮罩 */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.3)',
          zIndex: 99,
          opacity: animating ? 1 : 0,
          transition: 'opacity 0.25s ease',
        }}
      />
      {/* 抽屉面板 */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          bottom: 0,
          width: 'var(--drawer-width)',
          background: 'var(--bg-secondary)',
          zIndex: 100,
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '4px 0 24px rgba(0,0,0,0.12)',
          transform: animating ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
          outline: 'none',
        }}
      >
        {/* 头部 */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}>
          <h2 style={{ fontSize: '1rem', fontWeight: '600' }}>{title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
            className="btn-ghost btn-icon-sm"
            style={{ background: 'var(--bg-tertiary)' }}
          ><X size={14} /></button>
        </div>
        {/* 内容 — position:relative 供子组件做 absolute 填充 */}
        <div style={{ flex: 1, overflow: 'auto', position: 'relative' }}>
          {children}
        </div>
      </div>
    </>
  );
}
