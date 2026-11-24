/**
 * installers.ts — 把下载下来的工坊内容写进本地，每种类型一个安装器，都返回可回滚的操作。
 *
 * 本地 id 的规则：
 *  - 更新已安装的条目时，原地覆盖上次写入的资产（包括上次另存的副本）。
 *  - 本地已有同 id、但不属于这个条目的资产时，由调用方决定 replace（覆盖）或 copy（另存副本）；
 *    与内置世界同 id 时一律另存副本，内置世界永远不会被遮住。
 */
import { STORAGE_KEYS } from '../config/storageKeys';
import { WORLDS } from '../data/worldLoader';
import type { WorldDef } from '../data/worlds-schema';
import { fitsInLocalStorage, formatStorageSize, safeSetItem, trySetItem } from '../storage/safeStorage';
import { deleteNpcTemplate, getNpcTemplates, putNpcTemplate, type NpcTemplate } from '../storage/templateStore';
import {
  bindCustomGameplayModule,
  deleteCustomGameplayModule,
  getCustomGameplayModule,
  restoreCustomGameplayModule,
  saveCustomGameplayModule,
} from '../custom-modules/storage';
import { deleteWebEvent, getWebEvent, putWebEvent, type WebEventRecord } from '../modules/eventDb';
import { invalidateCache } from '../modules/eventApi';
import type { EventPackType, Manifest } from '../modules/schema';
import { workflowToRuleFile } from '../modules/workflowConverters';
import type { WorkflowDefinition } from '../modules/workflowSchema';
import type { PublicWorkshopType } from '../workshopCatalog';
import { adventureEventPackId, compileAdventure } from './adventure';
import { targetOwner, type InstallTarget, type InstallTargetKind, type WorkshopInstallRecord } from './installs';
import { workshopContentId } from './protocol';
import { emitWindowEvent, getWorkshopRuntimeAsset, putWorkshopRuntimeAsset, restoreWorkshopRuntimeAsset } from './runtimeAssets';

export type ConflictPolicy = 'replace' | 'copy';

export interface InstallItemMeta {
  id: string;
  type: PublicWorkshopType;
  version: string;
  title: string;
  authorName: string;
}

export interface InstallContext {
  item: InstallItemMeta;
  data: unknown;
  /** 同一计划里的世界包落地后的本地 id，玩法模块绑定到它。 */
  worldId?: string;
  /** 上次安装写入的资产（更新时原地覆盖）。 */
  previousTargets?: readonly InstallTarget[];
  /** 本地已有同 id 的其他资产时怎么处理（默认另存副本，不丢玩家数据）。 */
  conflict?: ConflictPolicy;
  /** 当前所有来源记录，用来判断冲突的资产是谁的。 */
  records?: readonly WorkshopInstallRecord[];
}

export interface InstallOperation {
  label: string;
  targets: InstallTarget[];
  warnings: string[];
  rollback: () => Promise<void>;
}

export interface LocalConflict {
  kind: InstallTargetKind;
  id: string;
  /** 与内置世界同 id：只能另存副本。 */
  builtin: boolean;
  /** 冲突的资产属于另一个已安装的工坊条目时，给出它的标题。 */
  ownerTitle?: string;
}

