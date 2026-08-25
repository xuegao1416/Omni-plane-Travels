import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useGame } from '../../context/GameContext';
import { useUISettings } from '../../context/UISettingsContext';
import { useConfigStore } from '../../stores/configStore';
import { useMediaQuery } from '../../hooks/useIsMobile';
import ChatPanel from './chat/ChatPanel';
import ProfilePanel from './panels/ProfilePanel';
import CharacterGrid from './panels/CharacterGrid';
import NotebookPanel from './panels/NotebookPanel';
import TaskPanel from './panels/TaskPanel';
import ProfessionTreePanel from './panels/ProfessionTreePanel';
import VariableSnapshotPanel from './panels/VariableSnapshotPanel';
import WorldBookPanel from './panels/WorldBookPanel';
import RightPanel from './panels/RightPanel';
import BusinessOverlay from './panels/BusinessOverlay';
import SurvivalOverlay from './panels/SurvivalOverlay';
import CombatOverlay from './panels/CombatOverlay';
import CombatWireframe from './CombatWireframe';
import CombatEncounterDecisionCard, { type CombatEncounterDecision } from './CombatEncounterDecisionCard';
import AbilityProposalCard from './AbilityProposalCard';
import { MemorySettingsOverlay } from '../settings/memory/MemorySettingsOverlay';
import WorldDynamicsPanel from './panels/WorldDynamicsPanel';
import { findWorldDef } from '../../data/worldLoader';
import { resolveWorldArtwork } from '../../data/worldArtwork';
import { eventBus, EVENTS } from '../../engine/eventBus';
import type { WorldSystemData, DiceRoll, BusinessModuleSchema, CombatModuleSchema, ProfessionModuleSchema, ProgressionConfig, StatModuleSchema, WorldDynamicsConfig, PeriodicRule, ModuleEffects, EventRule, RuleFile } from '../../modules/schema';
import { recordDiceRoll } from '../../gameplay/modules/dice';
import { allocateStatPoints } from '../../gameplay/modules/stat';
import { breakthroughProgression } from '../../gameplay/modules/progression';
import { awakenAbility, equipAbility, learnSkill, respecAbilities, unequipAbility, unlockTalent, useSkill } from '../../gameplay/modules/talent';
import { resolveProfessionBonuses, synchronizeProfessionAbilities, unlockProfessionAbility, useProfessionAbility } from '../../gameplay/profession';
import { resolveProfessionBinding, resolveProfessionCombatActions } from '../../data/professions';
import { isProfessionModuleEnabled } from '../../gameplay/profession/featureGate';
import { resolveCombatRuleset } from '../../gameplay/combatRulesets';
import { createDefaultDiceModule } from '../../modules/defaults';
import { useSaveStore } from '../../stores/saveStore';
import { eventWorldEvolution } from '../../modules/eventIntegration';
import { installWorldEventPacks } from '../../modules/webEventStore';
import { getRuntimePack, listPacks, type EventRuntimePack } from '../../modules/eventApi';
import { selectRuntimePacksForWorld } from '../../modules/eventRuntime';
import { installWorldCardWorkflows } from '../../modules/cardWorldBindings';
import CardOverlay from '../event/CardOverlay';
import EventConfigPanel from '../event/EventConfigPanel';
import type { OverlayPanel } from './gameScreen/types';
import { navButtons, buildMobileNavItems } from './gameScreen/navConfig';
import DesktopLayout from './gameScreen/DesktopLayout';
import MobileLayout from './gameScreen/MobileLayout';
import { useSimulation } from './gameScreen/hooks/useSimulation';
import { useSurvivalCraft } from './gameScreen/hooks/useSurvivalCraft';
import { useSurvivalSettlement } from './gameScreen/hooks/useSurvivalSettlement';
import { useBusinessSettlement } from './gameScreen/hooks/useBusinessSettlement';
import { assignBusinessStaff, purchaseBusinessAsset, upgradeBusinessAsset } from '../../gameplay/modules/business';
import { performCombatAction, endCombat } from '../../gameplay/combat';
import { normalizeAssetStatus } from './panels/businessOverlay/utils';
import JourneyDossierContent from './shared/JourneyDossierContent';
import { DOSSIER_META, normalizeDossierPanel } from './shared/journeyDossierMeta';
import { runCustomModulesForWorldAndCommit } from '../../custom-modules/engineBridge';
import type { CustomModuleChoiceEvent } from '../../custom-modules/context';
import { useMemoryStore } from '../../memory/memoryStore';
import { usePortraitStore } from '../../stores/portraitStore';
import { getEngineState } from '../../simulation/SimulationApi';
import { normalizeCombatEncounterRequest, type CombatCommandInputV2, type CombatEncounterRequest } from '../../gameplay/protocols';
import { applyNarrativeDecision, createNarrativeDecisionRecord, type NarrativeDecisionRecord } from '../../gameplay/narrativeDecision';
import { resolveAbilityProposalOnGameState } from '../../gameplay/abilitySystem';
import { chooseAutomaticCommand, prepareCombatEncounterRequest, type CombatAutoStrategy, type CombatStatRanges } from '../../gameplay/combatV2';
import { CombatNarrationCoordinator, applyV3CombatCommand, buildLocalCombatContinuation, isCombatFeatureEnabled, isCombatInteractionPaused, preserveCombatOwnedState, requestFromNarrativeAction, retryV3Combat, startV3Combat } from '../../gameplay/combatRuntime';

