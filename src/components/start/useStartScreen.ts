import { CreateJourney } from '../../context/createJourney';
import { useMemoryStore } from '../../memory/memoryStore';
import { STORAGE_KEYS } from '../../config/storageKeys';
import { useEffect, useRef, useState } from 'react';
import { LoadJourney } from '../../context/journeyNavigation';
import { useGame } from '../../context/GameContext';
import { useUISettings } from '../../context/UISettingsContext';
import { useDialog } from '../shared/Dialog';
import { useSaveStore,resetForNewGame } from '../../stores/saveStore';
import { useConfigStore } from '../../stores/configStore';
import { useWizard } from '../../hooks/useWizard';
import { useAiFill } from '../../hooks/useAiFill';
import { useCharacterHistory } from '../../hooks/useCharacterHistory';
import { loadSaveWithMigration,type GameSave } from '../../storage/db';
import { decodeSaveFile, encodeSaveFile, SAVE_FILE_EXTENSION } from '../../storage/saveFileCodec';
import { isQuotaExceededError } from '../../storage/safeStorage';
import { getDirectorDefinition } from '../../director/definitionStore';
import { runCustomModulesForWorld } from '../../custom-modules/engineBridge';
import { resolveProfessionBinding } from '../../data/professions';

import { v4 as uuid } from 'uuid';

