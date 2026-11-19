import type { ButtonHTMLAttributes,ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import DawnFrameV4 from '../shared/dawn/DawnFrameV4';

export interface EntrySlicedButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: LucideIcon;
  emblemSrc?: string;
  tone?: 'primary' | 'quiet';
  frame?: 'dawn-v4-compact' | 'dawn-v4-panel';
  children: ReactNode;
}

/** Map the historical tone / legacy btn-* class onto a planar kit button variant. */
function kitVariant(tone: 'primary' | 'quiet', className: string) {
  if (/btn-primary/.test(className) || (tone === 'primary' && !/btn-secondary/.test(className))) return 'pk-btn--primary';
  return 'pk-btn--secondary';
}

/** Entrance controls are planar kit buttons; the class contract stays for layout hooks. */
export function EntrySlicedButton({
  icon: Icon,
  emblemSrc,
  tone = 'quiet',
  frame = 'dawn-v4-compact',
  className = '',
  children,
  type = 'button',
  ...buttonProps
}: EntrySlicedButtonProps) {
  const isCompactFrame = frame === 'dawn-v4-compact';
  const content = (
    <span className="entry-sliced-button__content">
      {emblemSrc ? <img className="entry-sliced-button__emblem" src={emblemSrc} alt="" aria-hidden="true" /> : Icon && <Icon size={15} strokeWidth={1.7} aria-hidden="true" />}
      <span className="entry-sliced-button__label">{children}</span>
    </span>
  );

  return (
    <button
      {...buttonProps}
      type={type}
      className={`entry-sliced-button entry-sliced-button--${tone}${isCompactFrame ? ' entry-sliced-button--compact' : ''} pk-btn ${kitVariant(tone, className)}${className ? ` ${className}` : ''}`}
    >
      {isCompactFrame ? content : (
        <DawnFrameV4
          mode={frame === 'dawn-v4-panel' ? 'panel' : 'compact'}
          borderLayer="front"
        >
          {content}
        </DawnFrameV4>
      )}
    </button>
  );
}
