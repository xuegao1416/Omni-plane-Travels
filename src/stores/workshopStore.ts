/**
 * 创意工坊界面状态：浏览条件与结果、已安装列表、我的发布、收藏。
 * 请求封装在 src/workshop/api.ts，安装/卸载流程在 src/workshop/service.ts。
 */
import { create } from 'zustand';
import type { PublicWorkshopType } from '../workshopCatalog';
import { describeWorkshopError, workshopApi } from '../workshop/api';
import { listInstalledEntries, type InstalledEntry } from '../workshop/service';
import type { WorkshopItemSummary, WorkshopSort } from '../workshop/protocol';

export type { WorkshopItemDetail, WorkshopInstallPlan, WorkshopItemSummary as WorkshopItem } from '../workshop/protocol';

export interface WorkshopBrowseQuery {
  type: PublicWorkshopType | '';
  q: string;
  sort: WorkshopSort;
  page: number;
  /** 只看某位作者的作品（authorName 仅用于显示筛选条）。 */
  author: string;
  authorName: string;
}

export const WORKSHOP_PAGE_SIZE = 18;

interface WorkshopState {
  query: WorkshopBrowseQuery;
  items: WorkshopItemSummary[];
  total: number;
  loading: boolean;
  error: string | null;

  installed: InstalledEntry[];
  installedLoaded: boolean;
  installedOffline: boolean;

  mine: WorkshopItemSummary[];
  mineLoading: boolean;
  mineError: string | null;

  favorites: WorkshopItemSummary[];
  favoritesLoading: boolean;
  favoritesError: string | null;

  /** 改条件并重新加载；除非显式给 page，否则回到第一页。 */
  setQuery: (patch: Partial<WorkshopBrowseQuery>) => Promise<void>;
  fetchItems: () => Promise<void>;
  refreshInstalled: () => Promise<void>;
  fetchMine: () => Promise<void>;
  fetchFavorites: () => Promise<void>;
  /** 本地改动某个条目后（评分、收藏、发布新版本），同步到已加载的列表里。 */
  patchItem: (id: string, patch: Partial<WorkshopItemSummary>) => void;
}

let requestSerial = 0;

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  query: { type: '', q: '', sort: 'latest', page: 1, author: '', authorName: '' },
  items: [],
  total: 0,
  loading: false,
  error: null,

  installed: [],
  installedLoaded: false,
  installedOffline: false,

  mine: [],
  mineLoading: false,
  mineError: null,

  favorites: [],
  favoritesLoading: false,
  favoritesError: null,

  setQuery: async (patch) => {
    set(state => ({ query: { ...state.query, ...patch, page: patch.page ?? 1 } }));
    await get().fetchItems();
  },

  fetchItems: async () => {
    const serial = ++requestSerial;
    const { query } = get();
    set({ loading: true, error: null });
    try {
      const result = await workshopApi.list({
        type: query.type || undefined,
        q: query.q.trim() || undefined,
        author: query.author || undefined,
        sort: query.sort,
        page: query.page,
        pageSize: WORKSHOP_PAGE_SIZE,
      });
      // 只采用最后一次请求的结果，快速切换筛选时不会被旧响应覆盖。
      if (serial === requestSerial) set({ items: result.items, total: result.total, loading: false });
    } catch (error) {
      if (serial === requestSerial) set({ loading: false, error: describeWorkshopError(error) });
    }
  },

  refreshInstalled: async () => {
    const { entries, offline } = await listInstalledEntries();
    set({ installed: entries, installedLoaded: true, installedOffline: offline });
  },

  fetchMine: async () => {
    set({ mineLoading: true, mineError: null });
    try {
      set({ mine: await workshopApi.mine(), mineLoading: false });
    } catch (error) {
      set({ mineLoading: false, mineError: describeWorkshopError(error) });
    }
  },

  fetchFavorites: async () => {
    set({ favoritesLoading: true, favoritesError: null });
    try {
      set({ favorites: await workshopApi.favorites(), favoritesLoading: false });
    } catch (error) {
      set({ favoritesLoading: false, favoritesError: describeWorkshopError(error) });
    }
  },

  patchItem: (id, patch) => {
    const apply = (list: WorkshopItemSummary[]) => list.map(item => (item.id === id ? { ...item, ...patch } : item));
    set(state => ({ items: apply(state.items), mine: apply(state.mine), favorites: apply(state.favorites) }));
  },
}));
