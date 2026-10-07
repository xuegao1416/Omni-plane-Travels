/** A hook-local token; cancelled work may finish only while it still owns the turn. */
export class TurnOperations {
  private current: AbortController | null = null;
  begin(): AbortController { this.current?.abort(); return this.current = new AbortController(); }
  owns(controller: AbortController): boolean { return this.current === controller; }
  accept(controller: AbortController): boolean { return this.owns(controller) && !controller.signal.aborted; }
  invalidate(): void { this.current?.abort(); this.current = null; }
}

/** Retry data contains ordinary snapshots and may outlive the original turn. */
export function detachTurnMemoryValue<T>(value: T): T { return structuredClone(value); }

/**
 * Guard operations on the owner, never data crossing clone/worker/save boundaries.
 * Retained data is a private snapshot. Runtime drafts require an explicit versioned
 * store commit; store writers are checked again at the moment of invocation.
 */
export function guardTurnMemory<T extends object>(store: T, isCurrent: () => boolean, getCurrent: () => T = () => store): T {
  const assert = () => { if (!isCurrent()) throw new DOMException('回合已停止或旅程已切换', 'AbortError'); };
  const snapshot = (value: unknown): unknown => value && typeof value === 'object' ? structuredClone(value) : value;
  return new Proxy(store, {
    get(_target, key) {
      assert();
      const current = getCurrent();
      const value = Reflect.get(current, key);
      if (typeof value !== 'function') return snapshot(value);
      return (...args: unknown[]) => {
        assert();
        const owner = getCurrent();
        const action = Reflect.get(owner, key) as (...args: unknown[]) => unknown;
        const result = Reflect.apply(action, owner, args.map(snapshot));
        // Pipeline drafts need current facts, not the archive of rollback
        // snapshots. Commits merge the owner's checkpoint ledger separately.
        if (key === 'getMemoryRuntime' && result && typeof result === 'object' && 'checkpoints' in result && Array.isArray(result.checkpoints)) {
          return snapshot({ ...result, checkpoints: [] });
        }
        return snapshot(result);
      };
    },
    set() { assert(); throw new Error('记忆任务必须通过 store 操作提交状态'); },
  });
}
