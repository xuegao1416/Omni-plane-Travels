import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { isAriaDisabled, type CrystalVisualState } from './crystalInteraction';

export interface CrystalActionButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** CSS state consumed by adaptive-theme.css. */
  state?: CrystalVisualState;
  /** Reflects the pressed state for toggle-like actions. */
  pressed?: boolean;
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

/** A typed action button that only exposes declarative visual state. */
export function CrystalActionButton({
  className,
  state = 'idle',
  pressed,
  disabled = false,
  artUrl,
  assetUrl,
  style,
  type = 'button',
  children,
  'aria-pressed': ariaPressed,
  'aria-disabled': ariaDisabled,
  ...props
}: CrystalActionButtonProps) {
  const isDisabled = disabled || state === 'disabled' || isAriaDisabled(ariaDisabled);
  return (
    <button
      {...props}
      type={type}
      className={['crystal-action-button', className].filter(Boolean).join(' ')}
      data-state={state}
      disabled={isDisabled}
      aria-pressed={isDisabled ? false : (ariaPressed ?? pressed ?? (state === 'pressed' ? true : undefined))}
      aria-disabled={isDisabled ? 'true' : ariaDisabled}
      style={withArtBackground(style, artUrl, assetUrl)}
    >
      {children}
    </button>
  );
}
