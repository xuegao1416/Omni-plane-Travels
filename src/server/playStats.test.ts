import { describe, expect, test } from 'bun:test';
import { parsePlayPingBody } from './playStats';

const now = 1_800_000_000_000;
const validPing = {
  id: '123e4567-e89b-42d3-a456-426614174000',
  startedAt: now - 10_000,
  endedAt: now,
  durationMs: 8_000,
  maxDepth: 'wizard',
  isReturn: false,
  browserFamily: 'Chrome',
  screenSize: '1920x1080',
  timezone: 'Asia/Shanghai',
};

describe('parsePlayPingBody', () => {
  test('accepts a valid anonymous session', () => {
    expect(parsePlayPingBody(validPing, now)).toEqual({ ok: true, value: validPing });
  });

  test('rejects duration longer than elapsed time', () => {
    expect(parsePlayPingBody({ ...validPing, durationMs: 11_000 }, now)).toEqual({ ok: false, error: 'INVALID_DURATION' });
  });

  test('rejects malformed strings', () => {
    expect(parsePlayPingBody({ ...validPing, screenSize: 'big' }, now)).toEqual({ ok: false, error: 'INVALID_SCREEN' });
    expect(parsePlayPingBody({ ...validPing, browserFamily: { value: 'Chrome' } }, now)).toEqual({ ok: false, error: 'INVALID_BROWSER' });
  });

  test('rejects sessions outside the accepted time window', () => {
    const startedAt = now - 8 * 24 * 60 * 60 * 1000;
    expect(parsePlayPingBody({ ...validPing, startedAt }, now)).toEqual({ ok: false, error: 'INVALID_STARTED_AT' });
  });
});
