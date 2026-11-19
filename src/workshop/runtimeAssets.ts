/**
 * runtimeAssets.ts — 冒险包与视觉主题的本地原件（IndexedDB global / workshopRuntimeAssets.v1）。
 *
 * 原件留给“本地资产”页查看、编辑和再次发布；真正生效的是它们的产物：
 * 冒险包编译成事件卡包（见 adventure.ts），视觉主题由 visualTheme.ts 注入色板。
 */
import { getGlobal, putGlobal } from '../storage/db';
import { deleteWebEvent, getWebEvent, putWebEvent } from '../modules/eventDb';
import { invalidateCache } from '../modules/eventApi';
import { adventureEventPackId, compileAdventure } from './adventure';

export interface StoredWorkshopRuntimeAsset {
  id: string;
  type: 'adventure_pack' | 'visual_theme';
  version: string;
  title: string;
  data: unknown;
  installedAt: number;
}

const RUNTIME_ASSET_KEY = 'workshopRuntimeAssets.v1';
export const RUNTIME_ASSETS_CHANGED = 'workshop-runtime-assets-changed';

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function emitWindowEvent(name: string): void {
  if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') window.dispatchEvent(new Event(name));
}

async function readAssets(): Promise<StoredWorkshopRuntimeAsset[]> {
  const value = await getGlobal<StoredWorkshopRuntimeAsset[]>(RUNTIME_ASSET_KEY);
  return Array.isArray(value) ? value : [];
}

async function writeAssets(value: StoredWorkshopRuntimeAsset[]): Promise<void> {
  await putGlobal(RUNTIME_ASSET_KEY, value);
  emitWindowEvent(RUNTIME_ASSETS_CHANGED);
}

export async function listWorkshopRuntimeAssets(): Promise<StoredWorkshopRuntimeAsset[]> {
  return jsonCopy(await readAssets());
}

export async function getWorkshopRuntimeAsset(id: string): Promise<StoredWorkshopRuntimeAsset | undefined> {
  return (await readAssets()).find(asset => asset.id === id);
}

/** 写入（同 id 覆盖）。返回之前的记录，供回滚。 */
export async function putWorkshopRuntimeAsset(asset: StoredWorkshopRuntimeAsset): Promise<StoredWorkshopRuntimeAsset | undefined> {
  const assets = await readAssets();
  const previous = assets.find(entry => entry.id === asset.id);
  await writeAssets([...assets.filter(entry => entry.id !== asset.id), jsonCopy(asset)]);
  return previous;
}

/** 回滚用：恢复之前的记录，或在之前不存在时删除。 */
export async function restoreWorkshopRuntimeAsset(id: string, previous: StoredWorkshopRuntimeAsset | undefined): Promise<void> {
  const assets = (await readAssets()).filter(entry => entry.id !== id);
  if (previous) assets.push(previous);
  await writeAssets(assets);
}

export async function deleteWorkshopRuntimeAsset(id: string): Promise<void> {
  const assets = await readAssets();
  const target = assets.find(asset => asset.id === id);
  await writeAssets(assets.filter(asset => asset.id !== id));
  // 冒险包的产物（事件卡包）跟着原件一起删掉，避免留下玩不到原件的卡。
  if (target?.type === 'adventure_pack') {
    await deleteWebEvent(adventureEventPackId(target.data));
    invalidateCache();
  }
}

/** “本地资产”页编辑后保存：冒险包已有产物时按新内容重新编译，保留启用状态。 */
export async function updateWorkshopRuntimeAsset(
  id: string,
  patch: Pick<StoredWorkshopRuntimeAsset, 'title' | 'data'>,
): Promise<void> {
  const assets = await readAssets();
  const index = assets.findIndex(asset => asset.id === id);
  if (index < 0) throw new Error('找不到要编辑的本地资产');
  const next = { ...assets[index], title: patch.title, data: jsonCopy(patch.data) };
  if (next.type === 'adventure_pack') {
    const previousPackId = adventureEventPackId(assets[index].data);
    const existing = await getWebEvent(previousPackId);
    if (existing) {
      const compiled = compileAdventure(next.data, { version: next.version, author: existing.manifest.author, title: next.title });
      if (compiled.packId !== previousPackId) await deleteWebEvent(previousPackId);
      await putWebEvent({ ...existing, id: compiled.packId, manifest: compiled.manifest, files: compiled.files });
      invalidateCache();
    }
  }
  assets[index] = next;
  await writeAssets(assets);
}
