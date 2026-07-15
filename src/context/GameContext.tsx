import { createContext, useContext, useReducer, useCallback, useEffect, useRef, useMemo, type ReactNode } from 'react';
import { useGameEngine } from '../engine/useGameEngine';
import type { GameEngine } from '../engine/types';
import type { GameSave, PlayerProfile } from '../storage/db';
import { loadGame as loadGameFromDb, optimizeSnapshots, ACTIVE_SAVE_KEY } from '../storage/db';
import { useSaveStore, setAutoSaveBuilder } from '../stores/saveStore';
import { useConfigStore } from '../stores/configStore';
import { useMemoryStore } from '../memory/memoryStore';
import { getEngineState } from '../simulation/SimulationApi';
import { STORAGE_KEYS } from '../config/storageKeys';
import { findWorldDef } from '../data/worldLoader';

/** 创建带默认值的 PlayerProfile（旧存档缺失字段时兜底） */
function withProfileDefaults(raw: Partial<PlayerProfile> | null | undefined): PlayerProfile | null {
  if (!raw) return null;
  return {
    name: raw.name ?? '', gender: raw.gender ?? '', age: raw.age ?? '', background: raw.background ?? '',
    personality: raw.personality ?? '', appearance: raw.appearance ?? '',
    career: raw.career ?? '', socialClass: raw.socialClass ?? '', organization: raw.organization ?? '',
    specialIdentity: raw.specialIdentity ?? '', perspective: raw.perspective ?? '第三人称',
    initialSkills: raw.initialSkills ?? {}, initialItems: raw.initialItems ?? {}, customNpcs: raw.customNpcs ?? [],
  };
}

type Screen = 'start' | 'settings' | 'game' | 'mods';

interface AppState {
  currentScreen: Screen;
  screenHistory: Screen[];
  selectedWorld: string;
  personalInfo: PlayerProfile | null;
  characterHistory: string;
}

type Action =
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'GO_BACK' }
  | { type: 'SET_WORLD'; worldId: string }
  | { type: 'SET_PERSONAL_INFO'; info: PlayerProfile | null }
  | { type: 'SET_CHARACTER_HISTORY'; history: string }
  | { type: 'LOAD_SAVE'; save: GameSave }
  | { type: 'CLEAR_SAVE_DATA' };

const initialState: AppState = {
  currentScreen: 'start',
  screenHistory: [],
  selectedWorld: 'default',
  personalInfo: null,
  characterHistory: '',
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'NAVIGATE':
      return { ...state, currentScreen: action.screen, screenHistory: [...state.screenHistory, state.currentScreen] };
    case 'GO_BACK': {
      const prev = state.screenHistory[state.screenHistory.length - 1];
      return { ...state, currentScreen: prev || 'start', screenHistory: state.screenHistory.slice(0, -1) };
    }
    case 'SET_WORLD':
      return { ...state, selectedWorld: action.worldId };
    case 'SET_PERSONAL_INFO':
      return { ...state, personalInfo: action.info };
    case 'SET_CHARACTER_HISTORY':
      return { ...state, characterHistory: action.history };
    case 'LOAD_SAVE':
      return {
        ...state,
        selectedWorld: action.save.worldId || 'default',
        personalInfo: withProfileDefaults(action.save.personalInfo),
        characterHistory: action.save.characterHistory ?? '',
      };
    case 'CLEAR_SAVE_DATA':
      return {
        ...state,
        personalInfo: null,
        characterHistory: '',
        selectedWorld: 'default',
      };
    default:
      return state;
  }
}

interface GameContextType {
  state: AppState;
  dispatch: React.Dispatch<Action>;
  navigate: (screen: Screen) => void;
  goBack: () => void;
  engine: GameEngine;
  markNewGameStarted: () => void;
}

