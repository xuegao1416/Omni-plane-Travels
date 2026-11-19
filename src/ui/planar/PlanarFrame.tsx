import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { FrameCorner, FrameCrest, FrameStud } from './Ornaments';

export interface PlanarFrameProps {
  children?: ReactNode;
  /** `grand`: crest + studs, for dialogs and full screens. `plate`: corners only, for cards. */
  variant?: 'grand' | 'plate';
  /** Surface material inside the brass rails. */
  material?: 'cloth' | 'glass' | 'parchment';
  gem?: 'amber' | 'garnet' | 'sapphire';
  className?: string;
  style?: CSSProperties;
  as?: 'div' | 'section' | 'article';
  ariaLabel?: string;
  onClick?: (event: MouseEvent<HTMLElement>) => void;
}

/**
 * The planar instrument frame: a bevelled brass rail with engraved corners
 * around a woven cloth (or glass / parchment) field. Ornaments are SVG drawn
 * in code; no bitmap assets.
 */
export default function PlanarFrame({
  children,
  variant = 'grand',
  material = 'cloth',
  gem = 'amber',
  className = '',
  style,
  as: Tag = 'div',
  ariaLabel,
  onClick,
}: PlanarFrameProps) {
  return (
    <Tag className={`pk-frame pk-frame--${variant} pk-frame--${material} ${className}`} style={style} aria-label={ariaLabel} onClick={onClick}>
      <span className="pk-frame__rail" aria-hidden="true" />
      <span className="pk-frame__field" aria-hidden="true" />
      <span className="pk-frame__ornaments" aria-hidden="true">
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--tl" />
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--tr" />
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--bl" />
        <FrameCorner gem={gem} className="pk-frame__corner pk-frame__corner--br" />
        {variant === 'grand' && (
          <>
            <FrameCrest gem={gem} className="pk-frame__crest" />
            <FrameStud className="pk-frame__stud pk-frame__stud--b" />
          </>
        )}
      </span>
      <div className="pk-frame__content">{children}</div>
    </Tag>
  );
}
