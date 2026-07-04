import { useEffect } from 'react';
import { useGame } from '../../context/GameContext';
import { useUISettings } from '../../context/UISettingsContext';
import { useDialog } from '../shared/Dialog';
import { useSaveStore, resetForNewGame } from '../../stores/saveStore';
import { useConfigStore } from '../../stores/configStore';
import { useWizard } from '../../hooks/useWizard';
import { useAiFill } from '../../hooks/useAiFill';
import { useCharacterHistory, clearSegmentsCache } from '../../hooks/useCharacterHistory';
import type { GameSave, PlayerProfile } from '../../storage/db';
import type { ChatMessage } from '../../engine/types';
import type { GameState } from '../../schema/variables';
import { createDefaultGameState } from '../../schema/variables';
import { resetSimulationEngine } from '../../simulation/SimulationApi';

import { v4 as uuid } from 'uuid';

export function useStartScreen() {
  const { navigate, state, dispatch, engine, markNewGameStarted } = useGame();
  const savesMeta = useSaveStore(s => s.savesMeta);
  const currentSaveId = useSaveStore(s => s.currentSaveId);
  const createNewGame = useSaveStore(s => s.createNewGame);
  const loadSaveFromStore = useSaveStore(s => s.loadSave);
  const deleteSaveFromStore = useSaveStore(s => s.deleteSave);
  const forceDeleteSaveFromStore = useSaveStore(s => s.forceDeleteSave);
  const renameSaveFromStore = useSaveStore(s => s.renameSave);
  const importSaveToStore = useSaveStore(s => s.importSave);
  const exportSaveFromStore = useSaveStore(s => s.exportSave);
  const apiConfig = useConfigStore(s => s.apiConfig);
  const { t, settings } = useUISettings();
  const { DialogUI, confirm, alert: showAlert, prompt } = useDialog();
  const locale = settings.language === 'en' ? 'en-US' : 'zh-CN';

  // ─── 向导 ───
  const wizard = useWizard({
    initialWorld: state.selectedWorld,
    initialPersonalInfo: state.personalInfo,
  });

  // ─── AI 补全 ───
  const aiFill = useAiFill({
    apiConfig,
    personalInfo: wizard.personalInfo,
    selectedWorld: wizard.selectedWorld,
    allWorlds: wizard.allWorlds,
    worldEntry: wizard.worldEntry,
    setPersonalInfo: wizard.setPersonalInfo,
    navigate, showAlert,
  });

  // ─── 人物经历 ───
  const charHistory = useCharacterHistory({
    apiConfig,
    personalInfo: wizard.personalInfo,
    selectedWorld: wizard.selectedWorld,
    allWorlds: wizard.allWorlds,
    worldEntry: wizard.worldEntry,
    initialCharacterHistory: state.characterHistory,
    perspective: wizard.personalInfo.perspective,
    navigate, showAlert,
  });

  // 清理（组件卸载时保存 segments 到缓存）
  useEffect(() => () => { aiFill.cleanup(); charHistory.cleanup(); }, []);

  // ─── 构建初始 GameState ───
  const buildInitialState = (): GameState => {
    const gs = createDefaultGameState();
    const pi = wizard.personalInfo;

    // 初始化模块数据 → 写入 GameState 对应路径
    // 数值属性 → 玩家.生存状态（血量/体力值/dim1-6/special）
    // 成长体系 → 玩家.当前段位索引/当前经验值
    // 其他模块（生存资源/经营资产/骰子/天赋）数据只存世界定义，不写入 GameState
    const selectedWorldDef = wizard.allWorlds.find(w => w.id === wizard.selectedWorld);
    if (selectedWorldDef?.modules?.length) {
      for (const mod of selectedWorldDef.modules) {
        if (!mod.enabled) continue;

        // 从 initialState 初始化（新格式，优先）
        if (mod.initialState && Object.keys(mod.initialState).length > 0) {
          if (mod.moduleId === 'stat') {
            const initState = mod.initialState as any;
            const cfg = (mod.moduleConfig || {}) as any;
            if (initState.attrA != null) gs.玩家.生存状态.血量 = initState.attrA;
            if (initState.attrB != null) gs.玩家.生存状态.体力值 = initState.attrB;
            for (let i = 1; i <= 6; i++) {
              const val = initState[`dim${i}Value`];
              if (val != null) gs.玩家.生存状态[`dim${i}`] = val;
            }
            if (Array.isArray(cfg.special)) {
              for (const sp of cfg.special) {
                const val = initState.special?.[sp.id];
                if (val != null) gs.玩家.生存状态[sp.id] = val;
              }
            }
          }
          if (mod.moduleId === 'progression') {
            const initState = mod.initialState as any;
            gs.玩家.当前段位索引 = initState.currentTierIndex ?? 0;
            gs.玩家.当前经验值 = initState.currentXP ?? 0;
          }
        }

        // 从 moduleConfig 初始化（无 initialState 时的兜底，兼容纯配置的 JSON 世界文件）
        if (!mod.initialState && mod.moduleConfig) {
          if (mod.moduleId === 'stat') {
            const cfg = mod.moduleConfig as any;
            if (cfg.attrA?.current != null) gs.玩家.生存状态.血量 = cfg.attrA.current;
            if (cfg.attrB?.current != null) gs.玩家.生存状态.体力值 = cfg.attrB.current;
            for (let i = 1; i <= 6; i++) {
              const dimCfg = cfg[`dim${i}`];
              if (dimCfg?.value != null) gs.玩家.生存状态[`dim${i}`] = dimCfg.value;
            }
            if (Array.isArray(cfg.special)) {
              for (const sp of cfg.special) {
                if (sp.id && sp.value != null) gs.玩家.生存状态[sp.id] = sp.value;
              }
            }
          }
          if (mod.moduleId === 'progression') {
            const cfg = mod.moduleConfig as any;
            gs.玩家.当前段位索引 = cfg.currentTierIndex ?? 0;
            gs.玩家.当前经验值 = cfg.currentXP ?? 0;
          }
        }
      }
    }
    gs.玩家.姓名 = pi.name;
    gs.玩家.性别 = pi.gender;
    gs.玩家.年龄 = pi.age;
    gs.玩家.身份信息.背景信息 = pi.background;
    gs.玩家.性格 = pi.personality || '';
    gs.玩家.外貌 = pi.appearance || '';
    gs.玩家.身份信息.职业 = pi.career || '';
    if (pi.initialSkills) gs.玩家.技能系统 = { ...gs.玩家.技能系统, ...pi.initialSkills };
    if (pi.initialItems) {
      for (const [k, v] of Object.entries(pi.initialItems)) {
        gs.玩家.物品栏[k] = { ...v };
      }
    }
    for (const npc of pi.customNpcs) {
      const npcId = `NPC_${npc.name}`;

      // 构建 NPC 生存状态（从 survivalStats 获取，如果没有则使用默认值）
      const npcSurvivalState: { 血量: number; 体力值: number;[key: string]: number } = { 血量: 100, 体力值: 100 };
      if (npc.survivalStats && typeof npc.survivalStats === 'object') {
        if (npc.survivalStats.血量 != null) npcSurvivalState.血量 = Number(npc.survivalStats.血量);
        if (npc.survivalStats.体力值 != null) npcSurvivalState.体力值 = Number(npc.survivalStats.体力值);
        for (let i = 1; i <= 6; i++) {
          const key = `dim${i}`;
          if (npc.survivalStats[key] != null) npcSurvivalState[key] = Number(npc.survivalStats[key]);
        }
      }

      gs.人物档案[npcId] = {
        姓名: npc.name, 种族: npc.race || '人类', 性别: npc.gender || '', 年龄: npc.age || '',
        背景: npc.background || '',
        生存状态: npcSurvivalState,
        社会身份: {
          职业: npc.occupation || '',
          社会地位: npc.socialStatus || '',
        },
        关系数据: { 好感度: 0, 关系类型: npc.relationshipType || '同伴' },
        个人信息: {
          外貌: npc.appearance || '',
          表性格: npc.personality || '',
          里性格: npc.hiddenPersonality || '',
          当前想法: npc.currentThought || '',
          当前穿着: npc.currentOutfit || '',
          当前位置: npc.currentLocation || '', 当前状态: npc.currentState || '',
          备注: '',
        },
        重要NPC: true, _关注: true,
        $time: Date.now(), 人物分类: '在场',
        当前行动: npc.currentAction || '',
        短期目标: npc.shortTermGoal || '',
        长期目标: npc.longTermGoal || '',
        人物事迹: npc.chronicles || [],
        技能列表: npc.skillsList || {},
        物品列表: npc.itemsList || {},
      };
    }
    return gs;
  };

  // ─── 开始游戏 ───
  const handleStartGame = async () => {
    // 重置存档模块级变量，防止旧存档数据污染新存档
    resetForNewGame();
    // 重置世界推演引擎，防止旧存档的模拟数据串到新存档
    resetSimulationEngine();
    markNewGameStarted();
    // 开始游戏时清除缓存，下次进向导从头开始
    clearSegmentsCache();
    const characterHistory = charHistory.buildFullCharacterHistory();
    // 获取世界名（中文）
    const world = wizard.allWorlds.find((w: any) => w.id === wizard.selectedWorld);
    const worldName = world?.name || '默认世界';
    const characterName = wizard.personalInfo.name || '未命名';
    const defaultSaveName = `${characterName} - ${worldName}`;

    // ─── 取名环节 ───
    let saveName: string | null = defaultSaveName;
    while (true) {
      saveName = await prompt('请为这次冒险取一个存档名称：', {
        title: '存档命名',
        defaultValue: saveName || defaultSaveName,
        placeholder: '输入存档名称',
        confirmText: '开始冒险',
      });
      if (saveName === null) return; // 用户取消
      saveName = saveName.trim() || defaultSaveName;
      if (savesMeta.some(s => s.name === saveName)) {
        await showAlert(`存档名「${saveName}」已存在，请换个名字。`, { title: '名称重复', danger: true });
        continue;
      }
      break;
    }

    dispatch({ type: 'SET_WORLD', worldId: wizard.selectedWorld });
    dispatch({ type: 'SET_PERSONAL_INFO', info: wizard.personalInfo });
    dispatch({ type: 'SET_CHARACTER_HISTORY', history: characterHistory });

    const currentWorldDef = wizard.allWorlds.find(w => w.id === wizard.selectedWorld);
    engine.reset(currentWorldDef);
    engine.setPlayerProfile(wizard.personalInfo);

    // 应用 AI 生成的模块初始化数据（覆盖世界定义的默认值）
    if (wizard.personalInfo.moduleInitData && Object.keys(wizard.personalInfo.moduleInitData).length > 0) {
      engine.applyModuleInitData(wizard.personalInfo.moduleInitData);
    }

    if (wizard.personalInfo.customNpcs.length > 0) {
      engine.setInitialNPCs(wizard.personalInfo.customNpcs);
    }

    // 构建初始消息列表（直接构造，不依赖 React 批量更新）
    const initialMessages: ChatMessage[] = [];
    if (characterHistory.trim()) {
      // 附加快照到初始消息，确保第一轮重新发送时能回滚到初始状态
      const initialSnapshot = engine.variableManager.createSnapshot();
      const historyMsg: ChatMessage = {
        id: uuid(), role: 'assistant', rawText: characterHistory, round: 0, timestamp: Date.now(),
        snapshot: initialSnapshot, snapshotTime: Date.now(),
      };
      initialMessages.push(historyMsg);
      engine.addMessage(historyMsg);
    }

    const saveId = await createNewGame(saveName);

    const save: GameSave = {
      id: saveId, name: saveName, timestamp: Date.now(),
      messages: initialMessages, gameState: engine.variableManager.getState(),
      worldId: wizard.selectedWorld, personalInfo: wizard.personalInfo, characterHistory,
    };
    // 使用 performSave 保存存档（会同时更新 savesMeta 列表）
    const performSave = useSaveStore.getState().performSave;
    await performSave(save);
    navigate(apiConfig ? 'game' : 'settings');
  };

  // ─── 存档操作 ───
  const handleLoadSave = async (save: GameSave) => {
    const loaded = await loadSaveFromStore(save.id);
    if (loaded) {
      dispatch({ type: 'LOAD_SAVE', save: loaded });
      engine.loadSave(loaded);
      navigate('game');
    }
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

  const handleImportSave = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      await importSaveToStore(data);
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error('[导入] 失败:', err);
      await showAlert(`导入失败: ${errMsg}`, { title: '导入失败', danger: true });
    }
  };

  const handleExportSave = async (saveId: string) => {
    try {
      const blob = await exportSaveFromStore(saveId);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `world-wanderer-save-${Date.now()}.json`;
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
    step: wizard.step, setStep: wizard.setStep,
    selectedWorld: wizard.selectedWorld, setSelectedWorld: wizard.setSelectedWorld,
    worldEntry: wizard.worldEntry,
    personalInfo: wizard.personalInfo, setPersonalInfo: wizard.setPersonalInfo,
    allWorlds: wizard.allWorlds, createdWorlds: wizard.createdWorlds,
    worldEditorOpen: wizard.worldEditorOpen, setWorldEditorOpen: wizard.setWorldEditorOpen,
    editingWorld: wizard.editingWorld, setEditingWorld: wizard.setEditingWorld,
    handleSaveWorld: wizard.handleSaveWorld,
    handleDeleteWorld: wizard.handleDeleteWorld,
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
    buildInitialState,
    // handlers
    handleStartGame,
    handleLoadSave, handleDeleteSave, handleForceDeleteSave,
    handleRenameSave, handleImportSave, handleExportSave,
    // saves
    allSaves: savesMeta, currentSaveId,
  };
}
