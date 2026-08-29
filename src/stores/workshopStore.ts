/**
 * 创意工坊状态管理
 */
import { create } from 'zustand';
import { API_ENDPOINTS, fetchWithAuth } from '../config/api';
import { useAuthStore } from './authStore';
import type { WorkshopAssetType } from '../workshopCatalog';

export interface WorkshopItem {
  id: string;
  ownerId: string;
  type: WorkshopAssetType;
  contentType?: string;
  title: string;
  description: string | null;
  tags: string[];
  downloadCount: number;
  createdAt: number;
  updatedAt: number;
  category?: string | null;
  dependencies?: Array<{ id: string; version?: string; optional?: boolean }>;
  minAppVersion?: string | null;
  compatibility?: Record<string, unknown>;
  featured?: boolean;
  screenshots?: string[];
  version: string;
  recommendations?: Array<{ id: string; type?: WorkshopItem['type']; version?: string; optional?: boolean; reason?: string }>;
}

export interface WorkshopItemDetail extends WorkshopItem {
  data: any;  // 完整数据
}

export interface WorkshopInstallPlan {
  ok: boolean;
  rootId: string;
  items: WorkshopItem[];
  recommendations: Array<{ id: string; type?: WorkshopItem['type']; version?: string; optional?: boolean; reason?: string }>;
  errors: Array<{ code: 'MISSING' | 'INCOMPATIBLE' | 'CYCLE'; id: string; requiredBy?: string; requiredVersion?: string; actualVersion?: string; path: string[] }>;
}

interface WorkshopState {
  items: WorkshopItem[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchItems: (params?: { type?: string; tag?: string; page?: number; sort?: 'latest' | 'popular' | 'featured'; category?: string }) => Promise<void>;
  fetchItem: (itemId: string) => Promise<WorkshopItemDetail | null>;
  downloadItem: (itemId: string) => Promise<any>;
  createItem: (input: {
    type: string;
    contentType?: string;
    title: string;
    description?: string;
    tags?: string[];
    data: any;
    version?: string;
    category?: string;
    dependencies?: Array<{ id: string; version?: string; optional?: boolean }>;
    minAppVersion?: string;
    compatibility?: Record<string, unknown>;
    screenshots?: string[];
    recommendations?: Array<{ id: string; type?: WorkshopItem['type']; version?: string; optional?: boolean; reason?: string }>;
  }) => Promise<string>;
  deleteItem: (itemId: string) => Promise<void>;
  checkInstall: (itemId: string, installed?: Record<string, string>) => Promise<{ ok: boolean; missing: Array<{ id: string; version?: string; optional?: boolean }>; incompatible: Array<{ id: string; version?: string; optional?: boolean }> } | null>;
  getInstallPlan: (itemId: string) => Promise<WorkshopInstallPlan | null>;
}

export const useWorkshopStore = create<WorkshopState>((set, get) => ({
  items: [],
  total: 0,
  page: 1,
  pageSize: 20,
  isLoading: false,
  error: null,

  fetchItems: async (params = {}) => {
    set({ isLoading: true, error: null });
    try {
      const queryParams = new URLSearchParams();
      if (params.type) queryParams.set('type', params.type);
      if (params.tag) queryParams.set('tag', params.tag);
      if (params.page) queryParams.set('page', String(params.page));
      if ((params as { sort?: string }).sort) queryParams.set('sort', (params as { sort: string }).sort);
      if ((params as { category?: string }).category) queryParams.set('category', (params as { category: string }).category);

      const url = `${API_ENDPOINTS.workshop.list}?${queryParams.toString()}`;
      const response = await fetch(url, {
        credentials: 'include',
      });

      if (response.ok) {
        const data = await response.json();
        set({
          items: data.items || [],
          total: data.total || 0,
          page: data.page || 1,
          pageSize: data.pageSize || 20,
          isLoading: false,
        });
      } else {
        set({ error: '获取工坊列表失败', isLoading: false });
      }
    } catch (error) {
      console.error('获取工坊列表失败:', error);
      set({ error: '获取工坊列表失败', isLoading: false });
    }
  },

  fetchItem: async (itemId: string) => {
    try {
      const response = await fetch(API_ENDPOINTS.workshop.get(itemId), {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        return data.item;
      }
      return null;
    } catch (error) {
      console.error('获取工坊条目失败:', error);
      return null;
    }
  },

  downloadItem: async (itemId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetch(API_ENDPOINTS.workshop.download(itemId), {
        credentials: 'include',
      });
      if (response.ok) {
        const data = await response.json();
        set({ isLoading: false });
        return data;
      } else {
        set({ error: '下载失败', isLoading: false });
        return null;
      }
    } catch (error) {
      console.error('下载工坊条目失败:', error);
      set({ error: '下载失败', isLoading: false });
      return null;
    }
  },

  createItem: async (input) => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      throw new Error('请先登录');
    }

    set({ isLoading: true, error: null });
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.workshop.create, {
        method: 'POST',
        body: JSON.stringify(input),
      });

      if (response.ok) {
        const data = await response.json();
        set({ isLoading: false });
        await get().fetchItems(); // 刷新列表
        return data.id;
      } else {
        const error = await response.json();
        set({ error: error.message || '创建失败', isLoading: false });
        throw new Error(error.message || '创建失败');
      }
    } catch (error) {
      set({ error: '创建失败', isLoading: false });
      throw error;
    }
  },

  deleteItem: async (itemId: string) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.workshop.delete(itemId), {
        method: 'DELETE',
      });
      if (response.ok) {
        set({ isLoading: false });
        await get().fetchItems(); // 刷新列表
      } else {
        set({ error: '删除失败', isLoading: false });
      }
    } catch (error) {
      console.error('删除工坊条目失败:', error);
      set({ error: '删除失败', isLoading: false });
    }
  },

  checkInstall: async (itemId, installed = {}) => {
    try {
      const encoded = Object.entries(installed).map(([id, version]) => `${id}@${version}`).join(',');
      const response = await fetch(`${API_ENDPOINTS.workshop.get(itemId)}/install-check?installed=${encodeURIComponent(encoded)}`, { credentials: 'include' });
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  },

  getInstallPlan: async (itemId) => {
    try {
      const response = await fetch(API_ENDPOINTS.workshop.installPlan(itemId), { credentials: 'include' });
      const data = await response.json();
      return data && typeof data.rootId === 'string' ? data as WorkshopInstallPlan : null;
    } catch {
      return null;
    }
  },
}));
