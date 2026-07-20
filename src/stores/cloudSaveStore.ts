/**
 * 云存档状态管理
 */
import { create } from 'zustand';
import { API_ENDPOINTS, fetchWithAuth } from '../config/api';
import { useAuthStore } from './authStore';

export interface CloudSaveSlot {
  slotIndex: number;
  version: number;
  size: number;
  updatedAt: number;
}

interface CloudSaveState {
  slots: CloudSaveSlot[];
  isLoading: boolean;
  error: string | null;

  // Actions
  fetchSlots: () => Promise<void>;
  uploadSave: (slotIndex: number, saveData: any, currentVersion?: number) => Promise<{ version: number }>;
  downloadSave: (slotIndex: number) => Promise<any>;
  deleteSave: (slotIndex: number) => Promise<void>;
}

export const useCloudSaveStore = create<CloudSaveState>((set, get) => ({
  slots: [],
  isLoading: false,
  error: null,

  fetchSlots: async () => {
    const { isAuthenticated } = useAuthStore.getState();
    if (!isAuthenticated) {
      set({ slots: [] });
      return;
    }

    set({ isLoading: true, error: null });
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.saves.list);
      if (response.ok) {
        const data = await response.json();
        set({ slots: data.slots || [], isLoading: false });
      } else {
        set({ error: '获取存档列表失败', isLoading: false });
      }
    } catch (error) {
      console.error('获取云存档列表失败:', error);
      set({ error: '获取存档列表失败', isLoading: false });
    }
  },

  uploadSave: async (slotIndex: number, saveData: any, currentVersion?: number) => {
    set({ isLoading: true, error: null });
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (currentVersion !== undefined) {
        headers['x-save-version'] = String(currentVersion);
      }

      const response = await fetchWithAuth(API_ENDPOINTS.saves.put(slotIndex), {
        method: 'PUT',
        headers,
        body: JSON.stringify(saveData),
      });

      const data = await response.json();

      if (response.ok) {
        set({ isLoading: false });
        await get().fetchSlots(); // 刷新列表
        return { version: data.version };
      } else if (response.status === 409) {
        set({ isLoading: false, error: '版本冲突' });
        throw new Error('VERSION_CONFLICT');
      } else {
        set({ error: data.message || '上传失败', isLoading: false });
        throw new Error(data.message || '上传失败');
      }
    } catch (error) {
      if ((error as Error).message !== 'VERSION_CONFLICT') {
        set({ error: '上传存档失败', isLoading: false });
      }
      throw error;
    }
  },

  downloadSave: async (slotIndex: number) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.saves.get(slotIndex));
      if (response.ok) {
        const data = await response.json();
        set({ isLoading: false });
        return JSON.parse(data.payload_json);
      } else {
        set({ error: '下载存档失败', isLoading: false });
        return null;
      }
    } catch (error) {
      console.error('下载云存档失败:', error);
      set({ error: '下载存档失败', isLoading: false });
      return null;
    }
  },

  deleteSave: async (slotIndex: number) => {
    set({ isLoading: true, error: null });
    try {
      const response = await fetchWithAuth(API_ENDPOINTS.saves.delete(slotIndex), {
        method: 'DELETE',
      });
      if (response.ok) {
        set({ isLoading: false });
        await get().fetchSlots(); // 刷新列表
      } else {
        set({ error: '删除存档失败', isLoading: false });
      }
    } catch (error) {
      console.error('删除云存档失败:', error);
      set({ error: '删除存档失败', isLoading: false });
    }
  },
}));
