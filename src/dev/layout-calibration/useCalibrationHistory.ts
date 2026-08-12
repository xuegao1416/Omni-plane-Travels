import { useCallback, useReducer, useRef } from 'react';
import type { CalibrationSnapshot } from './types';

interface HistoryBucket {
  initial: CalibrationSnapshot;
  present: CalibrationSnapshot;
  past: CalibrationSnapshot[];
  future: CalibrationSnapshot[];
}

interface ActiveTransaction {
  key: string;
  before: CalibrationSnapshot;
}

const HISTORY_LIMIT = 50;

function cloneSnapshot(snapshot: CalibrationSnapshot): CalibrationSnapshot {
  return structuredClone(snapshot);
}

function snapshotsMatch(a: CalibrationSnapshot, b: CalibrationSnapshot) {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function useCalibrationHistory(key: string) {
  const bucketsRef = useRef(new Map<string, HistoryBucket>());
  const transactionRef = useRef<ActiveTransaction | null>(null);
  const [, rerender] = useReducer((value: number) => value + 1, 0);

  const bucket = bucketsRef.current.get(key);

  const seed = useCallback((seedKey: string, snapshot: CalibrationSnapshot) => {
    if (bucketsRef.current.has(seedKey)) return;
    const initial = cloneSnapshot(snapshot);
    bucketsRef.current.set(seedKey, {
      initial,
      present: cloneSnapshot(initial),
      past: [],
      future: [],
    });
    rerender();
  }, []);

  const begin = useCallback(() => {
    const current = bucketsRef.current.get(key);
    if (!current || transactionRef.current) return;
    transactionRef.current = { key, before: cloneSnapshot(current.present) };
  }, [key]);

  const preview = useCallback((mutate: (draft: CalibrationSnapshot) => void) => {
    const current = bucketsRef.current.get(key);
    if (!current) return;
    const next = cloneSnapshot(current.present);
    mutate(next);
    current.present = next;
    rerender();
  }, [key]);

  const commit = useCallback(() => {
    const transaction = transactionRef.current;
    transactionRef.current = null;
    if (!transaction || transaction.key !== key) return;
    const current = bucketsRef.current.get(key);
    if (!current || snapshotsMatch(transaction.before, current.present)) return;
    current.past.push(transaction.before);
    if (current.past.length > HISTORY_LIMIT) current.past.shift();
    current.future = [];
    rerender();
  }, [key]);

  const transact = useCallback((mutate: (draft: CalibrationSnapshot) => void) => {
    const current = bucketsRef.current.get(key);
    if (!current) return;
    const before = cloneSnapshot(current.present);
    const next = cloneSnapshot(current.present);
    mutate(next);
    if (snapshotsMatch(before, next)) return;
    current.past.push(before);
    if (current.past.length > HISTORY_LIMIT) current.past.shift();
    current.present = next;
    current.future = [];
    transactionRef.current = null;
    rerender();
  }, [key]);

  const undo = useCallback(() => {
    const current = bucketsRef.current.get(key);
    const previous = current?.past.pop();
    if (!current || !previous) return;
    current.future.push(cloneSnapshot(current.present));
    current.present = previous;
    transactionRef.current = null;
    rerender();
  }, [key]);

  const redo = useCallback(() => {
    const current = bucketsRef.current.get(key);
    const next = current?.future.pop();
    if (!current || !next) return;
    current.past.push(cloneSnapshot(current.present));
    current.present = next;
    transactionRef.current = null;
    rerender();
  }, [key]);

  const resetElement = useCallback((id: string) => {
    transact(draft => {
      const initial = bucketsRef.current.get(key)?.initial.elements[id];
      if (initial) draft.elements[id] = cloneSnapshot({
        ...draft,
        elements: { [id]: initial },
      }).elements[id];
    });
  }, [key, transact]);

  const resetProfile = useCallback(() => {
    const current = bucketsRef.current.get(key);
    if (!current || snapshotsMatch(current.present, current.initial)) return;
    current.past.push(cloneSnapshot(current.present));
    if (current.past.length > HISTORY_LIMIT) current.past.shift();
    current.present = cloneSnapshot(current.initial);
    current.future = [];
    transactionRef.current = null;
    rerender();
  }, [key]);

  const replace = useCallback((snapshot: CalibrationSnapshot) => {
    const current = bucketsRef.current.get(key);
    if (!current) return;
    current.past.push(cloneSnapshot(current.present));
    if (current.past.length > HISTORY_LIMIT) current.past.shift();
    current.present = cloneSnapshot(snapshot);
    current.future = [];
    transactionRef.current = null;
    rerender();
  }, [key]);

  return {
    snapshot: bucket?.present ?? null,
    seed,
    begin,
    preview,
    commit,
    transact,
    undo,
    redo,
    resetElement,
    resetProfile,
    replace,
    canUndo: Boolean(bucket?.past.length),
    canRedo: Boolean(bucket?.future.length),
  };
}

