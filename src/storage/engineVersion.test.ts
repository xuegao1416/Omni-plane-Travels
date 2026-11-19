import 'fake-indexeddb/auto';
import { describe, expect, test } from 'bun:test';
import { ENGINE_VERSION } from '../config/version';
import { createDefaultGameState } from '../schema/variables';
import { deleteSave, exportSave, getDB, importSaveFromData, loadGame } from './db';

function payload(extra: Record<string, unknown> = {}) {
  const gameState = createDefaultGameState();
  return {
    type: 'omni-plane-travels-save', version: '2.0', ...extra,
    save: { id: `engine_${Math.random().toString(36).slice(2)}`, name: `玩法版本 ${Math.random()}`, timestamp: 1, worldId: 'default', gameState, messages: [] },
  };
}

describe('玩法数据版本保护', () => {
  test('导出与本地存档都带 engineVersion；没有这个字段的旧导出照常导入', async () => {
    const meta = await importSaveFromData(payload());
    try {
      expect((await getDB().then(db => db.get('saves', meta.id))).engineVersion).toBe(ENGINE_VERSION);
      const exported = JSON.parse(await (await exportSave(meta.id)).text());
      expect(exported.version).toBe('2.0');
      expect(exported.engineVersion).toBe(ENGINE_VERSION);
      expect(exported.save.engineVersion).toBe(ENGINE_VERSION);
    } finally {
      await deleteSave(meta.id);
    }
  });

  test('拒绝导入更新版本游戏导出的存档', async () => {
    await expect(importSaveFromData(payload({ engineVersion: ENGINE_VERSION + 1 }))).rejects.toThrow('来自更新版本的游戏');
  });

  test('本机存档的玩法数据版本比应用新时拒绝读取，不会读错后再写回', async () => {
    const meta = await importSaveFromData(payload());
    try {
      const db = await getDB();
      const head = await db.get('saves', meta.id);
      await db.put('saves', { ...head, engineVersion: ENGINE_VERSION + 1 });
      await expect(loadGame(meta.id)).rejects.toThrow('来自更新版本的游戏');
      expect((await db.get('saves', meta.id)).engineVersion).toBe(ENGINE_VERSION + 1);
    } finally {
      await deleteSave(meta.id);
    }
  });
});
