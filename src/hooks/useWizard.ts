import { useState, useEffect, useMemo, useCallback, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { getCreationDraftOwner } from './creationDraftOwner';
import { WORLDS, type WorldDef } from '../data/worldLoader';
import type { PlayerProfile } from '../storage/db';
import type { WorldBookEntry } from '../worldbook/index';
import { STORAGE_KEYS } from '@/config/storageKeys';
import { trySetItem } from '@/storage/safeStorage';
import { normalizeModules } from '../modules/normalizeModule';
import { deleteCustomWorldFromList, type CustomWorldDeleteResult } from '../data/customWorldLifecycle';

const CREATED_WORLDS_KEY = STORAGE_KEYS.CUSTOM_WORLDS;

interface UseWizardOptions {
  initialWorld?: string;
}

export function useWizard({ initialWorld = 'default' }: UseWizardOptions = {}) {
  const [view, setView] = useState<'main' | 'wizard' | 'saves'>('main');
  const [hallWorld, setHallWorld] = useState(initialWorld);
  const creationDraftOwner = getCreationDraftOwner();
  const draft = useSyncExternalStore(creationDraftOwner.subscribe, creationDraftOwner.getSnapshot, creationDraftOwner.getSnapshot);
  // The active save's profile is never an input to a new creation document.
  const personalInfo = draft.profile;
  const step = draft.step;
  const selectedWorld = view === 'wizard' ? draft.selectedWorld : hallWorld;
  const setStep: Dispatch<SetStateAction<number>> = useCallback(value => {
    const current = creationDraftOwner.getSnapshot().step;
    creationDraftOwner.edit({ step: typeof value === 'function' ? value(current) : value });
  }, [creationDraftOwner]);
  const setPersonalInfo: Dispatch<SetStateAction<PlayerProfile>> = useCallback(value => {
    const current = creationDraftOwner.getSnapshot().profile;
    creationDraftOwner.edit({ profile: typeof value === 'function' ? value(current) : value });
  }, [creationDraftOwner]);
  const setSelectedWorld: Dispatch<SetStateAction<string>> = useCallback(value => {
    if (view === 'wizard') {
      const current = creationDraftOwner.getSnapshot().selectedWorld;
      creationDraftOwner.edit({ selectedWorld: typeof value === 'function' ? value(current) : value });
    } else setHallWorld(value);
  }, [creationDraftOwner, view]);
  const resetForNewJourney = () => creationDraftOwner.reset(hallWorld);
  const resumeCreationDraft = () => { setView('wizard'); };

  // ─── 用户创建的世界 ───
  const [createdWorlds, setCreatedWorlds] = useState<WorldDef[]>(() => {
    try {
      const worlds: WorldDef[] = JSON.parse(localStorage.getItem(CREATED_WORLDS_KEY) || '[]');
      // 统一模块数据格式（旧 data → moduleConfig + initialState）
      for (const w of worlds) {
        if (w.modules) w.modules = normalizeModules(w.modules);
      }
      return worlds;
    } catch { return []; }
  });
  // createdWorlds 优先去重：过滤掉 WORLDS 中已存在于 createdWorlds 的同 ID 世界
  // 确保修改后的内置世界不被原版覆盖
  const allWorlds = useMemo(() => {
    const customIds = new Set(createdWorlds.map(w => w.id));
    const builtinFiltered = WORLDS.filter(w => !customIds.has(w.id));
    return [...builtinFiltered, ...createdWorlds];
  }, [createdWorlds]);

  // ─── 世界编辑器 ───
  const [worldEditorOpen, setWorldEditorOpen] = useState(false);
  const [editingWorld, setEditingWorld] = useState<WorldDef | null>(null);
  const [worldEditorInitialStep, setWorldEditorInitialStep] = useState<number | undefined>(undefined);

  // The world entry is a projection of the selected definition, so a previous world's
  // asynchronous load cannot supply a prompt after a selection change.
  const worldEntry = useMemo<WorldBookEntry | null>(() => {
    const entry = allWorlds.find(world => world.id === selectedWorld)?.worldBookEntries?.[0];
    if (!entry) return null;
    return {
      id: entry.uid, comment: entry.comment, content: entry.content,
      constant: entry.constant, enabled: !entry.disable,
      selective: (entry.key?.length ?? 0) > 0, keys: entry.key ?? [],
      secondaryKeys: entry.keysecondary ?? [], position: entry.position ?? 'after_char',
      insertionOrder: entry.order ?? 0,
    };
  }, [selectedWorld, allWorlds]);

  // 持久化用户创建的世界
  // 自建世界带有完整世界书，体积可观：配额耗尽时只跳过本次落盘，
  // 不能让同步异常冒泡掀翻整个界面（内存态仍然有效）。
  useEffect(() => {
    trySetItem(CREATED_WORLDS_KEY, JSON.stringify(createdWorlds));
  }, [createdWorlds]);

  // ─── 世界编辑器操作 ───
  const handleSaveWorld = (world: WorldDef) => {
    setCreatedWorlds(prev => {
      const idx = prev.findIndex(w => w.id === world.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = world; return next; }
      return [...prev, world];
    });
    setSelectedWorld(world.id);
    setWorldEditorOpen(false);
    setEditingWorld(null);
    setWorldEditorInitialStep(undefined);
  };

  const handleDeleteWorld = (worldId: string, referencedWorldIds: ReadonlySet<string> = new Set()): CustomWorldDeleteResult => {
    const result = deleteCustomWorldFromList(createdWorlds, worldId, new Set(WORLDS.map(world => world.id)), referencedWorldIds);
    if (!result.ok) return result;
    setCreatedWorlds(result.worlds);
    if (selectedWorld === worldId) setSelectedWorld('default');
    return result;
  };

  const handleCancelWorldEditor = () => {
    setWorldEditorOpen(false);
    setEditingWorld(null);
    setWorldEditorInitialStep(undefined);
  };

  const handleImportWorld = (world: WorldDef) => {
    setCreatedWorlds(prev => {
      const idx = prev.findIndex(w => w.id === world.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = world; return next; }
      return [...prev, world];
    });
    setSelectedWorld(world.id);
  };

  return {
    // 向导
    view, setView,
    step, setStep,
    selectedWorld, setSelectedWorld,
    // 世界书
    worldEntry,
    // 角色
    personalInfo, setPersonalInfo,
    resetForNewJourney, resumeCreationDraft,
    creationDraftOwner,
    hasCreationDraft: creationDraftOwner.hasDraft(),
    draftWarning: draft.warning,
    retryDraftSave: creationDraftOwner.retrySave,
    // 世界列表
    allWorlds, createdWorlds,
    // 编辑器
    worldEditorOpen, setWorldEditorOpen,
    editingWorld, setEditingWorld,
    worldEditorInitialStep, setWorldEditorInitialStep,
    handleSaveWorld,
    handleDeleteWorld,
    handleCancelWorldEditor,
    handleImportWorld,
  };
}
