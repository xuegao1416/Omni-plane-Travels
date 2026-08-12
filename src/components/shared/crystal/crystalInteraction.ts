/** Visual states shared by the Crystal presentation primitives. */
export type CrystalVisualState =
  | 'idle'
  | 'enter'
  | 'selected'
  | 'dimmed'
  | 'pressed'
  | 'confirmed'
  | 'disabled';

export interface ChoiceCardVisualStateInput {
  index: number;
  selectedIndex?: number | null;
  disabled?: boolean;
}

/** React's ARIA Booleanish values may arrive as booleans or "true"/"false" strings. */
export function isAriaDisabled(value: boolean | 'true' | 'false' | undefined): boolean {
  return value === true || value === 'true';
}

/**
 * Resolve a choice card's presentation state without coupling it to an event
 * handler or animation implementation. Disabled cards always win over the
 * selected/sibling states.
 */
export function getChoiceCardVisualState({
  index,
  selectedIndex,
  disabled = false,
}: ChoiceCardVisualStateInput): Extract<CrystalVisualState, 'idle' | 'selected' | 'dimmed' | 'disabled'> {
  if (disabled) return 'disabled';
  if (selectedIndex == null) return 'idle';
  return index === selectedIndex ? 'selected' : 'dimmed';
}