export function useStartScreen() {
  const { navigate, state, dispatch, engine, markNewGameStarted } = useGame();
  const savesMeta = useSaveStore(s => s.savesMeta);
  const currentSaveId = useSaveStore(s => s.currentSaveId);
  const loadSaveFromStore = useSaveStore(s => s.loadSave);
  const deleteSaveFromStore = useSaveStore(s => s.deleteSave);
  const forceDeleteSaveFromStore = useSaveStore(s => s.forceDeleteSave);
  const renameSaveFromStore = useSaveStore(s => s.renameSave);
  const importSaveToStore = useSaveStore(s => s.importSave);
  const exportSaveFromStore = useSaveStore(s => s.exportSave);
  const apiConfig = useConfigStore(s => s.apiConfig);
  const { t, settings } = useUISettings();
  const { DialogUI, confirm, alert: showAlert, prompt } = useDialog();
  const loadPorts = useRef({ engine, navigate, dispatch, markNewGameStarted });
  loadPorts.current = { engine, navigate, dispatch, markNewGameStarted };
  const loadTask = useRef<LoadJourney<GameSave> | null>(null);
  if (!loadTask.current) loadTask.current = new LoadJourney({
    read: loadSaveFromStore,
    restore: save => loadPorts.current.engine.loadSave(save),
    activate: save => {
      loadPorts.current.markNewGameStarted();
      useSaveStore.getState().activateSave(save);
      loadPorts.current.dispatch({ type: 'LOAD_SAVE', save });
      loadPorts.current.navigate('game');
    },
  });
  useEffect(() => () => loadTask.current?.cancel(), []);
  const locale = settings.language === 'en' ? 'en-US' : 'zh-CN';

  // ─── 向导 ───
  const wizard = useWizard({
    initialWorld: state.selectedWorld,
  });

  // ─── AI 补全 ───
  const aiFill = useAiFill({
    draftOwner: wizard.creationDraftOwner,
    apiConfig,
    selectedWorld: wizard.selectedWorld,
    allWorlds: wizard.allWorlds,
    worldEntry: wizard.worldEntry,
    navigate, showAlert,
  });

  // ─── 人物经历 ───
  const charHistory = useCharacterHistory({
    draftOwner: wizard.creationDraftOwner,
    apiConfig,
    selectedWorld: wizard.selectedWorld,
    allWorlds: wizard.allWorlds,
    worldEntry: wizard.worldEntry,
    navigate, showAlert,
  });

  const [isCreatingJourney, setIsCreatingJourney] = useState(false);
  const creationController = useRef<AbortController | null>(null);
  const creationPorts = useRef({ engine, dispatch, markNewGameStarted, prompt, showAlert, completeDraft: charHistory.clearCompletedDraft });
  creationPorts.current = { engine, dispatch, markNewGameStarted, prompt, showAlert, completeDraft: charHistory.clearCompletedDraft };
  const creation = useRef<CreateJourney | null>(null);
  if (!creation.current) creation.current = new CreateJourney({
    chooseName: async defaultName => {
      let name = defaultName;
      while (true) {
        const answer = await creationPorts.current.prompt('请为这次冒险取一个存档名称：', { title: '存档命名', defaultValue: name, placeholder: '输入存档名称', confirmText: '开始冒险' });
        if (answer === null) return null;
        name = answer.trim() || defaultName;
        if (!useSaveStore.getState().savesMeta.some(save => save.name === name)) return name;
        await creationPorts.current.showAlert('存档名称已存在，请换个名字。', { title: '名称重复', danger: true });
      }
    },
    getDefinition: getDirectorDefinition,
    resolveProfession: config => resolveProfessionBinding(config as Parameters<typeof resolveProfessionBinding>[0]),
    runModules: async (manager, worldId, signal) => {
      const draft = structuredClone(manager.getState());
      const result = await runCustomModulesForWorld(draft, worldId, 'onGameStart', { round: 0 });
      signal?.throwIfAborted(); manager.setState(draft); return result;
    },
    persist: save => useSaveStore.getState().createSave(save),
    activate: save => {
      creationPorts.current.engine.loadSave(save);
      resetForNewGame(); creationPorts.current.markNewGameStarted();
      const warning = useSaveStore.getState().activateSave(save);
      creationPorts.current.dispatch({ type: 'LOAD_SAVE', save });
      if (warning) void creationPorts.current.showAlert(warning, { title: '旅程已保存' });
    },
  });
  const cancelJourneyCreation = () => {
    creationController.current?.abort(); creationController.current = null; setIsCreatingJourney(false);
  };
  useEffect(() => () => { aiFill.cleanup(); charHistory.cleanup(); cancelJourneyCreation(); }, [wizard.view, wizard.step]);
  const handleStartGame = async () => {
    if (creationController.current) return;
    aiFill.cleanup(); charHistory.cleanup();
    const controller = new AbortController(); creationController.current = controller; setIsCreatingJourney(true);
    try {
      let variablePreset: string | null = null;
      try { variablePreset = localStorage.getItem(STORAGE_KEYS.VARIABLE_API_PRESET); } catch { /* optional */ }
      const result = await creation.current!.start({ worldId: wizard.selectedWorld, world: wizard.allWorlds.find(world => world.id === wizard.selectedWorld),
        profile: wizard.personalInfo, characterHistory: charHistory.buildFullCharacterHistory(), memoryConfig: useMemoryStore.getState().config,
        variableConfig: variablePreset ? { apiPresetId: variablePreset } : undefined,
      }, controller.signal);
      if (result.status === 'created' && result.activated) {
        if (result.warnings.length) await showAlert(result.warnings.join('\n'), { title: '旅程已创建 · 扩展提示' });
        if (!controller.signal.aborted) {
          // Navigate before completing the document: clearing it changes the wizard
          // step, whose cleanup cancels work that is still preparing a journey.
          navigate(apiConfig ? 'game' : 'settings');
          creationPorts.current.completeDraft();
        }
      }
    } catch (error) {
      if (!controller.signal.aborted) await showAlert('无法启程：' + (error instanceof Error ? error.message : String(error)) + '\n\n创建资料仍保留，可修改后重试。', { title: '无法创建旅程', danger: true });
    } finally {
      if (creationController.current === controller) { creationController.current = null; setIsCreatingJourney(false); }
    }
  };

  // ─── 存档操作 ───
  const handleLoadSave = async (saveId: string) => {
    try { await loadTask.current!.run(saveId); }
    catch (error) { await showAlert(error instanceof Error ? error.message : String(error), { title: '未能载入旅程', danger: true }); }
  };

  const handleDeleteSave = async (id: string) => {
    if (!await confirm('确定要删除这个存档吗？此操作不可撤销。', { danger: true, confirmText: '删除' })) return;
    const isCurrentSave = currentSaveId === id;
    await deleteSaveFromStore(id);
    // 如果删除的是当前存档，清理引擎和游戏状态
    if (isCurrentSave) {
      dispatch({ type: 'CLEAR_SAVE_DATA' });
      engine.reset();
    }
  };

  const handleForceDeleteSave = async (id: string) => {
    if (!await confirm('强制删除会直接清除存档数据（不读取内容），用于存档损坏无法正常删除的情况。确定继续？', { danger: true, confirmText: '强制删除' })) return;
    const isCurrentSave = currentSaveId === id;
    await forceDeleteSaveFromStore(id);
    if (isCurrentSave) {
      dispatch({ type: 'CLEAR_SAVE_DATA' });
      engine.reset();
    }
  };

  const handleRenameSave = async (id: string, newName: string) => {
    await renameSaveFromStore(id, newName);
  };

  const handleDeleteWorld = async (worldId: string) => {
    if (!wizard.createdWorlds.some(world => world.id === worldId)) {
      await showAlert('内置世界不能删除；只有自建世界定义可以删除。', { title: '无法删除世界', danger: true });
      return { ok: false as const, reason: 'not-found' as const };
    }
    if (!await confirm('删除世界定义后将无法再进入该世界；关联存档不会被删除。确定继续？', { danger: true, confirmText: '删除世界定义' })) {
      return { ok: false as const, reason: 'cancelled' as const };
    }

    const referencedSaveIds: string[] = [];
    for (const meta of savesMeta) {
      const save = await loadSaveWithMigration(meta.id);
      if (save?.worldId === worldId) referencedSaveIds.push(meta.id);
    }
    if (referencedSaveIds.length > 0) {
      await showAlert('无法删除世界定义：已有存档引用它。请先处理关联存档；存档不会被自动删除。', { title: '存在关联存档', danger: true });
      return { ok: false as const, reason: 'referenced' as const };
    }
    return wizard.handleDeleteWorld(worldId);
  };

  const handleImportSave = async (file: File) => {
    try {
      const data = await decodeSaveFile(file);
      const meta = await importSaveToStore(data);
      await showAlert(`已导入「${meta.name}」，共 ${meta.messageCount ?? 0} 条消息。请在存档列表中选择它并继续旅程。`, { title: '导入成功' });
    } catch (err: unknown) {
      const errMsg = isQuotaExceededError(err)
        ? '浏览器存储空间不足，存档未能导入。请释放设备空间或导出并清理不需要的旧存档，再重试。'
        : err instanceof Error ? err.message : String(err);
      console.error('[导入] 失败:', err);
      await showAlert(`导入失败: ${errMsg}`, { title: '导入失败', danger: true });
    }
  };

  const handleExportSave = async (saveId: string) => {
    try {
      const blob = await encodeSaveFile(await exportSaveFromStore(saveId));
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `world-wanderer-save-${Date.now()}${SAVE_FILE_EXTENSION}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[导出] 失败:', err);
      await showAlert(`导出失败: ${errMsg}`, { title: '导出失败', danger: true });
    }
  };

  return {
    // context
    navigate, state, t, settings, locale, engine, dispatch,
    // config
    apiConfig,
    // dialog
    DialogUI,
    // wizard
    view: wizard.view, setView: wizard.setView,
    resetForNewJourney: wizard.resetForNewJourney,
    hasCreationDraft: wizard.hasCreationDraft, resumeCreationDraft: wizard.resumeCreationDraft,
    draftWarning: wizard.draftWarning, retryDraftSave: wizard.retryDraftSave,
    confirmReplaceCreationDraft: () => confirm('重新创建将替换尚未完成的角色资料。确定重新开始吗？', { title: '已有创建草稿', confirmText: '重新创建' }),
    step: wizard.step, setStep: wizard.setStep,
    selectedWorld: wizard.selectedWorld, setSelectedWorld: wizard.setSelectedWorld,
    worldEntry: wizard.worldEntry,
    personalInfo: wizard.personalInfo, setPersonalInfo: wizard.setPersonalInfo,
    allWorlds: wizard.allWorlds, createdWorlds: wizard.createdWorlds,
    worldEditorOpen: wizard.worldEditorOpen, setWorldEditorOpen: wizard.setWorldEditorOpen,
    editingWorld: wizard.editingWorld, setEditingWorld: wizard.setEditingWorld,
    worldEditorInitialStep: wizard.worldEditorInitialStep, setWorldEditorInitialStep: wizard.setWorldEditorInitialStep,
    handleSaveWorld: wizard.handleSaveWorld,
    handleDeleteWorld,
    handleCancelWorldEditor: wizard.handleCancelWorldEditor,
    handleImportWorld: wizard.handleImportWorld,
    // ai fill
    isFilling: aiFill.isFilling, fillElapsed: aiFill.fillElapsed, handleAiFill: aiFill.handleAiFill, cancelFill: aiFill.cancelFill,
    // character history
    segments: charHistory.segments, setSegments: charHistory.setSegments,
    isGenerating: charHistory.isGenerating, regeneratingId: charHistory.regeneratingId,
    includeAgeStages: charHistory.includeAgeStages, setIncludeAgeStages: charHistory.setIncludeAgeStages,
    handleGenerateAll: charHistory.handleGenerateAll,
    handleRegenerateSegment: charHistory.handleRegenerateSegment,
    handleLoadPreset: charHistory.loadPreset,
    isCreatingJourney, cancelJourneyCreation,
    cancelHistoryGeneration: charHistory.cancelGeneration,
    // handlers
    handleStartGame,
    handleLoadSave, handleDeleteSave, handleForceDeleteSave,
    handleRenameSave, handleImportSave, handleExportSave,
    // saves
    allSaves: savesMeta, currentSaveId,
  };
}
