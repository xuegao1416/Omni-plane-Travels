import type { WorldBookEntryDef, WorldDef } from '../../../../data/worlds-schema';
import { findWorldDef } from '../../../../data/worldLoader';
import { STORAGE_KEYS } from '../../../../config/storageKeys';

/** 持久化世界到 localStorage（CUSTOM_WORLDS） */
export function persistWorldToStorage(updatedWorld: WorldDef) {
  try {
    const stored: WorldDef[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
    const idx = stored.findIndex(w => w.id === updatedWorld.id);
    if (idx >= 0) {
      stored[idx] = updatedWorld;
    } else {
      stored.push(updatedWorld);
    }
    localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(stored));
  } catch (err) {
    console.error('[世界书] 持久化失败:', err);
    throw err;
  }
}

/** 读取原始 WorldBookEntryDef[]，优先从 worldDef 读取 */
export function loadDefs(worldId: string): WorldBookEntryDef[] {
  const world = findWorldDef(worldId);
  const defs = world?.worldBookEntries ?? [];
  return JSON.parse(JSON.stringify(defs)); // 深拷贝，避免编辑污染原始数据
}
