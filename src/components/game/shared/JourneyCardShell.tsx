import type { ReactNode } from 'react';
import DawnFrameV4 from '../../shared/dawn/DawnFrameV4';

interface JourneyCardShellProps {
  children: ReactNode;
  className?: string;
  label: string;
  mode?: 'panel' | 'compact';
}

/** Shared Dawn V4 presentation shell for inline and event cards. */
export default function JourneyCardShell({ children, className = '', label, mode = 'compact' }: JourneyCardShellProps) {
  return (
    <DawnFrameV4
      mode={mode}
      withFill
      className={`game-journey-card ${className}`}
      ariaLabel={label}
    >
      <div className="game-journey-card__content">{children}</div>
    </DawnFrameV4>
  );
}
