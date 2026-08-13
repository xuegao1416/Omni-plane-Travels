import { describe, expect, test } from 'bun:test';
import { calculateActiveDuration } from './playTracker';

describe('calculateActiveDuration', () => {
  test('adds only the current visible interval', () => {
    expect(calculateActiveDuration(2_000, 10_000, 13_500)).toBe(5_500);
  });

  test('does not add time while hidden', () => {
    expect(calculateActiveDuration(2_000, null, 30_000)).toBe(2_000);
  });

  test('guards against a clock moving backwards', () => {
    expect(calculateActiveDuration(2_000, 15_000, 14_000)).toBe(2_000);
  });
});
