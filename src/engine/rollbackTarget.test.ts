import { expect, test } from 'bun:test';
import { resolveRollbackTarget } from './rollbackTarget';
import type { ChatMessage } from './types';

function message(round: number, seq: number, snapshot?: unknown): ChatMessage {
  return { id: `m${seq}`, role: 'assistant', rawText: '正文', round, seq, timestamp: seq, snapshot };
}

test('resending a historical turn restores that turn and resets round and seq', () => {
  const messages = [message(45, 90, {}), message(48, 96, { relationship: 15 }), message(60, 120, {})];
  const target = resolveRollbackTarget(messages, 2);
  expect(target.ok).toBe(true);
  if (!target.ok) throw new Error('Expected exact rollback');
  expect(target.target?.id).toBe('m96');
  expect(target.round).toBe(48);
  expect(target.seq).toBe(96);
  expect(target.retainedMessages).toHaveLength(2);
});

test('a missing historical snapshot must not silently restore an older keyframe', () => {
  const messages = [message(45, 90, {}), message(46, 92), message(47, 94), message(48, 96)];
  expect(resolveRollbackTarget(messages, 4).ok).toBe(false);
});

test('rollback before any assistant message can use the initial state', () => {
  const result = resolveRollbackTarget([], 0);
  expect(result).toMatchObject({ ok: true, round: 0, seq: 0, target: undefined });
});
