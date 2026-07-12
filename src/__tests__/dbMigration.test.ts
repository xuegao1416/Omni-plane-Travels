import 'fake-indexeddb/auto';
import { describe, it, expect } from 'bun:test';
import { planV2ToV3Migration, SAVE_SCHEMA_VERSION } from '../storage/db';
import type { GameSave } from '../storage/db';

function makeOldSave(): GameSave {
  return {
    id: 'save_1',
    name: '测试存档',
    timestamp: 123,
    messages: [
      { id: 'm1', role: 'user', rawText: 'hi', round: 0, timestamp: 1 } as any,
      { id: 'm2', role: 'assistant', rawText: 'hello', round: 0, timestamp: 2 } as any,
      { id: 'm3', role: 'user', rawText: 'bye', round: 1, timestamp: 3 } as any,
    ],
    gameState: {} as any,
    worldId: 'default',
  };
}

describe('db 迁移 planV2ToV3Migration', () => {
  it('将内联 messages 拆分为分片并生成紧凑头部', () => {
    const plan = planV2ToV3Migration(makeOldSave());
    expect(plan).not.toBeNull();
    expect(plan!.head.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(plan!.head.messageCount).toBe(3);
    expect(plan!.head.lastMessageSeq).toBe(2);
    expect(plan!.messageRecords.length).toBe(3);
    expect(plan!.messageRecords[0].seq).toBe(0);
    expect(plan!.messageRecords[1].seq).toBe(1);
    expect(plan!.messageRecords[2].seq).toBe(2);
    expect(plan!.messageRecords[0].key).toBe('save_1#0');
    expect(plan!.messageRecords[2].saveId).toBe('save_1');
    expect(plan!.head.round).toBe(1);
  });

  it('已是新格式（schemaVersion>=4）返回 null（跳过）', () => {
    const save = makeOldSave() as any;
    save.schemaVersion = 4;
    expect(planV2ToV3Migration(save)).toBeNull();
  });

  it('无消息的存档生成空分片头部', () => {
    const save = makeOldSave();
    save.messages = [];
    const plan = planV2ToV3Migration(save);
    expect(plan).not.toBeNull();
    expect(plan!.head.messageCount).toBe(0);
    expect(plan!.messageRecords.length).toBe(0);
  });
});
