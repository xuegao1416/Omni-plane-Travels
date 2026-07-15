import { describe, it, expect } from 'bun:test';
import { isEventActive } from './eventActivation';

describe('isEventActive（全局启用态）', () => {
  it('未启用 → false', () => {
    expect(isEventActive(false)).toBe(false);
    expect(isEventActive(null)).toBe(false);
    expect(isEventActive(undefined)).toBe(false);
  });

  it('已启用 → true', () => {
    expect(isEventActive(true)).toBe(true);
  });
});
