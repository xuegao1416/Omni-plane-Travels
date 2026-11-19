import { APP_VERSION } from '../config/version';
import { useConfigStore } from '../stores/configStore';

/**
 * Localhost-only helper for visual QA: `?plshot=hall` (or `home`) dismisses
 * first-run notices so headless screenshots land on the requested screen.
 * `&ui=dawn` forces the light theme. Ignored on any non-local host.
 */
const isLocalHost = () => typeof window !== 'undefined' && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(window.location.hostname);

/** `?plshot=game` renders the in-game shell harness instead of the app (localhost only). */
export function isGameShellPreview() {
  return isLocalHost() && new URLSearchParams(window.location.search).get('plshot') === 'game';
}

/** `?plshot=kit` renders the planar kit sheet (localhost only). */
export function isKitPreview() {
  return isLocalHost() && new URLSearchParams(window.location.search).get('plshot') === 'kit';
}

export function applyDevScreenshotPreset() {
  if (typeof window === 'undefined') return;
  const host = window.location.hostname;
  if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) return;
  const target = new URLSearchParams(window.location.search).get('plshot');
  if (!target) return;
  try {
    localStorage.setItem('omni.play.consent.v1', 'denied');
    localStorage.setItem(`omni.update-notice.${APP_VERSION}.seen`, 'true');
    localStorage.setItem('omni.hall.musicMuted', 'true');
    if (target === 'hall') sessionStorage.setItem('omni.start.returnTarget', 'hall');
    // `&ui=dawn|night` forces the interface theme for side-by-side theme screenshots.
    const ui = new URLSearchParams(window.location.search).get('ui');
    if (ui === 'dawn' || ui === 'night') useConfigStore.getState().updateSettings('uiTheme', ui);
  } catch { /* storage unavailable: screenshot shows first-run state */ }
}

/** Which top-level screen / start view a `?plshot=` target asks for (localhost only). */
export function getDevScreenshotTarget(): string | null {
  if (!isLocalHost()) return null;
  return new URLSearchParams(window.location.search).get('plshot');
}

/** `?plshot=combat` renders the in-memory combat harness (localhost only). */
export function isCombatPreview() {
  return isLocalHost() && new URLSearchParams(window.location.search).get('plshot') === 'combat';
}

/** `?plshot=workshop` renders the workshop with in-memory sample data (localhost only). */
export function isWorkshopPreview() {
  return isLocalHost() && new URLSearchParams(window.location.search).get('plshot') === 'workshop';
}
