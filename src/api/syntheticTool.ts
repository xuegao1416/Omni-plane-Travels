import type { SyntheticToolRequest } from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Build a provider-safe, per-request function name that does not collide with existing tools. */
export function buildSyntheticToolName(existingNames: readonly string[], prefix: string): string {
  const used = new Set(existingNames);
  let safePrefix = prefix.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]+/, '');
  if (!safePrefix) safePrefix = 'tool_';
  safePrefix = safePrefix.slice(0, 48);

  for (let attempt = 0; attempt < 32; attempt += 1) {
    const suffix = Math.random().toString(36).slice(2, 10).padEnd(8, '0');
    const candidate = safePrefix + suffix;
    if (!used.has(candidate)) return candidate;
  }

  let index = 1;
  while (used.has(safePrefix + index)) index += 1;
  return (safePrefix + index).slice(0, 64);
}

/** Replace the SillyTavern script's dynamic function-name placeholder in prompt text. */
export function substituteToolName(text: string, toolName: string): string {
  return text.replace(/%TOOL_NAME%/g, toolName);
}

function readArgumentValue(rawArguments: unknown, paramName: string): string | undefined {
  let args: unknown = rawArguments;
  if (typeof rawArguments === 'string') {
    try {
      args = JSON.parse(rawArguments);
    } catch {
      return undefined;
    }
  }
  if (!isRecord(args) || typeof args[paramName] !== 'string') return undefined;
  return args[paramName] as string;
}

export function unwrapSyntheticToolResponse(
  payload: unknown,
  toolName: string,
  paramName: string,
): { text: string; matched: boolean } {
  if (!isRecord(payload)) return { text: '', matched: false };
  const choices = payload.choices;
  if (!Array.isArray(choices)) return { text: '', matched: false };

  for (const choice of choices) {
    if (!isRecord(choice) || !isRecord(choice.message)) continue;
    const calls = choice.message.tool_calls;
    if (!Array.isArray(calls)) continue;
    for (const call of calls) {
      if (!isRecord(call) || !isRecord(call.function) || call.function.name !== toolName) continue;
      const text = readArgumentValue(call.function.arguments, paramName);
      return { text: text ?? '', matched: true };
    }
  }
  return { text: '', matched: false };
}

interface StreamToolCall {
  name: string;
  arguments: string;
}

function readPartialStringArgument(source: string, paramName: string): string | undefined {
  const key = JSON.stringify(paramName);
  const keyIndex = source.indexOf(key);
  if (keyIndex < 0) return undefined;

  let index = keyIndex + key.length;
  while (/\s/.test(source[index] ?? '')) index += 1;
  if (source[index] !== ':') return undefined;
  index += 1;
  while (/\s/.test(source[index] ?? '')) index += 1;
  if (source[index] !== '"') return undefined;

  const start = index;
  let escaped = false;
  for (index += 1; index < source.length; index += 1) {
    const char = source[index];
    if (escaped) {
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === '"') {
      try {
        const value: unknown = JSON.parse(source.slice(start, index + 1));
        return typeof value === 'string' ? value : undefined;
      } catch {
        return undefined;
      }
    }
  }

  if (escaped) return undefined;
  try {
    const value: unknown = JSON.parse(source.slice(start) + '"');
    return typeof value === 'string' ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Collects OpenAI-compatible tool-call argument deltas and exposes the streamed text value. */
export class SyntheticStreamAccumulator {
  private readonly calls = new Map<number, StreamToolCall>();
  private emitted = '';

  constructor(
    private readonly toolName: string,
    private readonly paramName: string,
  ) {}

  absorb(chunk: unknown): string {
    if (!isRecord(chunk) || !Array.isArray(chunk.choices)) return '';
    for (const choice of chunk.choices) {
      if (!isRecord(choice) || !isRecord(choice.delta) || !Array.isArray(choice.delta.tool_calls)) continue;
      for (const item of choice.delta.tool_calls) {
        if (!isRecord(item) || !isRecord(item.function)) continue;
        const index = typeof item.index === 'number' ? item.index : 0;
        const current = this.calls.get(index) ?? { name: '', arguments: '' };
        if (typeof item.function.name === 'string') {
          const namePart = item.function.name;
          if (!current.name || namePart.startsWith(current.name)) current.name = namePart;
          else if (!current.name.startsWith(namePart)) current.name += namePart;
        }
        if (typeof item.function.arguments === 'string') current.arguments += item.function.arguments;
        else if (isRecord(item.function.arguments)) current.arguments += JSON.stringify(item.function.arguments);
        this.calls.set(index, current);
      }
    }

    const call = [...this.calls.values()].find(item => item.name === this.toolName);
    if (!call) return '';
    const partial = readPartialStringArgument(call.arguments, this.paramName);
    if (partial === undefined || !partial.startsWith(this.emitted)) return '';
    const delta = partial.slice(this.emitted.length);
    this.emitted = partial;
    return delta;
  }

  finalize(): string {
    const call = [...this.calls.values()].find(item => item.name === this.toolName);
    if (!call) return this.emitted;
    const complete = readArgumentValue(call.arguments, this.paramName);
    if (complete !== undefined) this.emitted = complete;
    return this.emitted;
  }
}

export function createSyntheticToolDefinition(tool: SyntheticToolRequest, description: string) {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description,
      parameters: {
        type: 'object',
        properties: {
          [tool.paramName]: {
            type: 'string',
            description: tool.fieldDescription,
          },
        },
        required: [tool.paramName],
        additionalProperties: false,
      },
    },
  };
}
