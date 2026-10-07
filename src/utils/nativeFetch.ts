/** Runtime capability detection also works when modules were loaded before the WebView. */
export function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__);
}


export interface NativeRequestInit extends RequestInit {
  /** Total request deadline, including response body consumption. */
  timeoutMs?: number;
}
type FetchImplementation = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
export interface NativeFetchDependencies {
  isTauri: () => boolean;
  browserFetch: FetchImplementation;
  loadNativeFetch: () => Promise<FetchImplementation>;
}

/** Native and browser requests share the same cancellation and body lifetime. */
export function createNativeFetch(dependencies: NativeFetchDependencies) {
  return async (input: string | URL | Request, init: NativeRequestInit = {}): Promise<Response> => {
    const { timeoutMs, ...requestInit } = init;
    const externalSignal = init.signal ?? (input instanceof Request ? input.signal : undefined);
    externalSignal?.throwIfAborted();
    const controller = timeoutMs != null && timeoutMs > 0 ? new AbortController() : undefined;
    const signal = controller?.signal ?? externalSignal;
    const onExternalAbort = () => controller?.abort(externalSignal?.reason);
    if (controller) externalSignal?.addEventListener('abort', onExternalAbort, { once: true });
    const timer = controller ? setTimeout(() => controller.abort(new DOMException('Request timeout exceeded', 'TimeoutError')), timeoutMs) : undefined;
    const cleanup = () => {
      if (timer !== undefined) clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    };
    if (signal) requestInit.signal = signal;

    try {
      let fetchImpl = dependencies.browserFetch;
      if (dependencies.isTauri()) {
        try {
          const loading = dependencies.loadNativeFetch();
          fetchImpl = signal ? await awaitAbortable(loading, signal) : await loading;
        } catch (error) {
          signal?.throwIfAborted();
          // Only plugin loading is safe to fall back from: no request has been sent.
          console.warn('[transport] Tauri HTTP 插件不可用，使用浏览器 HTTP:', error);
        }
      }
      signal?.throwIfAborted();
      const pending = fetchImpl(input, requestInit);
      const response = signal ? await awaitAbortable(pending, signal, response => {
        void response.body?.cancel(signal.reason).catch(() => {});
      }) : await pending;
      if (!response.body || !signal) { cleanup(); return response; }
      return bindBodyLifetime(response, signal, cleanup);
    } catch (error) {
      cleanup();
      if (signal?.aborted) throw signal.reason;
      throw error;
    }
  };
}

function awaitAbortable<T>(pending: Promise<T>, signal: AbortSignal, discard?: (value: T) => void): Promise<T> {
  return new Promise((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener('abort', onAbort); reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    pending.then(value => {
      signal.removeEventListener('abort', onAbort);
      if (signal.aborted) {
        discard?.(value);
        reject(signal.reason);
      } else resolve(value);
    }, error => {
      signal.removeEventListener('abort', onAbort);
      reject(signal.aborted ? signal.reason : error);
    });
  });
}

function bindBodyLifetime(response: Response, signal: AbortSignal, cleanup: () => void): Response {
  const reader = response.body!.getReader();
  let settled = false;
  let onAbort: () => void;
  const finish = () => {
    settled = true;
    signal.removeEventListener('abort', onAbort);
    cleanup();
  };
  const body = new ReadableStream<Uint8Array>({
    start(stream) {
      onAbort = () => {
        if (settled) return;
        finish();
        stream.error(signal.reason);
        // Native fetch's body cancel releases the Rust response resource.
        void reader.cancel(signal.reason).catch(() => {}).finally(() => reader.releaseLock());
      };
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
    },
    async pull(stream) {
      try {
        const chunk = await reader.read();
        if (settled) return;
        if (chunk.done) { finish(); reader.releaseLock(); stream.close(); }
        else stream.enqueue(chunk.value);
      } catch (error) {
        if (settled) return;
        finish(); reader.releaseLock(); stream.error(signal.aborted ? signal.reason : error);
      }
    },
    async cancel(reason) {
      if (settled) return;
      finish();
      try { await reader.cancel(reason); } finally { reader.releaseLock(); }
    },
  });
  const result = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
  preserveResponseMetadata(result, response);
  return result;
}

function preserveResponseMetadata(result: Response, source: Response): void {
  for (const field of ['url', 'redirected', 'type'] as const) {
    Object.defineProperty(result, field, { value: source[field] });
  }
  const clone = result.clone.bind(result);
  Object.defineProperty(result, 'clone', { value: () => {
    const copy = clone(); preserveResponseMetadata(copy, source); return copy;
  } });
}

export const nativeFetch = createNativeFetch({
  isTauri,
  browserFetch: (input, init) => globalThis.fetch(input, init),
  loadNativeFetch: async () => (await import('@tauri-apps/plugin-http')).fetch,
});

export default nativeFetch;
