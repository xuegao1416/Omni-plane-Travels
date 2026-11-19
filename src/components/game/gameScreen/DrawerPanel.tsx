import { useEffect,useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import JourneyDossierDrawer from '../shared/JourneyDossierDrawer';

interface DrawerPanelProps {
  open: boolean;
  title: string;
  subtitle?: string;
  icon?: LucideIcon;
  onClose: () => void;
  children: React.ReactNode;
}

export default function DrawerPanel({ open, title, subtitle, icon, onClose, children }: DrawerPanelProps) {
  const [visible, setVisible] = useState(false);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (open) {
      setVisible(true);
      const frame = requestAnimationFrame(() => setAnimating(true));
      return () => cancelAnimationFrame(frame);
    }
    setAnimating(false);
    const timer = setTimeout(() => setVisible(false), 260);
    return () => clearTimeout(timer);
  }, [open]);

  if (!visible) return null;

  return (
    <>
      <div className={`game-journey__drawer-backdrop${animating ? ' is-visible' : ''}`} onClick={onClose} aria-hidden="true" />
      <JourneyDossierDrawer
        title={title}
        subtitle={subtitle}
        icon={icon}
        onClose={onClose}
        className={`game-journey__drawer${animating ? ' is-open' : ''}`}
        panelClassName="game-journey__drawer-frame"
      >
        {children}
      </JourneyDossierDrawer>
    </>
  );
}
