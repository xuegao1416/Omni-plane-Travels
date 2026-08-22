import { describe, expect, test } from 'bun:test';
import { canAdvanceHallPage, getHallPageCount } from './worldHallPagination';

describe('world hall pagination', () => {
  test('keeps an empty custom-world page after every full group of six', () => {
    expect(getHallPageCount(0)).toBe(2);
    expect(getHallPageCount(5)).toBe(2);
    expect(getHallPageCount(6)).toBe(3);
    expect(getHallPageCount(12)).toBe(4);
  });

  test('allows a full custom-world page to advance to its empty successor', () => {
    expect(canAdvanceHallPage(1, 6)).toBe(true);
    expect(canAdvanceHallPage(1, 5)).toBe(false);
  });
});
