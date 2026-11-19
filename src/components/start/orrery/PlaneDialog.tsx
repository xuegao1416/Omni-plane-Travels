import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import OverlayPortal from '../../shared/OverlayPortal';

interface PlaneDialogProps {
  titleId: string;
  kicker?: string;
  title: ReactNode;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/** Shared modal shell for the entry screens: glass panel with a brass hairline. */
export default function PlaneDialog({ titleId, kicker, title, onClose, children, footer, size = 'md', className = '' }: PlaneDialogProps) {
  return (
    <OverlayPortal className={`pl-dialog-layer ${className}`} ariaLabelledBy={titleId} onClose={onClose}>
      <section className={`pl-dialog pl-dialog--${size}`} onClick={event => event.stopPropagation()}>
        <header className="pl-dialog__header">
          <div>
            {kicker && <span className="pl-kicker">{kicker}</span>}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="pl-icon-button" onClick={onClose} aria-label="关闭"><X size={18} aria-hidden="true" /></button>
        </header>
        <div className="pl-dialog__body">{children}</div>
        {footer && <footer className="pl-dialog__footer">{footer}</footer>}
      </section>
    </OverlayPortal>
  );
}
