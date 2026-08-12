import { describe, expect, test } from 'bun:test';
import { getOverlayPortalTarget, shouldDismissOverlay } from './overlayPortalContract';

describe('OverlayPortal contract', () => {
  test('does not attempt to access document during SSR', () => {
    expect(getOverlayPortalTarget()).toBeNull();
  });

  test('dismisses only when the backdrop itself is clicked', () => {
    const backdrop = new EventTarget();
    const child = new EventTarget();

    expect(shouldDismissOverlay(backdrop, backdrop)).toBe(true);
    expect(shouldDismissOverlay(child, backdrop)).toBe(false);
  });
});
