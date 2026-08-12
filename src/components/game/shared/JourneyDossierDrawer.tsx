import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import DawnFrameV4 from '../../shared/dawn/DawnFrameV4';

const FOCUSABLE = 'a[href], button:not([disabled]), textarea, input:not([disabled]), select, [tabindex]:not([tabindex="-1"])';

export interface JourneyDossierDrawerProps {
  title: string;
  subtitle?: string;
  emblemSrc?: string;
  onClose: () => void;
  children: React.ReactNode;
  className?: string;
  panelClassName?: string;
  style?: React.CSSProperties;
}

/** Shared presentation shell for every in-game journey dossier. Business data stays in the child panel. */
export default function JourneyDossierDrawer({
  title,
  subtitle,
  emblemSrc,
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
      <DawnFrameV4 mode="panel" withFill className={`journey-dossier__frame${panelClassName ? ` ${panelClassName}` : ''}`} ariaLabel={title}>
        <div className="journey-dossier__content">
          <header className="journey-dossier__header">
            <div className="journey-dossier__heading">
              {emblemSrc && <img src={emblemSrc} alt="" aria-hidden="true" className="journey-dossier__emblem" />}
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
      </DawnFrameV4>
    </div>
  );
}
