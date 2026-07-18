// ============================================================
//  Mod API 桥接 — 封装 10 个 Tauri 命令的 invoke 调用
//  内存注册表缓存 + 监听 mods:changed 事件刷新缓存。
//  写命令失败时统一 unwrap 为 EventApiError（含 EventErrorCode）。
//  注：Rust 后端实现 src-tauri/src/mod_system；本文件仅封装调用。
// ============================================================
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  EventMeta,
  EventRegistryEntry,
  EventDetail,
  EventError,
  EventErrorCode,
  Manifest,
  ValidationResult,
  ValidationIssue,
  Collection,
} from './schema';
// Web 端实现（!isTauri() 时委派；桌面端仍走下方 Tauri invoke）
import * as web from './webEventStore';
// 统一的 isTauri 检测（带缓存），避免与 nativeFetch.ts 各维护一份
import { isTauri } from '../utils/nativeFetch';

export class EventApiError extends Error {
  code: EventErrorCode;
  context?: Record<string, unknown>;
  constructor(e: EventError) {
    super(e.message);
    this.name = 'EventApiError';
    this.code = e.code;
    this.context = e.context;
  }
}

/** Tauri reject 的对象 message 即 EventError 的 JSON 字符串，解析回 EventError */
export function unwrapEventError(err: unknown): EventApiError {
  try {
    const raw = typeof err === 'string' ? err : (err as { message?: string })?.message ?? '{}';
    const parsed = JSON.parse(raw) as Partial<EventError>;
    if (parsed && parsed.code) return new EventApiError(parsed as EventError);
  } catch {
    /* 非结构化错误，降级处理 */
  }
  const msg = err instanceof Error ? err.message : String(err);
  return new EventApiError({ code: 'IO_ERROR', message: msg });
}

/** 是否运行在 Tauri 桌面 webview 内（统一使用 nativeFetch.ts 的带缓存实现）。 */

const NOT_IN_TAURI = new EventApiError({
  code: 'IO_ERROR',
  message:
    '当前不在 Tauri 桌面运行时，无法调用原生命令。请在打包后的桌面应用中操作，或通过 `bun tauri dev` 启动开发窗口。',
});

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  if (!isTauri()) throw NOT_IN_TAURI;
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw unwrapEventError(e);
  }
}

// ─── 内存注册表缓存 ───
let registryCache: EventRegistryEntry[] | null = null;
let metaCache = new Map<string, EventMeta>();
let listener: UnlistenFn | null = null;
let initPromise: Promise<void> | null = null;

export function invalidateCache(): void {
  registryCache = null;
  metaCache.clear();
}

/** @deprecated 请使用 invalidateCache */
export const invalidateModCache = invalidateCache;

/** 监听 packs:changed，自动失效缓存（非 Tauri 环境静默忽略） */
export function ensureCacheListener(): Promise<void> {
  if (initPromise) return initPromise;
  initPromise = (async () => {
    try {
      listener = await listen<{ id?: string; action?: string }>('mods:changed', () => {
        invalidateCache();
      });
    } catch {
      /* 非 Tauri 环境：无事件总线，忽略 */
    }
  })();
  return initPromise;
}

/** @deprecated 请使用 ensureCacheListener */
export const ensureModListener = ensureCacheListener;

/** 手动卸载事件监听（应用卸载时调用） */
export function disposeCacheListener(): void {
  listener?.();
  listener = null;
  initPromise = null;
}

/** @deprecated 请使用 disposeCacheListener */
export const disposeModListener = disposeCacheListener;

// ─── 10 个操作：桌面走 Tauri invoke，Web 走 IndexedDB 实现 ───

export async function discoverPacks(): Promise<EventMeta[]> {
  if (!isTauri()) return web.webDiscoverPacks();
  return call<EventMeta[]>('discover_events');
}

export async function listPacks(force = false): Promise<EventRegistryEntry[]> {
  if (!force && registryCache) return registryCache;
  const r = !isTauri()
    ? await web.webListPacks()
    : await call<EventRegistryEntry[]>('list_events');
  registryCache = r;
  return r;
}

export async function validateEvent(
  manifest: Manifest,
  _assets?: Array<{ path: string; bytes: number[] }>,
  _assetsRoot?: string,
): Promise<ValidationResult> {
  if (!isTauri()) return web.webValidatePack(manifest);
  return call<ValidationResult>('validate_event', { manifest });
}

