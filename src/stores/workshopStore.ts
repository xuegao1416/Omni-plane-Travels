/**
 * 创意工坊状态管理
 */
import { create } from 'zustand';
import { API_ENDPOINTS, fetchWithAuth } from '../config/api';
import { useAuthStore } from './authStore';

export interface WorkshopItem {
  id: string;
  ownerId: string;
  type: 'world_package' | 'character_preset' | 'npc_template' | 'history_preset';
  title: string;
  description: string | null;
  tags: string[];
  downloadCount: number;
  createdAt: number;
  updatedAt: number;
}

export interface WorkshopItemDetail extends WorkshopItem {
  data: any;  // 完整数据
}

interface WorkshopState {
  items: WorkshopItem[];
  total: number;
  page: number;
  pageSize: number;
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchItems: (params?: { type?: string; tag?: string; page?: number }) => Promise<void>;
  fetchItem: (itemId: string) => Promise<WorkshopItemDetail | null>;
  downloadItem: (itemId: string) => Promise<any>;
  createItem: (input: {
    type: string;
    title: string;
    description?: string;
    tags?: string[];
    data: any;
  }) => Promise<string>;
  deleteItem: (itemId: string) => Promise<void>;
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
}));
