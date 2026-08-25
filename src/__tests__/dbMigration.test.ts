import 'fake-indexeddb/auto';
import { describe, it, expect } from 'bun:test';
import {
  deleteSave,
  getAllSaveMeta,
  importSaveFromData,
  loadGame,
  planV2ToV3Migration,
  saveAllSaveMeta,
  saveGameIncremental,
  SAVE_SCHEMA_VERSION,
} from '../storage/db';
import type { GameSave } from '../storage/db';
import { getDefaultPortraitSource, getPortraitSource } from '../components/start/PortraitEditor';
import { getModuleStates } from '../storage/moduleStateDb';
import { createDefaultGameState } from '../schema/variables';

describe('portrait persistence round-trip', () => {
  it('preserves a custom data URL through the compact save head and restores default gender assets', async () => {
    const saveId = `portrait-round-trip-${Date.now()}`;
    const customDataUrl = 'data:image/webp;base64,portrait-round-trip';
    const portrait = {
      source: 'custom' as const,
      customDataUrl,
      zoom: 1.24,
      positionX: 7,
      positionY: -4,
      fileName: '旅者.webp',
    };

    try {
      await saveGameIncremental(saveId, {
        id: saveId,
        name: '头像持久化测试',
        timestamp: Date.now(),
        schemaVersion: SAVE_SCHEMA_VERSION,
        round: 0,
        gameState: {} as any,
        worldId: 'default',
        personalInfo: { gender: '女', portrait },
      } as any, []);

      const loaded = await loadGame(saveId);
      expect(loaded?.personalInfo?.portrait).toEqual(portrait);
      expect(getPortraitSource(loaded!.personalInfo!)).toBe(customDataUrl);
    } finally {
      await deleteSave(saveId);
    }

    expect(getDefaultPortraitSource('男')).toBe('/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-male-v1.png');
    expect(getDefaultPortraitSource('女')).toBe('/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-female-v1.png');
    expect(getDefaultPortraitSource('其他')).toBe('/art/theme/ui-kit/dawn-v4/portraits/portrait-silhouette-neutral-v1.png');
    expect(getPortraitSource({ gender: '男' } as any)).toBe(getDefaultPortraitSource('男'));
  });
});

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

describe('imported save metadata', () => {
  it('records the imported message count and repairs older metadata that omitted it', async () => {
    const rawData = {
      save: {
        id: `import-message-count-${Date.now()}`,
        name: '导入消息计数测试',
        timestamp: Date.now(),
        worldId: 'default',
        gameState: {},
        messages: makeOldSave().messages,
      },
    };
    const meta = await importSaveFromData(rawData);

    try {
      expect(meta.messageCount).toBe(3);

      const { messageCount: _, ...legacyMeta } = meta;
      await saveAllSaveMeta([legacyMeta]);
      const repaired = await getAllSaveMeta();
      expect(repaired[0]?.messageCount).toBe(3);
    } finally {
      await deleteSave(meta.id);
      await saveAllSaveMeta((await getAllSaveMeta()).filter(item => item.id !== meta.id));
    }
  });

  it('moves legacy module fields into independent records and restores them on load', async () => {
    const state = createDefaultGameState();
    state.玩家.生存资源 = { water: { 数量: 4 } };
    const meta = await importSaveFromData({
      save: {
        id: `import-module-state-${Date.now()}`,
        name: '导入模块分区测试',
        timestamp: Date.now(),
        worldId: 'default',
        gameState: state,
        messages: [],
      },
    });

    try {
      const loaded = await loadGame(meta.id);
      expect((loaded?.gameState as any).玩家.生存资源).toBeUndefined();
      expect(loaded?.moduleStates?.find(item => item.moduleId === 'survival')?.state).toMatchObject({
        resources: { water: { 数量: 4 } },
      });
      expect((await getModuleStates(meta.id)).length).toBeGreaterThan(0);
    } finally {
      await deleteSave(meta.id);
      await saveAllSaveMeta((await getAllSaveMeta()).filter(item => item.id !== meta.id));
    }
  });
});
