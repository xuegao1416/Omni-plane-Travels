/**
 * 匿名游玩统计。
 *
 * 只有玩家明确同意后才会创建和上报会话。统计不包含 IP、账号、存档、
 * 对话或世界内容；时长只累计页面处于前台的时间。
 */

export type PlayDepth = 'home' | 'lobby' | 'events' | 'wizard' | 'game';
export type PlayTrackingConsent = 'granted' | 'denied' | null;

const CONSENT_KEY = 'omni.play.consent.v1';
const LAST_VISIT_KEY = 'omni.play.lastVisit';
const HISTORY_KEY = 'omni.play.history.v2';

const DEPTH_RANK: Record<PlayDepth, number> = {
  home: 0,
  lobby: 1,
  events: 2,
  wizard: 3,
  game: 4,
};

interface PlaySession {
  id: string;
  startedAt: number;
  endedAt: number | null;
  activeDurationMs: number;
  maxDepth: PlayDepth;
  isReturn: boolean;
}

interface PingPayload {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  maxDepth: PlayDepth;
  isReturn: boolean;
  browserFamily: string;
  screenSize: string;
  timezone: string;
}

let currentSession: PlaySession | null = null;
let maxDepthReached: PlayDepth = 'home';
let visibleSince: number | null = null;
let saveInterval: number | null = null;
let listenersInstalled = false;

export function getPlayTrackingConsent(): PlayTrackingConsent {
  try {
    const value = localStorage.getItem(CONSENT_KEY);
    return value === 'granted' || value === 'denied' ? value : null;
  } catch {
    return null;
  }
}

export function setPlayTrackingConsent(granted: boolean): void {
  try {
    localStorage.setItem(CONSENT_KEY, granted ? 'granted' : 'denied');
    if (!granted) localStorage.removeItem(HISTORY_KEY);
  } catch {
    // 存储不可用时不启动统计，保持隐私优先。
    if (granted) return;
  }

  if (granted) initPlayTracker();
  else stopPlayTracker();
}

export function calculateActiveDuration(
  accumulatedMs: number,
  activeSince: number | null,
  now: number,
): number {
  if (activeSince === null) return accumulatedMs;
  return accumulatedMs + Math.max(0, now - activeSince);
}

function getBrowserFamily(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : '';
  if (ua.includes('Firefox/')) return 'Firefox';
  if (ua.includes('Edg/')) return 'Edge';
  if (ua.includes('Chrome/')) return 'Chrome';
  if (ua.includes('Safari/') && !ua.includes('Chrome/')) return 'Safari';
  return 'Other';
}

function getScreenSize(): string {
  if (typeof screen === 'undefined') return '';
  return `${screen.width}x${screen.height}`;
}

function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

function saveLocal(session: PlaySession): void {
  try {
    const raw = localStorage.getItem(HISTORY_KEY) || '[]';
    const history = JSON.parse(raw) as PlaySession[];
    const index = history.findIndex((item) => item.id === session.id);
    if (index >= 0) history[index] = session;
    else history.push(session);
    if (history.length > 100) history.splice(0, history.length - 100);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
  } catch {
    // 本地统计副本只是辅助信息，失败不影响游戏。
  }
}

function snapshotSession(now = Date.now()): PingPayload | null {
  if (!currentSession) return null;
  return {
    id: currentSession.id,
    startedAt: currentSession.startedAt,
    endedAt: now,
    durationMs: calculateActiveDuration(currentSession.activeDurationMs, visibleSince, now),
    maxDepth: maxDepthReached,
    isReturn: currentSession.isReturn,
    browserFamily: getBrowserFamily(),
    screenSize: getScreenSize(),
    timezone: getTimezone(),
  };
}

function persistSnapshot(now = Date.now()): PingPayload | null {
  const payload = snapshotSession(now);
  if (!payload || !currentSession) return payload;
  currentSession.endedAt = payload.endedAt;
  currentSession.maxDepth = payload.maxDepth;
  saveLocal({ ...currentSession, activeDurationMs: payload.durationMs });
  return payload;
}

async function sendPayload(payload: PingPayload): Promise<void> {
  if (getPlayTrackingConsent() !== 'granted') return;
  try {
    await fetch('/api/stats/play', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // 统计失败不重试，也不影响游戏。
  }
}

function sendCurrentSession(useBeacon: boolean): void {
  const payload = persistSnapshot();
  if (!payload || getPlayTrackingConsent() !== 'granted') return;

  if (useBeacon && typeof navigator.sendBeacon === 'function') {
    try {
      navigator.sendBeacon(
        '/api/stats/play',
        new Blob([JSON.stringify(payload)], { type: 'application/json' }),
      );
      return;
    } catch {
      // 降级到 keepalive fetch。
    }
  }
  void sendPayload(payload);
}

function handleVisibilityChange(): void {
  const now = Date.now();
  if (document.visibilityState === 'hidden') {
    if (visibleSince === null || !currentSession) return;
    currentSession.activeDurationMs = calculateActiveDuration(
      currentSession.activeDurationMs,
      visibleSince,
      now,
    );
    visibleSince = null;
    sendCurrentSession(true);
    return;
  }

  if (currentSession && visibleSince === null) visibleSince = now;
}

function handleBeforeUnload(): void {
  sendCurrentSession(true);
}

export function reportDepth(depth: PlayDepth): void {
  if (DEPTH_RANK[depth] <= DEPTH_RANK[maxDepthReached]) return;
  maxDepthReached = depth;
  if (currentSession) {
    currentSession.maxDepth = depth;
    saveLocal(currentSession);
  }
}

export function initPlayTracker(): void {
  if (typeof window === 'undefined') return;
  exposeConsoleApi();
  if (getPlayTrackingConsent() !== 'granted' || currentSession) return;
  if (typeof crypto.randomUUID !== 'function') return;

  const lastVisit = (() => {
    try {
      return localStorage.getItem(LAST_VISIT_KEY);
    } catch {
      return null;
    }
  })();
  try {
    localStorage.setItem(LAST_VISIT_KEY, String(Date.now()));
  } catch {
    return;
  }

  const now = Date.now();
  currentSession = {
    id: crypto.randomUUID(),
    startedAt: now,
    endedAt: null,
    activeDurationMs: 0,
    maxDepth: maxDepthReached,
    isReturn: Boolean(lastVisit),
  };
  visibleSince = document.visibilityState === 'hidden' ? null : now;
  saveLocal(currentSession);

  if (!listenersInstalled) {
    window.addEventListener('beforeunload', handleBeforeUnload);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    listenersInstalled = true;
  }

  saveInterval = window.setInterval(() => {
    persistSnapshot();
  }, 30_000);
}

export function stopPlayTracker(): void {
  if (saveInterval !== null) {
    window.clearInterval(saveInterval);
    saveInterval = null;
  }
  if (listenersInstalled) {
    window.removeEventListener('beforeunload', handleBeforeUnload);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    listenersInstalled = false;
  }
  currentSession = null;
  visibleSince = null;
  maxDepthReached = 'home';
}

function exposeConsoleApi(): void {
  if (typeof window === 'undefined') return;
  (window as unknown as { playTracker?: unknown }).playTracker = {
    optOut: () => setPlayTrackingConsent(false),
    optIn: () => setPlayTrackingConsent(true),
    view: () => {
      const history = readHistory();
      console.table(history);
      return history;
    },
    export: () => JSON.stringify(readHistory(), null, 2),
  };
}

function readHistory(): PlaySession[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY) || '[]';
    return JSON.parse(raw) as PlaySession[];
  } catch {
    return [];
  }
}
