import type { ReactNode } from 'react';

interface JourneyCardShellProps {
  children: ReactNode;
  className?: string;
  label: string;
  /** `panel` cards get a stronger surface (event cards, dice checks). */
  mode?: 'panel' | 'compact';
}

/** Shared presentation shell for inline and event cards. */
export default function JourneyCardShell({ children, className = '', label, mode = 'compact' }: JourneyCardShellProps) {
  return (
    <section className={`game-journey-card game-journey-card--${mode} ${className}`.trim()} aria-label={label}>
      <div className="game-journey-card__content">{children}</div>
    </section>
  );
}
