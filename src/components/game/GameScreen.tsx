import { useState,useEffect,useCallback,useMemo,useRef } from 'react';
import { useGame } from '../../context/GameContext';
import { useUISettings } from '../../context/UISettingsContext';
import { useConfigStore } from '../../stores/configStore';
import { useMediaQuery } from '../../hooks/useIsMobile';
import ChatPanel from './chat/ChatPanel';
import ProfilePanel from './panels/ProfilePanel';
import CharacterGrid from './panels/CharacterGrid';
import { mergeCurrentNpcChronicles, updateCurrentNpcChronicles, type ChronicleMergeOptions } from './panels/characterGrid/chronicleActions';
import { requestCompletion } from '../../api/client';
import NotebookPanel from './panels/NotebookPanel';
import TaskPanel from './panels/TaskPanel';
import ProfessionTreePanel from './panels/ProfessionTreePanel';
import VariableSnapshotPanel from './panels/VariableSnapshotPanel';
import WorldBookPanel from './panels/WorldBookPanel';
import RightPanel from './panels/RightPanel';
import EconomyLedger from './panels/EconomyLedger';
import { buildEconomyViewModel } from '../../domains/economy/viewModel';
import { useEconomyActions } from './gameScreen/hooks/useEconomyActions';
import ResourcesLedger from './panels/ResourcesLedger';
import { buildResourcesViewModel } from '../../domains/resources/viewModel';
import CombatWireframe from './CombatWireframe';
import CombatEncounterDecisionCard,{ type CombatEncounterDecision } from './CombatEncounterDecisionCard';
import AbilityProposalCard from './AbilityProposalCard';
import { MemorySettingsOverlay } from '../settings/memory/MemorySettingsOverlay';
import WorldDynamicsPanel from './panels/WorldDynamicsPanel';
import { findWorldDef } from '../../data/worldLoader';
import { resolveWorldArtwork } from '../../data/worldArtwork';
import '../../ui/screens/game.css';
import '../../ui/screens/game-story.css';
import '../../ui/screens/game-dossier.css';
import '../../ui/screens/game-panels.css';
import { eventBus,EVENTS } from '../../engine/eventBus';
import type { WorldSystemData,DiceRoll,BusinessModuleSchema,ProfessionModuleSchema,ProgressionConfig,StatModuleSchema,WorldDynamicsConfig } from '../../modules/schema';
import type { DiceRollRequest } from '../../gameplay/modules/dice';
import { resolveProfessionBonuses,synchronizeProfessionAbilities } from '../../gameplay/profession';
import { resolveProfessionBinding } from '../../data/professions';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import { resolveCombatRuleset } from '../../gameplay/combatRulesets';
import { createDefaultDiceModule } from '../../modules/defaults';
import { useSaveStore, captureCurrentSave } from '../../stores/saveStore';
import { LeaveJourney, type JourneyDestination } from '../../context/journeyNavigation';
import { useDialog } from '../shared/Dialog';
import { encodeSaveFile } from '../../storage/saveFileCodec';
import { exportSaveCapture } from '../../storage/db';
import { loadEventCatalog } from '../../events/catalog';
import { buildEventsPanelView } from '../../events/viewModel';
import { setEventPacing } from '../../events/playerActions';
import CardOverlay from '../event/CardOverlay';
import EventConfigPanel from '../event/EventConfigPanel';
import type { OverlayPanel } from './gameScreen/types';
import { navButtons,buildMobileNavItems } from './gameScreen/navConfig';
import DesktopLayout from './gameScreen/DesktopLayout';
import MobileLayout from './gameScreen/MobileLayout';
import { useSimulation } from './gameScreen/hooks/useSimulation';
import { useResourceActions } from './gameScreen/hooks/useResourceActions';
import JourneyDossierContent from './shared/JourneyDossierContent';
import { DOSSIER_META,normalizeDossierPanel } from './shared/journeyDossierMeta';
import { runCustomModulesForWorldAndCommit } from '../../custom-modules/engineBridge';
import { setCustomModuleActiveSave } from '../../custom-modules/saveApplication';
import type { CustomModuleChoiceEvent } from '../../custom-modules/context';
import { useMemoryStore } from '../../memory/memoryStore';
import { useStoredImageUrls } from '../../hooks/useStoredImageUrl';
import { imageDb } from '../../storage/imageDb';
import { getEngineState } from '../../simulation/SimulationApi';
import { normalizeCombatEncounterRequest,type CombatCommandInputV2,type CombatEncounterRequest } from '../../gameplay/protocols';
import { applyNarrativeDecision,createNarrativeDecisionRecord,type NarrativeDecisionRecord } from '../../gameplay/narrativeDecision';
import { resolveAbilityProposalOnGameState } from '../../gameplay/abilitySystem';
import { chooseAutomaticCommand,prepareCombatEncounterRequest,type CombatAutoStrategy,type CombatStatRanges } from '../../gameplay/combatV2';
import { CombatNarrationCoordinator,applyV3CombatCommand,buildLocalCombatContinuation,isCombatFeatureEnabled,isCombatInteractionPaused,preserveCombatOwnedState,requestFromNarrativeAction,retryV3Combat,startV3Combat } from '../../gameplay/combatRuntime';

const ABILITY_COMMANDS = {
  talent: 'unlockTalent', learn: 'learnSkill', use: 'useSkill', awaken: 'awaken', equip: 'equip', unequip: 'unequip', respec: 'respec',
} as const;

