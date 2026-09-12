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

/** Entrance controls use the current responsive Dawn V4 frame. */
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
      className={`entry-sliced-button entry-sliced-button--${tone} entry-sliced-button--dawn entry-sliced-button--dawn-v4${isCompactFrame ? ' entry-sliced-button--compact' : ''}${className ? ` ${className}` : ''}`}
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

export function EntrySlicedProgress({ value }: { value: number }) {
  const safeValue = Math.max(0, Math.min(1, value));
  return (
    <div
      className="entry-sliced-progress"
      role="progressbar"
      aria-label="晶界接入进度"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(safeValue * 100)}
    >
      <span className="entry-sliced-progress__track entry-sliced-progress__track--left" aria-hidden="true" />
      <span className="entry-sliced-progress__track entry-sliced-progress__track--middle" aria-hidden="true" />
      <span className="entry-sliced-progress__track entry-sliced-progress__track--right" aria-hidden="true" />
      <span className="entry-sliced-progress__fill" style={{ width: `${safeValue * 100}%` }}>
        <span className="entry-sliced-progress__fill-piece entry-sliced-progress__fill-piece--left" aria-hidden="true" />
        <span className="entry-sliced-progress__fill-piece entry-sliced-progress__fill-piece--middle" aria-hidden="true" />
        <span className="entry-sliced-progress__fill-piece entry-sliced-progress__fill-piece--right" aria-hidden="true" />
        <span className="entry-sliced-progress__sweep" aria-hidden="true" />
      </span>
    </div>
  );
}
