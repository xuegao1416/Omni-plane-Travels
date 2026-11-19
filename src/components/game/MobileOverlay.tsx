import { useEffect } from 'react';
import type { CSSProperties } from 'react';
import type { LucideIcon } from 'lucide-react';
import JourneyDossierDrawer from './shared/JourneyDossierDrawer';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  side: 'left' | 'right';
  width?: number;
  children: React.ReactNode;
}

export default function MobileOverlay({ open, onClose, title, subtitle, icon, side, width = 344, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open]);

  if (!open) return null;

  return (
    <div className="game-journey__overlay" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}>
        <JourneyDossierDrawer
          title={title}
          subtitle={subtitle}
          icon={icon}
          onClose={onClose}
          className={`mobile-overlay-panel mobile-overlay-${side} game-journey__overlay-panel`}
          panelClassName="game-journey__overlay-frame"
          style={{ '--game-journey-overlay-width': `${width}px` } as CSSProperties}
        >
          {children}
        </JourneyDossierDrawer>
      </div>
    </div>
  );
}
