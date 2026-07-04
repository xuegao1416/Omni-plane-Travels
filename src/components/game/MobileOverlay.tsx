import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  side: 'left' | 'right';
  width?: number;
  children: React.ReactNode;
}

export default function MobileOverlay({
  open,
  onClose,
  title,
  side,
  width = 280,
  children,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);

  // ESC 键关闭
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  // 阻止背景滚动
  useEffect(() => {
    if (open) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }

    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="mobile-overlay"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div
        ref={panelRef}
        className={`mobile-overlay-panel mobile-overlay-${side}`}
        style={{ width: `${width}px`, maxWidth: '80vw' }}
        onClick={e => e.stopPropagation()}
      >
        {/* 头部 */}
        <div className="mobile-overlay-header">
          <h2>{title}</h2>
          <button
            onClick={onClose}
            aria-label="关闭"
          >
            <X size={20} />
          </button>
        </div>

        {/* 内容 */}
        <div className="mobile-overlay-content">
          {children}
        </div>
      </div>
    </div>
  );
}
