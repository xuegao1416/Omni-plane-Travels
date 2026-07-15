import { useCallback, useEffect, useRef, useState } from 'react';
import {
  listMods,
  discoverMods,
  enableMod,
  disableMod,
  uninstallMod,
  importMod as importModFn,
  exportMod as exportModFn,
  getEventDetail,
  validateEvent as validateEventFn,
} from '../../modules/eventApi';
import type {
  EventRegistryEntry,
  EventDetail,
  EventMeta,
  Manifest,
  ValidationResult,
} from '../../modules/schema';

export interface UseEventsResult {
  /** 已注册（安装）的事件 */
  mods: EventRegistryEntry[];
  /** 本地发现的 .opt-event 包（含未安装） */
  discovered: EventMeta[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  enable: (id: string) => Promise<void>;
  disable: (id: string) => Promise<void>;
  uninstall: (id: string) => Promise<void>;
  /** 含 spec 命名 `import` 与别名 `importMod`（保留字不可作解构绑定，二者等价）。
   *  桌面端传 { path }（原生对话框），Web 端传 { file }（浏览器选择的 .opt-event）。 */
  import: (input?: { path?: string; file?: File }) => Promise<EventMeta | null>;
  importMod: (input?: { path?: string; file?: File }) => Promise<EventMeta | null>;
  exportMod: (id: string, target?: string) => Promise<void>;
  detail: (id: string) => Promise<EventDetail | null>;
  validate: (manifest: Manifest) => Promise<ValidationResult | null>;
}

function toMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return '未知错误';
}

/** 包裹 eventApi 的 React Hook：列表 / 发现 / 启停 / 卸载 / 导入 / 导出 / 详情 */
export function useEvents(): UseEventsResult {
  const [mods, setMods] = useState<EventRegistryEntry[]>([]);
  const [discovered, setDiscovered] = useState<EventMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [list, disc] = await Promise.all([
        listMods(true).catch(() => [] as EventRegistryEntry[]),
        discoverMods().catch(() => [] as EventMeta[]),
      ]);
      if (!mounted.current) return;
      setMods(list);
      setDiscovered(disc);
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
        await enableMod(id);
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
        await disableMod(id);
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
        await uninstallMod(id);
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
        const meta = await importModFn(input);
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
      await exportModFn(id, target);
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

  return {
    mods,
    discovered,
    loading,
    error,
    refresh,
    enable,
    disable,
    uninstall,
    import: doImport,
    importMod: doImport,
    exportMod: doExport,
    detail,
    validate,
  };
}
