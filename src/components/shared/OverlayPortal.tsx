import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../../hooks/useBodyScrollLock';
import { getOverlayPortalTarget, shouldDismissOverlay } from './overlayPortalContract';

export { getOverlayPortalTarget, shouldDismissOverlay } from './overlayPortalContract';

const FOCUSABLE_SELECTOR = [
  'a[href]',
  'button:not([disabled])',
  'textarea:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

interface EscapeEntry {
  closeOnEscape: boolean;
  onClose?: () => void;
}

const escapeStack: EscapeEntry[] = [];
let escapeListenerAttached = false;

function handleGlobalEscape(event: KeyboardEvent) {
  if (event.key !== 'Escape') return;
  const top = escapeStack[escapeStack.length - 1];
  if (!top) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (top.closeOnEscape) top.onClose?.();
}

interface OverlayPortalProps {
  children: ReactNode;
  className?: string;
  role?: 'dialog' | 'alertdialog';
  ariaLabel?: string;
  ariaLabelledBy?: string;
  onClose?: () => void;
  closeOnBackdrop?: boolean;
  closeOnEscape?: boolean;
  lockScroll?: boolean;
  tabIndex?: number;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
}

/**
 * Document-level overlay host. Consumers own their visual shell, while this
 * component owns stacking, focus restoration, Escape, and body scroll locking.
 */
export default function OverlayPortal({
  children,
  className,
  role = 'dialog',
  ariaLabel,
  ariaLabelledBy,
  onClose,
  closeOnBackdrop = true,
  closeOnEscape = true,
  lockScroll = true,
  tabIndex = -1,
  onClick,
}: OverlayPortalProps) {
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return undefined;
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    const root = rootRef.current;
    const firstFocusable = root?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    (firstFocusable ?? root)?.focus();

    return () => {
      previousFocusRef.current?.focus?.();
      previousFocusRef.current = null;
    };
  }, [mounted]);

  useEffect(() => {
    if (!mounted) return undefined;
    const entry: EscapeEntry = { closeOnEscape, onClose };
    escapeStack.push(entry);
    if (!escapeListenerAttached) {
      window.addEventListener('keydown', handleGlobalEscape);
      escapeListenerAttached = true;
    }
    return () => {
      const index = escapeStack.indexOf(entry);
      if (index >= 0) escapeStack.splice(index, 1);
      if (escapeStack.length === 0 && escapeListenerAttached) {
        window.removeEventListener('keydown', handleGlobalEscape);
        escapeListenerAttached = false;
      }
    };
  }, [closeOnEscape, mounted, onClose]);

  useBodyScrollLock(mounted && lockScroll);

  const target = getOverlayPortalTarget();
  if (!mounted || !target) return null;

  return createPortal(
    <div
      ref={rootRef}
      className={className}
      role={role}
      aria-modal="true"
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      tabIndex={tabIndex}
      onKeyDown={event => {
        if (event.key !== 'Tab') return;
        const focusables = Array.from(rootRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? []);
        if (focusables.length === 0) {
          event.preventDefault();
          rootRef.current?.focus();
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
      }}
      onPointerDownCapture={event => {
        if (closeOnBackdrop && onClose && shouldDismissOverlay(event.target, event.currentTarget)) {
          event.preventDefault();
          onClose();
        }
      }}
      onClick={event => {
        onClick?.(event);
      }}
    >
      {children}
    </div>,
    target,
  );
}