export default function GameScreen() {
  const { state, navigate, engine } = useGame();
  const { DialogUI: navigationDialog, confirm: confirmNavigation } = useDialog();
  const [isLeaving, setIsLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState<string | null>(null);
  const leaveDestination = useRef<JourneyDestination | null>(null);
  const leaveRequested = useRef(false);
  const leaveOwnerAlive = useRef(true);
  const navigationPorts = useRef({ engine, navigate, confirmNavigation, blocked: false });
  navigationPorts.current = { engine, navigate, confirmNavigation, blocked: false };
  const leaveTask = useRef<LeaveJourney | null>(null);
  if (!leaveTask.current) leaveTask.current = new LeaveJourney({
    busy: () => navigationPorts.current.engine.isGenerating,
    blocked: () => navigationPorts.current.blocked,
    identity: () => useSaveStore.getState().currentSaveId ?? '',
    version: () => { const { timestamp: _, ...capture } = captureCurrentSave(); return JSON.stringify(capture); },
    confirmStop: () => navigationPorts.current.confirmNavigation('停止生成后，已生成的正文会保留。保存成功后再离开。', { title: '停止并保存离开？', confirmText: '停止并保存', cancelText: '继续等待' }),
    stop: () => navigationPorts.current.engine.cancelAndWait(),
    flush: () => useSaveStore.getState().flushAutoSave(),
    navigate: target => navigationPorts.current.navigate(target),
  });
  useEffect(() => { leaveOwnerAlive.current = true; return () => { leaveOwnerAlive.current = false; leaveTask.current?.cancel(); }; }, []);
  const handleNavigate = useCallback((target: JourneyDestination) => {
    if (leaveRequested.current) return;
    if (target === 'settings') { navigationPorts.current.navigate(target); return; }
    leaveRequested.current = true; leaveDestination.current = target;
    setIsLeaving(true); setLeaveError(null);
    void leaveTask.current!.run(target).catch(error => {
      if (leaveOwnerAlive.current) setLeaveError(`未能保存离开：${error instanceof Error ? error.message : String(error)}`);
    }).finally(() => { leaveRequested.current = false; if (leaveOwnerAlive.current) setIsLeaving(false); });
  }, []);
  const handleNavigationBackup = async () => {
    try {
      const save = captureCurrentSave();
      const blob = await encodeSaveFile(await exportSaveCapture(save));
      const url = URL.createObjectURL(blob), anchor = document.createElement('a');
      anchor.href = url; anchor.download = `journey-backup-${Date.now()}.zip`; anchor.click(); URL.revokeObjectURL(url);
    } catch (error) { setLeaveError(`备份导出未完成：${error instanceof Error ? error.message : String(error)}`); }
  };
  const saveFailure = useSaveStore(s => s.saveFailure?.saveId === s.currentSaveId ? s.saveFailure : null);
  const customModuleSaveId = useSaveStore(s => s.currentSaveId);
  const customModuleScope = useRef({ mounted: true, worldId: state.selectedWorld, saveId: customModuleSaveId, manager: engine.variableManager });
  customModuleScope.current = { mounted: true, worldId: state.selectedWorld, saveId: customModuleSaveId, manager: engine.variableManager };
  useEffect(() => {
    const release = customModuleSaveId ? setCustomModuleActiveSave(customModuleSaveId) : () => undefined;
    return () => { customModuleScope.current.mounted = false; release(); };
  }, [customModuleSaveId]);
  const { t } = useUISettings();
  // Keep tablet/near-square viewports on the compact desktop composition; reserve
  // the mobile shell for genuinely narrow portrait widths.
  const isMobile = useMediaQuery('(max-width: 640px)');

  // ── State ──
  const [overlay, setOverlay] = useState<OverlayPanel>(null);
  const [businessOverlayOpen, setBusinessOverlayOpen] = useState(false);
  const [survivalOverlayOpen, setSurvivalOverlayOpen] = useState(false);
  const [rightCollapsed, setRightCollapsed] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showLeftOverlay, setShowLeftOverlay] = useState(false);
  const [showRightOverlay, setShowRightOverlay] = useState(false);
  const [mobileActivePanel, setMobileActivePanel] = useState<OverlayPanel>(null);
  const [stateVersion, setStateVersion] = useState(0);
  const [notification, setNotification] = useState<string | null>(null);
  const [combatSaving, setCombatSaving] = useState(false);
  const [combatError, setCombatError] = useState<string | null>(null);
  const [combatAutoStrategy, setCombatAutoStrategy] = useState<import('../../gameplay/combatV2').CombatAutoStrategy | null>(null);
  const [abilitySaving, setAbilitySaving] = useState(false);
  const [abilityError, setAbilityError] = useState<string | null>(null);
  const [chatDraft, setChatDraft] = useState<{ id: string; text: string } | null>(null);
  const combatNarrationRef = useRef(new CombatNarrationCoordinator());
  const combatNarrationInFlightRef = useRef(false);
  const combatNarrationGenerationRef = useRef(0);
  const combatAutomationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!notification) return;
    const timer = window.setTimeout(() => setNotification(null), 2800);
    return () => window.clearTimeout(timer);
  }, [notification]);
  const combatAutoStrategyRef = useRef<CombatAutoStrategy | null>(null);
  // ── Fullscreen ──
  const toggleFullscreen = useCallback(async () => {
    try {
      if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      else await document.exitFullscreen();
    } catch {}
  }, []);
  useEffect(() => {
    const h = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', h);
    return () => document.removeEventListener('fullscreenchange', h);
  }, []);
  // 窄视口自动折叠右侧面板
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 1100px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => { setRightCollapsed(e.matches); };
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Derived data ──
  const gameState = engine.variableManager.getState();
  const savedPortraits = useStoredImageUrls(Object.fromEntries(Object.entries(gameState.人物档案 ?? {})
    .map(([id, npc]) => [id, (npc as any).portraitBlobKey || `portrait-${id}`])));
  const apiConfig = useConfigStore(s => s.apiConfig);
  const worldDef = useMemo(() => {
    try { return findWorldDef(state.selectedWorld); } catch { return undefined; }
  }, [state.selectedWorld]);
  const worldArtwork = useMemo(() => worldDef ? resolveWorldArtwork(worldDef).src : undefined, [worldDef]);
  const combatPortraits = useMemo(() => {
    const result: Record<string, { src?: string; gender?: string }> = {
      player: { gender: gameState.玩家.性别, ...(state.personalInfo?.portrait?.source === 'custom' && state.personalInfo.portrait.customDataUrl ? { src: state.personalInfo.portrait.customDataUrl } : {}) },
    };
    for (const [id, npc] of Object.entries(gameState.人物档案 ?? {})) {
      result[id] = { gender: npc.性别, ...(savedPortraits[id] ? { src: savedPortraits[id] } : {}) };
    }
    return result;
  }, [gameState, savedPortraits, state.personalInfo?.portrait]);
  const hasBusinessModule = !!worldDef?.modules?.some(m => m.moduleId === 'business' && m.enabled);
  const hasProfessionModule = isProfessionModuleEnabled(worldDef);
  const combatV3Enabled = isCombatFeatureEnabled(gameState);
  const readOnly = engine.isReadOnly;
  const pendingAbilityProposals = Object.values(gameState.v3?.pendingAbilityProposals ?? {});
  const worldSystem = useMemo((): WorldSystemData => {
    if (!worldDef?.modules) return {};
    const keyMap: Record<string, string> = {
      stat: '数值属性', progression: '成长体系', survival: '生存资源',
      business: '经营资产', dice: '骰子检定', talent: '天赋体系', profession: '职业体系', combat: '战斗系统',
    };
    const result: WorldSystemData = {};
    for (const mod of worldDef.modules) {
      if (!mod.enabled) continue;
      if (mod.moduleId === 'profession' && !isProfessionModuleEnabled(worldDef)) continue;
      const key = keyMap[mod.moduleId];
      if (!key || (!(mod.moduleConfig) && mod.moduleId !== 'dice')) continue;
      const config = (mod.moduleConfig || createDefaultDiceModule()) as Record<string, any>;
      if (mod.moduleId === 'stat') {
        const live = gameState.玩家?.生存状态 ?? {};
        const statConfig: Record<string, any> = { ...config };
        if (config.attrA) statConfig.attrA = { ...config.attrA, current: live.血量 ?? config.attrA.current };
        if (config.attrB) statConfig.attrB = { ...config.attrB, current: live.体力值 ?? config.attrB.current };
        for (let i = 1; i <= 6; i++) {
          const id = `dim${i}`;
          if (config[id]) statConfig[id] = { ...config[id], value: live[id] ?? config[id].value };
        }
        if (Array.isArray(config.special)) {
          statConfig.special = config.special.map((item: any) => ({
            ...item,
            value: live[item.id] ?? item.value,
          }));
        }
        (result as any)[key] = statConfig;
      } else if (mod.moduleId === 'profession') {
        (result as any)[key] = resolveProfessionBinding(config);
      } else if (mod.moduleId === 'combat') {
        (result as any)[key] = resolveCombatRuleset(config);
      } else if (mod.moduleId === 'dice') {
        (result as any)[key] = { ...config, ...(gameState.dice ?? {}) };
      } else {
        (result as any)[key] = config;
      }
    }
    const professionConfig = result.职业体系 as ProfessionModuleSchema | undefined;
    if (result.骰子检定 && professionConfig) {
      result.骰子检定 = {
        ...result.骰子检定,
        runtimeBonuses: resolveProfessionBonuses(gameState, professionConfig).checks,
      };
    }
    return result;
  }, [worldDef, gameState, stateVersion]);
  const combatStatRanges = useMemo((): CombatStatRanges => {
    const stat = worldSystem.数值属性 as StatModuleSchema | undefined;
    const survival = gameState.玩家.生存状态;
    const upper = (configured: unknown, current: unknown, fallback: number) => Math.max(fallback, Number(configured) || 0, Number(current) || 0);
    return {
      attrA: [0, upper(stat?.attrA?.max, survival.血量上限 ?? survival.血量, 1)],
      attrB: [0, upper(stat?.attrB?.max, survival.体力上限 ?? survival.体力值, 1)],
      ...Object.fromEntries((['dim1', 'dim2', 'dim3', 'dim4', 'dim5', 'dim6'] as const).map(id => {
        const range = stat?.[id]?.range;
        return [id, range && Number.isFinite(range[0]) && Number.isFinite(range[1]) ? range : [0, upper(undefined, survival[id], 20)]];
      })),
    } as CombatStatRanges;
  }, [worldSystem.数值属性, gameState.玩家.生存状态]);
  const combatStatLabels = useMemo(() => {
    const stat = worldSystem.数值属性 as StatModuleSchema | undefined;
    return {
      health: stat?.attrA?.name?.trim() || '生命',
      resource: stat?.attrB?.name?.trim() || '能量',
    };
  }, [worldSystem.数值属性]);
  // ── Extracted hooks ──
  const bumpVersion = useCallback(() => setStateVersion(v => v + 1), []);
  const { isSimulating, handleManualTick } = useSimulation(engine, worldDef, apiConfig);

  const handleCustomModuleChoice = useCallback(async (event: CustomModuleChoiceEvent) => {
    if (engine.isReadOnly) return;
    const scope = { ...customModuleScope.current };
    const result = await runCustomModulesForWorldAndCommit(engine.variableManager.getState(), state.selectedWorld, 'onChoice', {
      event,
    }, {
      getCurrentState: () => scope.manager.getState(),
      isCurrent: () => customModuleScope.current.mounted && customModuleScope.current.manager === scope.manager && customModuleScope.current.worldId === scope.worldId && useSaveStore.getState().currentSaveId === scope.saveId,
      commit: (nextState) => engine.variableManager.setState(nextState),
      notify: () => { bumpVersion(); eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED); },
      autoSave: () => useSaveStore.getState().scheduleAutoSave(),
    });
    if (result.warnings.length > 0) console.warn('[CustomModules] onChoice warnings:', result.warnings);
  }, [engine, state.selectedWorld, bumpVersion]);

  const combatOptions = useCallback((request: CombatEncounterRequest) => {
    const saveId = useSaveStore.getState().currentSaveId ?? 'default';
    const memory = useMemoryStore.getState().toJSON();
    const moduleBundle = engine.variableManager.createModulePersistenceBundle(saveId);
    let hash = 17;
    for (const character of request.proposal.id) hash = (hash * 31 + character.charCodeAt(0)) % 2147483647;
    return {
      seed: Math.abs(((gameState.simulationRuntime?.tick ?? 0) * 131 + hash) % 2147483647),
      riskMode: gameState.v3?.featureFlags?.combatRiskMode ?? 'normal',
      messages: engine.messages,
      memoryRuntime: memory.memoryRuntime,
      vectorMemory: memory.vectorMemory,
      worldSimulationState: getEngineState(),
      moduleStates: moduleBundle.current,
      moduleCheckpoints: moduleBundle.checkpoints,
      statRanges: combatStatRanges,
      statLabels: combatStatLabels,
      now: Date.now(),
    };
  }, [engine, gameState, combatStatRanges, combatStatLabels]);

  const commitV3CombatState = useCallback((nextState: import('../../schema/variables').GameState, message?: string) => {
    if (engine.isReadOnly) return;
    engine.variableManager.setState(nextState);
    bumpVersion();
    setCombatError(null);
    if (message) setNotification(message);
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, bumpVersion]);

  const synchronizeCombatAbilities = useCallback((source: import('../../schema/variables').GameState) => {
    const professionConfig = worldSystem.职业体系 as ProfessionModuleSchema | undefined;
    return professionConfig ? synchronizeProfessionAbilities(source, professionConfig) : source;
  }, [worldSystem.职业体系]);

  const handleNarrativeDecisionApplied = useCallback(async (nextState: import('../../schema/variables').GameState, record?: NarrativeDecisionRecord) => {
    if (engine.isReadOnly) return;
    const previousState = engine.variableManager.getState();
    let committedState = nextState;
    if (record && (record.action.type === 'start_combat' || record.action.type === 'combat.encounter.requested') && isCombatFeatureEnabled(nextState)) {
      const request = record.action.type === 'combat.encounter.requested' ? record.action.request : record.action.request;
      if (request) {
        const decisionState = synchronizeCombatAbilities(structuredClone(nextState));
        if (decisionState.v3?.pendingEncounterRequest?.proposal.id === request.proposal.id) {
          delete decisionState.v3.pendingEncounterRequest;
        }
        const combat = requestFromNarrativeAction(decisionState, record.action, {}, combatOptions(request));
        if (combat.ok) committedState = combat.state;
        else setNotification(combat.errors.join('；'));
      }
    }
    engine.variableManager.setState(committedState);
    try {
      await useSaveStore.getState().flushAutoSave();
    } catch (error) {
      engine.variableManager.setState(previousState);
      bumpVersion();
      throw error;
    }
    bumpVersion();
    eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
    setNotification('选择已保存，将在下一次成功正文中承接');
  }, [engine, bumpVersion, combatOptions, synchronizeCombatAbilities]);

  const handleTypedCombatRequest = useCallback(async (payload: unknown) => {
    if (!combatV3Enabled || engine.isReadOnly) return;
    const raw = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined;
    const action = raw?.action as NarrativeDecisionRecord['action'] | undefined;
    const candidate = action?.type === 'start_combat'
        ? action.request
        : action?.type === 'combat.encounter.requested'
          ? action.request
          : payload;
    const request = normalizeCombatEncounterRequest(candidate);
    if (!request) return;

    const originalState = engine.variableManager.getState();
    const current = synchronizeCombatAbilities(originalState);
    const active = current.v3?.combatSession;
    if (active?.encounter.id === request.proposal.id) return;
    if (current.v3?.pendingEncounterRequest?.proposal.id === request.proposal.id) return;

    const validation = prepareCombatEncounterRequest(current, request, { statRanges: combatStatRanges });
    if (!validation.ok) {
      setCombatError(validation.errors.join('；'));
      return;
    }

    // 玩家已经在正文输入里明确选择攻击或迎战时，那句话本身就是决定。
    // 不再追加一张“是否迎战”卡让玩家重复确认，直接进入编队准备；
    // 敌方伏击、围攻等被动遭遇仍保留迎战/脱离/叙事处理三种选择。
    if (request.hostileAction?.subjectId === 'player') {
      const combat = requestFromNarrativeAction(
        current,
        { type: 'combat.encounter.requested', request },
        {},
        combatOptions(request),
      );
      if (!combat.ok) {
        setCombatError(combat.errors.join('；'));
        return;
      }
      setCombatSaving(true);
      setCombatError(null);
      engine.variableManager.setState(combat.state);
      bumpVersion();
      try {
        await useSaveStore.getState().flushAutoSave();
        setNotification('已进入战斗准备，请选择出战阵容');
      } catch (error) {
        engine.variableManager.setState(originalState);
        bumpVersion();
        setCombatError(error instanceof Error ? error.message : String(error));
      } finally {
        setCombatSaving(false);
      }
      return;
    }

    const nextState = structuredClone(current);
    nextState.v3 ??= {
      schemaVersion: 3,
      featureFlags: { professionsEnabled: false, combatEnabled: true, combatRiskMode: 'normal' },
    };
    nextState.v3.pendingEncounterRequest = request;
    engine.variableManager.setState(nextState);
    bumpVersion();
    setCombatError(null);
    try {
      await useSaveStore.getState().flushAutoSave();
    } catch (error) {
      engine.variableManager.setState(originalState);
      bumpVersion();
      setCombatError(error instanceof Error ? error.message : String(error));
    }
  }, [combatV3Enabled, engine, combatStatRanges, combatOptions, bumpVersion, synchronizeCombatAbilities]);

  const handleEncounterDecision = useCallback(async (decision: CombatEncounterDecision) => {
    if (!combatV3Enabled || engine.isReadOnly || combatSaving) return;
    const originalState = engine.variableManager.getState();
    const current = synchronizeCombatAbilities(originalState);
    const request = current.v3?.pendingEncounterRequest;
    if (!request) return;

    const saveId = useSaveStore.getState().currentSaveId ?? 'default';
    const labels: Record<CombatEncounterDecision, string> = {
      fight: '迎战',
      escape: '尝试脱离',
      narrative: '叙事处理',
    };
    const action: NarrativeDecisionRecord['action'] = decision === 'fight'
      ? { type: 'combat.encounter.requested', request }
      : decision === 'escape'
        ? { type: 'attempt_escape' }
        : { type: 'narrative', instruction: '不进入机械战斗，由正文承接并处理这次已经发生的冲突。' };
    const record = createNarrativeDecisionRecord({
      id: `${saveId}:v3-combat:${request.proposal.id}:${decision}`,
      saveId,
      eventPackId: 'v3-combat',
      cardId: request.proposal.id,
      blockId: 'encounter-decision',
      selectedIndex: decision === 'fight' ? 0 : decision === 'escape' ? 1 : 2,
      action,
      aiNote: `遭遇「${request.proposal.context}」中，玩家选择了「${labels[decision]}」。`,
    });

    const previous = structuredClone(originalState);
    const decisionState = structuredClone(current);
    if (decisionState.v3) delete decisionState.v3.pendingEncounterRequest;
    const applied = applyNarrativeDecision(decisionState, record);
    let committedState = applied.state;
    if (decision === 'fight') {
      const combat = requestFromNarrativeAction(applied.state, action, {}, combatOptions(request));
      if (!combat.ok) {
        setCombatError(combat.errors.join('；'));
        return;
      }
      committedState = combat.state;
    }

    setCombatSaving(true);
    setCombatError(null);
    engine.variableManager.setState(committedState);
    bumpVersion();
    try {
      await useSaveStore.getState().flushAutoSave();
    } catch (error) {
      engine.variableManager.setState(previous);
      bumpVersion();
      setCombatError(error instanceof Error ? error.message : String(error));
      setCombatSaving(false);
      return;
    }
    setCombatSaving(false);
    eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);

    if (decision === 'fight') {
      setNotification('选择已保存，请完成出战编队');
      return;
    }
    setNotification('选择已保存，正在承接正文');
    await engine.sendMessage('请承接刚刚确认的遭遇选择。', { displayUserMessage: false });
  }, [combatV3Enabled, engine, combatSaving, combatOptions, bumpVersion, synchronizeCombatAbilities]);

  const handleAbilityProposal = useCallback(async (proposalId: string, decision: 'accept' | 'reject') => {
    if (engine.isReadOnly || abilitySaving) return;
    const previous = engine.variableManager.getState();
    const resolved = resolveAbilityProposalOnGameState(previous, proposalId, decision);
    if (!resolved.resolved) return;
    setAbilitySaving(true);
    setAbilityError(null);
    engine.variableManager.setState(resolved.state);
    bumpVersion();
    try {
      await useSaveStore.getState().flushAutoSave();
      eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
      setNotification(decision === 'accept' && resolved.definition ? `已获得能力「${resolved.definition.name}」` : '已放弃能力提案');
    } catch (error) {
      engine.variableManager.setState(previous);
      bumpVersion();
      setAbilityError(error instanceof Error ? error.message : String(error));
    } finally {
      setAbilitySaving(false);
    }
  }, [engine, abilitySaving, bumpVersion]);

  useEffect(() => {
    const off = eventBus.on(EVENTS.COMBAT_ENCOUNTER_REQUESTED, handleTypedCombatRequest);
    return off;
  }, [handleTypedCombatRequest]);

  const handleCustomModuleButton = useCallback((moduleId: string, event: string) => {
    if (engine.isReadOnly) return;
    const scope = { ...customModuleScope.current };
    void runCustomModulesForWorldAndCommit(engine.variableManager.getState(), state.selectedWorld, 'onButton', {
      event: { type: 'button', moduleId, event },
    }, {
      getCurrentState: () => scope.manager.getState(),
      isCurrent: () => customModuleScope.current.mounted && customModuleScope.current.manager === scope.manager && customModuleScope.current.worldId === scope.worldId && useSaveStore.getState().currentSaveId === scope.saveId,
      commit: (nextState) => engine.variableManager.setState(nextState),
      notify: () => { bumpVersion(); eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED); },
      autoSave: () => useSaveStore.getState().scheduleAutoSave(),
    }).then((result) => {
      if (result.warnings.length > 0) console.warn('[CustomModules] onButton warnings:', result.warnings);
    }).catch((error) => console.warn('[CustomModules] onButton failed:', error));
  }, [engine, state.selectedWorld, bumpVersion]);

  // ── 事件目录：世界内置事件 + 本局启用的事件包（二级开关 sessionActivePacks 优先，否则用全局已启用列表） ──
  // 事件的触发、抽卡与结算都由玩法宿主里的事件导演完成；这里只负责把目录加载好。
  const sessionActivePacks = useSaveStore(s => s.sessionActivePacks);
  useEffect(() => {
    let cancelled = false;
    void loadEventCatalog(worldDef, sessionActivePacks !== undefined ? { activePackIds: sessionActivePacks } : {})
      .then(() => { if (!cancelled) bumpVersion(); })
      .catch(error => console.warn('[事件] 事件目录加载失败，仅使用世界内置事件', error));
    return () => { cancelled = true; };
  }, [worldDef?.id, sessionActivePacks]);
  const resourceActions = useResourceActions(engine, apiConfig, worldDef, setNotification, bumpVersion);
  const isGeneratingRecipe = resourceActions.isGeneratingRecipe;
  // ── Event effects ──
  useEffect(() => {
    const onUpdate = () => setStateVersion(v => v + 1);
    const onFail = () => { setNotification('变量提取失败，游戏状态可能未更新'); setTimeout(() => setNotification(null), 4000); };
    eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, onUpdate);
    eventBus.on(EVENTS.VARIABLE_EXTRACTION_FAILED, onFail);
    return () => { eventBus.off(EVENTS.VARIABLE_UPDATE_ENDED, onUpdate); eventBus.off(EVENTS.VARIABLE_EXTRACTION_FAILED, onFail); };
  }, []);
  // ── Callbacks ──
  // 骰子、属性点、突破都交给玩法宿主的对应模块结算，成功后一次性提交。
  const handleDiceRoll = useCallback((request: DiceRollRequest): DiceRoll | null => {
    if (engine.isReadOnly) return null;
    const result = engine.dispatch('dice.roll', {
      ...(request.requestId ? { requestId: request.requestId } : {}),
      ...(request.attributeId ? { attributeId: request.attributeId } : {}),
      attribute: request.attributeName,
      dc: request.dc,
      timestamp: request.timestamp,
      ...(request.advantageMode ? { advantageMode: request.advantageMode } : {}),
    }, '骰子检定');
    if (!result.ok) return null;
    bumpVersion();
    return result.outcome?.state.dice?.lastRoll ?? null;
  }, [engine, worldDef, bumpVersion]);
  const handleAllocateStat = useCallback((statId: string) => {
    const result = engine.dispatch('stats.allocate', { stat: statId, amount: 1 }, '分配属性点');
    if (!result.ok) { setNotification(result.feedback); return; }
    bumpVersion();
  }, [engine, worldDef, bumpVersion]);
  const handleBreakthrough = useCallback((targetTier: number) => {
    const result = engine.dispatch('progression.breakthrough', { targetTier }, '突破');
    setNotification(result.feedback);
    if (result.ok) bumpVersion();
  }, [engine, worldDef, bumpVersion]);
  // 天赋、技能与职业能力交给玩法宿主的能力模块（domains/abilities）结算，成功后一次性提交。
  const applyAbilityAction = useCallback((action: 'talent' | 'learn' | 'use' | 'awaken' | 'equip' | 'unequip' | 'respec', id = '', slotId = '') => {
    if (engine.isReadOnly) return;
    const command = ABILITY_COMMANDS[action];
    const result = engine.dispatch(`abilities.${command}`, { id, slotId });
    if (!result.ok) { setNotification(result.feedback); return; }
    bumpVersion();
  }, [engine, bumpVersion]);
  const applyProfessionAction = useCallback((action: 'unlock' | 'use', id: string) => {
    if (engine.isReadOnly) return;
    const result = engine.dispatch(action === 'unlock' ? 'abilities.unlockProfession' : 'abilities.useProfession', { id });
    if (!result.ok) { setNotification(result.feedback); return; }
    bumpVersion();
  }, [engine, bumpVersion]);
  const economyActions = useEconomyActions(engine, worldDef, setNotification, bumpVersion);


  const continueCombatNarration = useCallback(async () => {
    if (combatNarrationInFlightRef.current) return;
    const current = engine.variableManager.getState();
    if (!current.v3?.combatSession || current.v3.combatSession.lifecycle !== 'terminal') return;
    combatNarrationInFlightRef.current = true;
    const generation = ++combatNarrationGenerationRef.current;
    setCombatSaving(true);
    setCombatError(null);
    try {
      const outcome = await combatNarrationRef.current.continue(current, async (prompt, result, protectedState) => {
        let sendOutcome: { success: boolean; content?: string; error?: string } | undefined;
        await engine.sendMessage(prompt, {
          displayUserMessage: false,
          combatContinuation: { protectedState, fallbackText: buildLocalCombatContinuation(result) },
          onComplete: result => { sendOutcome = result; },
        });
        if (!sendOutcome?.success) throw new Error(sendOutcome?.error || '主模型未返回战斗承接正文');
        return sendOutcome.content;
      }, async pendingState => {
        if (generation !== combatNarrationGenerationRef.current) return;
        engine.variableManager.setState(pendingState);
        bumpVersion();
        await useSaveStore.getState().flushAutoSave();
      });
      if (generation !== combatNarrationGenerationRef.current) return;
      const narratedState = engine.variableManager.getState();
      engine.variableManager.setState(preserveCombatOwnedState(narratedState, outcome.state));
      bumpVersion();
      await useSaveStore.getState().flushAutoSave();
      setNotification(outcome.result.narration.status === 'succeeded' ? '战斗承接正文已完成' : '战斗承接正文等待重试');
    } catch (error) {
      if (generation === combatNarrationGenerationRef.current) setCombatError(error instanceof Error ? error.message : String(error));
    } finally {
      if (generation === combatNarrationGenerationRef.current) {
        combatNarrationInFlightRef.current = false;
        setCombatSaving(false);
      }
    }
  }, [engine, bumpVersion]);

  const handleV3Command = useCallback((input: CombatCommandInputV2) => {
    if (engine.isReadOnly) return;
    const result = applyV3CombatCommand(engine.variableManager.getState(), input);
    if (!result.session) {
      setCombatError(result.errors.join('；'));
      return;
    }
    commitV3CombatState(result.state, result.ok ? undefined : result.errors.join('；'));
    if (result.session.lifecycle === 'terminal') void continueCombatNarration();
  }, [engine, commitV3CombatState, continueCombatNarration]);

  const handleV3Start = useCallback((selectedIds: string[]) => {
    if (engine.isReadOnly) return;
    const result = startV3Combat(engine.variableManager.getState(), selectedIds);
    if (!result.ok) {
      setCombatError(result.errors.join('；'));
      return;
    }
    commitV3CombatState(result.state, '战斗开始');
  }, [engine, commitV3CombatState]);

  const handleLeaveV3Combat = useCallback(async () => {
    if (combatAutomationTimerRef.current) clearTimeout(combatAutomationTimerRef.current);
    combatAutomationTimerRef.current = null;
    handleNavigate('start');
  }, [handleNavigate]);

  const runCombatAutomationStep = useCallback(() => {
    combatAutomationTimerRef.current = null;
    if (engine.isReadOnly) return;
    const current = engine.variableManager.getState();
    const session = current.v3?.combatSession;
    const actor = session?.participants.find(unit => unit.id === session.activeUnitId);
    if (!session || session.lifecycle !== 'active' || !actor) return;
    const strategy: CombatAutoStrategy | null = actor.side === 'enemy' ? 'balanced' : combatAutoStrategyRef.current;
    if (!strategy) return;
    const command = chooseAutomaticCommand(session, actor.id, strategy);
    const result = applyV3CombatCommand(current, command);
    if (!result.session) {
      setCombatError(result.errors.join('；'));
      return;
    }
    let applied = result;
    if (!result.ok) {
      applied = applyV3CombatCommand(current, {
        commandId: `${session.id}:auto:${actor.id}:${session.round}:${strategy}:fallback`,
        unitId: actor.id,
        kind: 'defend',
        targetIds: [actor.id],
      });
    }
    if (!applied.session) {
      setCombatError(applied.errors.join('；'));
      return;
    }
    if (!applied.ok) {
      setCombatError(applied.errors.join('；') || '本地自动策略无法生成合法行动');
      return;
    }
    commitV3CombatState(applied.state, applied.ok ? undefined : applied.errors.join('；'));
    if (applied.session.lifecycle === 'terminal') {
      void continueCombatNarration();
      return;
    }
    combatAutomationTimerRef.current = setTimeout(runCombatAutomationStep, 800);
  }, [engine, commitV3CombatState, continueCombatNarration]);

  const handleV3AutoStrategy = useCallback((strategy: CombatAutoStrategy | null) => {
    if (engine.isReadOnly) return;
    combatAutoStrategyRef.current = strategy;
    setCombatAutoStrategy(strategy);
    if (combatAutomationTimerRef.current) clearTimeout(combatAutomationTimerRef.current);
    combatAutomationTimerRef.current = null;
    if (strategy) combatAutomationTimerRef.current = setTimeout(runCombatAutomationStep, 0);
  }, [runCombatAutomationStep]);

  useEffect(() => () => {
    if (combatAutomationTimerRef.current) clearTimeout(combatAutomationTimerRef.current);
  }, []);

  // Refreshing into an enemy turn must not leave the session stuck; enemy AI is
  // always local and proceeds one action at a time until a manual/auto ally turn.
  useEffect(() => {
    const session = gameState.v3?.combatSession;
    const actor = session?.participants.find(unit => unit.id === session.activeUnitId);
    if (!readOnly && combatV3Enabled && session?.lifecycle === 'active' && actor?.side === 'enemy' && !combatAutomationTimerRef.current) {
      combatAutomationTimerRef.current = setTimeout(runCombatAutomationStep, 900);
    }
  }, [gameState, combatV3Enabled, readOnly, runCombatAutomationStep]);

  const handleV3Retry = useCallback(() => {
    if (engine.isReadOnly) return;
    combatNarrationGenerationRef.current += 1;
    combatNarrationInFlightRef.current = false;
    engine.cancel();
    setCombatSaving(false);
    const result = retryV3Combat(engine.variableManager.getState());
    if (!result.ok || !result.restore) {
      setCombatError(result.errors.join('；'));
      return;
    }
    engine.restoreCombatCheckpoint(result.restore, useSaveStore.getState().currentSaveId ?? undefined);
    engine.variableManager.setState(result.state);
    combatAutoStrategyRef.current = null;
    setCombatAutoStrategy(null);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
    setNotification('已恢复战前完整检查点，请重新编队');
  }, [engine, bumpVersion]);
  const currentPlayerActionHost = () => {
    const scope = { ...customModuleScope.current };
    return {
      readState: () => scope.manager.getState(),
      isCurrent: () => customModuleScope.current.mounted && customModuleScope.current.manager === scope.manager
        && customModuleScope.current.worldId === scope.worldId && useSaveStore.getState().currentSaveId === scope.saveId
        && !engine.isReadOnly && !engine.isGenerating,
      commit: (next: ReturnType<typeof engine.variableManager.getState>) => {
        const accepted = engine.commitPlayerState(next);
        if (accepted) bumpVersion();
        return accepted;
      },
    };
  };
  const handleUpdateChronicles = (npcId: string, chronicles: string[], expectedChronicles?: string[]) => {
    const result = updateCurrentNpcChronicles(currentPlayerActionHost(), npcId, chronicles, expectedChronicles);
    if (!result.applied && result.reason) setNotification(result.reason);
    return result.applied;
  };
  const handleMergeChronicles = async (npcId: string, startIndex: number, endIndex: number, options?: ChronicleMergeOptions) => {
    if (!apiConfig) { setNotification('请先配置可用模型。'); return false; }
    const result = await mergeCurrentNpcChronicles({
      ...options, host: currentPlayerActionHost(), npcId, startIndex, endIndex,
      generate: async ({ npcName, deeds, signal }) => (await requestCompletion(apiConfig, [{ role: 'user', content:
        `你是叙事记录员。以下是NPC「${npcName}」的${deeds.length}条事迹记录，请将它们合并总结为1条简洁的事迹摘要（30-60字），保留关键事件，去除冗余。只输出合并后的1条文本，不要编号或其他前缀。\n\n原始事迹：\n${deeds.map((c, i) => `${i + 1}. ${c}`).join('\n')}`,
      }], { temperature: 0.3, signal })).text,
    });
    if (!result.applied && result.reason) setNotification(result.reason);
    return result.applied;
  };
  const handleDeleteNpc = useCallback((npcId: string) => {
    if (engine.isReadOnly) return false;
    if (!npcId) return false;
    const s = engine.variableManager.getState();
    const npc = s.人物档案?.[npcId];
    if (!npc) {
      setNotification(t('npc.delete.fail'));
      return false;
    }
    const npcName = (npc as any).姓名 || npcId;
    const removed = engine.variableManager.removeNpc(npcId);
    if (!removed) {
      setNotification(t('npc.delete.fail'));
      return false;
    }
    // 清理头像 blob（PortraitHeader 写入的稳定 key 是 portrait-）；
    // 同时清理 npc 自身记录里可能另存的 portraitBlobKey。
    const portraitKey = 'portrait-' + npcId;
    imageDb.deleteBlob(portraitKey).catch(() => { /* 没有头像时静默 */ });
    const ext = npc as any;
    if (ext.portraitBlobKey && ext.portraitBlobKey !== portraitKey) {
      imageDb.deleteBlob(ext.portraitBlobKey).catch(() => { /* 同上 */ });
    }
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
    setNotification(t('npc.delete.success').replace('{name}', npcName));
    return true;
  }, [engine, bumpVersion, t]);
  // ── Simulation rules change handler ──
  const handleSimulationRulesChange = useCallback((rules: WorldDynamicsConfig) => {
    if (!worldDef || engine.isReadOnly) return;
    // 新世界默认不再显式携带 simulation 模块；首次编辑时再物化一份覆盖配置。
    const modules = worldDef.modules ?? (worldDef.modules = []);
    const simMod = modules.find(m => m.moduleId === 'simulation');
    if (simMod) {
      simMod.enabled = true;
      simMod.moduleConfig = rules as unknown as Record<string, unknown>;
    } else {
      modules.push({
        moduleId: 'simulation',
        name: '剧情导演',
        description: '当前世界的剧情导演兼容规则覆盖',
        enabled: true,
        moduleConfig: rules as unknown as Record<string, unknown>,
      });
    }
    bumpVersion();
  }, [worldDef, bumpVersion]);
  const handleUseWorldDynamicsAction = useCallback((text: string) => {
    const draft = text.trim();
    if (!draft || engine.isReadOnly) return;
    setChatDraft({ id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, text: draft });
    setNotification('建议行动已放入正文输入框');
  }, [engine.isReadOnly]);
  // ── Panel rendering (shared between desktop and mobile) ──
  const renderPanelContent = (panel: OverlayPanel, onClose: () => void) => {
    const host = currentPlayerActionHost();
    const content = (() => {
      switch (panel) {
        case 'profile': return <ProfilePanel gameState={gameState} hasBusinessModule={hasBusinessModule} professionConfig={worldSystem.职业体系 as import('../../modules/schema').ProfessionModuleSchema | undefined} statConfig={worldSystem.数值属性 as StatModuleSchema | undefined} variableManager={engine.variableManager} />;
        case 'characters': return <CharacterGrid gameState={gameState} worldId={state.selectedWorld} onUpdateChronicles={handleUpdateChronicles} onMergeChronicles={handleMergeChronicles} onDeleteNpc={readOnly ? undefined : handleDeleteNpc} />;
        case 'tasks': return <TaskPanel gameState={gameState} professionConfig={worldSystem.职业体系 as import('../../modules/schema').ProfessionModuleSchema | undefined} />;
        case 'profession': return <ProfessionTreePanel config={worldSystem.职业体系 as import('../../modules/schema').ProfessionModuleSchema | undefined} statConfig={worldSystem.数值属性 as StatModuleSchema | undefined} gameState={gameState} currentTick={gameState.simulationRuntime?.tick ?? 0} onUnlock={id => applyProfessionAction('unlock', id)} onUse={id => applyProfessionAction('use', id)} />;
        case 'notebook': return <NotebookPanel gameState={gameState} />;
        case 'variables': return <VariableSnapshotPanel messages={engine.messages} varMgr={engine.variableManager}
          onIsCurrent={host.isCurrent} onPrepareStateJSON={engine.preparePlayerStateJSON}
          onRollbackToSnapshot={(msgIndex) => { if (!host.isCurrent()) return; engine.rollbackToSnapshot(msgIndex); bumpVersion(); useSaveStore.getState().scheduleAutoSave(); }}
          onSave={() => { if (!host.isCurrent()) return; bumpVersion(); useSaveStore.getState().scheduleAutoSave(); }}
          onCommitState={async next => { if (!host.isCurrent() || !host.commit(next)) return false; await useSaveStore.getState().flushAutoSave(); setNotification('状态已应用并保存'); return true; }} />;
        case 'worldbook': return <WorldBookPanel worldId={state.selectedWorld} engine={engine} />;
        case 'memory': return <MemorySettingsOverlay visible={true} onClose={onClose} onSave={() => useSaveStore.getState().scheduleAutoSave()} messages={engine.messages} mode="inline" />;
        case 'dynamics': return <WorldDynamicsPanel gameState={gameState} onManualTick={readOnly ? async () => undefined : handleManualTick} isSimulating={isSimulating} worldDef={worldDef} onRulesChange={handleSimulationRulesChange} onUseAction={readOnly ? undefined : text => { handleUseWorldDynamicsAction(text); onClose(); }} />;
        case 'modules': return <EventConfigPanel worldDef={worldDef} />;
        default: return null;
      }
    })();
    return panel && content ? <JourneyDossierContent panel={normalizeDossierPanel(panel)}>{content}</JourneyDossierContent> : content;
  };
  const getPanelTitle = (panel: OverlayPanel): string => {
    if (!panel) return '';
    return DOSSIER_META[normalizeDossierPanel(panel)].title;
  };
  const getPanelMeta = (panel: OverlayPanel) => panel ? DOSSIER_META[normalizeDossierPanel(panel)] : undefined;
  const activeNavButtons = useMemo(() => navButtons.filter(button => button.id !== 'profession' || hasProfessionModule), [hasProfessionModule]);
  const mobileNavItems = useMemo(() => buildMobileNavItems({
    navigate: handleNavigate, setShowLeftOverlay, setMobileActivePanel,
  }).filter(item => item.id !== 'profession' || hasProfessionModule), [handleNavigate, hasProfessionModule]);
  // ── Shared elements ──
  const economyView = buildEconomyViewModel(gameState, worldDef, worldDef?.modules?.find(module => module.moduleId === 'business' && module.enabled)?.name);

  const resourcesView = buildResourcesViewModel(gameState, worldDef, worldDef?.modules?.find(module => module.moduleId === 'survival' && module.enabled)?.name);
  const eventsView = buildEventsPanelView(gameState, worldDef);
  const rightPanelEl = (
    <RightPanel
      gameState={gameState} worldId={state.selectedWorld}
      resourcesView={resourcesView}
      onResourceGather={readOnly ? undefined : resourceActions.gather}
      onResourceGenerateRecipe={readOnly ? undefined : resourceActions.generateRecipe}
      onResourceCancelRecipeGeneration={readOnly ? undefined : resourceActions.cancelRecipeGeneration}
      isGeneratingRecipe={isGeneratingRecipe}
      economyView={economyView}
      onOpenEconomyLedger={() => setBusinessOverlayOpen(true)}
      eventsView={eventsView}
      onSetEventPacing={readOnly ? undefined : level => {
        const result = setEventPacing(engine, worldDef, level);
        setNotification(result.feedback);
        if (result.ok) bumpVersion();
      }}
      onOpenEventCard={() => eventBus.emit(EVENTS.EVENT_CARD_OPEN)}
      onOpenResourcesLedger={() => setSurvivalOverlayOpen(true)}
      onAllocateStat={handleAllocateStat}
      onBreakthrough={handleBreakthrough}
      onUnlockTalent={id => applyAbilityAction('talent', id)}
      onLearnSkill={id => applyAbilityAction('learn', id)}
      onUseSkill={id => applyAbilityAction('use', id)}
      onAwakenAbility={id => applyAbilityAction('awaken', id)}
      onRespecAbilities={() => applyAbilityAction('respec')}
      onEquipAbility={(id, slotId) => applyAbilityAction('equip', id, slotId)}
      onUnequipAbility={id => applyAbilityAction('unequip', id)}
      onCustomModuleButton={handleCustomModuleButton}
      combatV3Enabled={combatV3Enabled}
    />
  );

  const chatPanelEl = (
    <ChatPanel
      messages={engine.messages} isGenerating={engine.isGenerating}
      worldName={worldDef?.name || '世界漫游指南'}
      worldSceneUrl={worldArtwork}
      onSend={engine.sendMessage} onCancel={engine.cancel}
      onDelete={engine.deleteSingleMessage} onEdit={engine.editMessage}
      onResend={engine.resendFromMessage} onResendFromHere={engine.resendFromAssistantMessage}
      pipelineStatus={engine.pipelineStatus} worldSystem={worldSystem}
      onDiceRoll={handleDiceRoll} onRetrySingleStage={engine.retrySingleStage}
      onRetryPipeline={engine.retryPipeline}
      readOnly={readOnly}
      externalDraft={chatDraft}
      externalBlockedReason={isLeaving ? '正在保存旅程，请稍候。' : undefined}
    />
  );
  // ── Render ──
  navigationPorts.current.blocked = combatSaving || abilitySaving || isSimulating || isGeneratingRecipe || combatNarrationInFlightRef.current;
  return (
    <>
      <div inert={isLeaving} style={{ display: 'contents' }}>
      {isMobile ? (
        <MobileLayout
          worldName={worldDef?.name || '世界漫游指南'}
          isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
          showLeftOverlay={showLeftOverlay} onShowLeftOverlay={setShowLeftOverlay}
          mobileNavItems={mobileNavItems}
          showRightOverlay={showRightOverlay} onShowRightOverlay={setShowRightOverlay}
          mobileActivePanel={mobileActivePanel} onMobileActivePanelChange={setMobileActivePanel}
          panelTitle={getPanelTitle(mobileActivePanel)}
          panelSubtitle={getPanelMeta(mobileActivePanel)?.subtitle}
          panelIcon={getPanelMeta(mobileActivePanel)?.icon}
          panelContent={renderPanelContent(mobileActivePanel, () => setMobileActivePanel(null))}
          rightPanel={rightPanelEl}
        >{chatPanelEl}</MobileLayout>
      ) : (
        <DesktopLayout
          navButtons={activeNavButtons} overlay={overlay} onOverlayChange={setOverlay}
          onNavigate={handleNavigate}
          isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
          drawerTitle={getPanelTitle(overlay)}
          drawerSubtitle={getPanelMeta(overlay)?.subtitle}
          drawerIcon={getPanelMeta(overlay)?.icon}
          drawerContent={renderPanelContent(overlay, () => setOverlay(null))}
          rightCollapsed={rightCollapsed} onToggleRightPanel={() => setRightCollapsed(c => !c)}
          rightPanel={rightPanelEl}
        >{chatPanelEl}</DesktopLayout>
      )}
      {economyView && <EconomyLedger
        open={businessOverlayOpen} view={economyView}
        {...(readOnly ? {} : economyActions)}
        onClose={() => setBusinessOverlayOpen(false)}
      />}
      {resourcesView && <ResourcesLedger
        open={survivalOverlayOpen} view={resourcesView}
        onGather={readOnly ? undefined : resourceActions.gather}
        onCraft={readOnly ? undefined : resourceActions.craft}
        onUnlock={readOnly ? undefined : resourceActions.unlockRecipe}
        onDeleteRecipe={readOnly ? undefined : resourceActions.removeRecipe}
        onClose={() => setSurvivalOverlayOpen(false)}
      />}
      {combatV3Enabled && gameState.v3?.combatSession && (gameState.v3.combatSession.lifecycle !== 'terminal' || gameState.v3.combatSession.result?.narration.status !== 'succeeded') && <CombatWireframe
        session={gameState.v3.combatSession}
        statLabels={combatStatLabels}
        worldSceneUrl={worldArtwork}
        world={worldDef}
        portraits={combatPortraits}
        saving={combatSaving}
        error={combatError}
        autoStrategy={combatAutoStrategy}
        readOnly={readOnly}
        onCommand={handleV3Command}
        onStart={handleV3Start}
        onSetAutoStrategy={handleV3AutoStrategy}
        onRetry={handleV3Retry}
        onContinueNarration={continueCombatNarration}
        onLeave={handleLeaveV3Combat}
      />}
      {combatV3Enabled && !readOnly && gameState.v3?.pendingEncounterRequest && <CombatEncounterDecisionCard
        request={gameState.v3.pendingEncounterRequest}
        saving={combatSaving}
        error={combatError}
        onChoose={handleEncounterDecision}
      />}
      {!readOnly && !isCombatInteractionPaused(gameState) && pendingAbilityProposals[0] && <AbilityProposalCard
        proposal={pendingAbilityProposals[0]}
        remainingCount={pendingAbilityProposals.length}
        saving={abilitySaving}
        error={abilityError}
        onResolve={handleAbilityProposal}
      />}
      {!readOnly && !isCombatInteractionPaused(gameState) && <CardOverlay engine={engine} world={worldDef} gameState={gameState} apiConfig={apiConfig} onChoice={handleCustomModuleChoice} onDecisionApplied={handleNarrativeDecisionApplied} onNotify={setNotification} />}
      {readOnly && <div className="game-readonly-banner" role="status">此旅程已在炼狱风险中封存：可以回顾与导出，但不能继续、编辑或回滚。</div>}
      {notification && (
        <button type="button" aria-label="关闭提示" onClick={() => setNotification(null)} style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 20px', fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 200, animation: 'fadeIn 0.2s ease', cursor: 'pointer' }}>
          {notification}
        </button>
      )}
      </div>
      {isLeaving && <div role="status" style={{ position: 'fixed', inset: 0, zIndex: 290, display: 'grid', placeItems: 'center', background: 'var(--overlay-backdrop)' }}>正在保存旅程…</div>}
      {!isLeaving && (leaveError || saveFailure) && <section role="alert" style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', zIndex: 280, maxWidth: 'calc(100vw - 32px)', padding: 14, background: 'var(--bg-secondary)', border: '1px solid var(--danger)', borderRadius: 8 }}>
        <p>{leaveError || `进度尚未保存：${saveFailure?.message}`}。当前旅程仍保留，可重试或导出完整备份。</p>
        <button type="button" onClick={() => { if (leaveDestination.current) handleNavigate(leaveDestination.current); else void useSaveStore.getState().flushAutoSave().then(() => setLeaveError(null)).catch(error => setLeaveError(String(error))); }}>重试保存</button>
        <button type="button" onClick={() => { void handleNavigationBackup(); }}>导出备份</button>
        {leaveError && <button type="button" onClick={() => { leaveDestination.current = null; setLeaveError(null); }}>留在旅程</button>}
      </section>}
      {navigationDialog}
    </>
  );
}
