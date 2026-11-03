import type { ChatMessage } from './types';

/** A retained turn must restore its own state, never an older keyframe. */
export function resolveRollbackTarget(messages: readonly ChatMessage[], truncateAt: number) {
  const retainedMessages = messages.slice(0, truncateAt);
  const target = retainedMessages.findLast(message => message.role === 'assistant');
  if (target && !target.snapshot) return { ok: false as const, target };
  return {
    ok: true as const,
    target,
    retainedMessages,
    round: retainedMessages.reduce((max, message) => Math.max(max, message.round), 0),
    seq: retainedMessages.reduce((max, message) => Math.max(max, message.seq ?? 0), 0),
  };
}
