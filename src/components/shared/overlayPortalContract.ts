export function getOverlayPortalTarget(): HTMLElement | null {
  return typeof document === 'undefined' ? null : document.body;
}

export function shouldDismissOverlay(target: EventTarget | null, currentTarget: EventTarget | null): boolean {
  return target === currentTarget;
}
