/**
 * Detach a JSON state from its mutable owner while reusing equal subtrees of an
 * earlier, immutable snapshot. Callers must never edit the returned history.
 * This keeps canonical objects and synchronous rollback without duplicating
 * every unchanged NPC, source event or embedding for every historical turn.
 */
function snapshotCloner(): (next: unknown, old: unknown) => unknown {
  const copies = new WeakMap<object, unknown>();
  const active = new WeakSet<object>();
  const clone = (next: unknown, old: unknown): unknown => {
    if (next === null || typeof next !== 'object') return next;
    if (next === old) return old;
    if (active.has(next)) throw new TypeError('Snapshot contains a circular reference');
    if (copies.has(next)) return copies.get(next);
    const isArray = Array.isArray(next);
    const prototype = Object.getPrototypeOf(next);
    if (!isArray && prototype !== Object.prototype && prototype !== null) return structuredClone(next);
    const comparable = old !== null && typeof old === 'object'
      && Array.isArray(old) === isArray && Object.getPrototypeOf(old) === prototype;
    const prior = comparable ? old as Record<string, unknown> : undefined;
    const keys = Object.keys(next);
    let equal = Boolean(prior && keys.length === Object.keys(prior).length
      && (!isArray || (old as unknown[]).length === (next as unknown[]).length));
    const copy = isArray ? new Array((next as unknown[]).length)
      : prototype === null ? Object.create(null) : { ...next };
    active.add(next);
    for (const key of keys) {
      const child = clone((next as Record<string, unknown>)[key], prior?.[key]);
      Object.defineProperty(copy, key, { value: child, enumerable: true, writable: true, configurable: true });
      if (!prior || !Object.hasOwn(prior, key) || !Object.is(child, prior[key])) equal = false;
    }
    active.delete(next);
    const result = equal ? old : copy;
    copies.set(next, result);
    return result;
  };
  return clone;
}

export function cloneSnapshotWithSharing<T>(value: T, previous?: T): T {
  return snapshotCloner()(value, previous) as T;
}

/** Rebuild sharing after JSON/IndexedDB decoding, without discarding a turn. */
export function shareSnapshotHistory<T>(history: readonly T[]): T[] {
  // Input histories are immutable, so one cache can detach shared source
  // branches once across the entire decoded history, including embeddings.
  const clone = snapshotCloner();
  let previous: T | undefined;
  return history.map(value => previous = clone(value, previous) as T);
}
