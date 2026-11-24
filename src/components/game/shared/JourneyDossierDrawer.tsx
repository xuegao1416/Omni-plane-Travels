import { useEffect,useRef } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export interface JourneyDossierDrawerProps {
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  style?: React.CSSProperties;
}

/** Shared presentation shell for every in-game dossier. Business data stays in the child panel. */
export default function JourneyDossierDrawer({
  title,
  subtitle,
  icon: Icon,
  onClose,
  children,
  className = '',
  panelClassName = '',
  style,
}: JourneyDossierDrawerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previousFocus.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const first = dialog?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? dialog)?.focus();
    return () => previousFocus.current?.focus?.();
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    // 卷宗里打开的浮层（人物详情、物品详情、对话框）挂在 body 上，按键仍会经 React 树冒泡到这里；
    // 那一层的 Escape 交给它自己（OverlayPortal 的 Escape 栈），不要连卷宗一起关掉。
    const fromNestedOverlay = event.target instanceof Node && !dialogRef.current?.contains(event.target);
    if (fromNestedOverlay) return;
    if (event.key === 'Escape') {
      event.stopPropagation();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusables = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(el => el.getClientRects().length > 0);
    if (!focusables.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div
      ref={dialogRef}
      className={`journey-dossier${className ? ` ${className}` : ''}`}
      role="dialog"
      aria-modal="true"
      aria-label={title}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      style={style}
    >
      <div className={`journey-dossier__frame${panelClassName ? ` ${panelClassName}` : ''}`}>
        <div className="journey-dossier__content">
          <header className="journey-dossier__header">
            <div className="journey-dossier__heading">
              {Icon && <span className="journey-dossier__emblem" aria-hidden="true"><Icon size={17} strokeWidth={1.6} /></span>}
              <div>
                <h2>{title}</h2>
                {subtitle && <p>{subtitle}</p>}
              </div>
            </div>
            <button type="button" className="journey-dossier__close" onClick={onClose} aria-label="关闭卷宗">
              <X size={18} aria-hidden="true" />
            </button>
          </header>
          <div className="journey-dossier__body">{children}</div>
        </div>
      </div>
    </div>
  );
}
