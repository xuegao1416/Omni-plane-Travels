import { describe, expect, test } from 'bun:test';
import { getInitialMessageStart, getPreviousMessageStart, MESSAGE_BATCH_SIZE } from './messageWindow';

describe('large chat message window', () => {
  test('mounts only the latest batch from a large save', () => {
    expect(MESSAGE_BATCH_SIZE).toBeGreaterThanOrEqual(60);
    expect(getInitialMessageStart(581)).toBe(581 - MESSAGE_BATCH_SIZE);
    expect(getInitialMessageStart(20)).toBe(0);
  });

  test('reveals one bounded history batch at a time', () => {
    const start = getInitialMessageStart(581);
    expect(getPreviousMessageStart(start)).toBe(start - MESSAGE_BATCH_SIZE);
    expect(getPreviousMessageStart(12)).toBe(0);
  });
});