const GameContext = createContext<GameContextType | null>(null);

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const navigate = useCallback((screen: Screen) => dispatch({ type: 'NAVIGATE', screen }), []);
  const goBack = useCallback(() => dispatch({ type: 'GO_BACK' }), []);

  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const engineRef = useRef<GameEngine | null>(null);

  // 从 configStore 读取 API 配置
  const apiConfig = useConfigStore(s => s.apiConfig);

  // ─── 自动存档桥接 ───
  const scheduleAutoSave = useSaveStore(s => s.scheduleAutoSave);
  const scheduleAutoSaveRef = useRef(scheduleAutoSave);
  useEffect(() => { scheduleAutoSaveRef.current = scheduleAutoSave; }, [scheduleAutoSave]);

  const handleAutoSave = useCallback(() => {
    scheduleAutoSaveRef.current();
  }, []);

  // 注入 buildSaveData 到 saveStore（仅挂载时执行一次，builder 内部通过 ref 读取最新状态）
  useEffect(() => {
    setAutoSaveBuilder(() => {
      const eng = engineRef.current;
      const s = stateRef.current;
      const saveId = useSaveStore.getState().currentSaveId;
      if (!eng || eng.messages.length === 0 || !saveId) {
        console.log('[auto-save] builder 检查:', { hasEngine: !!eng, messageCount: eng?.messages.length, saveId });
        return null;
      }

      const optimized = optimizeSnapshots([...eng.messages]);
      const memStore = useMemoryStore.getState();
      const memData = memStore.toJSON();

      // 自建世界：带上完整世界定义（确保导出可移植）
      let customWorld: Record<string, unknown> | undefined;
      try {
        const customs: Record<string, unknown>[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
        customWorld = customs.find((w: any) => w?.id === s.selectedWorld) || undefined;
      } catch { /* ignore */ }

      return {
        id: saveId,
        name: useSaveStore.getState().currentSaveName || s.personalInfo?.name || '未命名存档',
        timestamp: Date.now(),
        messages: optimized,
        gameState: eng.variableManager.getState(),
        worldId: s.selectedWorld,
        personalInfo: s.personalInfo ?? undefined,
        characterHistory: s.characterHistory || undefined,
        memoryRuntime: memData.memoryRuntime,
        memoryConfig: memData.config,
        vectorMemory: memData.vectorMemory,
        variableConfig: {
          apiPresetId: localStorage.getItem(STORAGE_KEYS.VARIABLE_API_PRESET) || undefined,
        },
        customWorld,
        simulationState: getEngineState(),
      };
    });
  }, []);

  // 引擎
  const engine = useGameEngine(
    apiConfig,
    undefined,
    state.selectedWorld,
    state.personalInfo,
    state.characterHistory,
    handleAutoSave,
  );

  useEffect(() => { engineRef.current = engine; }, [engine]);

  // 跟踪新游戏是否已开始，防止 auto-restore 覆盖新游戏状态
  const newGameStartedRef = useRef(false);

  // ─── F5 刷新恢复 ───
  // 加载存档数据到内存，但不自动跳转游戏页面
  // 用户在主页点击"继续游戏"或"读取存档"后才进入游戏
  useEffect(() => {
    let cancelled = false;
    const savedId = localStorage.getItem(ACTIVE_SAVE_KEY);
    if (savedId) {
      loadGameFromDb(savedId).then(save => {
        // 如果新游戏已开始，不应用旧存档数据
        if (newGameStartedRef.current) return;
        // ── 临时迁移：旧存档 content → rawText（可于 2026-07 后删除） ──
        if (save?.messages?.length) {
          for (const msg of save.messages) {
            if ((msg as any).content && !msg.rawText) {
              msg.rawText = (msg as any).content;
              delete (msg as any).content;
              delete (msg as any).thinking;
              delete (msg as any).actionOptions;
            }
          }
        }
        // ── 迁移结束 ──
        if (!cancelled && save && save.messages && save.messages.length > 0) {
          useSaveStore.setState({ currentSaveId: savedId, currentSaveName: save.name });
          dispatch({ type: 'LOAD_SAVE', save });
          engine.loadSave(save);
        } else if (!cancelled) {
          // 存档不存在或已空，清理所有残留状态
          localStorage.removeItem(ACTIVE_SAVE_KEY);
          useSaveStore.setState({ currentSaveId: null, currentSaveName: '' });
          dispatch({ type: 'CLEAR_SAVE_DATA' });
          engine.reset();
        }
      }).catch(err => {
        console.warn('[auto-restore] 加载存档失败:', err);
        if (!cancelled) {
          localStorage.removeItem(ACTIVE_SAVE_KEY);
          useSaveStore.setState({ currentSaveId: null, currentSaveName: '' });
          dispatch({ type: 'CLEAR_SAVE_DATA' });
          engine.reset();
        }
      });
    }
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 初始化 saveStore
  useEffect(() => {
    useSaveStore.getState().initialize();
  }, []);

  // 开发环境暴露（调试用）
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') {
      (window as any).__engine = engine;
      return () => { delete (window as any).__engine; };
    }
  }, [engine]);

  // 标记新游戏已开始，防止 auto-restore 覆盖
  const markNewGameStarted = useCallback(() => {
    newGameStartedRef.current = true;
  }, []);

  // 稳定 Provider value，防止每次渲染创建新引用导致消费者级联重渲染
  const contextValue = useMemo(
    () => ({ state, dispatch, navigate, goBack, engine, markNewGameStarted }),
    [state, dispatch, navigate, goBack, engine, markNewGameStarted],
  );

  return (
    <GameContext.Provider value={contextValue}>
      {children}
      {engine.DialogUI}
    </GameContext.Provider>
  );
}

export function useGame() {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used within GameProvider');
  return ctx;
}
