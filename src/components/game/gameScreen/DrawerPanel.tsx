import { useEffect, useState } from 'react';
import JourneyDossierDrawer from '../shared/JourneyDossierDrawer';

interface DrawerPanelProps {
  open: boolean;
  title: string;
  emblemSrc?: string;
  onClose: () => void;
  children: React.ReactNode;
}

export default function DrawerPanel({ open, title, emblemSrc, onClose, children }: DrawerPanelProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      requestAnimationFrame(() => setAnimating(true));
      return;
    }
    setAnimating(false);
    const timer = setTimeout(() => setVisible(false), 250);
    return () => clearTimeout(timer);
  }, [open]);

  if (!visible) return null;

  return (
    <>
      <div className={`game-journey__drawer-backdrop${animating ? ' is-visible' : ''}`} onClick={onClose} aria-hidden="true" />
      <div onClick={e => e.stopPropagation()}>
        <JourneyDossierDrawer
          title={title}
          emblemSrc={emblemSrc}
          onClose={onClose}
          className={`game-journey__drawer${animating ? ' is-open' : ''}`}
          panelClassName="game-journey__drawer-frame"
        >
          {children}
        </JourneyDossierDrawer>
      </div>
    </>
  );
}
