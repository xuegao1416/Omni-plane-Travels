import {
  findComfyExecutionError,
  findComfyImageOutput,
  formatComfyExecutionError,
  hasComfyExecutionSuccessMessage,
  parseComfyWebSocketExecutionError,
  type ComfyHistoryEntry,
} from './comfyOutput';

export interface ComfyHistorySnapshot {
  [promptId: string]: ComfyHistoryEntry | undefined;
}

export interface WaitForComfyExecutionOptions {
  promptId: string;
  fetchHistory: () => Promise<ComfyHistorySnapshot>;
  websocketUrl?: string;
  timeoutMs?: number;
  pollIntervalMs?: number;
  maxConsecutiveErrors?: number;
  legacySettlePolls?: number;
  webSocketFactory?: (url: string) => WebSocket;
}

export interface ComfyExecutionResult {
  entry: ComfyHistoryEntry;
  completionSource: 'history' | 'websocket';
}

type WsSignal =
  | { type: 'completed' }
  | { type: 'error'; error: Error };

function statusLooksCompleted(entry: ComfyHistoryEntry): boolean {
  if (entry.status?.completed === true) return true;
  const status = typeof entry.status?.status_str === 'string' ? entry.status.status_str.toLowerCase() : '';
  return status === 'success' || status === 'completed';
}

function statusLooksFailed(entry: ComfyHistoryEntry): boolean {
  const status = typeof entry.status?.status_str === 'string' ? entry.status.status_str.toLowerCase() : '';
  return status === 'error' || status === 'failed';
}

function defaultWebSocketFactory(url: string): WebSocket {
  return new WebSocket(url);
}

function startOptionalWebSocketWatch(
  websocketUrl: string | undefined,
  promptId: string,
  factory: ((url: string) => WebSocket) | undefined,
  onSignal: (signal: WsSignal) => void,
): () => void {
  if (!websocketUrl || (typeof WebSocket === 'undefined' && !factory)) return () => {};

  let socket: WebSocket | null = null;
  try {
    socket = (factory || defaultWebSocketFactory)(websocketUrl);
  } catch (error) {
    console.debug('[ComfyUI] WebSocket 不可用，继续使用 HTTP history 轮询:', error);
    return () => {};
  }

  const cleanup = () => {
    if (!socket) return;
    try {
      socket.close();
    } catch {
      // WebSocket 仅为辅助通道，清理失败不影响任务结果。
    }
    socket = null;
  };

  socket.addEventListener('message', (event) => {
    if (typeof event.data !== 'string') return;
    try {
      const message = JSON.parse(event.data) as Record<string, unknown>;
      const data = message.data && typeof message.data === 'object'
        ? message.data as Record<string, unknown>
        : null;
      const eventPromptId = typeof data?.prompt_id === 'string' ? data.prompt_id : undefined;
      if (eventPromptId && eventPromptId !== promptId) return;

      const executionError = parseComfyWebSocketExecutionError(message);
      if (executionError) {
        onSignal({ type: 'error', error: new Error(formatComfyExecutionError(executionError)) });
        return;
      }

      if (message.type === 'executing' && data?.node === null && (!eventPromptId || eventPromptId === promptId)) {
        onSignal({ type: 'completed' });
      }
    } catch {
      // 忽略未知/非 JSON WS 消息，HTTP history 仍是最终数据来源。
    }
  });

  socket.addEventListener('error', (event) => {
    console.debug('[ComfyUI] WebSocket 监听失败，HTTP history 轮询继续运行:', event);
  });
  socket.addEventListener('close', () => {
    // 断线不视为生成失败；HTTP fallback 会继续完成任务。
  });

  return cleanup;
}

export async function waitForComfyExecution(options: WaitForComfyExecutionOptions): Promise<ComfyExecutionResult> {
  const {
    promptId,
    fetchHistory,
    websocketUrl,
    timeoutMs = 5 * 60 * 1000,
    pollIntervalMs = 1000,
    maxConsecutiveErrors = 15,
    legacySettlePolls = 2,
    webSocketFactory,
  } = options;

  const startedAt = Date.now();
  let consecutiveErrors = 0;
  let legacyStablePolls = 0;
  let websocketCompleted = false;
  let websocketError: Error | null = null;
  const wakeRef: { current: (() => void) | null } = { current: null };

  const stopWebSocket = startOptionalWebSocketWatch(
    websocketUrl,
    promptId,
    webSocketFactory,
    (signal) => {
      if (signal.type === 'error') websocketError = signal.error;
      if (signal.type === 'completed') websocketCompleted = true;
      wakeRef.current?.();
    },
  );

  const sleepOrWake = () => new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      wakeRef.current = null;
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(finish, pollIntervalMs);
    wakeRef.current = finish;
  });

  try {
    while (Date.now() - startedAt <= timeoutMs) {
      if (websocketError) throw websocketError;

      try {
        const history = await fetchHistory();
        consecutiveErrors = 0;
        const entry = history?.[promptId];

        if (entry) {
          const executionError = findComfyExecutionError(entry);
          if (executionError) throw new Error(formatComfyExecutionError(executionError));

          const image = findComfyImageOutput(entry.outputs);
          if (image) {
            return { entry, completionSource: websocketCompleted ? 'websocket' : 'history' };
          }

          if (statusLooksFailed(entry)) {
            throw new Error('ComfyUI 执行失败：history 返回失败状态，但未提供具体节点错误');
          }

          const explicitSuccess = statusLooksCompleted(entry) || hasComfyExecutionSuccessMessage(entry);
          if (explicitSuccess || websocketCompleted) {
            return { entry, completionSource: websocketCompleted ? 'websocket' : 'history' };
          }

          if (entry.outputs && typeof entry.outputs === 'object') {
            legacyStablePolls += 1;
            if (legacyStablePolls >= legacySettlePolls) {
              return { entry, completionSource: 'history' };
            }
          } else {
            legacyStablePolls = 0;
          }
        } else {
          legacyStablePolls = 0;
        }
      } catch (error) {
        const isExecutionError = error instanceof Error && /^ComfyUI 执行失败/.test(error.message);
        if (isExecutionError) throw error;

        consecutiveErrors += 1;
        console.warn(`[ComfyUI] history 请求失败，连续错误 ${consecutiveErrors}/${maxConsecutiveErrors}`, error);
        if (consecutiveErrors >= maxConsecutiveErrors) {
          throw new Error(`ComfyUI 连续 ${maxConsecutiveErrors} 次请求失败，服务端可能已停止`);
        }
      }

      await sleepOrWake();
    }

    throw new Error('生成超时（5分钟）');
  } finally {
    wakeRef.current?.();
    stopWebSocket();
  }
}
