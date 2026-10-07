import 'fake-indexeddb/auto';
import { expect, test } from 'bun:test';
import { saveGameIncremental, loadGame, deleteSave } from './db';
import { createDefaultGameState } from '../schema/variables';
import type { ChatMessage } from '../engine/types';

function fixture(label: string) {
  const id = `save_${Date.now()}_${label}`;
  const head = { id, name: label, timestamp: 1, worldId: 'default', gameState: createDefaultGameState(), schemaVersion: 5, round: 1 };
  const message = (seq: number, rawText: string): ChatMessage => ({ id: `${id}:${seq}`, role: 'assistant', rawText, seq, round: seq + 1, timestamp: seq + 1 });
  return { id, head, message };
}

test('an unpersistable module cannot write future messages ahead of the durable state', async () => {
  const { id, head, message } = fixture('atomicmodule');
  await saveGameIncremental(id, head, [message(0, '已保存正文')]);
  try {
    await expect(saveGameIncremental(id, { ...head, name: '未保存的新状态' }, [message(1, '不应出现的未来正文')], [{
      saveId: id, moduleId: 'stat', revision: 1, schemaVersion: 1, updatedAt: 2, state: { cannotClone: () => {} },
    }])).rejects.toThrow();
    const restored = await loadGame(id);
    expect(restored?.name).toBe(head.name);
    expect(restored?.messages.map(item => item.rawText)).toEqual(['已保存正文']);
  } finally { await deleteSave(id); }
});

test('a failed rollback rewrite preserves all previously durable records', async () => {
  const { id, head, message } = fixture('atomicrewrite');
  await saveGameIncremental(id, head, [message(0, '第一轮'), message(1, '第二轮')]);
  try {
    await expect(saveGameIncremental(id, head, [message(0, '修改后第一轮')], [{
      saveId: id, moduleId: 'stat', revision: 1, schemaVersion: 1, updatedAt: 2, state: { cannotClone: () => {} },
    }], [], { replaceMessages: true })).rejects.toThrow();
    expect((await loadGame(id))?.messages.map(item => item.rawText)).toEqual(['第一轮', '第二轮']);
    await saveGameIncremental(id, head, [message(0, '修改后第一轮')], [], [], { replaceMessages: true });
    const restored = await loadGame(id);
    expect(restored?.messages.map(item => item.rawText)).toEqual(['修改后第一轮']);
  } finally { await deleteSave(id); }
});