export default function GameScreen() {
  const { state, navigate, engine } = useGame();
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
    const mq = window.matchMedia('(max-width: 900px)');
    const handler = (e: MediaQueryListEvent | MediaQueryList) => { if (e.matches) setRightCollapsed(true); };
    handler(mq);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // ── Derived data ──
  const gameState = engine.variableManager.getState();
  const savedPortraits = usePortraitStore(s => s.portraits);
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
  const hasSurvivalModule = !!worldDef?.modules?.some(m => m.moduleId === 'survival' && m.enabled);
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
      if (!key || (!(mod.moduleConfig || mod.data) && mod.moduleId !== 'dice')) continue;
      const config = (mod.moduleConfig || mod.data || createDefaultDiceModule()) as Record<string, any>;
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
  const combatConfig = useMemo((): CombatModuleSchema | undefined => {
    const base = worldSystem.战斗系统 as CombatModuleSchema | undefined;
    if (!base) return undefined;
    const professionConfig = worldSystem.职业体系 as ProfessionModuleSchema | undefined;
    const professionActions = resolveProfessionCombatActions(gameState, professionConfig);
    const bonuses = resolveProfessionBonuses(gameState, professionConfig).combat;
    const actions = [...(base.playerActions ?? []), ...professionActions];
    const playerActions = [...new Map(actions.map(action => [action.id, action])).values()].map(action => ({
      ...action,
      ...((action.damage ?? 0) > 0 && bonuses.damage ? { damage: (action.damage ?? 0) + bonuses.damage } : {}),
      ...((action.healing ?? 0) > 0 && bonuses.healing ? { healing: (action.healing ?? 0) + bonuses.healing } : {}),
      ...(bonuses.accuracy ? { accuracy: (action.accuracy ?? 10) + bonuses.accuracy } : {}),
    }));
    return {
      ...base,
      playerActions,
      playerArmor: Math.max(0, Number(base.playerArmor ?? 0) + bonuses.armor),
      playerInitiative: Number(base.playerInitiative ?? 0) + bonuses.initiative,
    };
  }, [worldSystem, gameState, stateVersion]);
  // ── Extracted hooks ──
  const bumpVersion = useCallback(() => setStateVersion(v => v + 1), []);
  const { isSimulating, handleManualTick } = useSimulation(engine, worldDef, apiConfig);

  const handleCustomModuleChoice = useCallback(async (event: CustomModuleChoiceEvent) => {
    if (engine.isReadOnly) return;
    const result = await runCustomModulesForWorldAndCommit(engine.variableManager.getState(), state.selectedWorld, 'onChoice', {
      event,
    }, {
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
    void runCustomModulesForWorldAndCommit(engine.variableManager.getState(), state.selectedWorld, 'onButton', {
      event: { type: 'button', moduleId, event },
    }, {
      commit: (nextState) => engine.variableManager.setState(nextState),
      notify: () => { bumpVersion(); eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED); },
      autoSave: () => useSaveStore.getState().scheduleAutoSave(),
    }).then((result) => {
      if (result.warnings.length > 0) console.warn('[CustomModules] onButton warnings:', result.warnings);
    }).catch((error) => console.warn('[CustomModules] onButton failed:', error));
  }, [engine, state.selectedWorld, bumpVersion]);

  // ── 事件包注册（二级开关：sessionActivePacks 优先，否则用全局已启用列表） ──
  const sessionActivePacks = useSaveStore(s => s.sessionActivePacks);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // 1. 安装世界关联的事件包进 IndexedDB（幂等，已存在跳过）
      if (worldDef) {
        try {
          await installWorldEventPacks(worldDef);
          await installWorldCardWorkflows(worldDef);
        } catch (e) {
          console.warn('[事件包] 世界事件包安装失败（已跳过）:', e);
        }
      }
      if (cancelled) return;

      // 2. 兼容旧自定义世界：moduleConfig.periodicEvents → 临时注册
      const hasWorldPacks = (worldDef?.eventPacks?.length ?? 0) > 0;
      if (!hasWorldPacks) {
        const legacy = (worldDef?.modules?.find(m => m.moduleId === 'simulation' && m.enabled)?.moduleConfig as Record<string, unknown> | undefined)?.periodicEvents as Array<Record<string, unknown>> | undefined;
        if (legacy && legacy.length > 0) {
          const periodicRules: PeriodicRule[] = legacy.map((p) => ({
            id: String(p.id ?? `legacy_${Math.random().toString(36).slice(2)}`),
            name: typeof p.name === 'string' ? p.name : undefined,
            intervalTicks: Number(p.intervalTicks ?? 1),
            offsetTicks: typeof p.offsetTicks === 'number' ? p.offsetTicks : undefined,
            effects: (p.effects as ModuleEffects) ?? {},
            description: typeof p.description === 'string' ? p.description : undefined,
            narrateToAI: typeof p.narrateToAI === 'boolean' ? p.narrateToAI : undefined,
          }));
          const savedRuntime0 = gameState.simulationRuntime?.eventRuntimes?.['world:periodic'];
          eventWorldEvolution.registerPack({
            eventPackId: 'world:periodic',
            rules: [],
            periodicRules,
            permissions: ['modify_world_state'],
            runtime: savedRuntime0 ?? { onceFired: {}, cooldownRemaining: {} },
            displayName: '世界周期事件（自定义）',
            source: 'world',
          });
        }
      }

      // 3. 确定本局要注册的事件包列表（二级开关优先，否则用全局已启用列表）
      let enabledIds: string[];
      if (sessionActivePacks !== undefined) {
        enabledIds = sessionActivePacks;
      } else {
        try {
          const entries = await listPacks(true);
          enabledIds = entries.filter((entry) => entry.enabled).map((entry) => entry.meta.id);
        } catch {
          enabledIds = [];
        }
      }
      // 所有包必须绑定当前世界才加载（防止跨世界污染）
      if (cancelled) return;

      // 防残留：先清空再按当前绑定注册
      eventWorldEvolution.clear();

      // 重新注册旧自定义世界的周期事件（上面 clear 了）
      if (!hasWorldPacks) {
        const legacy = (worldDef?.modules?.find(m => m.moduleId === 'simulation' && m.enabled)?.moduleConfig as Record<string, unknown> | undefined)?.periodicEvents as Array<Record<string, unknown>> | undefined;
        if (legacy && legacy.length > 0) {
          const periodicRules: PeriodicRule[] = legacy.map((p) => ({
            id: String(p.id ?? `legacy_${Math.random().toString(36).slice(2)}`),
            name: typeof p.name === 'string' ? p.name : undefined,
            intervalTicks: Number(p.intervalTicks ?? 1),
            offsetTicks: typeof p.offsetTicks === 'number' ? p.offsetTicks : undefined,
            effects: (p.effects as ModuleEffects) ?? {},
            description: typeof p.description === 'string' ? p.description : undefined,
            narrateToAI: typeof p.narrateToAI === 'boolean' ? p.narrateToAI : undefined,
          }));
          const savedRuntime0b = gameState.simulationRuntime?.eventRuntimes?.['world:periodic'];
          eventWorldEvolution.registerPack({
            eventPackId: 'world:periodic',
            rules: [],
            periodicRules,
            permissions: ['modify_world_state'],
            runtime: savedRuntime0b ?? { onceFired: {}, cooldownRemaining: {} },
            displayName: '世界周期事件（自定义）',
            source: 'world',
          });
        }
      }

      const runtimePacks: EventRuntimePack[] = [];
      for (const id of enabledIds) {
        if (cancelled) break;
        try {
          runtimePacks.push(await getRuntimePack(id));
        } catch (e) {
          console.warn(`[event pack] runtime read failed: ${id}`, e);
        }
      }

      for (const rec of selectRuntimePacksForWorld(runtimePacks, worldDef?.id)) {
        if (cancelled) break;
        const id = rec.id;
        try {
          const rules: EventRule[] = [];
          const periodicRules: PeriodicRule[] = [];
          let workflow: import('../../modules/workflowSchema').WorkflowDefinition | undefined;
          // 优先读工作流格式
          const wfRaw = rec.files['schema/workflow.json'];
          if (typeof wfRaw === 'string') {
            try { workflow = JSON.parse(wfRaw); } catch { /* 损坏 */ }
          }
          // 回退读规则格式
          if (!workflow) {
            const raw = rec.files['schema/rules.json'];
            if (typeof raw === 'string') {
              const rf = JSON.parse(raw) as RuleFile;
              if (rf.rules) rules.push(...rf.rules);
              if (rf.periodicRules) periodicRules.push(...rf.periodicRules);
            }
          }
          if (workflow || rules.length > 0 || periodicRules.length > 0) {
            const savedRuntime = gameState.simulationRuntime?.eventRuntimes?.[id];
            eventWorldEvolution.registerPack({
              eventPackId: id,
              rules,
              periodicRules,
              workflow,
              permissions: rec.manifest.permissions ?? [],
              runtime: savedRuntime ?? { onceFired: {}, cooldownRemaining: {} },
              source: 'user',
            });
          }
        } catch (e) {
          console.warn(`[事件包] 规则注册失败（已跳过）: ${id}`, e);
        }
      }
    })();
    return () => {
      cancelled = true;
      eventWorldEvolution.clear();
    };
  }, [worldDef?.id, sessionActivePacks]);
  const {
    runtimeRecipes, isGeneratingRecipe,
    handleSurvivalCraft, handleSurvivalUnlockRecipe, handleSurvivalGather, handleSurvivalGenerateRecipe, handleSurvivalDeleteRecipe,
  } = useSurvivalCraft(engine, apiConfig, worldDef, setNotification, bumpVersion);
  useBusinessSettlement(engine, worldDef, bumpVersion);
  const { getChangeLog: getSurvivalChangeLog, clearChangeLog: clearSurvivalChangeLog } = useSurvivalSettlement(engine, worldDef, bumpVersion);
  // ── Event effects ──
  useEffect(() => {
    const onUpdate = () => setStateVersion(v => v + 1);
    const onFail = () => { setNotification('变量提取失败，游戏状态可能未更新'); setTimeout(() => setNotification(null), 4000); };
    eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, onUpdate);
    eventBus.on(EVENTS.VARIABLE_EXTRACTION_FAILED, onFail);
    return () => { eventBus.off(EVENTS.VARIABLE_UPDATE_ENDED, onUpdate); eventBus.off(EVENTS.VARIABLE_EXTRACTION_FAILED, onFail); };
  }, []);
  // ── Callbacks ──
  const handleDiceRoll = useCallback((roll: DiceRoll) => {
    if (engine.isReadOnly) return;
    const current = engine.variableManager.getState();
    const diceConfig = worldDef?.modules?.find(module => module.moduleId === 'dice' && module.enabled)?.moduleConfig as import('../../modules/schema').DiceModuleSchema | undefined;
    const result = recordDiceRoll(current, roll, diceConfig ?? {}, {
      tick: current.simulationRuntime?.tick ?? 0,
      enabledModules: ['dice'],
    });
    if (result.status !== 'applied') return;
    engine.variableManager.setState(result.state);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, worldDef, bumpVersion]);
  const handleAllocateStat = useCallback((statId: string) => {
    if (engine.isReadOnly) return;
    const config = worldDef?.modules?.find(module => module.moduleId === 'stat' && module.enabled)?.moduleConfig as StatModuleSchema | undefined;
    if (!config) return;
    const current = engine.variableManager.getState();
    const result = allocateStatPoints(current, config, { [statId]: 1 }, {
      tick: current.simulationRuntime?.tick ?? 0,
      enabledModules: ['stat'],
    });
    if (result.status !== 'applied') {
      setNotification(result.reason ?? '属性点不足');
      return;
    }
    engine.variableManager.setState(result.state);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, worldDef, bumpVersion]);
  const handleBreakthrough = useCallback((targetTier: number) => {
    if (engine.isReadOnly) return;
    const config = worldDef?.modules?.find(module => module.moduleId === 'progression' && module.enabled)?.moduleConfig as ProgressionConfig | undefined;
    if (!config) return;
    const professionConfig = worldSystem.职业体系 as ProfessionModuleSchema | undefined;
    const current = engine.variableManager.getState();
    const result = breakthroughProgression(current, config, targetTier, {
      tick: current.simulationRuntime?.tick ?? 0,
      enabledModules: ['progression'],
    }, { professionAbilityPointsPerTier: professionConfig?.abilityPointsPerTier });
    if (result.status !== 'applied') {
      setNotification(result.reason ?? '突破条件未满足');
      return;
    }
    engine.variableManager.setState(result.state);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, worldDef, worldSystem.职业体系, bumpVersion]);
  const applyAbilityAction = useCallback((action: 'talent' | 'learn' | 'use' | 'awaken' | 'equip' | 'unequip' | 'respec', id = '', slotId = '') => {
    if (engine.isReadOnly) return;
    const config = worldDef?.modules?.find(module => module.moduleId === 'talent' && module.enabled)?.moduleConfig as import('../../modules/schema').TalentModuleSchema | undefined;
    if (!config) return;
    const current = engine.variableManager.getState();
    const context = { tick: current.simulationRuntime?.tick ?? 0, enabledModules: ['talent'] };
    const result = action === 'talent'
      ? unlockTalent(current, config, id, context)
      : action === 'learn'
        ? learnSkill(current, config, id, context)
        : action === 'use'
          ? useSkill(current, config, id, context)
          : action === 'awaken'
            ? awakenAbility(current, config, id, context)
            : action === 'equip'
              ? equipAbility(current, config, id, slotId, context)
              : action === 'unequip'
                ? unequipAbility(current, id, context)
                : respecAbilities(current, config, context);
    if (result.status !== 'applied') {
      setNotification(result.reason ?? '当前条件不满足');
      return;
    }
    engine.variableManager.setState(result.state);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, worldDef, bumpVersion]);
  const applyProfessionAction = useCallback((action: 'unlock' | 'use', id: string) => {
    if (engine.isReadOnly) return;
    const config = worldSystem.职业体系 as import('../../modules/schema').ProfessionModuleSchema | undefined;
    if (!config) return;
    const current = engine.variableManager.getState();
    const context = { tick: current.simulationRuntime?.tick ?? 0, enabledModules: ['profession'] };
    const result = action === 'unlock'
      ? unlockProfessionAbility(current, config, id, context)
      : useProfessionAbility(current, config, id, context);
    if (result.status !== 'applied') {
      setNotification(result.reason ?? '当前条件不满足');
      return;
    }
    engine.variableManager.setState(result.state);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, worldSystem, bumpVersion]);
  const combatContext = useCallback(() => ({ tick: engine.variableManager.getState().simulationRuntime?.tick ?? 0, enabledModules: ['combat'] as const }), [engine]);
  const commitCombatResult = useCallback((result: ReturnType<typeof performCombatAction>) => {
    if (engine.isReadOnly) return;
    if (result.status !== 'applied') {
      setNotification(result.reason ?? result.summary ?? '战斗行动未执行');
      return;
    }
    engine.variableManager.setState(result.state);
    if (result.summary) setNotification(result.summary);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, bumpVersion]);
  const businessConfig = useMemo(() => worldDef?.modules?.find(module => module.moduleId === 'business' && module.enabled)?.moduleConfig as BusinessModuleSchema | undefined, [worldDef]);
  const commitBusinessResult = useCallback((result: ReturnType<typeof purchaseBusinessAsset>) => {
    if (engine.isReadOnly) return;
    if (result.status !== 'applied') {
      setNotification(result.reason ?? '经营操作未执行');
      return;
    }
    engine.variableManager.setState(result.state);
    bumpVersion();
    useSaveStore.getState().scheduleAutoSave();
  }, [engine, bumpVersion]);
  const businessContext = useCallback(() => ({ tick: engine.variableManager.getState().simulationRuntime?.tick ?? 0, enabledModules: ['business'] as const }), [engine]);
  const handleBusinessPurchase = useCallback((assetId: string) => {
    if (businessConfig) commitBusinessResult(purchaseBusinessAsset(engine.variableManager.getState(), businessConfig, assetId, businessContext()));
  }, [businessConfig, engine, businessContext, commitBusinessResult]);
  const handleBusinessUpgrade = useCallback((assetId: string) => {
    if (businessConfig) commitBusinessResult(upgradeBusinessAsset(engine.variableManager.getState(), businessConfig, assetId, businessContext()));
  }, [businessConfig, engine, businessContext, commitBusinessResult]);
  const handleBusinessStaff = useCallback((assetId: string, count: number, efficiency?: number) => {
    commitBusinessResult(assignBusinessStaff(engine.variableManager.getState(), assetId, count, efficiency, businessContext()));
  }, [engine, businessContext, commitBusinessResult]);
  const handleCombatAction = useCallback((actionId: string, targetId: string) => {
    if (!combatConfig) return;
    commitCombatResult(performCombatAction(engine.variableManager.getState(), combatConfig, actionId, targetId, combatContext()));
  }, [engine, combatConfig, combatContext, commitCombatResult]);
  const handleCombatEnd = useCallback(() => {
    commitCombatResult(endCombat(engine.variableManager.getState(), combatContext()));
  }, [engine, combatContext, commitCombatResult]);

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
    try {
      await useSaveStore.getState().flushAutoSave();
    } finally {
      navigate('start');
    }
  }, [navigate]);

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
    combatAutomationTimerRef.current = setTimeout(runCombatAutomationStep, 260);
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
      combatAutomationTimerRef.current = setTimeout(runCombatAutomationStep, 0);
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
  const handleUpdateChronicles = useCallback((npcId: string, chronicles: string[]) => {
    if (engine.isReadOnly) return;
    const s = engine.variableManager.getState();
    const npc = s.人物档案?.[npcId];
    if (!npc) return;
    (npc as any).人物事迹 = chronicles;
    engine.variableManager.setState(s);
    bumpVersion();
  }, [engine, bumpVersion]);
  const handleMergeChronicles = useCallback(async (npcId: string, startIndex: number, endIndex: number) => {
    if (engine.isReadOnly) return false;
    if (!apiConfig) return false;
    const ok = await engine.variableManager.mergeNpcChronicles(npcId, startIndex, endIndex, apiConfig);
    if (ok) bumpVersion();
    return ok;
  }, [engine, apiConfig, bumpVersion]);
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
        name: '世界动态',
        description: '当前世界的世界动态规则覆盖',
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
    const content = (() => {
      switch (panel) {
        case 'profile': return <ProfilePanel gameState={gameState} hasBusinessModule={hasBusinessModule} professionConfig={worldSystem.职业体系 as import('../../modules/schema').ProfessionModuleSchema | undefined} statConfig={worldSystem.数值属性 as StatModuleSchema | undefined} />;
        case 'characters': return <CharacterGrid gameState={gameState} worldId={state.selectedWorld} onUpdateChronicles={handleUpdateChronicles} onMergeChronicles={handleMergeChronicles} />;
        case 'tasks': return <TaskPanel gameState={gameState} professionConfig={worldSystem.职业体系 as import('../../modules/schema').ProfessionModuleSchema | undefined} />;
        case 'profession': return <ProfessionTreePanel config={worldSystem.职业体系 as import('../../modules/schema').ProfessionModuleSchema | undefined} statConfig={worldSystem.数值属性 as StatModuleSchema | undefined} gameState={gameState} currentTick={gameState.simulationRuntime?.tick ?? 0} onUnlock={id => applyProfessionAction('unlock', id)} onUse={id => applyProfessionAction('use', id)} />;
        case 'notebook': return <NotebookPanel gameState={gameState} />;
        case 'variables': return <VariableSnapshotPanel messages={engine.messages} varMgr={engine.variableManager} onRestoreSnapshot={(snap) => { if (readOnly) return; engine.variableManager.restoreSnapshot(snap); bumpVersion(); useSaveStore.getState().scheduleAutoSave(); }} onRollbackToSnapshot={(msgIndex) => { if (readOnly) return; engine.rollbackToSnapshot(msgIndex); bumpVersion(); useSaveStore.getState().scheduleAutoSave(); }} onSave={() => { if (readOnly) return; bumpVersion(); useSaveStore.getState().scheduleAutoSave(); }} onCommitState={async () => { if (readOnly) return; bumpVersion(); await useSaveStore.getState().flushAutoSave(); setNotification('状态已应用并保存'); }} />;
        case 'worldbook': return <WorldBookPanel worldId={state.selectedWorld} engine={engine} />;
        case 'memory': return <MemorySettingsOverlay visible={true} onClose={onClose} onSave={() => useSaveStore.getState().scheduleAutoSave()} messages={engine.messages} mode="inline" />;
        case 'dynamics': return <WorldDynamicsPanel gameState={gameState} onManualTick={readOnly ? async () => undefined : handleManualTick} isSimulating={isSimulating} worldDef={worldDef} onRulesChange={handleSimulationRulesChange} onUseAction={readOnly ? undefined : text => { handleUseWorldDynamicsAction(text); onClose(); }} />;
        case 'modules': return <EventConfigPanel onClose={onClose} worldDef={worldDef} />;
        default: return null;
      }
    })();
    return panel && content ? <JourneyDossierContent panel={normalizeDossierPanel(panel)}>{content}</JourneyDossierContent> : content;
  };
  const getPanelTitle = (panel: OverlayPanel): string => {
    if (!panel) return '';
    return DOSSIER_META[normalizeDossierPanel(panel)].title;
  };
  const getPanelEmblem = (panel: OverlayPanel): string | undefined => panel ? DOSSIER_META[normalizeDossierPanel(panel)].emblemSrc : undefined;
  const activeNavButtons = useMemo(() => navButtons.filter(button => button.id !== 'profession' || hasProfessionModule), [hasProfessionModule]);
  const mobileNavItems = useMemo(() => buildMobileNavItems({
    navigate, setShowLeftOverlay, setMobileActivePanel,
  }).filter(item => item.id !== 'profession' || hasProfessionModule), [navigate, hasProfessionModule]);
  // ── Shared elements ──
  const bizData = (() => {
    const bizConfig = businessConfig;
    if (!bizConfig) return undefined;
    // 优先从当前渲染的 gameState 读取，其次从 VariableManager 实时读取（防止渲染间隙丢失更新）
    const runtimeBiz = gameState.玩家?.经营资产
      ?? (engine.variableManager.getVar('玩家.经营资产') as { 资金: number; 资产列表: any[]; 交易日志?: any[] } | undefined);
    if (!runtimeBiz) return bizConfig;
    return {
      ...bizConfig,
      funds: runtimeBiz.资金,
      assets: (runtimeBiz.资产列表 ?? []).map(a => {
        const definition = bizConfig.assets?.find(item => item.id === a.id);
        return {
          ...definition,
          id: a.id || `asset-${a.名称 || a.类型 || 'runtime'}`,
          name: a.名称 || a.类型 || a.id || '未命名资产',
          type: a.类型 || '',
          level: a.等级 ?? 1,
          maxLevel: a.最高等级 ?? 3,
          description: a.描述 || '',
          status: normalizeAssetStatus(a.状态),
          income: {
            base: a.基础收益 ?? 0,
            perLevel: a.每级收益 ?? 0,
            cycle: bizConfig.cycleName || '天',
          },
          maintenance: a.维护费 ?? 0,
          staff: a.员工效率 !== undefined || a.员工人数 !== undefined ? { current: a.员工人数 ?? definition?.staff?.current ?? 0, max: definition?.staff?.max ?? Math.max(1, a.员工人数 ?? 1), efficiency: a.员工效率 ?? definition?.staff?.efficiency ?? 1 } : undefined,
          marketTags: a.市场标签,
          risk: a.风险等级 ? { level: a.风险等级, description: '' } : undefined,
          upgradeCost: a.升级费用,
        };
      }),
      transactionLog: (runtimeBiz.交易日志 || []).map((t, i) => ({
        cycle: i + 1, type: t.类型, description: t.描述, amount: t.金额,
      })),
    } as BusinessModuleSchema;
  })();

  const rightPanelEl = (
    <RightPanel
      gameState={gameState} worldId={state.selectedWorld}
      onSurvivalGenerateRecipe={readOnly ? undefined : handleSurvivalGenerateRecipe}
      onSurvivalCraft={readOnly ? undefined : handleSurvivalCraft}
      onSurvivalUnlock={readOnly ? undefined : handleSurvivalUnlockRecipe}
      unlockedRecipeIds={gameState.gameplay?.survival?.unlockedRecipes ?? []}
      onSurvivalGather={readOnly ? undefined : handleSurvivalGather}
      onSurvivalDeleteRecipe={readOnly ? undefined : handleSurvivalDeleteRecipe}
      isGeneratingRecipe={isGeneratingRecipe} runtimeRecipes={runtimeRecipes}
      onOpenBusinessOverlay={readOnly ? undefined : () => setBusinessOverlayOpen(true)}
      onOpenSurvivalOverlay={readOnly ? undefined : () => setSurvivalOverlayOpen(true)}
      survivalChangeLog={getSurvivalChangeLog()}
      businessData={bizData}
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
      readOnly={readOnly}
      externalDraft={chatDraft}
    />
  );
  // 生存资源数据（供 SurvivalOverlay 使用）
  const survivalData = (() => {
    return worldDef?.modules?.find(m => m.moduleId === 'survival' && m.enabled)?.moduleConfig as import('../../modules/schema').SurvivalModuleSchema | undefined;
  })();
  // ── Render ──
  return (
    <>
      {isMobile ? (
        <MobileLayout
          worldName={worldDef?.name || '世界漫游指南'}
          isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
          showLeftOverlay={showLeftOverlay} onShowLeftOverlay={setShowLeftOverlay}
          mobileNavItems={mobileNavItems} t={t}
          showRightOverlay={showRightOverlay} onShowRightOverlay={setShowRightOverlay}
          mobileActivePanel={mobileActivePanel} onMobileActivePanelChange={setMobileActivePanel}
          panelTitle={getPanelTitle(mobileActivePanel)}
          panelEmblemSrc={getPanelEmblem(mobileActivePanel)}
          panelContent={renderPanelContent(mobileActivePanel, () => setMobileActivePanel(null))}
          rightPanel={rightPanelEl}
        >{chatPanelEl}</MobileLayout>
      ) : (
        <DesktopLayout
          navButtons={activeNavButtons} overlay={overlay} onOverlayChange={setOverlay}
          onNavigate={navigate} t={t}
          isFullscreen={isFullscreen} onToggleFullscreen={toggleFullscreen}
          drawerTitle={getPanelTitle(overlay)}
          drawerEmblemSrc={getPanelEmblem(overlay)}
          drawerContent={renderPanelContent(overlay, () => setOverlay(null))}
          rightCollapsed={rightCollapsed} onToggleRightPanel={() => setRightCollapsed(c => !c)}
          rightPanel={rightPanelEl}
          worldName={worldDef?.name || '世界漫游指南'}
        >{chatPanelEl}</DesktopLayout>
      )}
      {!readOnly && bizData && <BusinessOverlay open={businessOverlayOpen} data={bizData} config={businessConfig} onPurchase={handleBusinessPurchase} onUpgrade={handleBusinessUpgrade} onAssignStaff={handleBusinessStaff} onClose={() => setBusinessOverlayOpen(false)} />}
      {!readOnly && survivalData && <SurvivalOverlay
        open={survivalOverlayOpen} data={survivalData}
        runtimeResources={gameState.玩家?.生存资源 as any}
        inventory={gameState.玩家?.物品栏}
        recipes={[...(survivalData.recipes ?? []), ...runtimeRecipes]}
        stamina={gameState.玩家?.生存状态?.体力值}
        worldTime={gameState.世界?.时间系统?.当前时间}
        onGather={handleSurvivalGather}
        onCraft={handleSurvivalCraft}
        onDeleteRecipe={handleSurvivalDeleteRecipe}
        changeLog={getSurvivalChangeLog()}
        onClose={() => setSurvivalOverlayOpen(false)}
      />}
      {!readOnly && !combatV3Enabled && gameState.combat?.active && combatConfig && <CombatOverlay state={gameState.combat} gameState={gameState} config={combatConfig} statConfig={worldSystem.数值属性 as StatModuleSchema | undefined} onAction={handleCombatAction} onEnd={handleCombatEnd} />}
      {combatV3Enabled && gameState.v3?.combatSession && (gameState.v3.combatSession.lifecycle !== 'terminal' || gameState.v3.combatSession.result?.narration.status !== 'succeeded') && <CombatWireframe
        session={gameState.v3.combatSession}
        statLabels={combatStatLabels}
        worldSceneUrl={worldArtwork}
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
      {!readOnly && !isCombatInteractionPaused(gameState) && <CardOverlay gameState={gameState} onChoice={handleCustomModuleChoice} onDecisionApplied={handleNarrativeDecisionApplied} />}
      {readOnly && <div className="game-readonly-banner" role="status">此旅程已在炼狱风险中封存：可以回顾与导出，但不能继续、编辑或回滚。</div>}
      {notification && (
        <button type="button" aria-label="关闭提示" onClick={() => setNotification(null)} style={{ position: 'fixed', bottom: '24px', left: '50%', transform: 'translateX(-50%)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 20px', fontSize: 'var(--font-size-md)', color: 'var(--text-primary)', boxShadow: '0 4px 16px rgba(0,0,0,0.15)', zIndex: 200, animation: 'fadeIn 0.2s ease', cursor: 'pointer' }}>
          {notification}
        </button>
      )}
    </>
  );
}
