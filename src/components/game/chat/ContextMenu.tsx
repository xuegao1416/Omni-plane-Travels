import { useEffect,useLayoutEffect,useRef } from 'react';
import { createPortal } from 'react-dom';
import { placeContextMenu,visibleBounds,type ContextMenuSource } from './contextMenuPlacement';

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
  /** 右键（鼠标）还是长按（触屏），决定菜单放在光标旁还是手指上方。 */
  source?: ContextMenuSource;
  items: ContextMenuItem[];
  onClose: () => void;
}

/**
 * 消息的右键 / 长按菜单。挂到 document.body：消息行带入场动画（transform），
 * 留在行内时 position: fixed 会以消息行为参照，菜单就偏到别处，还会跟着列表滚走。
 */
export default function ContextMenu({ x, y, source = 'mouse', items, onClose }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // 在外面按下、滚轮、窗口尺寸变化、切走页面时关闭。菜单固定在屏幕上，内容滚动后就对不上消息了。
  useEffect(() => {
    const close = () => onCloseRef.current();
    const handlePointerDown = (e: PointerEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) close();
    };
    // 延迟注册，避免打开菜单的那次按下立即把它关掉
    const timer = setTimeout(() => {
      document.addEventListener('pointerdown', handlePointerDown, true);
      document.addEventListener('wheel', close, { passive: true });
    }, 0);
    window.addEventListener('resize', close);
    window.addEventListener('blur', close);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerdown', handlePointerDown, true);
      document.removeEventListener('wheel', close);
      window.removeEventListener('resize', close);
      window.removeEventListener('blur', close);
    };
  }, []);

  // ESC 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  // 量出菜单尺寸后定位，在绘制之前完成，不会先在错的位置闪一下。
  useLayoutEffect(() => {
    const el = menuRef.current;
    if (!el) return;
    const placement = placeContextMenu({ x, y }, { width: el.offsetWidth, height: el.offsetHeight }, visibleBounds(), source);
    el.style.left = `${placement.left}px`;
    el.style.top = `${placement.top}px`;
    el.style.transformOrigin = placement.transformOrigin;
    el.style.visibility = 'visible';
  }, [x, y, source, items.length]);

  if (typeof document === 'undefined') return null;
  return createPortal(
    <div
      ref={menuRef}
      className="context-menu"
      role="menu"
      aria-label="上下文菜单"
      style={{
        position: 'fixed',
        left: 0,
        top: 0,
        visibility: 'hidden',
        zIndex: 10000,
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
    </div>,
    document.body,
  );
}
