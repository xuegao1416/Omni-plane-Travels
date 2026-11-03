import 'fake-indexeddb/auto';
import { describe,it,expect } from 'bun:test';
import {
deleteSave,
getAllSaveMeta,
importSaveFromData,
loadGame,
planV4ToV5Migration,
saveAllSaveMeta,
saveGameIncremental,
SAVE_SCHEMA_VERSION,
} from '../storage/db';
import type { GameSave } from '../storage/db';
import { getDefaultPortraitSource,getPortraitSource } from '../components/start/PortraitEditor';
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
    schemaVersion: SAVE_SCHEMA_VERSION - 1,
    messages: [
      { id: 'm1', role: 'user', rawText: 'hi', round: 0, timestamp: 1 } as any,
      { id: 'm2', role: 'assistant', rawText: 'hello', round: 0, timestamp: 2 } as any,
      { id: 'm3', role: 'user', rawText: 'bye', round: 1, timestamp: 3 } as any,
    ],
    gameState: {} as any,
    worldId: 'default',
  };
}

describe('db direct previous compact migration', () => {
  const oldHead = () => {
    const { messages, ...head } = makeOldSave();
    return { ...head, schemaVersion: 4, round: 1, messageCount: messages.length, lastMessageSeq: 2 };
  };
  it('upgrades v4 marker while preserving plain history and metadata', () => {
    const head = { ...oldHead(), memoryRuntime: { legacy: true } };
    expect(planV4ToV5Migration(head)).toEqual({ ...head, schemaVersion: SAVE_SCHEMA_VERSION });
  });
  it('skips current schema and rejects older internal or inline formats', () => {
    expect(planV4ToV5Migration({ ...oldHead(), schemaVersion: SAVE_SCHEMA_VERSION })).toBeNull();
    expect(() => planV4ToV5Migration({ ...oldHead(), schemaVersion: 3 })).toThrow('仅保留 v4 → v5');
    expect(() => planV4ToV5Migration({ ...oldHead(), messages: [] } as any)).toThrow();
  });
});

describe('imported save metadata', () => {
  it('records the imported message count and repairs incomplete metadata', async () => {
    const rawData = {
      type: 'omni-plane-travels-save',
      version: '2.0',
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

      const { messageCount: _, ...incompleteMeta } = meta;
      await saveAllSaveMeta([incompleteMeta]);
      const repaired = await getAllSaveMeta();
      expect(repaired[0]?.messageCount).toBe(3);
    } finally {
      await deleteSave(meta.id);
      await saveAllSaveMeta((await getAllSaveMeta()).filter(item => item.id !== meta.id));
    }
  });

  it('migrates direct-previous export v1 module fields into independent records', async () => {
    const state = createDefaultGameState();
    state.玩家.生存资源 = { water: { 数量: 4 } };
    const meta = await importSaveFromData({
      type: 'omni-plane-travels-save',
      version: '1.0',
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
