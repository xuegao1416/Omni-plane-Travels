// 游戏引擎 - 管线化消息发送、流式响应、变量更新
import { useCallback, useRef, useState, useEffect } from 'react';
import { useDialog } from '../components/shared/Dialog';
import type { ApiConfig, Message } from '../api/types';
import { requestStreamWithRetry } from '../api/client';
import { setRateLimitInterval } from '../api/rateLimiter';
import { extractContentForPrompt } from './responseExtractor';
import {
  appendDeepSeekRepair,
  buildDeepSeekRepairPrompt,
  ensureDeepSeekResponseFallback,
  isDeepSeekResponseComplete,
} from './deepSeekResponseGuard';
import { getMessageContent } from './contextManager';
import { VariableManager } from './variableManager';
import { resolveRollbackTarget } from './rollbackTarget';
import { eventBus, EVENTS } from './eventBus';
import { v4 as uuid } from 'uuid';
import type { WorldBookManager } from '../worldbook/index';
import { sanitizeForContext } from './contextManager';
import type { GameSave, PlayerProfile } from '../storage/db';
import { optimizeSnapshots } from '../storage/db';
import { loadWorldBook, applyWorld } from './worldPersonality';
import { findWorldDef } from '../data/worldLoader';
import { isProfessionModuleEnabled } from '../gameplay/profession/featureGate';
import type { WorldDef } from '../data/worlds-schema';
import type { GameState } from '../schema/variables';
import { directorReviews, getSimulationEngine, registerDirectorActions, restoreEngineState } from '../simulation/SimulationApi';
import { resolveDirectorApiConfig } from '../director/apiConfig';
import { buildEncounterContext } from './encounterContext';
import { prepareGameplayState } from '../gameplay/statePreparation';
import { canRollbackCombat, normalizeGameStateV3, synchronizeV3FeatureFlagsForWorld } from '../gameplay/protocols';
import { PipelineExecutor, type PipelineResult } from './pipelineExecutor';
import { settleAcceptedTurn, type TurnSettlementInput } from './turnSettlement';
import { readTurnRecovery, recoverableMemoryContext, recoveryVersion, needsTurnRecovery, type TurnRecovery } from './turnRecovery';
import { TurnOperations, guardTurnMemory, detachTurnMemoryValue } from './turnSafety';
import { loadPipelineConfig, type PipelineConfig, type PipelineStatus, type PipelineTaskId } from './pipelineTypes';
import type { ChatMessage, GameEngine, SendMessageOptions, SendMessageOutcome } from './types';
import { PROMPT_INLINE_IMAGE } from '../data/builtinPresets';
import { DRC_FORMAT_REPAIR_PROMPT_ID } from '../data/presetDrcV12';
import { getPlayerDecisionContext } from '../modules/playerDecisionLog';
import { getNarrativeDecisionPromptSnapshot } from '../gameplay/narrativeDecision';
import { usePresetStore } from '../stores/presetStore';
import { STORAGE_KEYS } from '../config/storageKeys';
import { useImageStore } from '../stores/imageStore';
import { ROLE_COGNITION_FIREWALL_TITLE, ROLE_COGNITION_FIREWALL_CONTENT } from '../utils/roleCognitionFirewall';
import { assembleSystemPrompt, injectAtDepthEntries } from './promptAssembler';
import { MacroEngine } from './macroEngine';
import { useMemoryStore } from '../memory/memoryStore';
import { collectMemoryEntries } from '../memory/memoryCandidates';
import { useSimulationStore } from '../stores/simulationStore';
import { useSaveStore } from '../stores/saveStore';
import { formatSnapshotForMainAI } from '../utils/npcHelpers';
import type { MemoryPipelineContext } from '../memory/useMemorySystem';
import { buildModuleContextProjection } from '../gameplay/moduleRuntime/contextRouter';
import { resolvePreset } from '../api/presets';
import { apiPresetStore } from '../stores/apiPresetStore';
import { runCustomModuleTurnLifecycles } from '../custom-modules/engineBridge';
import { pinCustomModuleDefinitions } from '../custom-modules/saveDefinitions';
import {
  ensureWorldClockOnGameState,
  formatWorldClock,
  getTimeSystemFromWorld,
} from '../time/worldClock';
import { prepareWorldMechanics, commitWorldMechanics } from '../gameplay/worldMechanics';
import { isCombatFeatureEnabled, isCombatInteractionPaused, isCombatSaveEnded, preserveCombatOwnedState } from '../gameplay/combatRuntime';
import type { CombatCheckpointRestore } from '../gameplay/combatV2';
import { constrainPreCombatNarrative } from '../gameplay/combatNarrativeBoundary';
import { inferImmediateCombatEncounterRequest } from './variableExtraction';
import { formatDirectorDirective } from '../director/runtime';
import { evolutionFactVersion } from '../simulation/turnCoordinator';
import { canReviewCommittedTurn } from '../director/commitBarrier';
import {
  executeMemoryWrite,
  executeMemorySummary,
  executeMemoryVector,
  executeMemoryQueryRewrite,
  executeMemoryRetrievePlan,
  executeMemoryMultiRound,
  executeMemoryRerank,
  executeMemoryRetrieveFinalize,
  executeMemoryCompile,
  executeMemoryPrepareForMain,
  buildMemoryBatchText,
} from '../memory/memoryPipeline';

export type { ChatMessage, GameEngine };

/** 包装记忆管线任务，自动检测降级并抛出错误（消除 3 处重复代码） */
function withDegradationCheck(
  memCtx: MemoryPipelineContext,
  label: string,
  task: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const before = memCtx._degradedStages?.length ?? 0;
    await task();
    if ((memCtx._degradedStages?.length ?? 0) > before) {
      throw new Error(`[降级] ${label}失败，使用回退策略`);
    }
  };
}

/**
 * 格式化机械层效果摘要（供主 AI 上下文注入，避免双重叙事）
 * 只生成可读的文本描述，不暴露内部结构
 */
function formatMechanicalEffectsSummary(effects: import('../modules/schema').ModuleEffects): string {
  const lines: string[] = ['【世界演化 — 本轮已自动结算的确定性效果】'];

  if (effects.survival?.resources) {
    for (const [id, change] of Object.entries(effects.survival.resources)) {
      if (change.delta !== undefined) {
        lines.push(`- ${id} ${change.delta > 0 ? '+' : ''}${change.delta}`);
      } else if (change.set !== undefined) {
        lines.push(`- ${id} → ${change.set}`);
      }
    }
  }

  if (effects.business?.fundsDelta !== undefined) {
    const d = effects.business.fundsDelta;
    lines.push(`- 资金 ${d > 0 ? '+' : ''}${d}`);
  }

  if (effects.stats?.changes) {
    for (const [id, change] of Object.entries(effects.stats.changes)) {
      if (change.delta !== undefined) {
        lines.push(`- ${id} ${change.delta > 0 ? '+' : ''}${change.delta}`);
      } else if (change.set !== undefined) {
        lines.push(`- ${id} → ${change.set}`);
      }
    }
  }

  if (effects.progression) {
    if (effects.progression.xpDelta !== undefined) {
      const d = effects.progression.xpDelta;
      lines.push(`- 经验值 ${d > 0 ? '+' : ''}${d}`);
    }
  }

  if (lines.length <= 1) return '';
  lines.push('（这些变化已由系统自动处理，无需在正文中重复描述数值变化）');
  return lines.join('\n');
}

/** 构建记忆管线任务对象（消除 sendMessage/retryPipeline/retrySingleStage 三处重复） */
function buildMemoryTasks(
  memStore: ReturnType<typeof useMemoryStore.getState>,
  memCtx: MemoryPipelineContext,
  memConfig: { enabled: boolean; vectorEnabled?: boolean },
) {
  if (!memConfig.enabled) return undefined;
  return {
    write: async () => { await executeMemoryWrite(memStore, memCtx); },
    summary: async () => { await executeMemorySummary(memStore, memCtx); },
    vector: memConfig.vectorEnabled ? async () => { await executeMemoryVector(memStore, memCtx); } : undefined,
    queryRewrite: withDegradationCheck(memCtx, '查询改写', () => executeMemoryQueryRewrite(memStore, memCtx)),
    retrievePlan: withDegradationCheck(memCtx, '检索规划', () => executeMemoryRetrievePlan(memStore, memCtx)),
    multiRound: withDegradationCheck(memCtx, '多轮补充', () => executeMemoryMultiRound(memStore, memCtx)),
    rerank: withDegradationCheck(memCtx, '精排', () => executeMemoryRerank(memStore, memCtx)),
    retrieveFinalize: async () => { await executeMemoryRetrieveFinalize(memStore, memCtx); },
    compile: async () => { await executeMemoryCompile(memStore, memCtx); },
    debugLogger: (kind: string, message: string) => {
      memStore.appendWriteDebugLog({ kind: `error_${kind}`, message, timestamp: Date.now() });
    },
  };
}

/** 保存变量快照 + 记忆检查点 + 世界演化快照到消息（消除三处快照保存重复） */
function saveSnapshot(
  varMgrRef: React.RefObject<VariableManager>,
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void,
  aiMsgId: string,
  msgIndex: number,
  gameTime?: string,
  retainedMessages: readonly ChatMessage[] = [],
) {
  try {
    const snapshot = varMgrRef.current.createSnapshot();
    const memStoreForCheckpoint = useMemoryStore.getState();
    const memCheckpoint = memStoreForCheckpoint.createCheckpoint(retainedMessages.flatMap(m => m.memoryCheckpointId ? [m.memoryCheckpointId] : []));

    // 创建世界演化引擎快照
    let simulationSnapshotId: string | undefined;
    try {
      const simEngine = getSimulationEngine();
      const simSnapshot = simEngine.createSnapshot(
        msgIndex,
        gameTime || '',
        false,
        undefined,
        retainedMessages.flatMap(m => m.simulationSnapshotId ? [m.simulationSnapshotId] : []),
      );
      simulationSnapshotId = simSnapshot.id;
    } catch (simErr) {
      console.warn('[快照] 世界演化快照创建失败（不影响正文）:', simErr);
    }

    updateMessage(aiMsgId, {
      snapshot,
      snapshotTime: Date.now(),
      memoryCheckpointId: memCheckpoint?.id,
      simulationSnapshotId,
    });
  } catch (snapErr: any) {
    console.warn('[快照] 创建失败（不影响正文）:', snapErr.message);
  }
}

