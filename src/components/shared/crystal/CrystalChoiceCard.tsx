import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { getChoiceCardVisualState, isAriaDisabled, type CrystalVisualState } from './crystalInteraction';

export interface CrystalChoiceCardProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'title'> {
  /** Position in the current choice list, used to dim unselected siblings. */
  index: number;
  /** Index selected by the parent choice controller. */
  selectedIndex?: number | null;
  /** Convenience flag for isolated cards that do not have a selected index. */
  selected?: boolean;
  /** Optional declarative state override (for example, confirmed). */
  state?: CrystalVisualState;
  /** Optional decorative image URL layered above the CSS fallback surface. */
  artUrl?: string;
  /** Alias for callers that provide a named theme asset. */
  assetUrl?: string;
  /** Optional semantic title rendered as DOM text. */
  title?: ReactNode;
  /** Optional supporting detail rendered as DOM content. */
  detail?: ReactNode;
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

/** A declarative choice surface that leaves selection/effect handling to its parent. */
export function CrystalChoiceCard({
  className,
  index,
  selectedIndex,
  selected = false,
  state,
  disabled = false,
  artUrl,
  assetUrl,
  title,
  detail,
  style,
  type = 'button',
  children,
  'aria-pressed': ariaPressed,
  'aria-disabled': ariaDisabled,
  ...props
}: CrystalChoiceCardProps) {
  const effectiveSelectedIndex = selected ? index : selectedIndex;
  const ariaDisabledValue = isAriaDisabled(ariaDisabled);
  const isDisabled = disabled || state === 'disabled' || ariaDisabledValue;
  const calculatedState = getChoiceCardVisualState({
    index,
    selectedIndex: effectiveSelectedIndex,
    disabled: isDisabled,
  });
  const visualState = isDisabled ? 'disabled' : (state ?? calculatedState);
  const isSelected =
    !isDisabled &&
    (visualState === 'selected' || selected || effectiveSelectedIndex === index);

  return (
    <button
      {...props}
      type={type}
      className={['crystal-choice', className].filter(Boolean).join(' ')}
      data-state={visualState}
      disabled={isDisabled}
      aria-pressed={isDisabled ? false : (ariaPressed ?? isSelected)}
      aria-disabled={isDisabled ? 'true' : ariaDisabled}
      style={withArtBackground(style, artUrl, assetUrl)}
    >
      {title !== undefined || detail !== undefined ? (
        <span>
          {title !== undefined && <span>{title}</span>}
          {detail !== undefined && <span>{detail}</span>}
        </span>
      ) : null}
      {children}
    </button>
  );
}

export type { CrystalVisualState } from './crystalInteraction';
