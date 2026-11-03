export interface ComfyImageDescriptor {
  filename: string;
  subfolder?: string;
  type?: string;
}

export interface ComfyExecutionErrorInfo {
  nodeId?: string;
  nodeType?: string;
  exceptionMessage?: string;
  exceptionType?: string;
}

export interface ComfyHistoryStatus {
  completed?: boolean;
  status_str?: string;
  messages?: unknown[];
  [key: string]: unknown;
}

export interface ComfyHistoryEntry {
  outputs?: Record<string, unknown>;
  status?: ComfyHistoryStatus;
  [key: string]: unknown;
}

export function findComfyImageOutput(outputs: unknown): ComfyImageDescriptor | null {
  if (!outputs || typeof outputs !== 'object') return null;

  for (const nodeOutput of Object.values(outputs as Record<string, unknown>)) {
    if (!nodeOutput || typeof nodeOutput !== 'object') continue;
    const images = (nodeOutput as { images?: unknown }).images;
    if (!Array.isArray(images) || images.length === 0) continue;

    const image = images[0];
    if (!image || typeof image !== 'object') continue;
    const record = image as Record<string, unknown>;
    if (typeof record.filename !== 'string' || !record.filename) continue;

    return {
      filename: record.filename,
      subfolder: typeof record.subfolder === 'string' ? record.subfolder : undefined,
      type: typeof record.type === 'string' ? record.type : undefined,
    };
  }

  return null;
}

function readExecutionErrorFromMessage(message: unknown): ComfyExecutionErrorInfo | null {
  if (!Array.isArray(message) || message[0] !== 'execution_error') return null;
  const raw = message[1];
  if (!raw || typeof raw !== 'object') return {};
  const data = raw as Record<string, unknown>;
  return {
    nodeId: typeof data.node_id === 'string' ? data.node_id : undefined,
    nodeType: typeof data.node_type === 'string' ? data.node_type : undefined,
    exceptionMessage: typeof data.exception_message === 'string' ? data.exception_message : undefined,
    exceptionType: typeof data.exception_type === 'string' ? data.exception_type : undefined,
  };
}

export function findComfyExecutionError(entry: ComfyHistoryEntry | null | undefined): ComfyExecutionErrorInfo | null {
  const messages = entry?.status?.messages;
  if (!Array.isArray(messages)) return null;
  for (const message of messages) {
    const parsed = readExecutionErrorFromMessage(message);
    if (parsed) return parsed;
  }
  return null;
}

export function parseComfyWebSocketExecutionError(message: unknown): ComfyExecutionErrorInfo | null {
  if (!message || typeof message !== 'object') return null;
  const envelope = message as Record<string, unknown>;
  if (envelope.type !== 'execution_error') return null;
  const data = envelope.data;
  if (!data || typeof data !== 'object') return {};
  const record = data as Record<string, unknown>;
  return {
    nodeId: typeof record.node_id === 'string' ? record.node_id : undefined,
    nodeType: typeof record.node_type === 'string' ? record.node_type : undefined,
    exceptionMessage: typeof record.exception_message === 'string' ? record.exception_message : undefined,
    exceptionType: typeof record.exception_type === 'string' ? record.exception_type : undefined,
  };
}

export function formatComfyExecutionError(error: ComfyExecutionErrorInfo): string {
  const node = error.nodeId ? `节点 ${error.nodeId}${error.nodeType ? ` (${error.nodeType})` : ''}` : '';
  const detail = error.exceptionMessage || error.exceptionType || '未知执行错误';
  return `ComfyUI 执行失败${node ? `：${node}` : ''}：${detail}`;
}

export function hasComfyExecutionSuccessMessage(entry: ComfyHistoryEntry | null | undefined): boolean {
  const messages = entry?.status?.messages;
  return Array.isArray(messages) && messages.some((message) => Array.isArray(message) && message[0] === 'execution_success');
}
