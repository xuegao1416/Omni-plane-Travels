// 游戏引擎 - 管线化消息发送、流式响应、变量更新
import { useCallback, useRef, useState, useEffect } from 'react';
import { useDialog } from '../components/shared/Dialog';
import type { ApiConfig, Message } from '../api/types';
import { requestStreamWithRetry } from '../api/client';
import { setRateLimitInterval } from '../api/rateLimiter';
import { extractContentForPrompt } from './responseExtractor';
import { getMessageContent } from './contextManager';
import { VariableManager } from './variableManager';
import { eventBus, EVENTS } from './eventBus';
import { v4 as uuid } from 'uuid';
import type { WorldBookManager } from '../worldbook/index';
import { sanitizeForContext } from './contextManager';
import type { GameSave, PlayerProfile, CustomNpc } from '../storage/db';
import { optimizeSnapshots } from '../storage/db';
import { loadWorldBook, applyWorld } from './worldPersonality';
import { findWorldDef } from '../data/worldLoader';
import type { WorldDef } from '../data/worlds-schema';
import { getSimulationEngine, restoreEngineState } from '../simulation/SimulationApi';
import { createDefaultSurvivalModule, createDefaultBusinessModule, createDefaultDiceModule, createDefaultTalentModule } from '../modules/defaults';
import { PipelineExecutor } from './pipelineExecutor';
import { loadPipelineConfig, type PipelineStatus, type PipelineTaskId } from './pipelineTypes';
import type { ChatMessage, GameEngine } from './types';
import { PROMPT_INLINE_IMAGE } from '../data/builtinPresets';
import { usePresetStore } from '../stores/presetStore';
import { STORAGE_KEYS } from '../config/storageKeys';
import { useImageStore } from '../stores/imageStore';
import { ROLE_COGNITION_FIREWALL_TITLE, ROLE_COGNITION_FIREWALL_CONTENT } from '../utils/roleCognitionFirewall';
import { assembleSystemPrompt, injectAtDepthEntries } from './promptAssembler';
import { runBusinessExtraction } from './businessExtraction';
import { MacroEngine } from './macroEngine';
import { useMemoryStore } from '../memory/memoryStore';
import { useSimulationStore } from '../stores/simulationStore';
import { formatSnapshotForMainAI } from '../utils/npcHelpers';
import type { MemoryPipelineContext } from '../memory/useMemorySystem';
import { loadPresets, resolvePreset } from '../components/settings/apiPresetUtils';
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
) {
  try {
    const snapshot = varMgrRef.current.createSnapshot();
    const memStoreForCheckpoint = useMemoryStore.getState();
    const memCheckpoint = memStoreForCheckpoint.createCheckpoint();

    // 创建世界演化引擎快照
    let simulationSnapshotId: string | undefined;
    try {
      const simEngine = getSimulationEngine();
      const simSnapshot = simEngine.createSnapshot(
        msgIndex,
        gameTime || '',
        false,
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
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const messagesRef = useRef<ChatMessage[]>([]);
  const sendMessageRef = useRef<((text: string) => Promise<void>) | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  // 防止双击/同步多次触发 sendMessage 的 ref 守卫
  const generatingRef = useRef(false);
  const varMgrRef = useRef(initialVarMgr || new VariableManager());
  const cancelRef = useRef<AbortController | null>(null);
  const roundRef = useRef(0);
  const seqRef = useRef(0);  // 消息序号，单调递增
  const worldBookRef = useRef<WorldBookManager | null>(null);
  const initializedRef = useRef(false);
  // 全局初始快照（参考项目的 initialSnapshot，用于回滚兜底）
  const initialSnapshotRef = useRef<unknown>(null);
  // 全局初始记忆快照（用于记忆系统回滚兜底）
  type MemorySnapshot = ReturnType<ReturnType<typeof useMemoryStore.getState>['toJSON']>;
  const initialMemorySnapshotRef = useRef<MemorySnapshot | null>(null);
  // 从 sessionStorage 恢复最后一轮管线状态
  const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(() => {
    try {
      const saved = sessionStorage.getItem('dev_pipeline_status');
      return saved ? JSON.parse(saved) : null;
    } catch { return null; }
  });
  const playerProfileRef = useRef(playerProfile ?? null);
  const characterHistoryRef = useRef(characterHistory ?? '');
  const onAutoSaveRef = useRef(onAutoSave);
  const selectedWorldRef = useRef(selectedWorld);
  useEffect(() => { selectedWorldRef.current = selectedWorld; }, [selectedWorld]);
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
  } | null>(null);

  useEffect(() => { playerProfileRef.current = playerProfile ?? null; }, [playerProfile]);
  useEffect(() => { characterHistoryRef.current = characterHistory ?? ''; }, [characterHistory]);
  useEffect(() => { onAutoSaveRef.current = onAutoSave; }, [onAutoSave]);

  // API 限流间隔同步
  useEffect(() => {
    if (apiConfig?.rateLimitMs) {
      setRateLimitInterval(apiConfig.rateLimitMs);
    }
  }, [apiConfig?.rateLimitMs]);

  // 管线状态持久化到 sessionStorage
  useEffect(() => {
    if (pipelineStatus) {
      try { sessionStorage.setItem('dev_pipeline_status', JSON.stringify(pipelineStatus)); } catch { /* sessionStorage 不可用时静默 */ }
    }
  }, [pipelineStatus]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

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

  // ── 经营资产独立提取：变量提取完成后 fire-and-forget ──
  useEffect(() => {
    const unsubscribe = eventBus.on(EVENTS.VARIABLE_UPDATE_ENDED, () => {
      try {
        const worldId = selectedWorldRef.current;
        console.log('[经营提取] 事件触发, worldId:', worldId);
        if (!worldId || worldId === 'default') return;
        const worldDef = findWorldDef(worldId);
        const hasBusiness = worldDef?.modules?.some(m => m.moduleId === 'business' && m.enabled);
        console.log('[经营提取] worldDef:', worldDef?.name, 'hasBusiness:', hasBusiness);
        if (!hasBusiness) return;

        const ctx = lastPipelineCtxRef.current;
        if (!ctx) return;

        // API 配置：优先变量提取专用预设 > 主API
        let effectiveConfig: ApiConfig | null = apiConfig;
        try {
          const varPresetId = localStorage.getItem(STORAGE_KEYS.VARIABLE_API_PRESET);
          if (varPresetId) {
            const { loadPresets } = require('../components/settings/apiPresetUtils');
            const presets = loadPresets();
            const preset = presets.find((p: any) => p.id === varPresetId);
            if (preset) effectiveConfig = { ...preset.config };
          }
        } catch { /* fallback */ }
        if (!effectiveConfig) return;

        console.log('[经营提取] 启动后台提取');
        runBusinessExtraction({
          varMgr: varMgrRef.current,
          selectedWorld: worldId,
          userText: ctx.userText,
          aiContentText: ctx.batchText,
          mainApiConfig: effectiveConfig,
        }).catch(err => {
          console.warn('[经营提取] 后台执行失败（不影响主流程）:', err);
        });
      } catch (err) {
        console.warn('[经营提取] 初始化失败（不影响主流程）:', err);
      }
    });
    return unsubscribe;
  }, [apiConfig]);

  const addMessage = useCallback((msg: ChatMessage) => { setMessages(prev => [...prev, msg]); }, []);
  const updateMessage = useCallback((id: string, updates: Partial<ChatMessage>) => {
    setMessages(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }, []);

  // 辅助：回滚变量快照 + 记忆检查点 + 世界演化快照，并截断消息列表到指定索引
  const rollbackAndTruncate = useCallback((truncateAt: number) => {
    const currentMessages = messagesRef.current;

    // 1. 回滚变量快照
    let restored = false;
    for (let i = truncateAt - 1; i >= 0; i--) {
      if (currentMessages[i].snapshot) {
        varMgrRef.current.restoreSnapshot(currentMessages[i].snapshot as any);
        restored = true;
        break;
      }
    }
    if (!restored && initialSnapshotRef.current) {
      varMgrRef.current.restoreSnapshot(initialSnapshotRef.current as any);
    }

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
    setMessages(prev => {
      const truncated = prev.slice(0, truncateAt);
      messagesRef.current = truncated;
      return truncated;
    });
  }, []);

  // 辅助：构建记忆管线上下文（加载 preset、解析各阶段 API 配置）
  const buildMemoryContext = useCallback((
    floor: number, batchText: string, inputText: string,
    recentContext: string, playerName: string, mainApiConfig: ApiConfig,
  ): MemoryPipelineContext => {
    const memStore = useMemoryStore.getState();
    const memConfig = memStore.config;
    const presets = loadPresets();
    const defaultMemApi = { baseUrl: mainApiConfig.baseUrl, apiKey: mainApiConfig.apiKey, model: mainApiConfig.model };
    const memApiConfig = resolvePreset(presets, memConfig.apiPresetId) ?? defaultMemApi;
    return {
      floor, batchText, inputText, recentContext, playerName,
      apiConfig: memApiConfig,
      writeApiConfig: resolvePreset(presets, memConfig.writePipeline.apiPresetId) ?? undefined,
      summaryApiConfig: resolvePreset(presets, memConfig.writePipeline.summaryApiPresetId) ?? undefined,
      conflictJudgeApiConfig: resolvePreset(presets, memConfig.writePipeline.conflictJudgeApiPresetId) ?? undefined,
      retrievalApiConfig: resolvePreset(presets, memConfig.retrieval.plannerApiPresetId) ?? undefined,
      vectorApiConfig: resolvePreset(presets, memConfig.vectorExtractApiPresetId) ?? undefined,
    };
  }, []);

  // 删除消息：级联删除 + 回滚状态（用户消息连同后面的AI消息一起删）
  const deleteSingleMessage = useCallback((id: string) => {
    if (generatingRef.current) return; // 生成中禁止删除，防止状态不一致
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
    setMessages(prev => prev.map(m => m.id === id ? { ...m, rawText: content } : m));
  }, []);

  const resendFromMessage = useCallback(async (id: string) => {
    if (!apiConfig || generatingRef.current) return;
    const currentMessages = messagesRef.current;
    const idx = currentMessages.findIndex(m => m.id === id);
    if (idx === -1) return;
    const msg = currentMessages[idx];
    if (!msg || msg.role !== 'user') return;

    rollbackAndTruncate(idx);

    setTimeout(() => {
      sendMessageRef.current?.(getMessageContent(msg));
    }, 0);
  }, [apiConfig, rollbackAndTruncate]);

  // 从 AI 消息回滚并重新发送
  const resendFromAssistantMessage = useCallback(async (id: string) => {
    if (!apiConfig || generatingRef.current) return;
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

    rollbackAndTruncate(userIdx);

    setTimeout(() => {
      sendMessageRef.current?.(getMessageContent(userMsg));
    }, 0);
  }, [apiConfig, rollbackAndTruncate]);

  const loadSave = useCallback((save: GameSave) => {
    setMessages(save.messages);
    varMgrRef.current = VariableManager.fromJSON({ state: save.gameState });
    // 恢复全局初始快照：优先从第一条消息的 snapshot 获取，否则用存档的 gameState
    const firstMsg = save.messages.find(m => m.snapshot);
    if (firstMsg?.snapshot) {
      initialSnapshotRef.current = firstMsg.snapshot;
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

    // 兼容老存档：补全 simulationRuntime 字段
    const gameState = varMgrRef.current.getState();
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
      // 旧存档没有 simulationState（可能是迁移前创建或 auto-save 时序问题）
      // 引擎已在初始化时从 localStorage 加载了状态，只在两端都为空时才重置
      const engine = getSimulationEngine();
      const hasLocalData = Object.keys(engine.state.events).length > 0
        || Object.keys(engine.state.storylines).length > 0
        || engine.state.pendingInteractions.length > 0;
      if (!hasLocalData) {
        engine.reset();
      }
    }
  }, []);

  const sendMessage = useCallback(async (userText: string) => {
    if (!apiConfig || generatingRef.current || !userText.trim()) return;

    generatingRef.current = true;
    setIsGenerating(true);
    roundRef.current++;
    const round = roundRef.current;

    // 分配消息序号（单调递增，用于增量存档）
    seqRef.current++;
    const userSeq = seqRef.current;
    seqRef.current++;
    const aiSeq = seqRef.current;

    const userMsg: ChatMessage = { id: uuid(), role: 'user', rawText: userText, round, timestamp: Date.now(), seq: userSeq };
    addMessage(userMsg);
    eventBus.emit(EVENTS.MESSAGE_SENT, userMsg);

    const aiMsgId = uuid();
    const aiMsg: ChatMessage = { id: aiMsgId, role: 'assistant', rawText: '', round, timestamp: Date.now(), streaming: true, seq: aiSeq };
    addMessage(aiMsg);
    eventBus.emit(EVENTS.GENERATION_STARTED, aiMsgId);

    const controller = new AbortController();
    cancelRef.current = controller;

    // 创建管线执行器
    const pipelineConfig = loadPipelineConfig();
    // 统一记忆系统启用状态：使用 memoryStore 的配置
    const memStoreForConfig = useMemoryStore.getState();
    pipelineConfig.memoryEnabled = memStoreForConfig.config.enabled;
    const executor = new PipelineExecutor(round, {
      onUpdate: () => {
        const status = executor.getStatus();
        setPipelineStatus({ ...status, stages: { ...status.stages } });
        eventBus.emit(EVENTS.PIPELINE_UPDATE, status);
      },
    });
    setPipelineStatus(executor.getStatus());
    lastExecutorRef.current = executor;

    try {
      // 使用管线执行器运行执行链
      // ── 记忆系统任务 ──
      const memStore = useMemoryStore.getState();
      const memConfig = memStore.config;

      const playerName = playerProfileRef.current?.name || '冒险者';
      const batchText = userText + '\n\n' + '(等待AI回复)';
      const recentContext = sanitizeForContext(messagesRef.current, round)
        .slice(-6)
        .map(m => m.content || '')
        .join('\n\n');

      const memCtx = buildMemoryContext(round, batchText, userText, recentContext, playerName, apiConfig);

      // 保存管线上下文（用于重试管线）
      lastPipelineCtxRef.current = { round, userText, aiMsgId, batchText, recentContext, playerName };

      // ── 世界演化：非阻塞后台执行 ──
      // 机械层 effects 直接确定性应用到 GameState，不传递给辅助 API
      // 改为 fire-and-forget，不阻塞主管线启动；效果在下一轮生效
      let mechanicalEffectsSummary = ''; // 供主 AI 上下文注入
      try {
        const simEngine = getSimulationEngine();
        const gs = varMgrRef.current.getState();
        const gameTime = {
          current: gs.世界?.时间系统?.当前时间 ?? '',
        };

        // 获取世界定义
        const currentWorldDef = findWorldDef(selectedWorld);
        const worldDesc = currentWorldDef?.description ?? currentWorldDef?.name ?? '未知世界';

        // 获取仿真规则
        const simRulesMod = currentWorldDef?.modules?.find(m => m.moduleId === 'simulation' && m.enabled);
        const simRules = simRulesMod?.moduleConfig as import('../modules/schema').SimulationRules | undefined;

        if (simEngine.shouldTick(gameTime, round) && simEngine.effectiveApiConfig) {
          // 后台执行，不 await — 世界演化结果在下一轮对话生效
          simEngine.tick(gs, gameTime, round, worldDesc, undefined, simRules ?? null)
            .then((result) => {
              // 直接应用机械层效果（确定性，不经 AI）
              if (result?.mechanicalEffects && Object.keys(result.mechanicalEffects).length > 0) {
                const enabledModules = (currentWorldDef?.modules ?? [])
                  .filter(m => m.enabled)
                  .map(m => m.moduleId);
                varMgrRef.current.applyModuleEffects(result.mechanicalEffects, 'periodic', enabledModules);
              }
              // 直接应用世界状态更新
              if (result?.worldStateUpdate && Object.keys(result.worldStateUpdate).length > 0) {
                varMgrRef.current.applyWorldStateUpdate(result.worldStateUpdate);
              }
              // 同步世界演化状态到 store
              useSimulationStore.getState().setSimState(simEngine.state);
            })
            .catch((simErr) => {
              console.warn('[世界演化] 后台执行失败（不影响管线）:', simErr);
            });
        }
      } catch (simErr) {
        console.warn('[世界演化] 初始化失败（不影响管线）:', simErr);
      }

      const pipelineResult = await executor.execute({
        config: pipelineConfig,
        signal: controller.signal,
        varMgr: varMgrRef.current,
        worldBook: worldBookRef.current,
        userText,
        mainApiConfig: apiConfig,

        // 记忆系统任务集
        memoryTasks: buildMemoryTasks(memStore, memCtx, memConfig),

        // main 任务：正文生成
        mainTask: async () => {
          // ── 构建系统提示词（v2.0 结构化预设 + 宏引擎） ──
          const state = varMgrRef.current.createSafeSnapshotForPrompt();
          const varSnapshot = formatSnapshotForMainAI(state);

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
${(() => {
  const skills = (state as any).玩家?.技能系统;
  if (skills && typeof skills === 'object' && Object.keys(skills).length > 0) {
    const lines = Object.entries(skills).filter(([_, d]: [string, any]) => d != null).map(([name, data]: [string, any]) => {
      const parts = [`【${name}】`];
      if (data?.品质) parts.push(`品质:${data.品质}`);
      if (data?.类型) parts.push(`类型:${data.类型}`);
      if (data?.描述) parts.push(`效果:${data.描述}`);
      return `- ${parts.join(' | ')}`;
    });
    return `- 技能：\n${lines.join('\n')}`;
  }
  return '';
})()}
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

          // 获取世界模拟简报（后台推演引擎产出的世界动态 + 角色暗线）
          const simEngine = getSimulationEngine();
          let simulationBrief = '';
          try {
            const newsBrief = simEngine.getWorldNewsBrief();
            const storylineSummary = simEngine.getAllStorylineSummaries();
            const parts = [newsBrief, storylineSummary].filter(Boolean);
            // 追加机械层结算摘要（让主 AI 知道确定性效果已生效，避免双重叙事）
            if (mechanicalEffectsSummary) {
              parts.push(mechanicalEffectsSummary);
            }
            if (parts.length > 0) {
              simulationBrief = parts.join('\n\n');
            }
          } catch {
            // 模拟引擎未初始化或不启用时静默降级
          }

          // 使用结构化预设 + 宏引擎组装系统提示
          // getActivePreset() 已处理：用户自定义预设 / 内置预设 + 覆盖层 / 默认回退
          let preset = usePresetStore.getState().getActivePreset();
          // 叠加正文生图指令（独立于预设，当 inlineImageEnabled 时始终注入）
          const inlineImageEnabled = useImageStore.getState().config.inlineImageEnabled;
          if (inlineImageEnabled) {
            const hasInlineImage = preset.prompts.some(p => p.identifier === 'inline_image_gen');
            if (!hasInlineImage) {
              preset = {
                ...preset,
                prompts: [...preset.prompts, {
                  identifier: 'inline_image_gen',
                  name: '正文生图标签',
                  role: 'system' as const,
                  content: PROMPT_INLINE_IMAGE,
                  enabled: true,
                  order: 1250,
                }],
              };
            }
          }
          const macroEngine = new MacroEngine();
          let systemPrompt = assembleSystemPrompt(preset, {
            varSnapshot,
            wbInjection,
            playerProfileBlock,
            firewallTitle: ROLE_COGNITION_FIREWALL_TITLE,
            firewallContent: ROLE_COGNITION_FIREWALL_CONTENT,
            userText,
            round,
            macroEngine,
            compiledMemoryContext,  // ← 注入记忆上下文
            simulationBrief,  // ← 注入世界模拟简报
          });

          // 正文生图：在系统提示末尾追加格式提醒（提高 Gemini 等模型的遵循率）
          if (inlineImageEnabled) {
            systemPrompt += '\n\n【提醒】在 <contenttext> 正文中插入 image###英文提示词### 生图标签（1-2个）。';
          }

          const chatHistory = sanitizeForContext(messagesRef.current, round);
          // 注入 atDepth 世界书条目到聊天历史
          const chatHistoryWithDepth = injectAtDepthEntries(chatHistory, atDepthEntries);
          const apiMessages: Message[] = [
            { role: 'system', content: systemPrompt },
            ...chatHistoryWithDepth,
            { role: 'user', content: userText },
          ];

          let accumulated = '';

          // 预设级模型参数覆盖全局 ApiConfig（temperature/top_p/max_tokens）
          const presetRequestOpts: Record<string, unknown> = {};
          if (preset.temperature != null) presetRequestOpts.temperature = preset.temperature;
          if (preset.top_p != null) presetRequestOpts.topP = preset.top_p;
          if (preset.max_tokens != null) presetRequestOpts.maxTokens = preset.max_tokens;

          const result = await requestStreamWithRetry(apiConfig, apiMessages, {
            signal: controller.signal,
            onDelta: (_delta, acc) => { accumulated = acc; updateMessage(aiMsgId, { rawText: acc }); },
            ...presetRequestOpts,
          });

          let rawText = result.text || accumulated;

          // 如果响应为空（SSE尾部丢失等），重试一次
          if (!rawText.trim()) {
            let retryAccumulated = '';
            const retryResult = await requestStreamWithRetry(apiConfig, apiMessages, {
              signal: controller.signal,
              onDelta: (_delta, acc) => { retryAccumulated = acc; updateMessage(aiMsgId, { rawText: acc }); },
              ...presetRequestOpts,
            });
            rawText = retryResult.text || retryAccumulated;
          }

          // StatusPlaceHolderImpl 处理
          if (rawText.includes('<StatusPlaceHolderImpl/>')) {
            rawText = rawText.replace(/<StatusPlaceHolderImpl\/>/g, '').trim();
            if (!rawText) {
              rawText = '🌍 欢迎来到世界漫游指南！\n\n请描述你的角色和想要穿越的世界，开始你的冒险之旅。\n\n你可以：\n• 直接描述你想做什么\n• 选择下方的推荐行动\n• 输入任何你想尝试的行动';
            }
          }

          // 存储完整原始响应（thinking/options/summary 全由正则脚本处理）
          updateMessage(aiMsgId, {
            rawText,
            streaming: false,
          });
          eventBus.emit(EVENTS.MESSAGE_RECEIVED, aiMsgId);

          return { text: rawText, parsed: { content: extractContentForPrompt(rawText), thinking: '' } };
        },
      });

      // 管线完成 — 保存当前变量快照到 AI 消息（用于回滚）
      const gameTimeStr = (varMgrRef.current.getState() as any)?.世界?.时间系统?.当前时间 || '';
      saveSnapshot(varMgrRef, updateMessage, aiMsgId, round, gameTimeStr);

      // 清理内存中的冗余快照，防止内存无限增长
      setMessages(prev => optimizeSnapshots(prev));

      setPipelineStatus(pipelineResult.status);

    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      if (err instanceof Error && err.name === 'AbortError') {
        // 不覆盖已生成的正文，只标记停止
        const existingRaw = getMessageContent(messagesRef.current.find(m => m.id === aiMsgId)!) || '';
        if (!existingRaw.trim()) {
          updateMessage(aiMsgId, { rawText: '[已停止生成]', streaming: false });
        } else {
          updateMessage(aiMsgId, { streaming: false });
        }
      } else {
        // 不覆盖已流式输出的正文，只在文末追加错误提示
        const currentContent = getMessageContent(messagesRef.current.find(m => m.id === aiMsgId)!) || '';
        const errorSuffix = currentContent.trim()
          ? `\n\n⚠️ [管线错误] ${errMsg}`
          : `[错误] ${errMsg}`;
        updateMessage(aiMsgId, { rawText: errorSuffix, streaming: false });
      }
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
      cancelRef.current = null;
      eventBus.emit(EVENTS.GENERATION_ENDED, aiMsgId);
      // 直接触发自动存档（通过 ref 回调，不依赖事件总线时序）
      try { onAutoSaveRef.current?.(); } catch (e) {
        // 不再静默吞掉，让错误暴露
        console.error('[auto-save] 回调失败（需要用户注意）:', e);
      }
    }
  }, [apiConfig, addMessage, updateMessage]);

  sendMessageRef.current = sendMessage;

  const cancel = useCallback(() => { cancelRef.current?.abort(); }, []);

  // ─── 重试管线（跳过正文生成，只重跑失败的记忆/变量阶段） ───
  const retryPipeline = useCallback(async () => {
    const ctx = lastPipelineCtxRef.current;
    if (!apiConfig || generatingRef.current || !ctx) return;

    // 找到对应的 AI 消息，确认正文还在
    const aiMsg = messagesRef.current.find(m => m.id === ctx.aiMsgId);
    if (!aiMsg || !aiMsg.rawText || aiMsg.rawText.startsWith('[错误]')) return;

    generatingRef.current = true;
    setIsGenerating(true);
    const controller = new AbortController();
    cancelRef.current = controller;

    const pipelineConfig = loadPipelineConfig();
    const memStoreForConfig = useMemoryStore.getState();
    pipelineConfig.memoryEnabled = memStoreForConfig.config.enabled;

    // 重试时跳过 main 阶段
    pipelineConfig.executionOrder = pipelineConfig.executionOrder
      .map(step => step.filter(t => t !== 'main'))
      .filter(step => step.length > 0);

    const executor = new PipelineExecutor(ctx.round, {
      onUpdate: () => {
        const status = executor.getStatus();
        setPipelineStatus({ ...status, stages: { ...status.stages } });
        eventBus.emit(EVENTS.PIPELINE_UPDATE, status);
      },
    });
    setPipelineStatus(executor.getStatus());

    try {
      const memStore = useMemoryStore.getState();
      const memConfig = memStore.config;
      const memCtx = buildMemoryContext(ctx.round, ctx.batchText, ctx.userText, ctx.recentContext, ctx.playerName, apiConfig);

      const pipelineResult = await executor.execute({
        config: pipelineConfig,
        signal: controller.signal,
        varMgr: varMgrRef.current,
        worldBook: worldBookRef.current,
        userText: ctx.userText,
        mainApiConfig: apiConfig,

        memoryTasks: buildMemoryTasks(memStore, memCtx, memConfig),

        // mainTask 为空（跳过）
        mainTask: async () => ({ text: aiMsg.rawText, parsed: { content: extractContentForPrompt(aiMsg.rawText), thinking: '', actionOptions: [], summary: null } }),
      });

      // 重试成功后重新保存快照
      const gameTimeStr2 = (varMgrRef.current.getState() as any)?.世界?.时间系统?.当前时间 || '';
      saveSnapshot(varMgrRef, updateMessage, ctx.aiMsgId, ctx.round, gameTimeStr2);

      setMessages(prev => optimizeSnapshots(prev));
      setPipelineStatus(pipelineResult.status);
    } catch (err: unknown) {
      console.error('[重试管线] 失败:', err instanceof Error ? err.message : String(err));
    } finally {
      generatingRef.current = false;
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
    const ctx = lastPipelineCtxRef.current;
    const executor = lastExecutorRef.current;
    if (generatingRef.current) return; // 正在生成中，按钮已 disabled，静默返回
    if (!apiConfig || !ctx || !executor) {
      const reason = !apiConfig ? 'API 配置缺失' : '管线上下文或执行器已丢失（可能页面刷新过）';
      console.warn('[单步重试] 无法重试：', reason);
      dlgAlert(`无法重试：${reason}`, { title: '重试失败' });
      return;
    }

    const aiMsg = messagesRef.current.find(m => m.id === ctx.aiMsgId);
    if (!aiMsg || !aiMsg.rawText || aiMsg.rawText.startsWith('[错误]')) {
      console.warn('[单步重试] 无法重试：AI 消息不存在或正文为空');
      dlgAlert('无法重试：AI 消息不存在或正文为空', { title: '重试失败' });
      return;
    }

    generatingRef.current = true;
    setIsGenerating(true);
    try {
      const memStore = useMemoryStore.getState();
      const memCtx = buildMemoryContext(ctx.round, ctx.batchText, ctx.userText, ctx.recentContext, ctx.playerName, apiConfig);

      // 根据 taskId 构建对应的执行函数
      const memConfig = memStore.config;
      const memoryTasks = buildMemoryTasks(memStore, memCtx, memConfig);
      const taskFnMap: Record<string, (() => Promise<void>) | undefined> = {
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
          const { runVariableExtraction } = await import('./variableExtraction');
          await runVariableExtraction({
            varMgr: varMgrRef.current,
            parsed: { content: extractContentForPrompt(aiMsg.rawText!), thinking: '', actionOptions: [], summary: null },
            round: ctx.round,
            userText: ctx.userText,
            mainApiConfig: apiConfig,
            worldBook: worldBookRef.current,
            delayMs: 0,
            maxRetries: 0,
          });
        },
      };

      const taskFn = taskFnMap[taskId];
      if (!taskFn) {
        console.warn(`[单步重试] 不支持重试阶段: ${taskId}`);
        return;
      }

      await executor.retryStage(taskId, taskFn);

      // 重试成功后更新快照
      const gameTimeStr3 = (varMgrRef.current.getState() as any)?.世界?.时间系统?.当前时间 || '';
      saveSnapshot(varMgrRef, updateMessage, ctx.aiMsgId, ctx.round, gameTimeStr3);

      setPipelineStatus({ ...executor.getStatus(), stages: { ...executor.getStatus().stages } });
    } catch (err: unknown) {
      console.error('[单步重试] 失败:', err instanceof Error ? err.message : String(err));
    } finally {
      generatingRef.current = false;
      setIsGenerating(false);
      try { onAutoSaveRef.current?.(); } catch (e) {
        // 不再静默吞掉，让错误暴露
        console.error('[auto-save] 回调失败（需要用户注意）:', e);
      }
    }
  }, [apiConfig]);

  const reset = useCallback((worldDef?: WorldDef) => {
    cancelRef.current?.abort();
    generatingRef.current = false;
    setIsGenerating(false);
    setMessages([]);
    varMgrRef.current = new VariableManager();
    varMgrRef.current.initializeWorldAndNotebook();
    roundRef.current = 0;
    // 重置记忆系统，防止跨存档污染
    const memStore = useMemoryStore.getState();
    memStore.resetMemoryRuntime();
    memStore.clearPipelineOutputs();
    // 捕获记忆系统初始快照（用于回滚兜底）
    initialMemorySnapshotRef.current = memStore.toJSON();
    // 初始化模块数据 → 只写入 玩家.生存状态（配置只在世界书）
    if (worldDef?.modules?.length) {
      const state = varMgrRef.current.getState();
      const ss = state.玩家.生存状态;

      for (const mod of worldDef.modules) {
        if (!mod.enabled) continue;

        // 数值属性：全部写入 生存状态
        if (mod.moduleId === 'stat') {
          const src = (mod.initialState || mod.moduleConfig || {}) as any;
          // attrA/attrB → 血量/体力值
          if (src.attrA != null) ss.血量 = typeof src.attrA === 'object' ? src.attrA.current ?? 80 : src.attrA;
          if (src.attrB != null) ss.体力值 = typeof src.attrB === 'object' ? src.attrB.current ?? 60 : src.attrB;
          // 六维
          for (let i = 1; i <= 6; i++) {
            const dim = src[`dim${i}`];
            if (dim != null) ss[`dim${i}`] = typeof dim === 'object' ? dim.value ?? 50 : dim;
          }
          // 特色属性
          const sp = src.special;
          if (Array.isArray(sp)) {
            for (const s of sp) { if (s?.id && s?.value != null) ss[s.id] = s.value; }
          } else if (sp && typeof sp === 'object') {
            for (const [id, value] of Object.entries(sp)) { ss[id] = value as number; }
          }
        }

        // 成长体系
        if (mod.moduleId === 'progression') {
          const src = (mod.initialState || mod.moduleConfig || {}) as any;
          state.玩家.当前段位索引 = src.currentTierIndex ?? 0;
          state.玩家.当前经验值 = src.currentXP ?? 0;
        }
      }

      varMgrRef.current.setState(state);
    }

    // 初始化世界演化运行时状态
    const { createDefaultSimulationRuntimeState } = require('../modules/schema');
    varMgrRef.current.setState({
      ...varMgrRef.current.getState(),
      simulationRuntime: createDefaultSimulationRuntimeState(),
    });

    // ★ 无论是否有模块，都必须重新注入世界书条目
    // 否则无模块的世界（如外部导入世界）的 worldBookEntries 永远不会被加载
    if (worldBookRef.current && worldDef?.id) {
      applyWorldAndModules(worldBookRef.current, worldDef.id);
    }
  }, [selectedWorld]);

  const setPlayerProfile = useCallback((profile: PlayerProfile) => {
    const state = varMgrRef.current.getState();
    // 基础信息
    state.玩家.姓名 = profile.name;
    state.玩家.性别 = profile.gender;
    state.玩家.年龄 = profile.age;
    state.玩家.身份信息.背景信息 = profile.background;
    state.玩家.性格 = profile.personality || '';
    state.玩家.外貌 = profile.appearance || '';
    // 身份信息
    state.玩家.身份信息.职业 = profile.career || '';
    // 初始技能
    if (profile.initialSkills && Object.keys(profile.initialSkills).length > 0) {
      state.玩家.技能系统 = { ...state.玩家.技能系统, ...profile.initialSkills };
    }
    // 初始物品（补全 InventoryItem 缺失字段）
    if (profile.initialItems && Object.keys(profile.initialItems).length > 0) {
      const filled: typeof state.玩家.物品栏 = {};
      for (const [k, v] of Object.entries(profile.initialItems)) {
        filled[k] = { ...v };
      }
      state.玩家.物品栏 = { ...state.玩家.物品栏, ...filled };
    }
    varMgrRef.current.setState(state);
    varMgrRef.current.initializeWorldAndNotebook();
  }, [selectedWorld]);

  // 应用 AI 生成的模块初始化数据 → 写入 生存状态
  const applyModuleInitData = useCallback((moduleInitData: Record<string, unknown>) => {
    if (!moduleInitData || Object.keys(moduleInitData).length === 0) return;

    const state = varMgrRef.current.getState();
    const ss = state.玩家.生存状态;

    // 数值属性
    const statData = moduleInitData['数值属性'] as Record<string, unknown> | undefined;
    if (statData) {
      const getVal = (v: unknown): number | undefined => {
        if (typeof v === 'number') return v;
        if (v && typeof v === 'object' && 'current' in (v as any)) return (v as any).current;
        if (v && typeof v === 'object' && 'value' in (v as any)) return (v as any).value;
        return undefined;
      };
      const a = getVal(statData.attrA); if (a != null) ss.血量 = a;
      const b = getVal(statData.attrB); if (b != null) ss.体力值 = b;
      for (let i = 1; i <= 6; i++) {
        const v = getVal(statData[`dim${i}`]); if (v != null) ss[`dim${i}`] = v;
      }
      if (Array.isArray(statData.special)) {
        for (const sp of statData.special as Array<{ id: string; value: number }>) {
          if (sp?.id && sp?.value != null) ss[sp.id] = sp.value;
        }
      }
    }

    varMgrRef.current.setState(state);
  }, [selectedWorld]);

  const setInitialNPCs = useCallback((npcs: CustomNpc[]) => {
    const state = varMgrRef.current.getState();
    for (const npc of npcs) {
      const npcId = `NPC_${npc.name}`;
      state.人物档案[npcId] = {
        姓名: npc.name,
        种族: npc.race || '人类',
        性别: npc.gender || '',
        年龄: npc.age || '',
        背景: npc.background || '',
        生存状态: npc.survivalStats
          ? { 血量: npc.survivalStats['血量'] ?? 100, 体力值: npc.survivalStats['体力值'] ?? 100,
              ...Object.fromEntries(Object.entries(npc.survivalStats).filter(([k]) => k !== '血量' && k !== '体力值')) }
          : { 血量: 100, 体力值: 100 },
        社会身份: {
          职业: npc.occupation || '',
          社会地位: npc.socialStatus || '',
        },
        关系数据: {
          好感度: 0,
          关系类型: npc.relationshipType || '同伴',
        },
        个人信息: {
          外貌: npc.appearance || '',
          表性格: npc.personality || '',
          里性格: npc.hiddenPersonality || '',
          当前想法: npc.currentThought || '',
          当前穿着: npc.currentOutfit || '',
          当前位置: npc.currentLocation || '',
          当前状态: npc.currentState || '',
          备注: '',
        },
        重要NPC: true,
        _关注: true,
        $time: Date.now(),
        人物分类: '在场',
        当前行动: npc.currentAction || '',
        短期目标: npc.shortTermGoal || '',
        长期目标: npc.longTermGoal || '',
        人物事迹: npc.chronicles || [],
        技能列表: npc.skillsList || {},
        物品列表: npc.itemsList || {},
      };
    }
    varMgrRef.current.setState(state);
    // 更新全局初始快照（此时包含玩家数据和NPC，NPC事迹为空）
    initialSnapshotRef.current = varMgrRef.current.createSnapshot();
  }, []);

  // 使用 getter 确保 variableManager 总是返回最新的 ref 值
  // （reset 会创建新的 VariableManager 实例，旧的 engine 对象仍需能访问到新实例）
  return {
    sendMessage, cancel, isGenerating, messages,
    get variableManager() { return varMgrRef.current; },
    get worldBook() { return worldBookRef.current; },
    pipelineStatus,
    deleteSingleMessage, editMessage, resendFromMessage, resendFromAssistantMessage,
    loadSave, reset, setPlayerProfile, applyModuleInitData, setInitialNPCs, addMessage,
    retryPipeline, retrySingleStage,
    DialogUI,
  };
}
