/**
 * installs.ts — 已安装工坊条目的来源记录（IndexedDB global / workshopInstalls.v1）。
 *
 * 每条记录说明：装的是哪个工坊条目的哪个版本、它写进了哪些本地资产（targets）、
 * 是玩家主动安装的还是作为依赖被带进来的（requiredBy）。界面靠它显示“已安装 / 有更新”，
 * 卸载时靠它知道该删什么、哪些依赖已经没人用了。
 */
import { getGlobal, putGlobal } from '../storage/db';
import type { PublicWorkshopType } from '../workshopCatalog';
import type { WorkshopDependency } from './protocol';
import { emitWindowEvent } from './runtimeAssets';

/** world: 自定义世界；module: 玩法模块；event: 事件包记录；npc: NPC 模板；asset: 冒险包/主题原件。 */
export type InstallTargetKind = 'world' | 'module' | 'event' | 'npc' | 'asset';

export interface InstallTarget {
  kind: InstallTargetKind;
  id: string;
  label: string;
}

export interface WorkshopInstallRecord {
  itemId: string;
  type: PublicWorkshopType;
  title: string;
  version: string;
  authorName: string;
  installedAt: number;
  updatedAt: number;
  /** 玩家主动安装（false 表示只是被别的条目作为依赖带进来）。 */
  explicit: boolean;
  /** 依赖它的已安装条目。 */
  requiredBy: string[];
  dependencies: WorkshopDependency[];
  targets: InstallTarget[];
  /** 该条目的玩法模块绑定的世界。 */
  boundWorldId?: string;
}

const INSTALLS_KEY = 'workshopInstalls.v1';
export const INSTALLS_CHANGED = 'workshop-installs-changed';

export async function listInstalls(): Promise<WorkshopInstallRecord[]> {
  const value = await getGlobal<WorkshopInstallRecord[]>(INSTALLS_KEY);
  return Array.isArray(value) ? value.filter(record => record && typeof record.itemId === 'string') : [];
}

export async function saveInstalls(records: readonly WorkshopInstallRecord[]): Promise<void> {
  await putGlobal(INSTALLS_KEY, JSON.parse(JSON.stringify(records)));
  emitWindowEvent(INSTALLS_CHANGED);
}

export async function getInstall(itemId: string): Promise<WorkshopInstallRecord | undefined> {
  return (await listInstalls()).find(record => record.itemId === itemId);
}

/** 哪个已安装条目拥有这个本地资产。 */
export function targetOwner(records: readonly WorkshopInstallRecord[], kind: InstallTargetKind, id: string): WorkshopInstallRecord | undefined {
  return records.find(record => record.targets.some(target => target.kind === kind && target.id === id));
}

/**
 * 玩家在“本地资产”页手动删掉某个资产后调用：从来源记录里去掉它；
 * 一个条目的资产全被删光时，记录也一起移除。
 */
export async function forgetLocalTarget(kind: InstallTargetKind, id: string): Promise<void> {
  const records = await listInstalls();
  let changed = false;
  const next = records.flatMap((record) => {
    const targets = record.targets.filter(target => !(target.kind === kind && target.id === id));
    if (targets.length === record.targets.length) return [record];
    changed = true;
    return targets.length ? [{ ...record, targets }] : [];
  });
  if (!changed) return;
  const remaining = new Set(next.map(record => record.itemId));
  await saveInstalls(next.map(record => ({ ...record, requiredBy: record.requiredBy.filter(owner => remaining.has(owner)) })));
}
