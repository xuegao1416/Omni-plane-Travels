import { describe, expect, test } from 'bun:test';
import { acquireBodyScrollLock, type ScrollLockTarget } from './bodyScrollLockManager';

describe('body scroll lock manager', () => {
  test('keeps overflow locked until the final interleaved release', () => {
    const body: ScrollLockTarget = { style: { overflow: 'auto' } };
    const firstRelease = acquireBodyScrollLock(body);
    const secondRelease = acquireBodyScrollLock(body);

    expect(body.style.overflow).toBe('hidden');
    firstRelease();
    expect(body.style.overflow).toBe('hidden');
    secondRelease();
    expect(body.style.overflow).toBe('auto');
    secondRelease();
    expect(body.style.overflow).toBe('auto');
  });
});
