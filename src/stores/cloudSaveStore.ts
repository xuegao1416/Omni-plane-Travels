/**
 * 云存档状态管理（支持 gzip 压缩）
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

  fetchSlots: () => Promise<void>;
  uploadSave: (slotIndex: number, saveData: any, currentVersion?: number) => Promise<{ version: number }>;
  downloadSave: (slotIndex: number) => Promise<any>;
  deleteSave: (slotIndex: number) => Promise<void>;
}

/** 裁剪存档数据，去除云端不需要的字段 */
function trimSaveData(save: any): any {
  if (!save || typeof save !== 'object') return save;

  const trimmed = { ...save };

  // 裁剪消息：去掉 streaming 标记，只保留最后 2 条消息的 snapshot
  if (Array.isArray(trimmed.messages)) {
    const len = trimmed.messages.length;
    trimmed.messages = trimmed.messages.map((msg: any, i: number) => {
      const m = { ...msg };
      delete m.streaming;
      // 只保留最后 2 条的 snapshot，老消息的 snapshot 太占空间
      if (i < len - 2) {
        delete m.snapshot;
        delete m.snapshotTime;
      }
      return m;
    });
  }

  // 裁剪 simulationState：只保留核心字段
  if (trimmed.simulationState && typeof trimmed.simulationState === 'object') {
    const sim = trimmed.simulationState;
    trimmed.simulationState = {
      tick: sim.tick,
      isRunning: sim.isRunning,
      config: sim.config,
      // 省略 worldStateCache / ruleResults 等运行时缓存
    };
  }

  return trimmed;
}

/** gzip 压缩字符串 → base64 */
async function compressToBase64(data: string): Promise<string> {
  const stream = new Blob([data]).stream().pipeThrough(new CompressionStream('gzip'));
  const buf = await new Response(stream).arrayBuffer();
  const bytes = new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/** base64 → gzip 解压 → 字符串 */
async function decompressFromBase64(b64: string): Promise<string> {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(stream).text();
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
      // 先裁剪再压缩
      const trimmed = trimSaveData(saveData);
      const jsonStr = JSON.stringify(trimmed);
      const compressed = await compressToBase64(jsonStr);
      const originalSize = new TextEncoder().encode(jsonStr).length;
      const compressedSize = new TextEncoder().encode(compressed).length;
      console.log(`[云存档] 压缩: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${((1 - compressedSize / originalSize) * 100).toFixed(0)}% 节省)`);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-content-encoding': 'gzip',
      };
      if (currentVersion !== undefined) {
        headers['x-save-version'] = String(currentVersion);
      }

      const response = await fetchWithAuth(API_ENDPOINTS.saves.put(slotIndex), {
        method: 'PUT',
        headers,
        body: JSON.stringify({ compressed: true, data: compressed }),
      });

      const data = await response.json();

      if (response.ok) {
        set({ isLoading: false });
        await get().fetchSlots();
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

        const payload = data.payload_json;
        if (typeof payload === 'string') {
          try {
            const parsed = JSON.parse(payload);
            if (parsed.compressed && parsed.data) {
              const decompressed = await decompressFromBase64(parsed.data);
              return JSON.parse(decompressed);
            }
          } catch {
            // 不是压缩格式，按原始 JSON 处理
          }
          return JSON.parse(payload);
        }
        return payload;
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
        await get().fetchSlots();
      } else {
        set({ error: '删除存档失败', isLoading: false });
      }
    } catch (error) {
      console.error('删除云存档失败:', error);
      set({ error: '删除存档失败', isLoading: false });
    }
  },
}));
