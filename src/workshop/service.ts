/**
 * service.ts — 创意工坊的安装、更新、卸载流程。
 *
 * 安装：读安装计划 → 对照本地来源记录得出每个条目要“新装 / 更新 / 保留”→ 查本地 id 冲突 →
 * 先下载全部内容再动本地 → 按依赖顺序写入 → 绑定同计划里的玩法模块到世界 → 写来源记录。
 * 任何一步失败都按相反顺序回滚已经写入的内容。
 */
import { APP_VERSION } from '../config/version';
import { disablePack, enablePack } from '../modules/eventApi';
import { bindCustomGameplayModule } from '../custom-modules/storage';
import { isPublicWorkshopType } from '../workshopCatalog';
import { workshopApi, type WorkshopApi } from './api';
import {
  findLocalConflict,
  installWorkshopContent,
  plannedLocalId,
  removeLocalTarget,
  targetExists,
  type ConflictPolicy,
  type InstallOperation,
  type LocalConflict,
} from './installers';
import { listInstalls, saveInstalls, type InstallTarget, type WorkshopInstallRecord } from './installs';
import {
  WORKSHOP_STATUS_LABELS,
  compareVersions,
  satisfiesVersion,
  type WorkshopInstallPlan,
  type WorkshopInstallPlanError,
  type WorkshopItemSummary,
  type WorkshopStatus,
} from './protocol';
import { activateVisualTheme, getActiveVisualThemeId } from './visualTheme';

export type InstallAction = 'install' | 'update' | 'reinstall' | 'skip';

export interface InstallPreviewEntry {
  item: WorkshopItemSummary;
  role: 'root' | 'dependency';
  action: InstallAction;
  installedVersion?: string;
  conflict: LocalConflict | null;
}

export interface InstallPreview {
  rootId: string;
  plan: WorkshopInstallPlan;
  entries: InstallPreviewEntry[];
  /** 有内容就不能安装（缺依赖、版本不够、应用版本太旧等）。 */
  blockers: string[];
}

export interface InstallResult {
  labels: string[];
  warnings: string[];
  /** 计划里有世界包时，它在本地的 id。 */
  worldId?: string;
}

export function describePlanError(error: WorkshopInstallPlanError, titles: ReadonlyMap<string, string> = new Map()): string {
  const name = titles.get(error.id) ?? error.id;
  const by = error.requiredBy ? `（${titles.get(error.requiredBy) ?? error.requiredBy} 需要）` : '';
  switch (error.code) {
    case 'MISSING': return `缺少依赖「${name}」${by}：工坊里找不到这个条目`;
    case 'INCOMPATIBLE': return `依赖「${name}」版本过低：需要 ${error.requiredVersion}，工坊只有 ${error.actualVersion}${by}`;
    case 'UNAVAILABLE': return `依赖「${name}」${WORKSHOP_STATUS_LABELS[error.status as WorkshopStatus] ?? '不可用'}，暂时无法安装${by}`;
    default: return `依赖形成循环：${error.path.map(id => titles.get(id) ?? id).join(' → ')}`;
  }
}

/** 计划里其他条目对某个依赖的版本要求。 */
function requiredVersions(plan: WorkshopInstallPlan, id: string): string[] {
  return plan.items.flatMap(item => item.dependencies.filter(dependency => dependency.id === id && dependency.version).map(dependency => dependency.version!));
}

export async function previewInstall(rootId: string, api: WorkshopApi = workshopApi): Promise<InstallPreview> {
  const plan = await api.plan(rootId);
  const records = await listInstalls();
  const titles = new Map(plan.items.map(item => [item.id, item.title]));
  const blockers = plan.errors.map(error => describePlanError(error, titles));
  const entries: InstallPreviewEntry[] = [];
  for (const item of plan.items) {
    if (!isPublicWorkshopType(item.type)) {
      blockers.push(`「${item.title}」的类型不受支持`);
      continue;
    }
    if (item.minAppVersion && compareVersions(APP_VERSION, item.minAppVersion) < 0) {
      blockers.push(`「${item.title}」需要应用 ${item.minAppVersion} 或更高版本（当前 ${APP_VERSION}）`);
    }
    const role = item.id === rootId ? 'root' : 'dependency';
    const installed = records.find(record => record.itemId === item.id);
    let action: InstallAction = 'install';
    if (installed) {
      const newer = compareVersions(item.version, installed.version) > 0;
      // 已装的依赖只要满足这次的版本要求就保留，不顺带升级（别的条目可能还依赖旧行为）；
      // 依赖自己的更新在“已安装”页单独提示。
      if (role === 'root') action = newer ? 'update' : 'reinstall';
      else action = requiredVersions(plan, item.id).every(version => satisfiesVersion(installed.version, version)) ? 'skip' : 'update';
    }
    let conflict: LocalConflict | null = null;
    if (action !== 'skip') {
      const planned = plannedLocalId(item.type, item.contentId, item.id);
      const reuses = installed?.targets.some(target => target.kind === planned?.kind);
      if (planned && !reuses) conflict = await findLocalConflict(planned.kind, planned.id, item.id, records);
    }
    entries.push({ item, role, action, ...(installed ? { installedVersion: installed.version } : {}), conflict });
  }
  return { rootId, plan, entries, blockers };
}

