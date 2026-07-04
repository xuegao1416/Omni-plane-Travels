import { create } from 'zustand';
import { STORAGE_KEYS } from '@/config/storageKeys';

interface AudioState {
  bgmMuted: boolean;
  setBgmMuted: (muted: boolean) => void;
}

// 从 localStorage 初始化 — 兼容旧 key 'bgm_muted'（后续写入全部用新 key）
const OLD_KEY = 'bgm_muted';
const NEW_KEY = STORAGE_KEYS.AUDIO_MUTED;
function loadAudioMuted(): boolean {
  // 优先读新 key，fallback 旧 key
  const val = localStorage.getItem(NEW_KEY);
  if (val !== null) return val === 'true';
  return localStorage.getItem(OLD_KEY) === 'true';
}
const initMuted = loadAudioMuted();

export const useAudioStore = create<AudioState>((set, get) => ({
  bgmMuted: initMuted,
  setBgmMuted: (muted) => {
    // 迁移旧数据 → 删旧 key，统一写入新 key
    localStorage.removeItem(OLD_KEY);
    localStorage.setItem(NEW_KEY, String(muted));
    set({ bgmMuted: muted });
  },
}));