export function useGameEngine(
  apiConfig: ApiConfig | null,
  initialVarMgr?: VariableManager,
  selectedWorld: string = 'default',
  playerProfile?: PlayerProfile | null,
  characterHistory?: string,
  onAutoSave?: () => void,
): GameEngine {
  const { DialogUI, alert: dlgAlert } = useDialog();
  const [messages, setMessagesState] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  // Save capture and cancellation read the same message version as the writer,
  // without waiting for React to render or for an effect to mirror it.
  const setMessages = useCallback((value: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
    const next = typeof value === 'function' ? value(messagesRef.current) : value;
    messagesRef.current = next;
    setMessagesState(next);
  }, []);
  const sendMessageRef = useRef<((text: string, options?: SendMessageOptions) => Promise<void>) | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  // 防止双击/同步多次触发 sendMessage 的 ref 守卫
  const generatingRef = useRef(false);
  const generationWaiters = useRef(new Set<() => void>());
  const finishGeneration = useCallback(() => {
    generatingRef.current = false;
    for (const resolve of generationWaiters.current) resolve();
    generationWaiters.current.clear();
  }, []);
  const varMgrRef = useRef(initialVarMgr || new VariableManager(undefined, undefined, getTimeSystemFromWorld(findWorldDef(selectedWorld))));
  const cancelRef = useRef<AbortController | null>(null);
  const operationsRef = useRef(new TurnOperations());
  const roundRef = useRef(0);
  const seqRef = useRef(0);  // 消息序号，单调递增
  const worldBookRef = useRef<WorldBookManager | null>(null);
  const initializedRef = useRef(false);
  // 全局初始快照（参考项目的 initialSnapshot，用于回滚兜底）
  const initialSnapshotRef = useRef<unknown>(null);
  // 全局初始记忆快照（用于记忆系统回滚兜底）
  type MemorySnapshot = ReturnType<ReturnType<typeof useMemoryStore.getState>['toJSON']>;
  const initialMemorySnapshotRef = useRef<MemorySnapshot | null>(null);
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
  const pendingRecoveryRef = useRef<TurnRecovery | null>(null);
  const playerProfileRef = useRef(playerProfile ?? null);
  const characterHistoryRef = useRef(characterHistory ?? '');
  const onAutoSaveRef = useRef(onAutoSave);
  const selectedWorldRef = useRef(selectedWorld);
  const latestCommittedTurnIdRef = useRef('');
  const activeWorldDefRef = useRef<WorldDef | undefined>(findWorldDef(selectedWorld));
  const getActiveWorldDef = () => {
    const worldId = selectedWorldRef.current;
    return activeWorldDefRef.current?.id === worldId ? activeWorldDefRef.current : findWorldDef(worldId);
  };
  const saveLifecycleRef = useRef<'active' | 'ended'>('active');
  const isSaveReadOnly = () => saveLifecycleRef.current === 'ended' || isCombatSaveEnded(varMgrRef.current.getState());
  useEffect(() => { selectedWorldRef.current = selectedWorld; }, [selectedWorld]);
  useEffect(() => {
    activeWorldDefRef.current = findWorldDef(selectedWorld);
    varMgrRef.current.setWorldClockConfig(getTimeSystemFromWorld(findWorldDef(selectedWorld)));
  }, [selectedWorld]);
  // 存储最后一轮管线执行器实例（用于单步重试）
  const lastExecutorRef = useRef<PipelineExecutor | null>(null);
  // 存储最后一轮管线执行上下文（用于重试管线）
  const lastPipelineCtxRef = useRef<{
    round: number;
    userText: string;
    aiMsgId: string;
    batchText: string;
    recentContext: string;
    playerName: string;
    manager: VariableManager;
    worldId: string;
    saveId: string | null;
    memCtx: MemoryPipelineContext;
    stateVersion?: string;
    memoryVersion?: string;
    recoveryRawText?: string;
    pipelineConfig: PipelineConfig;
    apiConfig: ApiConfig;
    settle?: (result: PipelineResult) => void;
    settlement?: TurnSettlementInput;
  } | null>(null);

  const clearTurnRecovery = () => {
    operationsRef.current.invalidate();
    cancelRef.current = null;
    lastExecutorRef.current = null;
    lastPipelineCtxRef.current = null;
    pendingRecoveryRef.current = null;
    latestCommittedTurnIdRef.current = '';
    directorReviews.invalidate();
    directorReviews.setForegroundBusy(false);
    setPipelineStatus(null);
  };
  useEffect(() => () => operationsRef.current.invalidate(), []);

  useEffect(() => { playerProfileRef.current = playerProfile ?? null; }, [playerProfile]);
  useEffect(() => { characterHistoryRef.current = characterHistory ?? ''; }, [characterHistory]);
  useEffect(() => { onAutoSaveRef.current = onAutoSave; }, [onAutoSave]);
  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);
  const memoryRecoveryVersion = () => {
    const { memoryRuntime, vectorMemory } = useMemoryStore.getState().toJSON();
    return recoveryVersion({ memoryRuntime, vectorMemory });
  };
  const captureTurnRecovery = () => {
    const ctx = lastPipelineCtxRef.current, executor = lastExecutorRef.current;
    if (!ctx?.settlement || !executor || varMgrRef.current !== ctx.manager
      || selectedWorldRef.current !== ctx.worldId || useSaveStore.getState().currentSaveId !== ctx.saveId) return;
    const result = { mainResult: executor.getMainResult(), status: executor.getStatus() };
    const message = messagesRef.current.find(item => item.id === ctx.aiMsgId);
    if (!message) return;
    // Recovery is usable only after an accepted narrative. Completed turns must
    // not serialize the entire state and memory again on every save capture.
    if (!needsTurnRecovery(result, ctx.pipelineConfig, ctx.settlement)) {
      if (message.turnRecovery) updateMessage(ctx.aiMsgId, { turnRecovery: undefined });
      return;
    }
    if (result.status.stages.main.status !== 'success') return;
    ctx.stateVersion = recoveryVersion(ctx.manager.getState());
    ctx.memoryVersion = memoryRecoveryVersion();
    ctx.recoveryRawText = message.rawText;
    updateMessage(ctx.aiMsgId, { turnRecovery: needsTurnRecovery(result, ctx.pipelineConfig, ctx.settlement) ? structuredClone({
      version: 1, worldId: ctx.worldId, saveId: ctx.saveId, aiMsgId: ctx.aiMsgId, round: ctx.round,
      userText: ctx.userText, rawText: message.rawText, stateVersion: ctx.stateVersion, memoryVersion: ctx.memoryVersion,
      config: ctx.pipelineConfig, result, memory: recoverableMemoryContext(ctx.memCtx), settlement: ctx.settlement,
    } satisfies TurnRecovery) : undefined });
  };
  const reviewCommittedTurn = useCallback(async (turn: { turnId: string; round: number; narrative: string; playerInput?: string; canReview: () => boolean; signal?: AbortSignal }, backgroundOnly = false) => {
    const world = getActiveWorldDef();
    if (!world || !apiConfig || isSaveReadOnly()) return;
    const reviewManager = varMgrRef.current;
    const reviewEngine = getSimulationEngine();
    const reviewSaveId = useSaveStore.getState().currentSaveId ?? 'unsaved';
    latestCommittedTurnIdRef.current = turn.turnId;
    directorReviews.setForegroundBusy(false);
    await directorReviews.run({
      ...turn, engine: reviewEngine, world, config: await resolveDirectorApiConfig(apiConfig),
      saveId: reviewSaveId,
      isCurrentOwner: () => varMgrRef.current === reviewManager && getSimulationEngine() === reviewEngine,
      getState: () => reviewManager.getState(), commitState: state => reviewManager.setState(state),
      currentSaveId: () => useSaveStore.getState().currentSaveId ?? 'unsaved',
      currentWorldId: () => selectedWorldRef.current, latestTurnId: () => latestCommittedTurnIdRef.current,
      getDirectorMemories: () => {
        const runtime = useMemoryStore.getState().memoryRuntime;
        return runtime ? collectMemoryEntries(runtime, 'director').map(fact => ({
          id: fact.id, text: fact.summary, confidence: fact.confidence, provenance: fact.sourceEventIds?.join(','), layer: fact.layer,
          visibility: fact.visibility === 'offscreen' || fact.visibility === 'restricted' ? 'reader_only' as const : 'foreground' as const,
        })) : [];
      },
      getOffscreenMemoryPort: () => ({
        appendAcceptedEvent: receipt => useMemoryStore.getState().appendAcceptedExternalEvent({ ...receipt, round: turn.round }),
        hasOffscreenFact: key => Boolean(useMemoryStore.getState().memoryRuntime?.sourceEvents.some(event => event.id === `external:${key}`)),
      }),
      onCommitted: () => { useSimulationStore.getState().syncFromEngine(getSimulationEngine().state); onAutoSaveRef.current?.(); },
      onMainlineBusy: busy => useSimulationStore.getState().setMainlineReviewing(busy),
      onBackgroundBusy: busy => useSimulationStore.getState().setBackgroundReviewing(busy),
      onBackgroundError: message => useSimulationStore.getState().setLastError(message),
    }, { backgroundOnly });
  }, [apiConfig]);
  const retryDirectorReview = useCallback(async (backgroundOnly: boolean) => {
    if (generatingRef.current || isSaveReadOnly()) return;
    const manager = varMgrRef.current;
    const saveId = useSaveStore.getState().currentSaveId;
    const worldId = selectedWorldRef.current;
    const pending = getSimulationEngine().state.director?.pendingReview;
    const latest = messagesRef.current.filter(message => message.role === 'assistant').at(-1);
    if (!pending) {
      await (backgroundOnly ? directorReviews.retryBackground() : directorReviews.retryMainline());
    } else {
      if (pending.saveId !== saveId || pending.worldId !== worldId || latest?.id !== pending.turnId) {
        useSimulationStore.getState().setLastError('待核对回合与当前存档不一致，请恢复对应回合后重试。'); return;
      }
      const canReview = () => lastPipelineCtxRef.current?.aiMsgId === pending.turnId && lastExecutorRef.current
        ? canReviewCommittedTurn(lastExecutorRef.current.getStatus()) : pending.writesCommitted;
      if (!canReview()) { useSimulationStore.getState().setLastError('该回合的变量或记忆写入尚未完成，请先补交失败步骤；刷新后可回滚重发该回合。'); return; }
      const index = messagesRef.current.findIndex(message => message.id === pending.turnId);
      const playerInput = messagesRef.current.slice(0, index).findLast(message => message.role === 'user')?.rawText;
      await reviewCommittedTurn({ turnId: pending.turnId, round: pending.round, narrative: extractContentForPrompt(latest.rawText), playerInput, canReview }, backgroundOnly);
    }
    // A manual review can commit offscreen facts after the original turn snapshot.
    // Refresh all three checkpoint references together, only while this turn still owns the save.
    if (latest && !generatingRef.current && !isSaveReadOnly() && varMgrRef.current === manager
      && useSaveStore.getState().currentSaveId === saveId && selectedWorldRef.current === worldId
      && messagesRef.current.filter(message => message.role === 'assistant').at(-1)?.id === latest.id) {
      saveSnapshot(varMgrRef, updateMessage, latest.id, latest.round, manager.getState().世界.时间系统.当前时间, messagesRef.current);
      onAutoSaveRef.current?.();
    }
  }, [reviewCommittedTurn, updateMessage]);
  useEffect(() => registerDirectorActions({
    mainline: () => retryDirectorReview(false),
    background: () => retryDirectorReview(true),
  }), [retryDirectorReview]);

  // API 限流间隔同步
  useEffect(() => {
    if (apiConfig?.rateLimitMs) {
      setRateLimitInterval(apiConfig.rateLimitMs);
    }
  }, [apiConfig?.rateLimitMs]);

  // 辅助：应用世界
  const applyWorldAndModules = useCallback((wb: WorldBookManager, worldId: string) => {
    applyWorld(wb, worldId);
  }, []);

  useEffect(() => {
    loadWorldBook().then(wb => {
      worldBookRef.current = wb;
      if (wb && !initializedRef.current) {
        initializedRef.current = true;
        applyWorldAndModules(wb, selectedWorld);
      }
    });
  }, []);

  useEffect(() => {
    if (worldBookRef.current && initializedRef.current) {
      applyWorldAndModules(worldBookRef.current, selectedWorld);
    }
  }, [selectedWorld]);

  const addMessage = useCallback((msg: ChatMessage) => { setMessages(prev => [...prev, msg]); }, []);
  const removeMessage = useCallback((id: string) => {
    setMessages(prev => {
      const next = prev.filter(message => message.id !== id);
      messagesRef.current = next;
      return next;
    });
  }, []);
  // 辅助：回滚变量快照 + 记忆检查点 + 世界演化快照，并截断消息列表到指定索引
  const rollbackAndTruncate = useCallback((truncateAt: number) => {
    if (generatingRef.current || isSaveReadOnly()) return false;
    const combatSession = varMgrRef.current.getState().v3?.combatSession;
    if (!canRollbackCombat(combatSession?.riskMode ?? 'normal', combatSession?.lifecycle ?? 'active')) return false;
    const currentMessages = messagesRef.current;
    const rollback = resolveRollbackTarget(currentMessages, truncateAt);
    if (!rollback.ok) {
      void dlgAlert(`第 ${rollback.target.round} 轮的变量快照已被旧版清理，无法精确恢复。请选择仍有完整快照的回退层，或导入补全快照后的存档。`, { title: '无法精确回退' });
      return false;
    }

    // 1. 回滚变量快照
    clearTurnRecovery();
    if (rollback.target?.snapshot) {
      varMgrRef.current.restoreSnapshot(rollback.target.snapshot as GameState);
    } else if (initialSnapshotRef.current) {
      varMgrRef.current.restoreSnapshot(initialSnapshotRef.current as any);
    }
    // Historical message snapshots may predate the structured clock. Rebuild it
    // from this save's world definition immediately, not only on the next turn.
    const restoredState = varMgrRef.current.getState();
    ensureWorldClockOnGameState(restoredState, getActiveWorldDef());
    varMgrRef.current.setState(restoredState);

    // 2. 回滚记忆系统（带兜底：checkpoint 可能已被淘汰）
    const memStore = useMemoryStore.getState();
    let memRestored = false;
    for (let i = truncateAt - 1; i >= 0; i--) {
      if (currentMessages[i].memoryCheckpointId) {
        memRestored = memStore.restoreCheckpoint(currentMessages[i].memoryCheckpointId!);
        if (memRestored) break;
      }
    }
    // 兜底：如果所有 checkpoint 都失效，恢复到初始记忆状态
    if (!memRestored && initialMemorySnapshotRef.current) {
      memStore.fromJSON(initialMemorySnapshotRef.current);
    }
    memStore.clearPipelineOutputs();

    // 3. 回滚世界演化引擎
    try {
      const simEngine = getSimulationEngine();
      let simRestored = false;
      for (let i = truncateAt - 1; i >= 0; i--) {
        if (currentMessages[i].simulationSnapshotId) {
          simRestored = simEngine.restoreSnapshot(currentMessages[i].simulationSnapshotId!);
          if (simRestored) break;
        }
      }
      // 如果没有找到快照或恢复失败，不做额外处理（世界演化引擎有自己的持久化状态）
    } catch (simErr) {
      console.warn('[回滚] 世界演化引擎恢复失败（不影响其他系统）:', simErr);
    }

    // 4. 截断消息
    roundRef.current = rollback.round;
    seqRef.current = rollback.seq;
    lastExecutorRef.current = null;
    lastPipelineCtxRef.current = null;
    setPipelineStatus(null);
    messagesRef.current = rollback.retainedMessages;
    setMessages(rollback.retainedMessages);
    return true;
  }, [dlgAlert]);

  // 从快照面板执行完整回滚：状态、记忆、世界演化和后续消息一起回到该 AI 层。
  const rollbackToSnapshot = useCallback((msgIndex: number) => {
    if (generatingRef.current) return;
    if (isSaveReadOnly()) return;
    const combatSession = varMgrRef.current.getState().v3?.combatSession;
    if (!canRollbackCombat(combatSession?.riskMode ?? 'normal', combatSession?.lifecycle ?? 'active')) return;
    const currentMessages = messagesRef.current;
    const target = currentMessages[msgIndex];
    if (msgIndex < 0 || !target?.snapshot) return;

    clearTurnRecovery();
    varMgrRef.current.restoreSnapshot(target.snapshot as any);

    const memStore = useMemoryStore.getState();
    let memRestored = false;
    for (let i = msgIndex; i >= 0; i--) {
      const checkpointId = currentMessages[i]?.memoryCheckpointId;
      if (checkpointId) {
        memRestored = memStore.restoreCheckpoint(checkpointId);
        if (memRestored) break;
      }
    }
    if (!memRestored && initialMemorySnapshotRef.current) {
      memStore.fromJSON(initialMemorySnapshotRef.current);
    }
    memStore.clearPipelineOutputs();

    try {
      const simEngine = getSimulationEngine();
      for (let i = msgIndex; i >= 0; i--) {
        const snapshotId = currentMessages[i]?.simulationSnapshotId;
        if (snapshotId && simEngine.restoreSnapshot(snapshotId)) break;
      }
    } catch (simErr) {
      console.warn('[回滚] 世界演化引擎恢复失败（不影响其他系统）:', simErr);
    }

    const retainedMessages = currentMessages.slice(0, msgIndex + 1);
    roundRef.current = retainedMessages.reduce((max, message) => Math.max(max, message.round), 0);
    seqRef.current = retainedMessages.reduce((max, message) => Math.max(max, message.seq ?? 0), 0);
    lastExecutorRef.current = null;
    lastPipelineCtxRef.current = null;
    setPipelineStatus(null);
    setMessages(prev => {
      const truncated = prev.slice(0, msgIndex + 1);
      messagesRef.current = truncated;
      return truncated;
    });
    try { onAutoSaveRef.current?.(); } catch (error) {
      console.error('[回滚] 自动保存失败:', error);
    }
  }, []);

  // 辅助：构建记忆管线上下文（加载 preset、解析各阶段 API 配置）
  const buildMemoryContext = useCallback(async (
    floor: number, batchText: string, inputText: string,
    recentContext: string, playerName: string, mainApiConfig: ApiConfig,
  ): Promise<MemoryPipelineContext> => {
    const memStore = useMemoryStore.getState();
    const memConfig = memStore.config;
    const usesPreset = [memConfig.apiPresetId, memConfig.writePipeline.apiPresetId,
      memConfig.writePipeline.summaryApiPresetId, memConfig.writePipeline.conflictJudgeApiPresetId,
      memConfig.retrieval.plannerApiPresetId, memConfig.vectorExtractApiPresetId].some(Boolean);
    const presets = usesPreset ? await apiPresetStore.getPresets() : [];
    const defaultMemApi = { baseUrl: mainApiConfig.baseUrl, apiKey: mainApiConfig.apiKey, model: mainApiConfig.model };
    const memApiConfig = resolvePreset(presets, memConfig.apiPresetId) ?? defaultMemApi;

    // 提取资源状态快照（供记忆编译阶段注入 AI 上下文）
    const gs = varMgrRef.current.getState();
    const survivalRes = gs.玩家?.生存资源;
    const resourceState = survivalRes
      ? Object.entries(survivalRes).map(([id, r]) => ({
          id,
          name: r.name ?? id,
          symbol: r.symbol ?? '📦',
          amount: r.数量,
          max: r.最大值,
          scarce: r.scarce,
        }))
      : undefined;

    return {
      floor, batchText, inputText, recentContext, playerName,
      apiConfig: memApiConfig,
      writeApiConfig: resolvePreset(presets, memConfig.writePipeline.apiPresetId) ?? undefined,
      summaryApiConfig: resolvePreset(presets, memConfig.writePipeline.summaryApiPresetId) ?? undefined,
      conflictJudgeApiConfig: resolvePreset(presets, memConfig.writePipeline.conflictJudgeApiPresetId) ?? undefined,
      retrievalApiConfig: resolvePreset(presets, memConfig.retrieval.plannerApiPresetId) ?? undefined,
      vectorApiConfig: resolvePreset(presets, memConfig.vectorExtractApiPresetId) ?? undefined,
      resourceState,
    };
  }, []);

  // 删除消息：级联删除 + 回滚状态（用户消息连同后面的AI消息一起删）
  const deleteSingleMessage = useCallback((id: string) => {
    if (generatingRef.current || isSaveReadOnly()) return; // 生成中/封存存档禁止删除，防止状态不一致
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const msg = currentMessages[idx];

    // 确定要回滚到的用户消息索引
    let userIdx = idx;
    if (msg.role === 'assistant') {
      for (let i = idx - 1; i >= 0; i--) {
        if (currentMessages[i].role === 'user') { userIdx = i; break; }
      }
    }
    if (userIdx < 0 || currentMessages[userIdx]?.role !== 'user') return;

    rollbackAndTruncate(userIdx);
  }, [rollbackAndTruncate]);

  const editMessage = useCallback((id: string, content: string) => {
    if (isSaveReadOnly()) return;
    setMessages(prev => prev.map(m => m.id === id ? { ...m, rawText: content } : m));
  }, []);

  const resendFromMessage = useCallback(async (id: string) => {
    if (!apiConfig || generatingRef.current || isSaveReadOnly()) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const msg = currentMessages[idx];
    if (!msg || msg.role !== 'user') return;

    if (!rollbackAndTruncate(idx)) return;

    setTimeout(() => {
      sendMessageRef.current?.(getMessageContent(msg));
    }, 0);
  }, [apiConfig, rollbackAndTruncate]);

  // 从 AI 消息回滚并重新发送
  const resendFromAssistantMessage = useCallback(async (id: string) => {
    if (!apiConfig || generatingRef.current || isSaveReadOnly()) return;
    const currentMessages = messagesRef.current;
    const aiIdx = currentMessages.findIndex(m => m.id === id);
    if (aiIdx === -1) return;
    const aiMsg = currentMessages[aiIdx];
    if (!aiMsg || aiMsg.role !== 'assistant') return;

    // 找到这条 AI 消息之前的最近一条用户消息
    let userIdx = -1;
    for (let i = aiIdx - 1; i >= 0; i--) {
      if (currentMessages[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx === -1) return;
    const userMsg = currentMessages[userIdx];

    if (!rollbackAndTruncate(userIdx)) return;

    setTimeout(() => {
      sendMessageRef.current?.(getMessageContent(userMsg));
    }, 0);
  }, [apiConfig, rollbackAndTruncate]);

  const loadSave = useCallback((save: GameSave) => {
    if (generatingRef.current) throw new Error('当前旅程仍在处理，请停止并等待完成后再读取存档。');
    if (!save?.id || !save.worldId || !Array.isArray(save.messages) || !save.gameState) throw new Error('存档缺少完整的旅程状态，未替换当前旅程。');
    save = structuredClone(save);
    const saveWorldDef = (save.customWorld as WorldDef | undefined) ?? findWorldDef(save.worldId);
    const migratedClockState = ensureWorldClockOnGameState(save.gameState, saveWorldDef);
    const saveClockConfig = getTimeSystemFromWorld(saveWorldDef);
    const restoredManager = VariableManager.fromJSON({
      state: migratedClockState,
      saveId: save.id,
      moduleStates: save.moduleStates,
      moduleCheckpoints: save.moduleCheckpoints,
    }, saveClockConfig);
    const normalizedSaveState = ensureWorldClockOnGameState(restoredManager.getState(), saveWorldDef);
    if (save.customWorld) {
      try {
        const customs: Record<string, unknown>[] = JSON.parse(localStorage.getItem(STORAGE_KEYS.CUSTOM_WORLDS) || '[]');
        const customIndex = customs.findIndex((world: any) => world?.id === save.worldId);
        if (customIndex >= 0) customs[customIndex] = save.customWorld;
        else customs.push(save.customWorld);
        localStorage.setItem(STORAGE_KEYS.CUSTOM_WORLDS, JSON.stringify(customs));
      } catch { /* localStorage 不可用时仍保留本次存档内的迁移结果 */ }
    }
    const preparedGameplayState = prepareGameplayState(normalizeGameStateV3(normalizedSaveState), saveWorldDef?.modules, { mode: 'load' }).state;
    const preparedSaveState = synchronizeV3FeatureFlagsForWorld(preparedGameplayState, {
      professionsEnabled: isProfessionModuleEnabled(saveWorldDef),
      combatEnabled: saveWorldDef?.modules?.some(module => typeof module === 'string'
        ? module === 'combat'
        : module.moduleId === 'combat' && module.enabled) === true,
      fallbackRiskMode: save.personalInfo?.combatRiskMode ?? 'normal',
    });
    restoredManager.setState(preparedSaveState);
    restoredManager.setWorldClockConfig(saveClockConfig);
    clearTurnRecovery();
    saveLifecycleRef.current = save.lifecycle === 'ended' ? 'ended' : 'active';
    activeWorldDefRef.current = saveWorldDef;
    selectedWorldRef.current = save.worldId;
    playerProfileRef.current = save.personalInfo ?? null;
    characterHistoryRef.current = save.characterHistory ?? '';
    setMessages(save.messages);
    varMgrRef.current = restoredManager;
    // 恢复全局初始快照：优先从第一条消息的 snapshot 获取，否则用存档的 gameState
    const firstMsg = save.messages.find(m => m.snapshot);
    if (firstMsg?.snapshot) {
      initialSnapshotRef.current = ensureWorldClockOnGameState(firstMsg.snapshot as any, saveWorldDef);
    } else {
      initialSnapshotRef.current = varMgrRef.current.createSnapshot();
    }
    roundRef.current = save.messages.length > 0
      ? save.messages.reduce((max, m) => Math.max(max, m.round), 0)
      : 0;
    // 恢复消息序号（取最后一条消息的 seq）
    seqRef.current = save.messages.length > 0
      ? Math.max(...save.messages.map(m => m.seq ?? 0))
      : 0;
    if (save.worldId && worldBookRef.current) {
      applyWorldAndModules(worldBookRef.current, save.worldId);
    }
    // 先完全重置记忆系统，防止跨存档污染
    const memStore = useMemoryStore.getState();
    memStore.resetMemoryRuntime();
    memStore.clearPipelineOutputs();
    // 再从存档恢复记忆数据
    if (save.memoryRuntime || save.memoryConfig || save.vectorMemory) {
      memStore.fromJSON({
        memoryRuntime: save.memoryRuntime,
        config: save.memoryConfig,
        vectorMemory: save.vectorMemory,
      });
    }
    // 捕获记忆系统初始快照（用于回滚兜底）
    initialMemorySnapshotRef.current = memStore.toJSON();

    // 防御性补全运行时状态；当前 schema 允许该切片缺省。
    const gameState = varMgrRef.current.getState();
    ensureWorldClockOnGameState(gameState, saveWorldDef);
    varMgrRef.current.setState(gameState);
    if (!gameState.simulationRuntime) {
      const { createDefaultSimulationRuntimeState } = require('../modules/schema');
      gameState.simulationRuntime = createDefaultSimulationRuntimeState();
      varMgrRef.current.setState(gameState);
    }

    // 恢复变量提取 API 配置
    if (save.variableConfig?.apiPresetId) {
      localStorage.setItem(STORAGE_KEYS.VARIABLE_API_PRESET, save.variableConfig.apiPresetId);
    }
    // 恢复世界推演模拟状态
    if (save.simulationState) {
      restoreEngineState(save.simulationState);
    } else {
      // 当前存档未携带世界推演切片时直接清空，避免沿用另一个存档的内存状态。
      getSimulationEngine().reset();
    }
    const lastMessage = save.messages.filter(message => message.role === 'assistant').at(-1);
    const recovery = readTurnRecovery(lastMessage?.turnRecovery);
    if (recovery && recovery.aiMsgId === lastMessage?.id && recovery.rawText === lastMessage.rawText
      && recovery.worldId === save.worldId && recovery.saveId === save.id
      && recovery.stateVersion === recoveryVersion(varMgrRef.current.getState())
      && recovery.memoryVersion === memoryRecoveryVersion()) {
      pendingRecoveryRef.current = recovery;
      const restored = new PipelineExecutor(recovery.round, { onUpdate: () => {} }, recovery.result);
      setPipelineStatus(restored.getStatus());
    }
  }, []);

  const restoreCombatCheckpoint = useCallback((restore: CombatCheckpointRestore, saveId?: string) => {
    if (isSaveReadOnly()) return;
    if (generatingRef.current) throw new Error('请先停止当前回合，再恢复战斗检查点。');
    clearTurnRecovery();
    if (restore.gameState) {
      varMgrRef.current = VariableManager.fromJSON({
        state: restore.gameState,
        saveId: saveId ?? localStorage.getItem(STORAGE_KEYS.ACTIVE_SAVE) ?? undefined,
        moduleStates: restore.moduleStates,
        moduleCheckpoints: restore.moduleCheckpoints,
      }, getTimeSystemFromWorld(getActiveWorldDef()));
    }
    if (restore.messages) {
      setMessages(restore.messages);
      messagesRef.current = restore.messages;
      roundRef.current = restore.messages.reduce((max, message) => Math.max(max, message.round), 0);
      seqRef.current = restore.messages.reduce((max, message) => Math.max(max, message.seq ?? 0), 0);
    }
    if (restore.memoryRuntime !== undefined || restore.vectorMemory !== undefined) {
      const memStore = useMemoryStore.getState();
      memStore.fromJSON({ memoryRuntime: restore.memoryRuntime, vectorMemory: restore.vectorMemory });
      initialMemorySnapshotRef.current = memStore.toJSON();
    }
    if (restore.worldSimulationState) restoreEngineState(restore.worldSimulationState);
    lastExecutorRef.current = null;
    lastPipelineCtxRef.current = null;
  }, []);

  const sendMessage = useCallback(async (userText: string, options: SendMessageOptions = {}) => {
    const internalContinuation = Boolean(options.combatContinuation);
    if (isSaveReadOnly() && !internalContinuation) {
      options.onComplete?.({ success: false, error: '此存档已封存为只读，不能继续旅程或发送正文' });
      return;
    }
    if (!apiConfig || generatingRef.current || !userText.trim()) {
      options.onComplete?.({ success: false, error: !apiConfig ? 'API 配置缺失' : '当前不可发送正文' });
      return;
    }
    if (!internalContinuation && isCombatInteractionPaused(varMgrRef.current.getState())) {
      options.onComplete?.({ success: false, error: '战斗进行中，普通聊天已暂停' });
      return;
    }

    generatingRef.current = true;
    setIsGenerating(true);
    if (!internalContinuation) directorReviews.setForegroundBusy(true);
    roundRef.current++;
    const round = roundRef.current;
    const displayUserMessage = options.displayUserMessage !== false;
    let completion: SendMessageOutcome = { success: false };

    // 分配消息序号（单调递增，用于增量存档）
    const userSeq = displayUserMessage ? ++seqRef.current : 0;
    seqRef.current++;
    const aiSeq = seqRef.current;

    const userMsg: ChatMessage = { id: uuid(), role: 'user', rawText: userText, round, timestamp: Date.now(), seq: userSeq };
    if (displayUserMessage) {
      addMessage(userMsg);
      eventBus.emit(EVENTS.MESSAGE_SENT, userMsg);
    }

    const aiMsgId = uuid();
    const aiMsg: ChatMessage = { id: aiMsgId, role: 'assistant', rawText: '', round, timestamp: Date.now(), streaming: true, seq: aiSeq };
    addMessage(aiMsg);
    eventBus.emit(EVENTS.GENERATION_STARTED, aiMsgId);

    const controller = operationsRef.current.begin();
    cancelRef.current = controller;
    const manager = varMgrRef.current;
    const worldId = selectedWorldRef.current;
    const saveId = useSaveStore.getState().currentSaveId;
    const ownsTurn = () => operationsRef.current.owns(controller) && varMgrRef.current === manager && selectedWorldRef.current === worldId;
    const isCurrent = () => ownsTurn() && operationsRef.current.accept(controller) && useSaveStore.getState().currentSaveId === saveId;
    const assertCurrent = () => { if (!isCurrent()) throw new DOMException('回合已停止或旅程已切换', 'AbortError'); };
    const updateTurnMessage = (updates: Partial<ChatMessage>) => { if (isCurrent()) updateMessage(aiMsgId, updates); };
    const narrativeDecisionRequest: { saveId: string; decisionIds: string[] } = {
      saveId: saveId ?? 'default',
      decisionIds: [],
    };

    // 创建管线执行器
    const pipelineConfig = loadPipelineConfig();
    // 统一记忆系统启用状态：使用 memoryStore 的配置
    const memStoreForConfig = useMemoryStore.getState();
    pipelineConfig.memoryEnabled = memStoreForConfig.config.enabled;
    const executor = new PipelineExecutor(round, {
      onUpdate: () => {
        if (!ownsTurn()) return;
        const status = executor.getStatus();
        setPipelineStatus({ ...status, stages: { ...status.stages } });
        // The auto-save builder prepares recovery once for this checkpoint.
        if (!onAutoSaveRef.current) captureTurnRecovery();
        if (status.stages.main.status === 'success') onAutoSaveRef.current?.();
        eventBus.emit(EVENTS.PIPELINE_UPDATE, status);
      },
    });
    setPipelineStatus(executor.getStatus());
    lastExecutorRef.current = executor;

    try {
      options.onAccepted?.();
      // Guarantee the authority boundary even for old/injected managers that did
      // not pass through reset() or loadSave() before their first turn.
      const turnStartState = varMgrRef.current.getState();
      ensureWorldClockOnGameState(turnStartState, getActiveWorldDef());
      varMgrRef.current.setState(turnStartState);
      const definitionVersion = recoveryVersion(manager.getState());
      const definitionDraft = structuredClone(manager.getState());
      await pinCustomModuleDefinitions(definitionDraft, worldId);
      assertCurrent();
      if (recoveryVersion(manager.getState()) !== definitionVersion) throw new DOMException('模块加载期间旅程状态已变化', 'AbortError');
      manager.setState(definitionDraft);

      // 使用管线执行器运行执行链
      // ── 记忆系统任务 ──
      const memStore = guardTurnMemory(useMemoryStore.getState(), isCurrent, useMemoryStore.getState);
      const memConfig = memStore.config;

      const playerName = playerProfileRef.current?.name || '冒险者';
      const batchText = buildMemoryBatchText(userText, '');
      const recentContext = sanitizeForContext(messagesRef.current, round)
        .slice(-6)
        .map(m => m.content || '')
        .join('\n\n');

      const memCtx = await buildMemoryContext(round, batchText, userText, recentContext, playerName, apiConfig);
      assertCurrent();
      memCtx.signal = controller.signal;

      // 保存管线上下文（用于重试管线）
      lastPipelineCtxRef.current = { round, userText, aiMsgId, batchText, recentContext, playerName, manager, worldId, saveId, memCtx, pipelineConfig, apiConfig: { ...apiConfig } };

      // ── 世界演化机械层：确定性结算先于正文，AI 后台审查在正文成功提交后启动 ──
      let mechanicalEffectsSummary = '';
      let mechanicalTickSettled = false;
      if (!internalContinuation) try {
        const simEngine = getSimulationEngine();
        const activeWorldId = selectedWorldRef.current;
        const currentWorldDef = getActiveWorldDef();
        const gs = structuredClone(varMgrRef.current.getState());
        const gameTime = { current: gs.世界?.时间系统?.当前时间 ?? '' };
        const settlement = await prepareWorldMechanics(simEngine, {
          gameState: gs, world: currentWorldDef, round, turnId: aiMsgId,
        });
        assertCurrent();
        if (settlement.settled) {
          mechanicalTickSettled = true;
          varMgrRef.current.setState(settlement.gameState);
          if (settlement.mechanicalEffects && Object.keys(settlement.mechanicalEffects).length > 0) {
            const enabledModules = (currentWorldDef?.modules ?? []).filter(m => m.enabled).map(m => m.moduleId);
            varMgrRef.current.applyModuleEffects(settlement.mechanicalEffects, 'periodic', enabledModules);
            mechanicalEffectsSummary = formatMechanicalEffectsSummary(settlement.mechanicalEffects);
          }
          if (await commitWorldMechanics(simEngine, settlement, isCurrent)) {
            assertCurrent();
            useSimulationStore.getState().syncFromEngine(simEngine.state);
          }
          eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
        }

      } catch (simErr) {
        assertCurrent();
        console.warn('[世界演化] 本地机械结算失败（不影响正文管线）:', simErr);
      }

      // 正文生成前按本轮输入刷新记忆上下文；不再使用上一轮的检索结果回答当前问题。
      if (memConfig.enabled) {
        try {
          await executeMemoryPrepareForMain(memStore, memCtx);
        } catch (memoryPrepareError) {
          assertCurrent();
          console.warn('[记忆系统] 本轮发送前准备失败，正文将使用现有热态记忆:', memoryPrepareError);
        }
      }
      assertCurrent();

      const progressionBaseline = {
        tierIndex: varMgrRef.current.getState().玩家.当前段位索引 ?? 0,
        currentXP: varMgrRef.current.getState().玩家.当前经验值 ?? 0,
      };
      const combatWorld = getActiveWorldDef();
      const graphicalCombatEnabled = !internalContinuation
        && isCombatFeatureEnabled(varMgrRef.current.getState())
        && combatWorld?.modules?.some(module => typeof module === 'string'
          ? module === 'combat'
          : module.moduleId === 'combat' && module.enabled) === true;
      let boundaryEncounter: ReturnType<typeof inferImmediateCombatEncounterRequest>;
      const applyCombatBoundary = (candidateText: string): string => {
        if (!graphicalCombatEnabled || !candidateText.trim()) return candidateText;
        const bounded = constrainPreCombatNarrative(candidateText, userText);
        if (!bounded.triggered) return candidateText;
        const encounter = inferImmediateCombatEncounterRequest(
          userText,
          extractContentForPrompt(candidateText),
          varMgrRef.current.getState(),
          round,
          { allowResolved: true },
        );
        if (!encounter) return candidateText;
        boundaryEncounter = encounter;
        if (lastPipelineCtxRef.current?.settlement) lastPipelineCtxRef.current.settlement.encounter = encounter;
        return bounded.text;
      };
      const settlement: TurnSettlementInput = { world: structuredClone(getActiveWorldDef()), progressionBaseline, narrativeDecisionRequest,
        internalContinuation, protectedState: options.combatContinuation?.protectedState, mechanicalTickSettled, done: false };
      const settle = (pipelineResult: PipelineResult) => {
        if (settlement.done || pipelineResult.status.stages.main.status !== 'success' || !pipelineResult.mainResult?.parsed.content?.trim()) return;
        if (pipelineConfig.variableEnabled && !['success', 'skipped'].includes(pipelineResult.status.stages.variable.status)) return;
        const accepted = settleAcceptedTurn(manager.getState(), settlement, pipelineResult, aiMsgId, round, userText);
        manager.setState(accepted.state);
        settlement.done = true;
        eventBus.emit(EVENTS.TURN_SETTLED, manager, accepted.changeLog);
        if (boundaryEncounter) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, boundaryEncounter);
        eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
      };
      lastPipelineCtxRef.current!.settlement = settlement;
      lastPipelineCtxRef.current!.settle = settle;

      const pipelineResult = await executor.execute({
        config: pipelineConfig,
        signal: controller.signal,
        isCurrent,
        onMainAccepted: () => { if (isCurrent()) eventBus.emit(EVENTS.MESSAGE_RECEIVED, aiMsgId); },
        varMgr: varMgrRef.current,
        worldBook: worldBookRef.current,
        userText,
        mainApiConfig: apiConfig,
        worldId: selectedWorldRef.current,

        settlementTask: result => completeTurnSettlement(result, isCurrent),

        // 记忆系统任务集
        memoryTasks: buildMemoryTasks(memStore, memCtx, memConfig),

        // main 任务：正文生成
        mainTask: async () => {
          assertCurrent();
          const narrativeVersion = JSON.stringify(manager.getState());
          const assertNarrativeCurrent = () => {
            assertCurrent();
            if (JSON.stringify(manager.getState()) !== narrativeVersion) throw new Error('正文生成期间游戏状态已变化，请回滚重发该回合。');
          };
          // ── 构建系统提示词（v2.0 结构化预设 + 宏引擎） ──
          const worldDefForPrompt = getActiveWorldDef();
          const clockConfigForPrompt = getTimeSystemFromWorld(worldDefForPrompt);
          const stateAtTurnStart = varMgrRef.current.getState();
          ensureWorldClockOnGameState(stateAtTurnStart, worldDefForPrompt);
          const turnStartClock = stateAtTurnStart.世界.时间系统.时钟!;
          const moduleProjection = buildModuleContextProjection({
            state: varMgrRef.current.createSafeSnapshotForPrompt(),
            worldDef: worldDefForPrompt,
            userText,
            target: 'main',
          });
          const coreSnapshot = formatSnapshotForMainAI(moduleProjection.state, clockConfigForPrompt);
          const varSnapshot = moduleProjection.summary
            ? `${coreSnapshot}\n### 【模块概览】\n> ${moduleProjection.summary}${moduleProjection.professionDetail ? `\n### 【当前职业】\n${moduleProjection.professionDetail}` : ''}`
            : coreSnapshot;

          // 世界书注入（v2 扫描引擎：支持正则关键词、选择逻辑、递归扫描、分组互斥）
          let wbInjection = '';
          const atDepthEntries: Array<{ depth: number; content: string }> = [];
          if (worldBookRef.current) {
            // 构建聊天历史供扫描引擎使用
            const scanHistory = messagesRef.current.map(m => ({
              role: m.role,
              content: getMessageContent(m),
            }));
            const scanResult = worldBookRef.current.scanAndBuildInjection(scanHistory, userText);
            if (scanResult.beforeChar) wbInjection += scanResult.beforeChar + '\n\n';
            if (scanResult.afterChar) wbInjection += scanResult.afterChar + '\n\n';
            atDepthEntries.push(...scanResult.atDepthEntries);
          }

          // 玩家角色设定注入
          let playerProfileBlock = '';
          if (playerProfileRef.current?.name) {
            const perspectiveMap: Record<string, string> = {
              '第一人称': '请用第二人称"你"来称呼玩家，描写玩家的内心感受和第一视角体验。',
              '第二人称': '请用第二人称"你"来称呼玩家。',
              '第三人称': '请用第三人称称呼玩家角色。',
            };
            const perspectiveInstruction = perspectiveMap[playerProfileRef.current.perspective || '第三人称'] || perspectiveMap['第三人称'];

            let customNpcsBlock = '';
            if (playerProfileRef.current.customNpcs && playerProfileRef.current.customNpcs.length > 0) {
              const npcLines = playerProfileRef.current.customNpcs.map(npc => {
                const parts = [npc.name];
                if (npc.gender) parts.push(`${npc.gender}`);
                if (npc.age) parts.push(`${npc.age}岁`);
                if (npc.race) parts.push(npc.race);
                if (npc.relationshipType) parts.push(`关系：${npc.relationshipType}`);
                if (npc.personality) parts.push(`性格：${npc.personality}`);
                if (npc.appearance) parts.push(`外貌：${npc.appearance}`);
                if (npc.background) parts.push(`背景：${npc.background}`);
                return `- ${parts.join('，')}`;
              }).join('\n');
              customNpcsBlock = `
自建NPC（玩家的初始关联角色，必须在游戏中以该身份登场）：
${npcLines}
人物档案中已预置这些NPC的完整数据，请直接使用。`;
            }

            playerProfileBlock = `
<PlayerProfile>
玩家角色设定（最高优先级，必须严格遵守）：
- 姓名：${playerProfileRef.current.name}
- 性别：${playerProfileRef.current.gender || '未设定'}
- 年龄：${playerProfileRef.current.age || '未设定'}
- 性格：${playerProfileRef.current.personality || '未设定'}
- 外貌：${playerProfileRef.current.appearance || '未设定'}
- 背景描述：${playerProfileRef.current.background || '无'}
- 职业：${playerProfileRef.current.career || '未设定'}
- 叙事视角：${playerProfileRef.current.perspective || '第三人称'}
${characterHistoryRef.current ? `- 角色经历：\n${characterHistoryRef.current}` : ''}
${customNpcsBlock}
在故事开始时，玩家应以此身份登场。NPC 应以该角色的姓名和身份进行称呼和互动。
使用技能时，必须严格遵循技能描述中的效果，不要自行编造技能功能。
${perspectiveInstruction}
</PlayerProfile>
`;
          }

          // 获取上一次编译的记忆上下文（如果有）
          const compiledMemoryContext = memStore.lastCompiledContext?.fullText || '';

          // 剧情导演只注入未来意图；确定性机械效果单独标为已结算事实。
          const simEngine = getSimulationEngine();
          let directorBrief = '';
          try {
            const parts: string[] = [];
            const directorWorld = getActiveWorldDef();
            const directorSaveId = useSaveStore.getState().currentSaveId ?? 'unsaved';
            const directorManager = varMgrRef.current;
            const directorState = structuredClone(directorManager.getState());
            const directorVersion = evolutionFactVersion(directorState);
            const runtime = useMemoryStore.getState().memoryRuntime;
            const previousNarrative = [...messagesRef.current].reverse().find(message => message.role === 'assistant' && message.id !== aiMsgId && message.rawText?.trim());
            const directorConfig = !internalContinuation && directorWorld ? await resolveDirectorApiConfig(apiConfig) : apiConfig;
            assertCurrent();
            const directive = !internalContinuation && directorWorld && apiConfig ? await directorReviews.prepareForTurn({
              engine: simEngine, world: directorWorld, config: directorConfig, turnId: aiMsgId, signal: controller.signal,
              context: { saveId: directorSaveId, worldId: directorWorld.id, completedTurnId: latestCommittedTurnIdRef.current || 'initial', stateVersion: directorVersion,
                playerInput: userText, narrative: previousNarrative ? extractContentForPrompt(previousNarrative.rawText ?? '') : '', variableProjection: directorState,
                memories: runtime ? collectMemoryEntries(runtime, 'director').map(fact => ({ id: fact.id, text: fact.summary, provenance: fact.sourceEventIds?.join(','), layer: fact.layer, confidence: fact.confidence })) : [],
              },
              isCurrent: () => isCurrent() && varMgrRef.current === directorManager && (useSaveStore.getState().currentSaveId ?? 'unsaved') === directorSaveId && selectedWorldRef.current === directorWorld.id && evolutionFactVersion(directorManager.getState()) === directorVersion,
              onDegraded: message => useSimulationStore.getState().setLastError(message),
            }) : undefined;
            const directiveText = formatDirectorDirective(directive);
            if (directiveText) parts.push(directiveText);
            const encounterContext = buildEncounterContext(directorState, [directive?.primary, ...(directive?.secondary ?? [])].flatMap(item => item?.participants ?? []));
            if (encounterContext) parts.push(encounterContext);
            if (mechanicalEffectsSummary) {
              parts.push(`【玩法机械 — 本轮已自动结算的确定性效果】\n${mechanicalEffectsSummary}`);
            }
            directorBrief = parts.join('\n\n');
          } catch (error) {
            assertCurrent();
            useSimulationStore.getState().setLastError(`本轮导演指导未生成：${error instanceof Error ? error.message : String(error)}`);
          }
          assertNarrativeCurrent();

          // 使用结构化预设 + 宏引擎组装系统提示
          // getActivePreset() 已处理：用户自定义预设 / 内置预设 + 覆盖层 / 默认回退
          // 注入玩家决策记录（选择卡路径 C）：取最近若干 aiNote 作为下一轮叙事上下文
          const decisionSnapshot = getNarrativeDecisionPromptSnapshot(
            varMgrRef.current.getState(),
            narrativeDecisionRequest.saveId,
          );
          narrativeDecisionRequest.decisionIds = decisionSnapshot.decisionIds;
          const playerDecisionContext = [getPlayerDecisionContext(), decisionSnapshot.context]
            .filter(Boolean).join('\n\n');

          let preset = usePresetStore.getState().getActivePreset();
          // 叠加正文生图指令（独立于预设，当 inlineImageEnabled 时始终注入）
          const imageConfig = useImageStore.getState().config;
          if (imageConfig.inlineImageEnabled) {
            const hasInlineImage = preset.prompts.some(p => p.identifier === 'inline_image_gen');
            if (!hasInlineImage) {
              const inlineImageContent = imageConfig.inlineImagePromptTemplate?.trim() || PROMPT_INLINE_IMAGE;
              preset = {
                ...preset,
                prompts: [...preset.prompts, {
                  identifier: 'inline_image_gen',
                  name: '正文生图标签',
                  role: 'system' as const,
                  content: inlineImageContent,
                  enabled: true,
                  order: 1250,
                }],
              };
            }
          }
          const useFormatRepairGuard = !internalContinuation && (preset.id === 'deepseek'
            || (preset.id === 'drc_v12'
              && preset.prompts.some(p => p.identifier === DRC_FORMAT_REPAIR_PROMPT_ID && p.enabled)));
          const macroEngine = new MacroEngine();
          const assembleResult = assembleSystemPrompt(preset, {
            varSnapshot,
            wbInjection,
            playerProfileBlock,
            firewallTitle: ROLE_COGNITION_FIREWALL_TITLE,
            firewallContent: ROLE_COGNITION_FIREWALL_CONTENT,
            userText,
            round,
            macroEngine,
            compiledMemoryContext,  // ← 注入记忆上下文
            directorBrief,  // ← 注入剧情导演未来意图与已结算机械事实
            playerDecisionContext,  // ← 注入玩家决策记录（选择卡路径 C）
            userPersonaName: playerProfileRef.current?.name || '',  // ← 供 {{user}} 宏（双人成行等第三方预设）
          });
          let systemPrompt = assembleResult.systemPrompt;

          // 正文生图：在系统提示末尾追加格式提醒（提高 Gemini 等模型的遵循率）
          if (imageConfig.inlineImageEnabled) {
            systemPrompt += '\n\n【提醒】在 <contenttext> 正文中插入 image###英文提示词### 生图标签（1-2个）。';
          }
          if (graphicalCombatEnabled) {
            systemPrompt += '\n\n【图形化战斗最高优先级边界】本世界已启用本地战斗模块。正文只允许写到敌人现身、伏击发生、攻击即将开始或双方进入对峙；到此必须立刻停止。严禁描写任何一次命中、闪避、格挡、反击、伤势、死亡、投降、胜负、奖励或成功逃脱，也不得用摘要跳过战斗。玩家随后会在独立战场完成机械结算，只有宿主再次提供 CombatResult 时，你才能依据该 JSON 一次性叙述完整战斗经过与结果。此规则高于预设中的篇幅、戏剧性和情节推进要求。';
          }
          if (!internalContinuation) {
            systemPrompt += `\n\n【权威时间裁决】本轮起始时间是“${formatWorldClock(turnStartClock, clockConfigForPrompt)}”。完成正文与行动选项后，必须在整条回复最后单独追加 <TimeAdvance>{"minutes":本轮从起始到正文末尾实际经过的非负整数分钟,"reason":"简短原因","evidence":"正文中的时间依据"}</TimeAdvance>。请自然判断已完成的用餐、睡眠、旅行、工作和天色变化：整段正文只给出从起始到末尾的唯一总推进；多个线索只是同一终点的相互佐证，不能重复累计。targetPhase/dayOffset 只能描述同一个最终时间终点，不得与 minutes 叠加；没有可靠证据时写 0。计划、对白、回忆中的未来或过去时间不推进；跨两天以上必须有明确天数、绝对日期或连续场景证据。不得省略回执；TimeAdvance 内不得增加绝对日期字段；不得把标签放进正文。`;
          }

          const chatHistory = sanitizeForContext(messagesRef.current, round);
          // 注入 atDepth 世界书条目 + 预设自带深度注入条目（双人成行 🔒丨文风 depth=2 等）到聊天历史
          // 世界书 atDepth 条目内容走宏引擎解析（{{user}} 等），macroEngine 已在 assembleSystemPrompt 内完成变量绑定
          const resolvedWbAtDepth = (atDepthEntries || []).map(e => ({
            depth: e.depth,
            content: macroEngine.resolve(e.content),
          }));
          const mergedAtDepth = [...resolvedWbAtDepth, ...(assembleResult.depthEntries || [])];
          // depth is relative to the complete conversation sent for this turn,
          // including the live user message. In particular, depth=0 must be the
          // final user-context message immediately before generation.
          const chatHistoryWithDepth = injectAtDepthEntries([
            ...chatHistory,
            { role: 'user' as const, content: userText },
          ], mergedAtDepth);
          const apiMessages: Message[] = [
            { role: 'system', content: systemPrompt },
            ...chatHistoryWithDepth,
          ];
          // 尾部 assistant 预填充（SillyTavern 兼容：仅第三方预设如双人成行有此条目；现有 4 预设为空，行为不变）
          if (assembleResult.assistantPrefill) {
            apiMessages.push({ role: 'assistant', content: assembleResult.assistantPrefill });
          }

          let accumulated = '';

          // 预设级模型参数覆盖全局 ApiConfig（temperature/top_p/max_tokens）
          const presetRequestOpts: Record<string, unknown> = {};
          if (preset.temperature != null) presetRequestOpts.temperature = preset.temperature;
          if (preset.top_p != null) presetRequestOpts.topP = preset.top_p;
          if (preset.max_tokens != null) presetRequestOpts.maxTokens = preset.max_tokens;

          // Narrative is committed as a whole; keep retries and format repair on the same non-streaming contract.
          const narrativeApiConfig = { ...apiConfig, stream: false };
          const result = await requestStreamWithRetry(narrativeApiConfig, apiMessages, {
            signal: controller.signal,
            onDelta: (_delta, acc) => { if (isCurrent()) { accumulated = acc; updateTurnMessage({ rawText: applyCombatBoundary(acc) }); } },
            ...presetRequestOpts,
          });
          assertNarrativeCurrent();

          let rawText = result.text || accumulated;

          // 如果响应为空（SSE尾部丢失等），重试一次
          if (!rawText.trim()) {
            let retryAccumulated = '';
            const retryResult = await requestStreamWithRetry(narrativeApiConfig, apiMessages, {
              signal: controller.signal,
              onDelta: (_delta, acc) => { if (isCurrent()) { retryAccumulated = acc; updateTurnMessage({ rawText: applyCombatBoundary(acc) }); } },
              ...presetRequestOpts,
            });
            assertNarrativeCurrent();
            rawText = retryResult.text || retryAccumulated;
            if (!rawText.trim()) {
              const fallbackText = options.combatContinuation?.fallbackText?.trim();
              if (fallbackText) {
                rawText = `<contenttext>${fallbackText}</contenttext>`;
              } else {
                throw new Error('模型返回空内容，可能触发了服务商内容审核或上下文过滤；请重试，或先回滚到较早快照再继续。');
              }
            }
          }

          // 内置 DeepSeek，或用户手动开启双人成行的格式补尾时：
          // 检测正文/选项未闭合，只请求一次缺失尾部；再次失败则本地补通用选项兜底。
          if (useFormatRepairGuard && rawText.trim() && !isDeepSeekResponseComplete(rawText)) {
            const partialResponse = rawText;
            console.warn('[FormatRepair] 首次响应格式不完整，准备自动补尾', {
              finishReason: result.finishReason ?? '(服务端未提供)',
              length: partialResponse.length,
            });
            let repairAccumulated = '';
            try {
              const repairResult = await requestStreamWithRetry(narrativeApiConfig, [
                ...apiMessages,
                { role: 'assistant', content: partialResponse },
                { role: 'user', content: buildDeepSeekRepairPrompt(partialResponse) },
              ], {
                signal: controller.signal,
                onDelta: (_delta, acc) => {
                  if (!isCurrent()) return;
                  repairAccumulated = acc;
                  updateTurnMessage({ rawText: applyCombatBoundary(appendDeepSeekRepair(partialResponse, acc)) });
                },
                ...presetRequestOpts,
              });
              assertNarrativeCurrent();
              rawText = appendDeepSeekRepair(partialResponse, repairResult.text || repairAccumulated);
              if (!isDeepSeekResponseComplete(rawText)) {
                console.warn('[FormatRepair] 补尾响应仍不完整，准备本地清理残片', {
                  finishReason: repairResult.finishReason ?? '(服务端未提供)',
                  repairLength: (repairResult.text || repairAccumulated).length,
                });
              }
            } catch (repairError) {
              assertNarrativeCurrent();
              console.warn('[FormatRepair] 自动补写缺失尾部失败，使用本地行动选项兜底:', repairError);
            }

            if (!isDeepSeekResponseComplete(rawText)) {
              rawText = ensureDeepSeekResponseFallback(rawText);
            }
          }

          // StatusPlaceHolderImpl 处理
          if (rawText.includes('<StatusPlaceHolderImpl/>')) {
            rawText = rawText.replace(/<StatusPlaceHolderImpl\/>/g, '').trim();
            if (!rawText) {
              rawText = '🌍 欢迎来到世界漫游指南！\n\n请描述你的角色和想要穿越的世界，开始你的冒险之旅。\n\n你可以：\n• 直接描述你想做什么\n• 选择下方的推荐行动\n• 输入任何你想尝试的行动';
            }
          }

          rawText = applyCombatBoundary(rawText);
          assertNarrativeCurrent();

          // 记忆写入必须读取本轮完整剧情，不能再保存“等待 AI 回复”占位文本。
          const completedBatchText = buildMemoryBatchText(
            userText,
            extractContentForPrompt(rawText).trim() || rawText,
          );
          memCtx.batchText = completedBatchText;
          memCtx.assistantText = extractContentForPrompt(rawText).trim() || rawText;
          if (lastPipelineCtxRef.current?.aiMsgId === aiMsgId) {
            lastPipelineCtxRef.current.batchText = completedBatchText;
          }

          // 存储完整原始响应（thinking/options/summary 全由正则脚本处理）
          updateTurnMessage({
            rawText,
            streaming: false,
          });

          return { text: rawText, parsed: { content: extractContentForPrompt(rawText), thinking: '' } };
        },
      });
      assertCurrent();

      const mainContent = pipelineResult.mainResult?.parsed.content?.trim() || '';

      if (!internalContinuation && !controller.signal.aborted && pipelineResult.status.stages.main.status === 'success' && mainContent && apiConfig) {
        const currentWorld = getActiveWorldDef();
        if (currentWorld) {
          await reviewCommittedTurn({ turnId: aiMsgId, round, narrative: mainContent, playerInput: userText, canReview: () => canReviewCommittedTurn(executor.getStatus()), signal: controller.signal });
          assertCurrent();
        }
      }
      if (internalContinuation && (!mainContent || pipelineResult.status.stages.main.status !== 'success')) {
        removeMessage(aiMsgId);
      }
      completion = {
        success: Boolean(!controller.signal.aborted && pipelineResult.status.stages.main.status === 'success' && mainContent),
        ...(mainContent ? { content: mainContent } : {}),
      };

      // 管线完成 — 保存当前变量快照到 AI 消息（用于回滚）
      const gameTimeStr = (varMgrRef.current.getState() as any)?.世界?.时间系统?.当前时间 || '';
      saveSnapshot(varMgrRef, updateMessage, aiMsgId, round, gameTimeStr, messagesRef.current);

      // 清理内存中的冗余快照，防止内存无限增长
      setMessages(prev => optimizeSnapshots(prev));

      setPipelineStatus(pipelineResult.status);

    } catch (err: unknown) {
      if (!ownsTurn()) return;
      const errMsg = err instanceof Error ? err.message : String(err);
      completion = { success: false, error: errMsg };
      if (err instanceof Error && err.name === 'AbortError') {
        // 不覆盖已生成的正文，只标记停止
        const existingRaw = messagesRef.current.find(m => m.id === aiMsgId)?.rawText || '';
        if (!existingRaw.trim()) {
          updateMessage(aiMsgId, { rawText: '[已停止生成]', streaming: false });
        } else {
          updateMessage(aiMsgId, { streaming: false });
        }
      } else if (internalContinuation) {
        removeMessage(aiMsgId);
      } else {
        // 不覆盖已流式输出的正文，只在文末追加错误提示
        const currentContent = messagesRef.current.find(m => m.id === aiMsgId)?.rawText || '';
        const errorSuffix = currentContent.trim()
          ? `\n\n⚠️ [管线错误] ${errMsg}`
          : `[错误] ${errMsg}`;
        updateMessage(aiMsgId, { rawText: currentContent + errorSuffix, streaming: false });
      }
    } finally {
      if (!ownsTurn()) return;
      if (lastPipelineCtxRef.current?.aiMsgId === aiMsgId) {
        lastPipelineCtxRef.current.memCtx = detachTurnMemoryValue({ ...lastPipelineCtxRef.current.memCtx, signal: undefined });
        if (executor.getMainResult()) {
          const gameTime = manager.getState().世界?.时间系统?.当前时间 ?? '';
          saveSnapshot(varMgrRef, updateMessage, aiMsgId, round, gameTime, messagesRef.current);
        }
        captureTurnRecovery();
      }
      finishGeneration();
      setIsGenerating(false);
      if (!internalContinuation) directorReviews.setForegroundBusy(false);
      cancelRef.current = null;
      eventBus.emit(EVENTS.GENERATION_ENDED, aiMsgId);
      try { options.onComplete?.(completion); } catch (callbackError) {
        console.error('[消息管线] 完成回调失败:', callbackError);
      }
      // 直接触发自动存档（通过 ref 回调，不依赖事件总线时序）
      try { onAutoSaveRef.current?.(); } catch (e) {
        // 不再静默吞掉，让错误暴露
        console.error('[auto-save] 回调失败（需要用户注意）:', e);
      }
    }
  }, [apiConfig, addMessage, updateMessage, removeMessage]);

  sendMessageRef.current = sendMessage;

  const cancel = useCallback(() => { cancelRef.current?.abort(); }, []);
  const cancelAndWait = useCallback(async () => {
    if (!generatingRef.current) return;
    const idle = new Promise<void>(resolve => generationWaiters.current.add(resolve));
    cancelRef.current?.abort();
    await idle;
  }, []);

  const canRecoverTurn = (ctx: NonNullable<typeof lastPipelineCtxRef.current>) =>
    varMgrRef.current === ctx.manager && selectedWorldRef.current === ctx.worldId
    && useSaveStore.getState().currentSaveId === ctx.saveId
    && messagesRef.current.filter(message => message.role === 'assistant').at(-1)?.id === ctx.aiMsgId
    && ctx.stateVersion === recoveryVersion(ctx.manager.getState())
    && (!ctx.memoryVersion || ctx.memoryVersion === memoryRecoveryVersion())
    && messagesRef.current.find(message => message.id === ctx.aiMsgId)?.rawText === ctx.recoveryRawText;

  const completeTurnSettlement = async (result: PipelineResult, isCurrent: () => boolean) => {
    const ctx = lastPipelineCtxRef.current;
    if (!ctx?.settlement || !isCurrent()) throw new DOMException('回合已失效', 'AbortError');
    ctx.settle?.(result);
    if (!ctx.settlement.done) throw new Error('变量尚未接纳，请先补交变量提取，再结算本轮玩法。');
    if (!ctx.settlement.internalContinuation && !ctx.settlement.modulesDone) {
      const moduleResult = await runCustomModuleTurnLifecycles(ctx.manager.getState(), ctx.worldId, {
        round: ctx.round, tick: ctx.manager.getState().simulationRuntime?.tick ?? ctx.round,
        settled: Boolean(ctx.settlement.mechanicalTickSettled), time: ctx.manager.getState().世界.时间系统.当前时间, now: Date.now(),
      }, {
        isCurrent, getCurrentState: () => ctx.manager.getState(), commit: state => ctx.manager.setState(state),
        notify: () => eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED),
      });
      if (!isCurrent()) throw new DOMException('回合已失效', 'AbortError');
      if (moduleResult.warnings.some(warning => warning.includes('本次模块执行未提交'))) throw new Error(moduleResult.warnings.join('\n'));
      if (moduleResult.warnings.length) console.warn('[CustomModules] 回合收尾:', moduleResult.warnings);
      ctx.settlement.modulesDone = true;
    }
  };

  const restoreTurnRecovery = async () => {
    const recovery = pendingRecoveryRef.current;
    if (!recovery || !apiConfig || generatingRef.current) return;
    const manager = varMgrRef.current;
    if (recovery.saveId !== useSaveStore.getState().currentSaveId || recovery.worldId !== selectedWorldRef.current
      || recovery.stateVersion !== recoveryVersion(manager.getState()) || recovery.memoryVersion !== memoryRecoveryVersion()) return;
    const memory = await buildMemoryContext(recovery.round, String(recovery.memory.batchText ?? ''), recovery.userText,
      String(recovery.memory.recentContext ?? ''), String(recovery.memory.playerName ?? ''), apiConfig);
    if (pendingRecoveryRef.current !== recovery || generatingRef.current || varMgrRef.current !== manager
      || recovery.stateVersion !== recoveryVersion(manager.getState()) || recovery.memoryVersion !== memoryRecoveryVersion()) return;
    const settlement = structuredClone(recovery.settlement);
    const executor = new PipelineExecutor(recovery.round, { onUpdate: () => {
      if (lastExecutorRef.current !== executor || varMgrRef.current !== manager) return;
      setPipelineStatus(structuredClone(executor.getStatus()));
      captureTurnRecovery();
    } }, recovery.result);
    lastExecutorRef.current = executor;
    lastPipelineCtxRef.current = { round: recovery.round, userText: recovery.userText, aiMsgId: recovery.aiMsgId,
      batchText: String(recovery.memory.batchText ?? ''), recentContext: String(recovery.memory.recentContext ?? ''),
      playerName: String(recovery.memory.playerName ?? ''), manager, worldId: recovery.worldId, saveId: recovery.saveId,
      memCtx: { ...memory, ...recoverableMemoryContext(recovery.memory) }, stateVersion: recovery.stateVersion,
      memoryVersion: recovery.memoryVersion, pipelineConfig: recovery.config, apiConfig, settlement,
      recoveryRawText: recovery.rawText,
      settle: result => {
        if (settlement.done || result.status.stages.main.status !== 'success' || !result.mainResult?.parsed.content?.trim()) return;
        if (recovery.config.variableEnabled && !['success', 'skipped'].includes(result.status.stages.variable.status)) return;
        const accepted = settleAcceptedTurn(manager.getState(), settlement, result, recovery.aiMsgId, recovery.round, recovery.userText);
        manager.setState(accepted.state);
        settlement.done = true;
        eventBus.emit(EVENTS.TURN_SETTLED, manager, accepted.changeLog);
        if (settlement.encounter) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, settlement.encounter);
        eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
      },
    };
  };

  const commitPlayerState = useCallback((state: GameState): boolean => {
    if (generatingRef.current || isSaveReadOnly()) return false;
    clearTurnRecovery();
    varMgrRef.current.setState(structuredClone(state));
    const latest = messagesRef.current.filter(message => message.role === 'assistant').at(-1);
    if (latest) {
      updateMessage(latest.id, { turnRecovery: undefined });
      saveSnapshot(varMgrRef, updateMessage, latest.id, latest.round, varMgrRef.current.getState().世界.时间系统.当前时间, messagesRef.current);
    }
    eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
    onAutoSaveRef.current?.();
    return true;
  }, []);
  const preparePlayerStateJSON = useCallback((json: string): GameState | null => {
    try {
      const parsed: unknown = JSON.parse(json);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !('玩家' in parsed) || !('世界' in parsed)) return null;
      delete (parsed as Record<string, unknown>).moduleRevisions;
      const draft = new VariableManager(varMgrRef.current.getState(), undefined, getTimeSystemFromWorld(getActiveWorldDef()));
      return draft.setStateFromJSON(JSON.stringify(parsed)) ? draft.getState() : null;
    } catch { return null; }
  }, []);
  const prepareSaveCapture = () => {
    const ctx = lastPipelineCtxRef.current;
    const executor = lastExecutorRef.current;
    if (!ctx?.settlement || !executor || !needsTurnRecovery({ mainResult: executor.getMainResult(), status: executor.getStatus() }, ctx.pipelineConfig, ctx.settlement)) return;
    if (ctx && (generatingRef.current || ctx.stateVersion === recoveryVersion(ctx.manager.getState()))) captureTurnRecovery();
  };

  // ─── 重试管线（跳过正文生成，只重跑失败的记忆/变量阶段） ───
  const retryPipeline = useCallback(async () => {
    try { if (!lastPipelineCtxRef.current) await restoreTurnRecovery(); }
    catch (error) { void dlgAlert(error instanceof Error ? error.message : String(error), { title: '无法恢复回合' }); return; }
    const ctx = lastPipelineCtxRef.current;
    if (!apiConfig || generatingRef.current || !ctx || isSaveReadOnly()) return;
    if (!canRecoverTurn(ctx)) { void dlgAlert('当前旅程状态已变化，请回滚重发该回合。', { title: '无法补交旧回合' }); return; }
    const executor = lastExecutorRef.current;
    if (!executor?.getMainResult()) return;

    // 找到对应的 AI 消息，确认正文还在
    const aiMsg = messagesRef.current.find(m => m.id === ctx.aiMsgId);
    if (!aiMsg || !aiMsg.rawText || aiMsg.rawText.startsWith('[错误]')) return;

    generatingRef.current = true;
    setIsGenerating(true);
    const controller = operationsRef.current.begin();
    cancelRef.current = controller;
    const ownsTurn = () => operationsRef.current.owns(controller) && varMgrRef.current === ctx.manager;
    const isCurrent = () => ownsTurn() && operationsRef.current.accept(controller) && selectedWorldRef.current === ctx.worldId && useSaveStore.getState().currentSaveId === ctx.saveId;
    const assertCurrent = () => { if (!isCurrent()) throw new DOMException('回合已失效', 'AbortError'); };

    const pipelineConfig = ctx.pipelineConfig;
    setPipelineStatus(executor.getStatus());

    try {
      const memStore = guardTurnMemory(useMemoryStore.getState(), isCurrent, useMemoryStore.getState);
      const memConfig = memStore.config;
      const memCtx = ctx.memCtx;
      memCtx.signal = controller.signal;

      const pipelineResult = await executor.execute({
        config: pipelineConfig,
        signal: controller.signal,
        isCurrent,
        resume: true,
        varMgr: varMgrRef.current,
        worldBook: worldBookRef.current,
        userText: ctx.userText,
        mainApiConfig: ctx.apiConfig,
        worldId: selectedWorldRef.current,

        memoryTasks: buildMemoryTasks(memStore, memCtx, memConfig),

        settlementTask: result => completeTurnSettlement(result, isCurrent),

        // mainTask 为空（跳过）
        mainTask: async () => { throw new Error('恢复不能重新生成已完成的正文'); },
      });

      assertCurrent();
      await reviewCommittedTurn({ turnId: ctx.aiMsgId, round: ctx.round, narrative: pipelineResult.mainResult!.parsed.content, playerInput: ctx.userText, canReview: () => isCurrent() && canReviewCommittedTurn(executor.getStatus()), signal: controller.signal });
      assertCurrent();
      // 重试成功后重新保存快照
      const gameTimeStr2 = (varMgrRef.current.getState() as any)?.世界?.时间系统?.当前时间 || '';
      saveSnapshot(varMgrRef, updateMessage, ctx.aiMsgId, ctx.round, gameTimeStr2, messagesRef.current);

      setMessages(prev => optimizeSnapshots(prev));
      setPipelineStatus(pipelineResult.status);
    } catch (err: unknown) {
      console.error('[重试管线] 失败:', err instanceof Error ? err.message : String(err));
    } finally {
      if (!ownsTurn()) return;
      ctx.memCtx = detachTurnMemoryValue({ ...ctx.memCtx, signal: undefined });
      captureTurnRecovery();
      finishGeneration();
      setIsGenerating(false);
      cancelRef.current = null;
      try { onAutoSaveRef.current?.(); } catch (e) {
        // 不再静默吞掉，让错误暴露
        console.error('[auto-save] 回调失败（需要用户注意）:', e);
      }
    }
  }, [apiConfig]);

  // ─── 单步重试（只重跑管线中的某一个失败阶段） ───
  const retrySingleStage = useCallback(async (taskId: PipelineTaskId) => {
    try { if (!lastPipelineCtxRef.current) await restoreTurnRecovery(); }
    catch (error) { void dlgAlert(error instanceof Error ? error.message : String(error), { title: '无法恢复回合' }); return; }
    const ctx = lastPipelineCtxRef.current;
    const executor = lastExecutorRef.current;
    if (generatingRef.current || isSaveReadOnly()) return; // 正在生成中/封存存档，静默返回
    if (!apiConfig || !ctx || !executor) {
      const reason = !apiConfig ? 'API 配置缺失' : '管线上下文或执行器已丢失（可能页面刷新过）';
      console.warn('[单步重试] 无法重试：', reason);
      dlgAlert(`无法重试：${reason}`, { title: '重试失败' });
      return;
    }
    if (!canRecoverTurn(ctx)) { void dlgAlert('当前旅程状态已变化，请回滚重发该回合。', { title: '无法补交旧回合' }); return; }
    if (!executor.getMainResult() || ['success', 'skipped'].includes(executor.getStatus().stages[taskId].status)) return;

    const aiMsg = messagesRef.current.find(m => m.id === ctx.aiMsgId);
    if (!aiMsg || !aiMsg.rawText || aiMsg.rawText.startsWith('[错误]')) {
      console.warn('[单步重试] 无法重试：AI 消息不存在或正文为空');
      dlgAlert('无法重试：AI 消息不存在或正文为空', { title: '重试失败' });
      return;
    }

    generatingRef.current = true;
    setIsGenerating(true);
    const controller = operationsRef.current.begin();
    cancelRef.current = controller;
    const ownsTurn = () => operationsRef.current.owns(controller) && varMgrRef.current === ctx.manager;
    const isCurrent = () => ownsTurn() && operationsRef.current.accept(controller) && selectedWorldRef.current === ctx.worldId && useSaveStore.getState().currentSaveId === ctx.saveId;
    const assertCurrent = () => { if (!isCurrent()) throw new DOMException('回合已失效', 'AbortError'); };
    try {
      const memStore = guardTurnMemory(useMemoryStore.getState(), isCurrent, useMemoryStore.getState);
      const memCtx = ctx.memCtx;
      memCtx.signal = controller.signal;

      // 根据 taskId 构建对应的执行函数
      const memConfig = memStore.config;
      const memoryTasks = buildMemoryTasks(memStore, memCtx, memConfig);
      const taskFnMap: Record<string, (() => Promise<void>) | undefined> = {
        settlement: () => completeTurnSettlement({ mainResult: executor.getMainResult(), status: executor.getStatus() }, isCurrent),
        ...(memoryTasks ? {
          memory_write: memoryTasks.write,
          memory_summary: memoryTasks.summary,
          memory_vector: memoryTasks.vector,
          memory_query_rewrite: memoryTasks.queryRewrite,
          memory_retrieve_plan: memoryTasks.retrievePlan,
          memory_multi_round: memoryTasks.multiRound,
          memory_rerank: memoryTasks.rerank,
          memory_retrieve_finalize: memoryTasks.retrieveFinalize,
          memory_compile: memoryTasks.compile,
        } : {}),
        variable: async () => {
          const { runTurnVariableExtraction } = await import('./turnVariableExtraction');
          await runTurnVariableExtraction({
            varMgr: varMgrRef.current,
            parsed: executor.getMainResult()!.parsed,
            round: ctx.round,
            userText: ctx.userText,
            mainApiConfig: ctx.apiConfig,
            worldBook: worldBookRef.current,
            worldId: selectedWorldRef.current,
            delayMs: 0,
            maxRetries: 0,
            signal: controller.signal,
            isCurrent,
          });
        },
      };

      const taskFn = taskFnMap[taskId];
      if (!taskFn) {
        console.warn(`[单步重试] 不支持重试阶段: ${taskId}`);
        return;
      }

      await executor.retryStage(taskId, taskFn, isCurrent);
      assertCurrent();
      if (taskId !== 'settlement' && executor.getStatus().stages.settlement.status !== 'success'
        && ['variable', 'memory_write', 'memory_summary', 'memory_vector'].every(id => ['success', 'skipped'].includes(executor.getStatus().stages[id as PipelineTaskId].status))) {
          await executor.retryStage('settlement', () => completeTurnSettlement({ mainResult: executor.getMainResult(), status: executor.getStatus() }, isCurrent), isCurrent);
      }
      if (canReviewCommittedTurn(executor.getStatus())) {
        await reviewCommittedTurn({ turnId: ctx.aiMsgId, round: ctx.round, narrative: executor.getMainResult()!.parsed.content, playerInput: ctx.userText, canReview: () => isCurrent() && canReviewCommittedTurn(executor.getStatus()), signal: controller.signal });
        assertCurrent();
      }

      // 重试成功后更新快照
      const gameTimeStr3 = (varMgrRef.current.getState() as any)?.世界?.时间系统?.当前时间 || '';
      saveSnapshot(varMgrRef, updateMessage, ctx.aiMsgId, ctx.round, gameTimeStr3, messagesRef.current);

      setPipelineStatus({ ...executor.getStatus(), stages: { ...executor.getStatus().stages } });
    } catch (err: unknown) {
      console.error('[单步重试] 失败:', err instanceof Error ? err.message : String(err));
    } finally {
      if (!ownsTurn()) return;
      ctx.memCtx = detachTurnMemoryValue({ ...ctx.memCtx, signal: undefined });
      captureTurnRecovery();
      finishGeneration();
      setIsGenerating(false);
      cancelRef.current = null;
      try { onAutoSaveRef.current?.(); } catch (e) {
        // 不再静默吞掉，让错误暴露
        console.error('[auto-save] 回调失败（需要用户注意）:', e);
      }
    }
  }, [apiConfig]);

  const reset = useCallback((worldDef?: WorldDef) => {
    clearTurnRecovery();
    saveLifecycleRef.current = 'active';
    activeWorldDefRef.current = worldDef ?? findWorldDef(selectedWorldRef.current);
    cancelRef.current?.abort();
    finishGeneration();
    setIsGenerating(false);
    setMessages([]);
    varMgrRef.current = new VariableManager(undefined, undefined, getTimeSystemFromWorld(worldDef));
    varMgrRef.current.initializeWorldAndNotebook();
    const initialClockState = varMgrRef.current.getState();
    ensureWorldClockOnGameState(initialClockState, worldDef);
    varMgrRef.current.setState(normalizeGameStateV3(prepareGameplayState(initialClockState, worldDef?.modules, { mode: 'new' }).state));
    roundRef.current = 0;
    seqRef.current = 0;
    // 重置记忆系统，防止跨存档污染
    const memStore = useMemoryStore.getState();
    memStore.resetMemoryRuntime();
    memStore.clearPipelineOutputs();
    // 捕获记忆系统初始快照（用于回滚兜底）
    initialMemorySnapshotRef.current = memStore.toJSON();
    // 初始化世界演化运行时状态
    const { createDefaultSimulationRuntimeState } = require('../modules/schema');
    varMgrRef.current.setState({
      ...varMgrRef.current.getState(),
      simulationRuntime: createDefaultSimulationRuntimeState(),
    });

    const finalClockState = varMgrRef.current.getState();
    ensureWorldClockOnGameState(finalClockState, worldDef);
    varMgrRef.current.setState(finalClockState);

    // ★ 无论是否有模块，都必须重新注入世界书条目
    // 否则无模块的世界（如外部导入世界）的 worldBookEntries 永远不会被加载
    if (worldBookRef.current && worldDef?.id) {
      applyWorldAndModules(worldBookRef.current, worldDef.id);
    }
  }, [selectedWorld]);

  // 使用 getter 确保 variableManager 总是返回最新的 ref 值
  // （reset 会创建新的 VariableManager 实例，旧的 engine 对象仍需能访问到新实例）
  return {
    sendMessage, cancel, cancelAndWait, commitPlayerState, preparePlayerStateJSON, prepareSaveCapture,
    get isGenerating() { return generatingRef.current; },
    get messages() { return messagesRef.current; },
    get isReadOnly() { return isSaveReadOnly(); },
    get variableManager() { return varMgrRef.current; },
    get worldBook() { return worldBookRef.current; },
    pipelineStatus,
    deleteSingleMessage, editMessage, resendFromMessage, resendFromAssistantMessage, rollbackToSnapshot,
    loadSave, restoreCombatCheckpoint, reset, addMessage,
    retryPipeline, retrySingleStage,
    DialogUI,
  };
}
