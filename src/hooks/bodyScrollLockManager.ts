export interface ScrollLockTarget {
  style: {
    overflow: string;
  };
}

interface ScrollLockState {
  count: number;
  previousOverflow: string;
}

const lockStates = new WeakMap<ScrollLockTarget, ScrollLockState>();

export function acquireBodyScrollLock(target: ScrollLockTarget): () => void {
  const current = lockStates.get(target);
  if (current) {
    current.count += 1;
  } else {
    lockStates.set(target, {
      count: 1,
      previousOverflow: target.style.overflow,
    });
    target.style.overflow = 'hidden';
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;

    const state = lockStates.get(target);
    if (!state) return;

    state.count -= 1;
    if (state.count === 0) {
      target.style.overflow = state.previousOverflow;
      lockStates.delete(target);
    }
  };
}