function sameTarget(left: InstallTarget, right: InstallTarget): boolean {
  return left.kind === right.kind && left.id === right.id;
}

/**
 * 按预览执行安装。conflicts 指定每个有冲突的条目怎么处理（默认另存副本）。
 * 依赖已满足的条目（skip）不会重新下载。
 */
export async function executeInstall(
  preview: InstallPreview,
  options: { conflicts?: Readonly<Record<string, ConflictPolicy>> } = {},
  api: WorkshopApi = workshopApi,
): Promise<InstallResult> {
  if (preview.blockers.length) throw new Error(preview.blockers.join('；'));
  const records = await listInstalls();
  const work = preview.entries.filter(entry => entry.action !== 'skip');

  // 先把要装的内容全部下载下来，网络失败不会留下装了一半的依赖图。
  const payloads: Array<{ entry: InstallPreviewEntry; data: unknown; version: string }> = [];
  for (const entry of work) {
    const download = await api.download(entry.item.id);
    if (download.data === null || download.data === undefined) throw new Error(`「${entry.item.title}」返回的数据为空`);
    if (download.type !== entry.item.type) throw new Error(`「${entry.item.title}」的类型与安装计划不一致`);
    payloads.push({ entry, data: download.data, version: download.version });
  }

  const operations: Array<{ entry: InstallPreviewEntry; version: string; operation: InstallOperation }> = [];
  const rollback = async () => {
    for (const { operation } of [...operations].reverse()) {
      try { await operation.rollback(); } catch { /* 保留最初的错误 */ }
    }
  };
  let worldId: string | undefined;
  try {
    for (const { entry, data, version } of payloads) {
      const previous = records.find(record => record.itemId === entry.item.id);
      const operation = await installWorkshopContent({
        item: { id: entry.item.id, type: entry.item.type as WorkshopInstallRecord['type'], version, title: entry.item.title, authorName: entry.item.author?.name ?? '' },
        data,
        previousTargets: previous?.targets,
        conflict: options.conflicts?.[entry.item.id] ?? 'copy',
        records,
      }).catch((error: unknown) => {
        throw new Error(`安装「${entry.item.title}」失败：${error instanceof Error ? error.message : String(error)}`);
      });
      operations.push({ entry, version, operation });
    }
    // 同一计划里的玩法模块绑定到计划里的世界（世界没变时用已安装的那份）。
    const worldOperation = operations.find(({ entry }) => entry.item.type === 'world_package');
    const keptWorld = preview.entries.find(entry => entry.item.type === 'world_package' && entry.action === 'skip');
    worldId = worldOperation?.operation.targets.find(target => target.kind === 'world')?.id
      ?? (keptWorld ? records.find(record => record.itemId === keptWorld.item.id)?.targets.find(target => target.kind === 'world')?.id : undefined);
    if (worldId) {
      for (const { operation } of operations) {
        for (const target of operation.targets.filter(entry => entry.kind === 'module')) await bindCustomGameplayModule(target.id, worldId);
      }
    }

    // 写来源记录。
    const now = Date.now();
    const dependents = (id: string) => preview.plan.items.filter(item => item.dependencies.some(dependency => dependency.id === id)).map(item => item.id);
    const next = records.map(record => ({ ...record }));
    const upsert = (record: WorkshopInstallRecord) => {
      const index = next.findIndex(entry => entry.itemId === record.itemId);
      if (index >= 0) next[index] = record;
      else next.push(record);
    };
    for (const { entry, version, operation } of operations) {
      const old = records.find(record => record.itemId === entry.item.id);
      upsert({
        itemId: entry.item.id,
        type: entry.item.type as WorkshopInstallRecord['type'],
        title: entry.item.title,
        version,
        authorName: entry.item.author?.name ?? old?.authorName ?? '',
        installedAt: old?.installedAt ?? now,
        updatedAt: now,
        explicit: entry.role === 'root' || Boolean(old?.explicit),
        requiredBy: [...new Set([...(old?.requiredBy ?? []), ...dependents(entry.item.id)])],
        dependencies: entry.item.dependencies,
        targets: operation.targets,
        ...(worldId && operation.targets.some(target => target.kind === 'module') ? { boundWorldId: worldId } : old?.boundWorldId ? { boundWorldId: old.boundWorldId } : {}),
      });
    }
    for (const entry of preview.entries.filter(candidate => candidate.action === 'skip')) {
      const index = next.findIndex(record => record.itemId === entry.item.id);
      if (index >= 0) next[index] = { ...next[index], requiredBy: [...new Set([...next[index].requiredBy, ...dependents(entry.item.id)])] };
    }
    await saveInstalls(next);

    // 更新后不再使用的旧资产（例如作者改了包内 id）。尽力清理，失败不影响安装结果。
    for (const { entry, operation } of operations) {
      const old = records.find(record => record.itemId === entry.item.id);
      for (const stale of old?.targets.filter(target => !operation.targets.some(current => sameTarget(current, target))) ?? []) {
        try { await removeLocalTarget(stale); } catch { /* 留给玩家在本地资产页处理 */ }
      }
    }
  } catch (error) {
    await rollback();
    throw error;
  }
  return {
    labels: operations.map(({ operation }) => operation.label),
    warnings: operations.flatMap(({ operation }) => operation.warnings),
    ...(worldId ? { worldId } : {}),
  };
}

