/** Wait for a transport delay while promptly releasing timers/listeners on abort. */
export function abortableDelay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  signal?.throwIfAborted();
  if (milliseconds <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const onAbort = () => { clearTimeout(timer); cleanup(); reject(signal?.reason ?? new DOMException('Cancelled', 'AbortError')); };
    const timer = setTimeout(() => { cleanup(); resolve(); }, milliseconds);
    signal?.addEventListener('abort', onAbort, {once:true});
    if (signal?.aborted) onAbort();
  });
}
