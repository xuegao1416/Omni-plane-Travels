/**
 * 后台世界推演 — Zustand Store
 * 管理推演状态的 UI 层绑定
 */

import { create } from 'zustand';
import type { SimulationState, SimConfig } from '../simulation/types';
import { createEmptySimState, DEFAULT_SIM_CONFIG } from '../simulation/types';
import { SIM_STORAGE_KEY } from '../simulation/storage';

/** 规范化 activePresetId：过滤空/垃圾值，回退到 'default' */
function sanitizeActivePresetId(raw: unknown): string {
  if (typeof raw !== 'string' || !raw || raw === 'null' || raw === 'undefined' || raw === 'default') {
    return 'default';
  }
  return raw;
}

interface SimulationStore {
  /** 模拟状态 */
  simState: SimulationState;
  /** 是否正在推演中 */
  isSimulating: boolean;
  /** 上次推演错误 */
  lastError: string | null;

  // 操作
  updateConfig: (patch: Partial<SimConfig>) => void;
  setSimState: (state: SimulationState) => void;
  setIsSimulating: (v: boolean) => void;
  setLastError: (err: string | null) => void;
  resetSimulation: () => void;
  loadFromStorage: () => void;
  /** 从引擎同步状态（仅更新 React state，不写 localStorage） */
  syncFromEngine: (state: SimulationState) => void;
}

function loadSimState(): SimulationState {
  try {
    const raw = localStorage.getItem(SIM_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SimulationState>;
      // ─── 兼容旧存档：补全缺失字段 ───
      if (!parsed.pendingInteractions) parsed.pendingInteractions = [];
      if (!parsed.events) parsed.events = {};
      if (!parsed.resolvedEvents) parsed.resolvedEvents = {};
      if (!parsed.storylines) parsed.storylines = {};
      if (parsed.tickCount === undefined) parsed.tickCount = 0;
      if (parsed.lastTickTimestamp === undefined) parsed.lastTickTimestamp = 0;
      if (parsed.config) {
        if (parsed.config.staleTickThreshold === undefined) parsed.config.staleTickThreshold = 10;
        if (!parsed.config.activePresetId) parsed.config.activePresetId = 'default';
        parsed.config.activePresetId = sanitizeActivePresetId(parsed.config.activePresetId);
        if (parsed.config.autoTickInterval === undefined) parsed.config.autoTickInterval = 3;
        if (parsed.config.lastAutoTickRound === undefined) parsed.config.lastAutoTickRound = 0;
        if (parsed.config.lastSimulatedTime === undefined) parsed.config.lastSimulatedTime = '';
        if (parsed.config.maxCascadeDepth === undefined) parsed.config.maxCascadeDepth = 3;
        if (parsed.config.maxActiveEvents === undefined) parsed.config.maxActiveEvents = 5;
        if (parsed.config.maxStorylineCharacters === undefined) parsed.config.maxStorylineCharacters = 5;
        if (parsed.config.beatsPerTick === undefined) parsed.config.beatsPerTick = 2;
        if (parsed.config.timeUnit === undefined) parsed.config.timeUnit = 'per_scene';
        if (parsed.config.enabled === undefined) parsed.config.enabled = true;
      } else {
        parsed.config = { ...DEFAULT_SIM_CONFIG };
      }
      return parsed as SimulationState;
    }
  } catch {
    // ignore
  }
  return createEmptySimState();
}

export const useSimulationStore = create<SimulationStore>((set) => ({
  simState: loadSimState(),
  isSimulating: false,
  lastError: null,

  updateConfig: (patch) =>
    set((s) => {
      const newConfig = { ...s.simState.config, ...patch };
      const newState = { ...s.simState, config: newConfig };
      try {
        localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(newState));
      } catch { /* ignore */ }
      return { simState: newState };
    }),

  setSimState: (state) =>
    set(() => {
      try {
        localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(state));
      } catch { /* ignore */ }
      return { simState: state };
    }),

  /** 从引擎同步状态（仅更新 React state，不写 localStorage，避免双写） */
  syncFromEngine: (state: SimulationState) =>
    set({ simState: state }),

  setIsSimulating: (v) => set({ isSimulating: v }),
  setLastError: (err) => set({ lastError: err }),

  resetSimulation: () =>
    set(() => {
      const empty = createEmptySimState();
      try {
        localStorage.setItem(SIM_STORAGE_KEY, JSON.stringify(empty));
      } catch { /* ignore */ }
      return { simState: empty, lastError: null };
    }),

  loadFromStorage: () =>
    set({ simState: loadSimState() }),
}));
