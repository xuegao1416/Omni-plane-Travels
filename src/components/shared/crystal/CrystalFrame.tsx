import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import type { CrystalVisualState } from './crystalInteraction';

export interface CrystalFrameProps extends HTMLAttributes<HTMLDivElement> {
  /** CSS state consumed by adaptive-theme.css. */
  state?: CrystalVisualState;
  /** Optional decorative image URL layered above the CSS fallback surface. */
  artUrl?: string;
  /** Alias for callers that provide a named theme asset. */
  assetUrl?: string;
  children?: ReactNode;
}
function withArtBackground(style: CSSProperties | undefined, artUrl?: string, assetUrl?: string): CSSProperties | undefined {
  const imageUrl = artUrl ?? assetUrl;
  if (!imageUrl) return style;

  return {
    ...style,
    backgroundImage: `url("${imageUrl}"), var(--crystal-surface-fallback)`,
  };
}

/** A presentational crystal surface; interaction remains owned by its children. */
export function CrystalFrame({
  className,
  state = 'idle',
  artUrl,
  assetUrl,
  style,
  children,
  'aria-disabled': ariaDisabled,
  ...props
}: CrystalFrameProps) {
  const disabled = ariaDisabled === true || state === 'disabled';
  return (
    <div
      {...props}
      className={['crystal-frame', className].filter(Boolean).join(' ')}
      data-state={state}
      aria-disabled={ariaDisabled ?? (disabled ? 'true' : undefined)}
      style={withArtBackground(style, artUrl, assetUrl)}
    >
      {children}
    </div>
  );
}