const TYPE_LABELS: Record<PublicWorkshopType, string> = {
  world_package: '世界',
  npc_template: 'NPC 模板',
  gameplay_module: '玩法模块',
  event_pack: '事件包',
  workflow_pack: '工作流包',
  adventure_pack: '冒险包',
  visual_theme: '视觉主题',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function jsonCopy<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function readCustomWorlds(): WorldDef[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 这个条目会占用的本地 id（安装前查冲突用；NPC 模板不会冲突）。 */
export function plannedLocalId(type: PublicWorkshopType, contentId: string | null | undefined, itemId: string): { kind: InstallTargetKind; id: string } | null {
  switch (type) {
    case 'world_package': return contentId ? { kind: 'world', id: contentId } : null;
    case 'gameplay_module': return contentId ? { kind: 'module', id: contentId } : null;
    case 'event_pack':
    case 'workflow_pack': return { kind: 'event', id: contentId || itemId };
    case 'adventure_pack': return { kind: 'event', id: adventureEventPackId({ id: contentId || itemId }) };
    case 'visual_theme': return { kind: 'asset', id: itemId };
    default: return null;
  }
}

async function localExists(kind: InstallTargetKind, id: string): Promise<{ exists: boolean; builtin: boolean }> {
  switch (kind) {
    case 'world': {
      const builtin = WORLDS.some(world => world.id === id);
      return { exists: builtin || readCustomWorlds().some(world => world.id === id), builtin };
    }
    case 'module': return { exists: Boolean(await getCustomGameplayModule(id)), builtin: false };
    case 'event': return { exists: Boolean(await getWebEvent(id)), builtin: false };
    case 'npc': return { exists: getNpcTemplates().some(template => template.id === id), builtin: false };
    default: return { exists: false, builtin: false };
  }
}

/** 本地已有同 id、且不是这个条目自己装的资产 → 冲突。 */
export async function findLocalConflict(
  kind: InstallTargetKind,
  id: string,
  itemId: string,
  records: readonly WorkshopInstallRecord[],
): Promise<LocalConflict | null> {
  const owner = targetOwner(records, kind, id);
  if (owner?.itemId === itemId) return null;
  const { exists, builtin } = await localExists(kind, id);
  if (!exists && !owner) return null;
  return { kind, id, builtin, ...(owner ? { ownerTitle: owner.title } : {}) };
}

function copyId(base: string, itemId: string): string {
  return `${base.slice(0, 54)}-ws${itemId.replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase()}`;
}

/** 决定本次写入的本地 id。 */
async function chooseLocalId(kind: InstallTargetKind, base: string, context: InstallContext): Promise<string> {
  const previous = context.previousTargets?.find(target => target.kind === kind);
  if (previous) return previous.id;
  const conflict = await findLocalConflict(kind, base, context.item.id, context.records ?? []);
  if (!conflict) return base;
  return conflict.builtin || context.conflict !== 'replace' ? copyId(base, context.item.id) : base;
}

function restoreLocalStorage(key: string, previous: string | null): void {
  // 回滚是尽力而为：已经写满时不能再让还原动作本身抛错。
  if (previous === null) localStorage.removeItem(key);
  else trySetItem(key, previous);
}

async function installWorld(context: InstallContext): Promise<InstallOperation> {
  const source = isRecord(context.data) ? context.data : {};
  const base = workshopContentId('world_package', source) || `workshop_${context.item.id}`;
  const id = await chooseLocalId('world', base, context);
  const world = { ...(jsonCopy(source) as unknown as WorldDef), id, name: typeof source.name === 'string' && source.name ? source.name : context.item.title };
  const key = STORAGE_KEYS.CUSTOM_WORLDS;
  const previous = localStorage.getItem(key);
  const worlds = readCustomWorlds();
  const index = worlds.findIndex(entry => entry.id === id);
  if (index >= 0) worlds[index] = world;
  else worlds.push(world);
  const payload = JSON.stringify(worlds);
  const fit = fitsInLocalStorage(key, payload);
  if (!fit.ok) {
    throw new Error(`本地存储超过容量预警线：安装后约需 ${formatStorageSize(fit.projectedChars)}，预警上限为 ${formatStorageSize(fit.budgetChars)}。`
      + '请先到「本地资产」把不再需要的世界导出后清理，再重新安装。');
  }
  safeSetItem(key, payload);
  emitWindowEvent('custom-worlds-changed');
  return {
    label: `世界「${world.name}」`,
    targets: [{ kind: 'world', id, label: world.name }],
    warnings: id !== base ? [`本地已有 id 为「${base}」的世界，已另存为「${id}」`] : [],
    rollback: async () => {
      restoreLocalStorage(key, previous);
      emitWindowEvent('custom-worlds-changed');
    },
  };
}

async function installModule(context: InstallContext): Promise<InstallOperation> {
  const source = isRecord(context.data) ? jsonCopy(context.data) : {};
  const base = workshopContentId('gameplay_module', source);
  if (!base) throw new Error('玩法模块缺少 id');
  const id = await chooseLocalId('module', base, context);
  const previous = await getCustomGameplayModule(id);
  const saved = await saveCustomGameplayModule({ ...source, id });
  try {
    if (context.worldId) await bindCustomGameplayModule(saved.module.id, context.worldId);
    // 从工坊更新时，已经启用的世界一起换成新版本（之后新开的游戏用新版）；已有存档仍固定原版本，可在「已安装」里应用更新。
    if (previous?.status === 'enabled') {
      for (const worldId of previous.worldIds) if (worldId !== context.worldId) await bindCustomGameplayModule(saved.module.id, worldId);
    }
  } catch (error) {
    if (previous) await restoreCustomGameplayModule(previous);
    else await deleteCustomGameplayModule(saved.module.id);
    throw error;
  }
  emitWindowEvent('custom-modules-changed');
  return {
    label: `玩法模块「${saved.module.name || context.item.title}」`,
    targets: [{ kind: 'module', id: saved.module.id, label: saved.module.name || context.item.title }],
    warnings: id !== base ? [`本地已有 id 为「${base}」的玩法模块，已另存为「${id}」`] : [],
    rollback: async () => {
      if (previous) await restoreCustomGameplayModule(previous);
      else await deleteCustomGameplayModule(saved.module.id);
      emitWindowEvent('custom-modules-changed');
    },
  };
}

function asManifest(raw: unknown, item: InstallItemMeta, type: EventPackType, id: string): Manifest {
  const source = isRecord(raw) ? raw : {};
  return {
    id,
    name: typeof source.name === 'string' ? source.name : item.title,
    version: typeof source.version === 'string' ? source.version : item.version,
    author: typeof source.author === 'string' ? source.author : item.authorName || '创意工坊',
    description: typeof source.description === 'string' ? source.description : undefined,
    engine: 'opt-event',
    schemaVersion: typeof source.schemaVersion === 'number' ? source.schemaVersion : 1,
    minAppVersion: typeof source.minAppVersion === 'string' ? source.minAppVersion : '3.0.0',
    type,
    coverColor: typeof source.coverColor === 'string' ? source.coverColor : '#3b82f6',
    icon: typeof source.icon === 'string' ? source.icon : 'Package',
    enabledByDefault: false,
    ...(Array.isArray(source.permissions) ? { permissions: source.permissions as Manifest['permissions'] } : {}),
    ...(typeof source.worldId === 'string' && source.worldId ? { worldId: source.worldId } : {}),
  };
}

function stringFiles(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) return null;
  const files: Record<string, string> = {};
  for (const [path, content] of Object.entries(value)) {
    if (typeof content !== 'string') return null;
    files[path] = content;
  }
  return files;
}

/** 事件包 / 工作流包 → 事件记录。 */
export function buildEventRecord(item: InstallItemMeta, data: unknown, id: string): WebEventRecord {
  const source = isRecord(data) ? data : {};
  const sourceManifest = isRecord(source.manifest) ? source.manifest : source;
  const eventType: EventPackType = item.type === 'workflow_pack'
    ? 'rule'
    : sourceManifest.type === 'card' || sourceManifest.type === 'worldbook' || sourceManifest.type === 'bundle' ? sourceManifest.type : 'rule';
  const manifest = asManifest(sourceManifest, item, eventType, id);
  let files = stringFiles(source.files);
  if (!files) {
    const workflow = (source.workflow ?? (item.type === 'workflow_pack' ? source : undefined)) as WorkflowDefinition | undefined;
    if (workflow && Array.isArray(workflow.nodes) && Array.isArray(workflow.connections)) {
      files = {
        'schema/workflow.json': JSON.stringify(workflow, null, 2),
        'schema/rules.json': JSON.stringify(workflowToRuleFile(workflow), null, 2),
      };
    } else if (Array.isArray(source.rules) || Array.isArray(source.periodicRules)) {
      files = { 'schema/rules.json': JSON.stringify({ version: 1, rules: source.rules ?? [], periodicRules: source.periodicRules ?? [] }, null, 2) };
    }
  }
  if (!files) throw new Error('事件包数据缺少 manifest/files 或有效的工作流/规则定义');
  files['manifest.json'] = JSON.stringify(manifest, null, 2);
  return { id, manifest, enabled: false, status: 'installed', installedAt: new Date().toISOString(), files };
}

async function writeEventRecord(record: WebEventRecord): Promise<() => Promise<void>> {
  const previous = await getWebEvent(record.id);
  // 更新时保留玩家的启用选择。
  await putWebEvent(previous ? { ...record, enabled: previous.enabled } : record);
  invalidateCache();
  return async () => {
    if (previous) await putWebEvent(previous);
    else await deleteWebEvent(record.id);
    invalidateCache();
  };
}

async function installEventPack(context: InstallContext): Promise<InstallOperation> {
  const base = workshopContentId(context.item.type, context.data) || context.item.id;
  const id = await chooseLocalId('event', base, context);
  const record = buildEventRecord(context.item, context.data, id);
  const rollback = await writeEventRecord(record);
  return {
    label: `${TYPE_LABELS[context.item.type]}「${record.manifest.name}」`,
    targets: [{ kind: 'event', id, label: record.manifest.name }],
    warnings: id !== base ? [`本地已有 id 为「${base}」的事件包，已另存为「${id}」`] : [],
    rollback,
  };
}

async function installAdventure(context: InstallContext): Promise<InstallOperation> {
  const base = adventureEventPackId(context.data);
  const id = await chooseLocalId('event', base, context);
  const compiled = compileAdventure(context.data, { version: context.item.version, author: context.item.authorName, title: context.item.title });
  const manifest = { ...compiled.manifest, id };
  const files = { ...compiled.files, 'manifest.json': JSON.stringify(manifest, null, 2) };
  const previousAsset = await putWorkshopRuntimeAsset({
    id: context.item.id, type: 'adventure_pack', version: context.item.version, title: context.item.title, data: jsonCopy(context.data), installedAt: Date.now(),
  });
  let rollbackEvent: () => Promise<void>;
  try {
    rollbackEvent = await writeEventRecord({ id, manifest, enabled: false, status: 'installed', installedAt: new Date().toISOString(), files });
  } catch (error) {
    await restoreWorkshopRuntimeAsset(context.item.id, previousAsset);
    throw error;
  }
  return {
    label: `冒险包「${manifest.name}」（${compiled.sceneCount} 个场景）`,
    targets: [{ kind: 'asset', id: context.item.id, label: context.item.title }, { kind: 'event', id, label: manifest.name }],
    warnings: [...compiled.warnings, ...(id !== base ? [`本地已有 id 为「${base}」的事件包，冒险已另存为「${id}」`] : [])],
    rollback: async () => {
      await rollbackEvent();
      await restoreWorkshopRuntimeAsset(context.item.id, previousAsset);
    },
  };
}

async function installTheme(context: InstallContext): Promise<InstallOperation> {
  const previous = await putWorkshopRuntimeAsset({
    id: context.item.id, type: 'visual_theme', version: context.item.version, title: context.item.title, data: jsonCopy(context.data), installedAt: Date.now(),
  });
  return {
    label: `视觉主题「${context.item.title}」`,
    targets: [{ kind: 'asset', id: context.item.id, label: context.item.title }],
    warnings: [],
    rollback: () => restoreWorkshopRuntimeAsset(context.item.id, previous),
  };
}

async function installNpc(context: InstallContext): Promise<InstallOperation> {
  const source = isRecord(context.data) ? context.data : {};
  const npc = (isRecord(source.npc) ? source.npc : source) as unknown as NpcTemplate['npc'];
  const name = typeof source.name === 'string' && source.name ? source.name : context.item.title;
  const id = context.previousTargets?.find(target => target.kind === 'npc')?.id ?? crypto.randomUUID();
  const previous = putNpcTemplate({ id, name, createdAt: Date.now(), npc: jsonCopy(npc) });
  return {
    label: `NPC 模板「${name}」`,
    targets: [{ kind: 'npc', id, label: name }],
    warnings: [],
    rollback: async () => {
      if (previous) putNpcTemplate(previous);
      else deleteNpcTemplate(id);
    },
  };
}

export async function installWorkshopContent(context: InstallContext): Promise<InstallOperation> {
  switch (context.item.type) {
    case 'world_package': return installWorld(context);
    case 'gameplay_module': return installModule(context);
    case 'event_pack':
    case 'workflow_pack': return installEventPack(context);
    case 'adventure_pack': return installAdventure(context);
    case 'visual_theme': return installTheme(context);
    case 'npc_template': return installNpc(context);
    default: throw new Error(`不支持安装类型：${String(context.item.type)}`);
  }
}

/** 删除一个本地资产，返回撤销函数（卸载失败时整体回滚）。 */
export async function removeLocalTarget(target: InstallTarget): Promise<() => Promise<void>> {
  switch (target.kind) {
    case 'world': {
      const key = STORAGE_KEYS.CUSTOM_WORLDS;
      const previous = localStorage.getItem(key);
      safeSetItem(key, JSON.stringify(readCustomWorlds().filter(world => world.id !== target.id)));
      emitWindowEvent('custom-worlds-changed');
      return async () => { restoreLocalStorage(key, previous); emitWindowEvent('custom-worlds-changed'); };
    }
    case 'module': {
      const previous = await getCustomGameplayModule(target.id);
      if (previous) await deleteCustomGameplayModule(target.id);
      emitWindowEvent('custom-modules-changed');
      return async () => { if (previous) await restoreCustomGameplayModule(previous); emitWindowEvent('custom-modules-changed'); };
    }
    case 'event': {
      const previous = await getWebEvent(target.id);
      if (previous) await deleteWebEvent(target.id);
      invalidateCache();
      return async () => { if (previous) await putWebEvent(previous); invalidateCache(); };
    }
    case 'npc': {
      const previous = getNpcTemplates().find(template => template.id === target.id);
      if (previous) deleteNpcTemplate(target.id);
      return async () => { if (previous) putNpcTemplate(previous); };
    }
    case 'asset': {
      const previous = await getWorkshopRuntimeAsset(target.id);
      // 产物（事件包）作为独立的 target 单独删除，这里只删原件。
      await restoreWorkshopRuntimeAsset(target.id, undefined);
      return async () => { if (previous) await putWorkshopRuntimeAsset(previous); };
    }
    default: return async () => {};
  }
}

/** 本地资产是否还在（已安装列表用来提示“本地已被删除”）。 */
export async function targetExists(target: InstallTarget): Promise<boolean> {
  if (target.kind === 'asset') {
    return Boolean(await getWorkshopRuntimeAsset(target.id));
  }
  return (await localExists(target.kind, target.id)).exists;
}
