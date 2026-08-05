import type { EventErrorCode } from './schema';
import type { EventPackFormatErrorCode } from './eventPackFormat';

export type WebEventErrorCode = 'FILE_INVALID' | 'PACK_NOT_FOUND';

export type EventApiErrorCode =
  | EventErrorCode
  | EventPackFormatErrorCode
  | WebEventErrorCode;

export interface EventApiErrorDetails {
  code: EventApiErrorCode;
  message: string;
  context?: Readonly<Record<string, unknown>>;
  filePath?: string;
}

export class EventApiError extends Error {
  readonly code: EventApiErrorCode;
  readonly context?: Readonly<Record<string, unknown>>;
  readonly filePath?: string;

  constructor(error: EventApiErrorDetails) {
    super(error.message);
    this.name = 'EventApiError';
    this.code = error.code;
    this.context = error.context;
    this.filePath = error.filePath ?? (
      typeof error.context?.filePath === 'string' ? error.context.filePath : undefined
    );
  }
}

export function ensureEventApiError(error: unknown): EventApiError {
  if (error instanceof EventApiError) return error;
  return new EventApiError({
    code: 'IO_ERROR',
    message: error instanceof Error ? error.message : String(error),
  });
}