export interface UninstallPreview {
  /** 会被卸载的条目（含不再被任何条目需要的依赖）。 */
  records: WorkshopInstallRecord[];
  /** 仍依赖它的已安装条目；非空时不能卸载。 */
  blockedBy: WorkshopInstallRecord[];
}

export function previewUninstall(itemId: string, records: readonly WorkshopInstallRecord[]): UninstallPreview {
  const root = records.find(record => record.itemId === itemId);
  if (!root) return { records: [], blockedBy: [] };
  const blockedBy = records.filter(record => root.requiredBy.includes(record.itemId));
  if (blockedBy.length) return { records: [], blockedBy };
  const removing = new Set([itemId]);
  // 反复寻找“只被将要卸载的条目需要、且不是玩家主动安装”的依赖。
  let grew = true;
  while (grew) {
    grew = false;
    for (const record of records) {
      if (removing.has(record.itemId) || record.explicit || record.requiredBy.length === 0) continue;
      if (record.requiredBy.every(owner => removing.has(owner))) {
        removing.add(record.itemId);
        grew = true;
      }
    }
  }
  return { records: records.filter(record => removing.has(record.itemId)), blockedBy: [] };
}

export async function uninstall(itemId: string): Promise<{ removed: string[] }> {
  const records = await listInstalls();
  const preview = previewUninstall(itemId, records);
  if (preview.blockedBy.length) throw new Error(`「${preview.blockedBy.map(record => record.title).join('」「')}」还依赖它，请先卸载它们`);
  if (!preview.records.length) throw new Error('这个条目没有安装记录');
  const undo: Array<() => Promise<void>> = [];
  const activeTheme = getActiveVisualThemeId();
  try {
    for (const record of preview.records) {
      for (const target of record.targets) undo.push(await removeLocalTarget(target));
    }
    const removed = new Set(preview.records.map(record => record.itemId));
    await saveInstalls(records.filter(record => !removed.has(record.itemId)).map(record => ({ ...record, requiredBy: record.requiredBy.filter(owner => !removed.has(owner)) })));
  } catch (error) {
    for (const step of undo.reverse()) {
      try { await step(); } catch { /* 保留最初的错误 */ }
    }
    throw error;
  }
  if (activeTheme && preview.records.some(record => record.targets.some(target => target.kind === 'asset' && target.id === activeTheme))) {
    await activateVisualTheme(null);
  }
  return { removed: preview.records.map(record => record.title) };
}

export interface InstalledEntry {
  record: WorkshopInstallRecord;
  latestVersion?: string;
  remoteStatus?: WorkshopStatus;
  hasUpdate: boolean;
  /** 本地已经被手动删掉的资产。 */
  missingTargets: InstallTarget[];
}

/** 已安装列表 + 远端最新版本。网络失败时只返回本地信息。 */
export async function listInstalledEntries(api: WorkshopApi = workshopApi): Promise<{ entries: InstalledEntry[]; offline: boolean }> {
  const records = await listInstalls();
  let remote = new Map<string, { version: string; status: WorkshopStatus }>();
  let offline = false;
  try {
    remote = new Map((await api.updates(records.map(record => record.itemId))).map(info => [info.id, info]));
  } catch {
    offline = true;
  }
  const entries: InstalledEntry[] = [];
  for (const record of records) {
    const info = remote.get(record.itemId);
    const missingTargets: InstallTarget[] = [];
    for (const target of record.targets) if (!(await targetExists(target))) missingTargets.push(target);
    entries.push({
      record,
      ...(info ? { latestVersion: info.version, remoteStatus: info.status } : {}),
      hasUpdate: Boolean(info && (info.status === 'published' || info.status === 'unlisted') && compareVersions(info.version, record.version) > 0),
      missingTargets,
    });
  }
  entries.sort((left, right) => Number(right.record.explicit) - Number(left.record.explicit) || right.record.updatedAt - left.record.updatedAt);
  return { entries, offline };
}

/** 事件类内容（事件包、工作流包、冒险包）安装后默认停用，可在这里直接启用。 */
export async function setInstalledEventsEnabled(record: WorkshopInstallRecord, enabled: boolean): Promise<void> {
  for (const target of record.targets.filter(entry => entry.kind === 'event')) {
    if (enabled) await enablePack(target.id);
    else await disablePack(target.id);
  }
}
