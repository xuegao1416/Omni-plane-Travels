import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listPacks,
  discoverPacks,
  enablePack,
  disablePack,
  uninstallPack,
  importPack as importPackFn,
  exportPack as exportPackFn,
  getEventDetail,
  validateEvent as validateEventFn,
  listCollections as listCollectionsFn,
  createCollection as createCollectionFn,
  removeCollection as removeCollectionFn,
  updateCollection as updateCollectionFn,
} from '../../modules/eventApi';
import type {
  EventRegistryEntry,
  EventDetail,
  EventMeta,
  Manifest,
  ValidationResult,
  Collection,
} from '../../modules/schema';

export interface UseEventsResult {
  /** 已注册（安装）的事件包 */
  packs: EventRegistryEntry[];
  /** 本地发现的 .opt-event 包（含未安装） */
  discovered: EventMeta[];
  /** 用户创建的合集 */
  collections: Collection[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  enable: (id: string) => Promise<void>;
  disable: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  /** 桌面端传 { path }（原生对话框），Web 端传 { file }（浏览器选择的 .opt-event）。 */
  importPack: (input?: { path?: string; file?: File }) => Promise<EventMeta | null>;
  exportPack: (id: string, target?: string) => Promise<void>;
  detail: (id: string) => Promise<EventDetail | null>;
  validate: (manifest: Manifest) => Promise<ValidationResult | null>;
  /** 创建合集 */
  createCollection: (data: { name: string; coverColor: string; icon: string; memberIds: string[] }) => Promise<string>;
  /** 删除合集 */
  deleteCollection: (id: string) => Promise<void>;
  /** 更新合集（名称 / 封面色 / 图标 / 成员） */
  updateCollection: (id: string, patch: Partial<Pick<Collection, 'name' | 'coverColor' | 'icon' | 'memberIds'>>) => Promise<void>;
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return '未知错误';
}

/** 包裹 eventApi 的 React Hook：列表 / 发现 / 启停 / 卸载 / 导入 / 导出 / 详情 / 合集 */
export function useEvents(): UseEventsResult {
  const [packs, setPacks] = useState<EventRegistryEntry[]>([]);
  const [discovered, setDiscovered] = useState<EventMeta[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, disc, cols] = await Promise.all([
        listPacks(true).catch(() => [] as EventRegistryEntry[]),
        discoverPacks().catch(() => [] as EventMeta[]),
        listCollectionsFn().catch(() => [] as Collection[]),
      ]);
      if (!mounted.current) return;
      setPacks(list);
      setDiscovered(disc);
      setCollections(cols);
    } catch (e) {
      if (!mounted.current) return;
      setError(toMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    return () => {
      mounted.current = false;
    };
  }, [refresh]);

  const enable = useCallback(
    async (id: string) => {
      try {
        await enablePack(id);
      } catch (e) {
        setError(toMessage(e));
      }
      await refresh();
    },
    [refresh],
  );

  const disable = useCallback(
    async (id: string) => {
      try {
        await disablePack(id);
      } catch (e) {
        setError(toMessage(e));
      }
      await refresh();
    },
    [refresh],
  );

  const uninstall = useCallback(
    async (id: string) => {
      try {
        await uninstallPack(id);
      } catch (e) {
        setError(toMessage(e));
      }
      await refresh();
    },
    [refresh],
  );

  const doImport = useCallback(
    async (input?: { path?: string; file?: File }): Promise<EventMeta | null> => {
      try {
        const meta = await importPackFn(input);
        await refresh();
        return meta;
      } catch (e) {
        setError(toMessage(e));
        return null;
      }
    },
    [refresh],
  );

  const doExport = useCallback(async (id: string, target?: string) => {
    try {
      await exportPackFn(id, target);
    } catch (e) {
      setError(toMessage(e));
    }
  }, []);

  const detail = useCallback(async (id: string): Promise<EventDetail | null> => {
    try {
      return await getEventDetail(id);
    } catch (e) {
      setError(toMessage(e));
      return null;
    }
  }, []);

  const validate = useCallback(async (manifest: Manifest): Promise<ValidationResult | null> => {
    try {
      return await validateEventFn(manifest);
    } catch (e) {
      setError(toMessage(e));
      return null;
    }
  }, []);

  // ─── 合集操作（IndexedDB 持久化） ───

  const createCollection = useCallback(
    async (data: { name: string; coverColor: string; icon: string; memberIds: string[] }): Promise<string> => {
      try {
        const id = await createCollectionFn(data.name, data.coverColor, data.icon, data.memberIds);
        await refresh();
        return id;
      } catch (e) {
        setError(toMessage(e));
        return '';
      }
    },
    [refresh],
  );

  const deleteCollection = useCallback(
    async (id: string): Promise<void> => {
      try {
        await removeCollectionFn(id);
        await refresh();
      } catch (e) {
        setError(toMessage(e));
      }
    },
    [refresh],
  );

  const updateCollection = useCallback(
    async (id: string, patch: Partial<Pick<Collection, 'name' | 'coverColor' | 'icon' | 'memberIds'>>): Promise<void> => {
      try {
        await updateCollectionFn(id, patch);
        await refresh();
      } catch (e) {
        setError(toMessage(e));
      }
    },
    [refresh],
  );

  return {
    packs,
    discovered,
    collections,
    loading,
    error,
    refresh,
    enable,
    disable,
    uninstall,
    importPack: doImport,
    exportPack: doExport,
    detail,
    validate,
    createCollection,
    deleteCollection,
    updateCollection,
  };
}