export async function installPack(_path: string): Promise<EventMeta> {
  // 桌面端从路径安装；Web 端无此概念（安装即导入，见 importPack），
  // 显式引导用户使用「导入 .opt-event」向导。
  if (!isTauri()) {
    throw new EventApiError({ code: 'IO_ERROR', message: 'Web 端不支持 install，请使用「导入 .opt-event」向导。' });
  }
  const r = await call<EventMeta>('install_event', { path: _path });
  invalidateCache();
  return r;
}

export async function uninstallPack(id: string): Promise<void> {
  if (!isTauri()) {
    await web.webUninstallPack(id);
    invalidateCache();
    return;
  }
  await call<void>('uninstall_event', { id });
  invalidateCache();
}

export async function enablePack(id: string): Promise<void> {
  if (!isTauri()) {
    await web.webEnablePack(id);
    invalidateCache();
    return;
  }
  await call<void>('enable_event', { id });
  invalidateCache();
}

export async function disablePack(id: string): Promise<void> {
  if (!isTauri()) {
    await web.webDisablePack(id);
    invalidateCache();
    return;
  }
  await call<void>('disable_event', { id });
  invalidateCache();
}

/** 导入：桌面端从路径安装（原生对话框）；Web 端解析浏览器选择的 .opt-event 文件并落 IndexedDB */
export async function importPack(input?: { path?: string; file?: File }): Promise<EventMeta> {
  if (!isTauri()) {
    if (!input?.file) {
      throw new EventApiError({ code: 'IO_ERROR', message: 'Web 端导入需要传入 .opt-event 文件。' });
    }
    const meta = await web.webImportFromFile(input.file);
    invalidateCache();
    return meta;
  }
  const r = await call<EventMeta>('import_event', input?.path ? { path: input.path } : {});
  invalidateCache();
  return r;
}

export async function exportPack(id: string, _target?: string): Promise<void> {
  if (!isTauri()) {
    await web.webExportPack(id);
    return;
  }
  await call<void>('export_event', _target ? { id, target: _target } : { id });
  invalidateCache();
}

/** @deprecated 请使用 discoverPacks */
export const discoverMods = discoverPacks;
/** @deprecated 请使用 listPacks */
export const listMods = listPacks;
/** @deprecated 请使用 installPack */
export const installMod = installPack;
/** @deprecated 请使用 uninstallPack */
export const uninstallMod = uninstallPack;
/** @deprecated 请使用 enablePack */
export const enableMod = enablePack;
/** @deprecated 请使用 disablePack */
export const disableMod = disablePack;
/** @deprecated 请使用 importPack */
export const importMod = importPack;
/** @deprecated 请使用 exportPack */
export const exportMod = exportPack;

export async function getEventDetail(id: string): Promise<EventDetail> {
  if (!isTauri()) return web.webGetEventDetail(id);
  return call<EventDetail>('get_event_detail', { id });
}

/** 便捷：取单个包的元数据（带缓存） */
export async function getEventMeta(id: string): Promise<EventMeta | null> {
  if (metaCache.has(id)) return metaCache.get(id)!;
  try {
    const list = await listPacks();
    const found = list.find((e) => e.meta.id === id)?.meta ?? null;
    if (found) metaCache.set(id, found);
    return found;
  } catch {
    return null;
  }
}

export type { ValidationIssue };

// ─── 合集（Collection）桥接层 ───
// 当前无 Tauri 后端命令，统一委派 Web 端 IndexedDB 实现。

export async function createCollection(
  name: string,
  coverColor: string,
  icon: string,
  memberIds: string[],
): Promise<string> {
  const id = await web.webCreateCollection(name, coverColor, icon, memberIds);
  invalidateCache();
  return id;
}

export async function updateCollection(
  id: string,
  updates: Partial<Pick<Collection, 'name' | 'coverColor' | 'icon' | 'memberIds'>>,
): Promise<void> {
  await web.webUpdateCollection(id, updates);
  invalidateCache();
}

export async function removeCollection(id: string): Promise<void> {
  await web.webRemoveCollection(id);
  invalidateCache();
}

export async function listCollections(): Promise<Collection[]> {
  return web.webListCollections();
}

export async function getCollectionDetail(
  id: string,
): Promise<{ collection: Collection; members: EventRegistryEntry[] } | null> {
  return web.webGetCollectionDetail(id);
}
