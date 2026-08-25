import type { Context } from 'hono';
import type { Bindings } from './types';

const MAX_PAYLOAD_BYTES = 4096;
const MAX_DURATION_MS = 6 * 60 * 60 * 1000;
const MAX_SESSION_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
const ALLOWED_DEPTHS = ['home', 'lobby', 'events', 'wizard', 'game'] as const;
const ALLOWED_BROWSERS = ['Chrome', 'Edge', 'Firefox', 'Safari', 'Other'] as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SCREEN_PATTERN = /^\d{2,5}x\d{2,5}$/;
const TIMEZONE_PATTERN = /^[A-Za-z0-9_+\-/]{0,64}$/;

export interface PlayPing {
  id: string;
  startedAt: number;
  endedAt: number;
  durationMs: number;
  maxDepth: (typeof ALLOWED_DEPTHS)[number];
  isReturn: boolean;
  browserFamily: (typeof ALLOWED_BROWSERS)[number];
  screenSize: string;
  timezone: string;
}

type ParseResult = { ok: true; value: PlayPing } | { ok: false; error: string };

export function parsePlayPingBody(input: unknown, now = Date.now()): ParseResult {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: 'INVALID_BODY' };
  }
  const body = input as Record<string, unknown>;
  const { id, startedAt, endedAt, durationMs, maxDepth, isReturn, browserFamily, screenSize, timezone } = body;

  if (typeof id !== 'string' || !UUID_PATTERN.test(id)) return { ok: false, error: 'INVALID_ID' };
  if (!Number.isSafeInteger(startedAt) || (startedAt as number) < now - MAX_SESSION_AGE_MS || (startedAt as number) > now + 60_000) {
    return { ok: false, error: 'INVALID_STARTED_AT' };
  }
  if (!Number.isSafeInteger(endedAt) || (endedAt as number) < (startedAt as number) || (endedAt as number) > now + 60_000) {
    return { ok: false, error: 'INVALID_ENDED_AT' };
  }
  if (!Number.isSafeInteger(durationMs) || (durationMs as number) < 0 || (durationMs as number) > MAX_DURATION_MS || (durationMs as number) > (endedAt as number) - (startedAt as number)) {
    return { ok: false, error: 'INVALID_DURATION' };
  }
  if (typeof maxDepth !== 'string' || !ALLOWED_DEPTHS.includes(maxDepth as PlayPing['maxDepth'])) {
    return { ok: false, error: 'INVALID_DEPTH' };
  }
  if (typeof isReturn !== 'boolean') return { ok: false, error: 'INVALID_RETURN_FLAG' };
  if (typeof browserFamily !== 'string' || !ALLOWED_BROWSERS.includes(browserFamily as PlayPing['browserFamily'])) {
    return { ok: false, error: 'INVALID_BROWSER' };
  }
  if (typeof screenSize !== 'string' || !SCREEN_PATTERN.test(screenSize)) return { ok: false, error: 'INVALID_SCREEN' };
  if (typeof timezone !== 'string' || !TIMEZONE_PATTERN.test(timezone)) return { ok: false, error: 'INVALID_TIMEZONE' };

  return {
    ok: true,
    value: {
      id,
      startedAt: startedAt as number,
      endedAt: endedAt as number,
      durationMs: durationMs as number,
      maxDepth: maxDepth as PlayPing['maxDepth'],
      isReturn,
      browserFamily: browserFamily as PlayPing['browserFamily'],
      screenSize,
      timezone,
    },
  };
}

function isSameOrigin(c: Context<any>): boolean {
  const origin = c.req.header('Origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === new URL(c.req.url).origin;
  } catch {
    return false;
  }
}

export async function handlePostPlayStat(c: Context<any>): Promise<Response> {
  if (!isSameOrigin(c)) return c.json({ error: 'FORBIDDEN_ORIGIN' }, 403);
  const contentLength = Number(c.req.header('Content-Length') || 0);
  if (!Number.isFinite(contentLength) || contentLength > MAX_PAYLOAD_BYTES) {
    return c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  let rawBody: string;
  try {
    rawBody = await c.req.text();
  } catch {
    return c.json({ error: 'INVALID_BODY' }, 400);
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_PAYLOAD_BYTES) {
    return c.json({ error: 'PAYLOAD_TOO_LARGE' }, 413);
  }

  let input: unknown;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return c.json({ error: 'INVALID_JSON' }, 400);
  }
  const parsed = parsePlayPingBody(input);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const body = parsed.value;
  const now = Date.now();

  try {
    await c.env.DB.batch([
      c.env.DB.prepare(`
        INSERT INTO play_sessions (
          id, started_at, ended_at, duration_ms, max_depth,
          is_return, browser_family, screen_size, timezone, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          ended_at = MAX(play_sessions.ended_at, excluded.ended_at),
          duration_ms = MAX(play_sessions.duration_ms, excluded.duration_ms),
          max_depth = CASE
            WHEN excluded.max_depth = 'game' THEN 'game'
            WHEN excluded.max_depth = 'wizard' AND play_sessions.max_depth != 'game' THEN 'wizard'
            WHEN excluded.max_depth = 'events' AND play_sessions.max_depth IN ('home', 'lobby', 'events') THEN 'events'
            WHEN excluded.max_depth = 'lobby' AND play_sessions.max_depth = 'home' THEN 'lobby'
            ELSE play_sessions.max_depth
          END
      `).bind(
        body.id,
        body.startedAt,
        body.endedAt,
        body.durationMs,
        body.maxDepth,
        body.isReturn ? 1 : 0,
        body.browserFamily,
        body.screenSize,
        body.timezone,
        now,
      ),
      c.env.DB.prepare('DELETE FROM play_sessions WHERE started_at < ?').bind(now - RETENTION_MS),
    ]);
    return c.json({ ok: true });
  } catch (error) {
    console.error('[playStats] insert failed:', error);
    return c.json({ error: 'INTERNAL' }, 500);
  }
}
