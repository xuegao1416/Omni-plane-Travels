> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（1、核心引擎系统）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 1、核心引擎系统

### 1.1 游戏引擎核心 — `src/engine/useGameEngine.ts`

**文件路径**: `src/engine/useGameEngine.ts`

**职责**: 整合消息发送、11阶段管线执行、变量管理、记忆系统、世界演化、快照回滚的单一入口 React Hook。是整个引擎的入口点和调度中心。

**主要导出**:

```typescript
export function useGameEngine(
  apiConfig: ApiConfig | null,
  initialVarMgr?: VariableManager,
  selectedWorld: string = 'default',
  playerProfile?: PlayerProfile | null,
  characterHistory?: string,
  onAutoSave?: () => void,
): GameEngine
```

**GameEngine 返回接口**:

```typescript
interface GameEngine {
  sendMessage: (userText: string, options?: SendMessageOptions) => Promise<void>;
  cancel: () => void;
  isGenerating: boolean;
  messages: ChatMessage[];
  readonly isReadOnly: boolean;       // getter,指向 engine.isReadOnly
  variableManager: VariableManager; // getter
  worldBook: WorldBookManager | null;   // 注意 nullable(修复)
  pipelineStatus: PipelineStatus | null; // 注意 nullable(修复)
  deleteSingleMessage: (id: string) => void;
  editMessage: (id: string, content: string) => void;
  resendFromMessage: (id: string) => Promise<void>;     // 修复:是 Promise
  resendFromAssistantMessage: (id: string) => Promise<void>;
  rollbackToSnapshot: (msgIndex: number) => void;       // 修复:入参是 msgIndex
  loadSave: (save: GameSave) => void;                    // 修复:同步
  restoreCombatCheckpoint: (restore: CombatCheckpointRestore, saveId?: string) => void;  // 修复:入参是 restore 对象
  reset: (worldDef?: WorldDef) => void;
  setPlayerProfile: (profile: PlayerProfile) => void;
  applyModuleInitData: (moduleInitData: Record<string, unknown>) => void;
  setInitialNPCs: (npcs: CustomNpc[]) => void;
  addMessage: (msg: ChatMessage) => void;
  retryPipeline: () => Promise<void>;
  retrySingleStage: (taskId: PipelineTaskId) => Promise<void>;
  DialogUI: ReactNode;                // 全局对话框(选项卡/骰子/战斗结算)
}
```

#### 1.1.1 状态定义

```typescript
// 第269-335行
const [messages, setMessages] = useState<ChatMessage[]>([]);
const messagesRef = useRef<ChatMessage[]>([]);           // 双写：React状态 + ref
const sendMessageRef = useRef<typeof sendMessage>(null); // sendMessage函数引用（供回调使用）
const isGenerating = useState(false)[0];
const generatingRef = useRef(false);                     // 防止双击
const cancelRef = useRef<AbortController | null>(null);  // 取消生成
const roundRef = useRef(0);                              // 回合计数器
const lastSuccessfulTurnRef = useRef('');                // 最后成功回合的AI消息ID
const seqRef = useRef(0);                                // 消息序号（单调递增，用于增量存档）
const worldBookRef = useRef<WorldBookManager | null>(null); // 世界书管理器实例
const varMgrRef = useRef<VariableManager | null>(null);  // 变量管理器实例

// 快照相关
const initialSnapshotRef = useRef<GameState | null>(null);   // 全局初始快照（回滚兜底，createSnapshot 返回 GameState）
const initialSimulationRef = useRef<SimulationSnapshot | null>(null); // 全局初始模拟状态
const initialMemorySnapshotRef = useRef<ReturnType<typeof useMemoryStore.getState.toJSON> | null>(null);

// 管线状态
const pipelineStatus = useState<PipelineStatus | null>(null)[0];

// 配置ref（避免闭包stale）
const playerProfileRef = useRef(playerProfile);
const characterHistoryRef = useRef(characterHistory);
const onAutoSaveRef = useRef(onAutoSave);
const selectedWorldRef = useRef(selectedWorld);

// 最后一轮执行上下文（用于重试）
const lastExecutorRef = useRef<PipelineExecutor | null>(null);
const lastPipelineCtxRef = useRef<LatestPipelineContext | null>(null);

// 存档生命周期
const saveLifecycleRef = useRef<'active' | 'ended'>('active');
```

#### 1.1.2 LatestPipelineContext — 贯穿管线的上下文对象

```typescript
// 第87-108行
interface LatestPipelineContext {
  round: number;                    // 当前回合
  userText: string;                 // 用户输入原文
  aiMsgId: string;                  // AI消息ID
  batchText: string;                // 记忆批次文本（用户+AI）
  recentContext: string;            // 最近上下文（6条消息）
  playerName: string;               // 玩家名
  saveId: string;                   // 当前存档ID
  worldId: string;                  // 世界ID
  manager: VariableManager;         // 变量管理器引用
  world?: WorldDef;                 // 世界定义
  variableEnabled: boolean;         // 变量提取是否启用
  internalContinuation: boolean;    // 内部continuation（如战斗继续）
  mainSucceeded: boolean;           // 正文是否成功
  rawText: string;                  // AI原始响应
  narrative: string;                // 解析后的叙事内容
  progressionBaseline: ProgressionBaseline; // 进度基准（用于计算本轮经验）
  narrativeDecisionRequest: { saveId: string; decisionIds: string[] };
}
```

#### 1.1.3 sendMessage 核心流程

```
用户输入
  ↓
[守卫检查]
  ├─ isSaveReadOnly() — 只读存档禁止发送（战斗continuation例外）
  ├─ !apiConfig / generatingRef.current / !userText.trim()
  └─ !internalContinuation && isCombatInteractionPaused()
  ↓
evolutionReviews.invalidate()      // 使评审失效
generatingRef.current = true
roundRef.current++                 // 回合计数+1
  ↓
分配消息序号
  const userSeq = displayUserMessage ? ++seqRef.current : 0;
  seqRef.current++;
  const aiSeq = seqRef.current;
  ↓
创建消息
  const userMsg = { id: uuid(), role: 'user', rawText, round, timestamp, seq: userSeq };
  const aiMsg = { id: aiMsgId, role: 'assistant', rawText: '', round, timestamp, streaming: true, seq: aiSeq };
  addMessage(userMsg);
  eventBus.emit(EVENTS.MESSAGE_SENT, userMsg);
  addMessage(aiMsg);
  eventBus.emit(EVENTS.GENERATION_STARTED, aiMsgId);
  ↓
构建管线
  const executor = new PipelineExecutor(round, {
    onUpdate: () => { /* 更新管线状态 */ eventBus.emit(EVENTS.PIPELINE_UPDATE, status); }
  });
  ↓
executor.execute({
  mainTask: async () => {
    // 1. 构建系统提示词（~100行，16个结构化条目）
    const worldDefForPrompt = getActiveWorldDef();
    const stateAtTurnStart = varMgrRef.current.getState();
    
    // 2. 模块上下文投影
    const moduleProjection = buildModuleContextProjection({ ... });
    const varSnapshot = formatSnapshotForMainAI(moduleProjection.state, clockConfig);
    
    // 3. 世界书扫描注入
    const scanResult = worldBookRef.current.scanAndBuildInjection(scanHistory, userText);
    let wbInjection = scanResult.beforeChar + '\n\n' + scanResult.afterChar;
    atDepthEntries.push(...scanResult.atDepthEntries);
    
    // 4. 小说主线注入
    if (novelSource?.datasetId && mainline?.enabled) {
      const novelInjection = buildMainlineInjection(mainline, novelDataset, worldDefForPrompt?.novelAdaptationMode, 6000);
      wbInjection += '\n\n' + novelInjection;
    }
    
    // 5. 玩家角色设定注入
    let playerProfileBlock = `...`;
    
    // 6. 编译记忆上下文
    const compiledMemoryContext = memStore.lastCompiledContext?.fullText || '';
    
    // 7. 世界模拟简报
    const simulationBrief = frozenSimulation.config.enabled
      ? simEngine.getWorldNewsBrief() + '\n\n' + simEngine.getAllStorylineSummaries()
      : '';
    
    // 8. 玩家决策记录
    const decisionSnapshot = getNarrativeDecisionPromptSnapshot(varMgrRef.current.getState(), narrativeDecisionRequest.saveId);
    
    // 9. 组装系统提示词
    const preset = usePresetStore.getState().getActivePreset();
    const macroEngine = new MacroEngine();
    const assembleResult = assembleSystemPrompt(preset, { varSnapshot, wbInjection, ... });
    let systemPrompt = assembleResult.systemPrompt;
    
    // 10. 追加战斗边界规则（图形化战斗时）
    if (graphicalCombatEnabled) { systemPrompt += '\n\n【图形化战斗最高优先级边界】...'; }
    
    // 11. 追加时间裁决规则
    if (!internalContinuation) { systemPrompt += `\n\n【权威时间裁决】...`; }
    
    // 12. 构建API消息
    const chatHistory = sanitizeForContext(messagesRef.current, round);
    const mergedAtDepth = [...atDepthEntries, ...assembleResult.depthEntries];
    const chatHistoryWithDepth = injectAtDepthEntries(chatHistory, mergedAtDepth);
    const apiMessages = [
      { role: 'system', content: systemPrompt },
      ...chatHistoryWithDepth,
      { role: 'user', content: userText },
    ];
    
    // 13. 流式请求
    const result = await requestStreamWithRetry(apiConfig, apiMessages, {
      signal: controller.signal,
      onDelta: (_delta, acc) => {
        accumulated = acc;
        updateMessage(aiMsgId, { rawText: applyCombatBoundary(acc) });
      },
      ...presetRequestOpts,
    });
    
    // 14. 空响应重试（最多2次）
    if (!rawText.trim()) {
      const retryResult = await requestStreamWithRetry(...);
      rawText = retryResult.text || retryAccumulated;
      if (!rawText.trim()) {
        rawText = fallbackText ? `<contenttext>${fallbackText}</contenttext>` : throw new Error('...');
      }
    }
    
    // 15. DeepSeek格式修复
    if (useFormatRepairGuard && rawText.trim() && !isDeepSeekResponseComplete(rawText)) {
      const partialResponse = rawText;
      const repairResult = await requestStreamWithRetry(apiConfig, [
        ...apiMessages,
        { role: 'assistant', content: partialResponse },
        { role: 'user', content: buildDeepSeekRepairPrompt(partialResponse) }
      ], { ... });
      rawText = appendDeepSeekRepair(partialResponse, repairResult.text || repairAccumulated);
    }
    
    // 16. StatusPlaceHolderImpl替换
    if (rawText.includes('<StatusPlaceHolderImpl/>')) {
      rawText = rawText.replace(/<StatusPlaceHolderImpl\/>/g, '').trim() || defaultWelcomeText;
    }
    
    // 17. 应用战斗边界
    rawText = applyCombatBoundary(rawText);
    
    // 18. 更新记忆批次文本
    const completedBatchText = buildMemoryBatchText(userText, extractContentForPrompt(rawText).trim() || rawText);
    memCtx.batchText = completedBatchText;
    memCtx.assistantText = extractContentForPrompt(rawText).trim() || rawText;
    
    // 19. 更新消息为完成状态
    updateMessage(aiMsgId, { rawText, streaming: false });
    eventBus.emit(EVENTS.MESSAGE_RECEIVED, aiMsgId);
    
    return { text: rawText, parsed: { content: extractContentForPrompt(rawText), thinking: '' } };
  },
  
  memoryTasks: buildMemoryTasks(memStore, memCtx, memConfig),
  // write/summary/vector 并行 → query_rewrite → retrieve_plan → multi_round → rerank → finalize → compile
  
  variableTask: async () => {
    // 独立API调用提取变量更新（runVariableExtraction 直接 mutate VariableManager，不返回 patch 数组）
    await runVariableExtraction({
      varMgr: varMgrRef.current,
      parsed: { content: extractContentForPrompt(rawText), thinking: '' },
      round, userText,
      mainApiConfig: apiConfig,
      worldBook: worldBookRef.current,
      worldId,
      delayMs: 0, maxRetries: 2, signal: controller.signal,
    });
  }
})
  ↓
正文成功后的后处理（内联于 sendMessage，代码中原无独立 finalizeNormalTurn 函数）— 处理全部后处理
  ├─ 叙事决策结算
  ├─ 世界时钟推进 resolveTurnTimeAdvance()
  ├─ 成长/职业结算 settleProgressionAction()
  ├─ 标记叙事已提交 updateMessage(aiMsgId, { narrativeCommitted: true })
  ├─ 自定义模块onTurnEnd
  ├─ 世界演化机械结算 simEngine.settleMechanics()
  │    ├─ resolvePendingChoices(settled.gameState, saveId)
  │    ├─ manager.setState(settled.gameState)
  │    ├─ manager.applyModuleEffects(settled.mechanicalEffects, 'periodic', ...)
  │    ├─ simEngine.commitMechanics(settled)
  │    └─ simEngine.publishMechanicalEvents(settled, scopeIsCurrent)
  ├─ 触发 VARIABLE_UPDATE_ENDED 事件
  └─ 演化评审 evolutionReviews.run()
  ↓
saveSnapshot() — 保存三重快照
  ├─ varMgrRef.current.createSnapshot()
  ├─ memStoreForCheckpoint.createCheckpoint()
  └─ simEngine.createSnapshot(msgIndex, gameTime, false)
  ↓
optimizeSnapshots() — 清理冗余快照
  ↓
错误处理 / finally清理
```

#### 1.1.4 回合终结后处理（内联于 sendMessage，无独立 finalizeNormalTurn 函数，等效 ~95行逻辑）

```typescript
// 以下逻辑在 sendMessage 内联执行
function finalizeNormalTurn( // 仅文档示意，实际内联
  ctx: LatestPipelineContext,
  status: PipelineStatus,
  signal: AbortSignal
): void {
  // 1. 叙事决策结算
  const narrativeDecisionRequest = ctx.narrativeDecisionRequest;
  if (narrativeDecisionRequest?.decisionIds.length) {
    settleNarrativeResponse(ctx.manager.getState(), narrativeDecisionRequest);
  }
  
  // 2. 世界时钟推进
  const currentClock = varMgrRef.current.getState().世界?.时间系统?.时钟;
  const clockConfig = getTimeSystemFromWorld(ctx.world);
  const suggestion = resolveTurnTimeAdvance({
    rawResponse: ctx.rawText,
    narrativeText: ctx.narrative,
    userText: ctx.userText,
    clock: currentClock,
    config: clockConfig,
  });
  if (suggestion && suggestion.minutes > 0) {
    const nextClock = advanceWorldClockForTurn(currentClock, clockConfig, suggestion.minutes, { ... });
    stateBeforeClock.世界.时间系统.时钟 = nextClock;
    stateBeforeClock.世界.时间系统.当前时间 = formatWorldClock(nextClock, clockConfig);
  }
  
  // 3. 成长/职业结算
  const progressionResult = settleProgressionAction(
    varMgrRef.current.getState(),
    ctx.progressionBaseline,
    ctx.world?.modules
  );
  if (progressionResult) { ... }
  
  // 4. 标记叙事已提交
  updateMessage(ctx.aiMsgId, { narrativeCommitted: true });
  
  // 5. 自定义模块onTurnEnd
  await runCustomModulesForWorldAndCommit(
    ctx.manager.getState(), ctx.worldId, 'onTurnEnd', { round: ctx.round }, { ... }
  );
  
  // 6. 世界演化机械结算
  const before = varMgrRef.current.getState();
  const simEngine = getSimulationEngine();
  const simRules = ctx.world?.modules?.find(m => m.moduleId === 'simulation')?.moduleConfig as WorldDynamics;
  const resources = ctx.world?.modules?.find(m => m.moduleId === 'survival')?.moduleConfig as SurvivalModuleSchema;
  
  const settled = await simEngine.settleMechanics(
    before,
    gameTime,
    ctx.round,
    ctx.world?.description || ctx.world?.name,
    simRules ?? createDefaultWorldDynamics(),
    resources,
    ctx.aiMsgId
  );
  
  if (scopeIsCurrent() && settled.settled) {
    resolvePendingChoices(settled.gameState, ctx.saveId);
    ctx.manager.setState(settled.gameState);
    ctx.manager.applyModuleEffects(
      settled.mechanicalEffects,
      'periodic',
      (ctx.world?.modules ?? []).filter(m => m.enabled).map(m => m.moduleId)
    );
    simEngine.commitMechanics(settled);
    simEngine.publishMechanicalEvents(settled, scopeIsCurrent);
    await runCustomModulesForWorldAndCommit(ctx.manager.getState(), ctx.worldId, 'onTick', {
      tick: simEngine.state.tick,
      mechanicalEffects: settled.mechanicalEffects,
    }, { ... });
  }
  
  // 7. 触发事件
  eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
  
  // 8. 演化评审
  await reviewLatest('mainline');
  await reviewLatest('background');
}
```

#### 1.1.5 快照保存机制

```typescript
// 第232-267行
function saveSnapshot(
  varMgrRef: React.RefObject<VariableManager>,
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void,
  aiMsgId: string,
  msgIndex: number,
  gameTime?: string,
) {
  // 1. 创建变量快照
  const snapshot = varMgrRef.current.createSnapshot();
  
  // 2. 创建记忆检查点
  const memStoreForCheckpoint = useMemoryStore.getState();
  const memoryCheckpointId = memStoreForCheckpoint.createCheckpoint();
  
  // 3. 创建世界演化引擎快照
  const simEngine = getSimulationEngine();
  const simSnapshot = simEngine.createSnapshot(msgIndex, gameTime || '', false);
  
  // 4. 绑定到AI消息
  updateMessage(aiMsgId, {
    snapshot,
    snapshotTime: Date.now(),
    memoryCheckpointId,
    simulationSnapshotId: simSnapshot.id,
  });
}
```

#### 1.1.6 回滚机制

```typescript
// rollbackAndTruncate（实际为 useCallback 闭包，非 async 函数）
// 四层回滚：变量 → 记忆 → 演化 → 消息截断
function rollbackAndTruncate(truncateAt: number): void {
  const messages = messagesRef.current;
  const targetMsg = messages[truncateAt];
  
  // 1. 变量快照回滚 — 找到最近一条有snapshot的AI消息
  for (let i = truncateAt - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role === 'assistant' && msg.snapshot) {
      varMgrRef.current.restoreSnapshot(msg.snapshot);
      break;
    }
  }
  
  // 2. 记忆检查点回滚
  if (targetMsg?.memoryCheckpointId) {
    const memStore = useMemoryStore.getState();
    memStore.restoreCheckpoint(targetMsg.memoryCheckpointId);
  }
  
  // 3. 世界演化引擎回滚
  if (targetMsg?.simulationSnapshotId) {
    const simEngine = getSimulationEngine();
    simEngine.restoreSnapshot(targetMsg.simulationSnapshotId);
  }
  
  // 4. 消息列表截断
  setMessages(prev => prev.slice(0, truncateAt));
}

// rollbackToSnapshot（useCallback 闭包，同步）
// 回滚到特定AI消息的快照，保留该消息本身
function rollbackToSnapshot(msgIndex: number): void {
  const messages = messagesRef.current;
  const targetMsg = messages[msgIndex];
  
  if (targetMsg?.snapshot) {
    varMgrRef.current.restoreSnapshot(targetMsg.snapshot);
  }
  if (targetMsg?.memoryCheckpointId) {
    useMemoryStore.getState().restoreCheckpoint(targetMsg.memoryCheckpointId);
  }
  if (targetMsg?.simulationSnapshotId) {
    getSimulationEngine().restoreSnapshot(targetMsg.simulationSnapshotId);
  }
  
  setMessages(prev => prev.slice(0, msgIndex + 1));
  roundRef.current = targetMsg.round;
  seqRef.current = targetMsg.seq ?? 0;
  lastExecutorRef.current = null;
  lastPipelineCtxRef.current = null;
}
```

#### 1.1.7 加载存档

```typescript
// loadSave（useCallback 闭包，同步执行）
function loadSave(save: GameSave): void {
  // 1. 失效演化评审
  evolutionReviews.invalidate();
  
  // 2. 重置存档生命周期
  saveLifecycleRef.current = save.lifecycle === 'ended' ? 'ended' : 'active';
  
  // 3. 恢复消息列表
  setMessages(save.messages);
  
  // 4. 查找世界定义
  const saveWorldDef = findWorldDef(save.worldId);
  
  // 5. 迁移游戏状态
  const migratedClockState = ensureWorldClockOnGameState(save.gameState, saveWorldDef);
  const restoredManager = VariableManager.fromJSON({
    state: migratedClockState,
    saveId: save.id,
    moduleStates: save.moduleStates,
    moduleCheckpoints: save.moduleCheckpoints,
  }, saveClockConfig);
  
  // 6. v3战斗检查点重建
  const normalizedSaveState = normalizeCombatStateForLoad(save.gameState);
  const preparedGameplayState = prepareGameplayState(
    migrateGameStateToV3(normalizedSaveState),
    saveWorldDef?.modules,
    { mode: 'load' }
  ).state;
  const preparedSaveState = synchronizeV3FeatureFlagsForWorld(preparedGameplayState, {
    professionsEnabled, combatEnabled, fallbackRiskMode
  });
  
  varMgrRef.current = restoredManager;
  
  // 7. 恢复全局初始快照
  initialSnapshotRef.current = varMgrRef.current.createSnapshot();
  
  // 8. 恢复记忆系统
  const memStore = useMemoryStore.getState();
  if (save.memoryRuntime || save.vectorMemory) {
    memStore.fromJSON({
      memoryRuntime: save.memoryRuntime,
      config: save.memoryConfig,
      vectorMemory: save.vectorMemory,
    });
  }
  initialMemorySnapshotRef.current = memStore.toJSON();
  
  // 9. 恢复世界推演状态
  if (save.simulationState) {
    const simEngine = getSimulationEngine();
    simEngine.restoreState(save.simulationState);
    initialSimulationRef.current = structuredClone(simEngine.state);
  }
}
```

---

### 1.2 管线执行与上下文管理

#### 1.2.1 管线执行器 — `src/engine/pipelineExecutor.ts`

**文件路径**: `src/engine/pipelineExecutor.ts`

**职责**: 11阶段管线的编排器，支持同层并行/层间串行执行。

```typescript
// 核心类（非 interface）
export class PipelineExecutor {
  constructor(round: number, callbacks: PipelineCallbacks);   // callbacks.onUpdate: () => void
  getStatus(): PipelineStatus;
  async execute(params: {
    config: PipelineConfig;
    mainTask: () => Promise<{ text: string; parsed: ParsedResponse }>;
    varMgr: VariableManager;
    worldBook: WorldBookManager | null;
    userText: string;
    mainApiConfig: ApiConfig;
    worldId?: string;
    signal: AbortSignal;
    memoryTasks?: MemoryTasks;
  }): Promise<PipelineResult>;
  async retryStage(taskId: PipelineTaskId, taskFn: () => Promise<void>): Promise<void>;
}

// PipelineTaskId — 阶段标识（联合类型，非接口）
type PipelineTaskId =
  | 'main' | 'memory_write' | 'memory_summary' | 'memory_vector'
  | 'memory_query_rewrite' | 'memory_retrieve_plan' | 'memory_multi_round'
  | 'memory_rerank' | 'memory_retrieve_finalize' | 'memory_compile' | 'variable';

// PipelineStageResult — 单阶段结果（实际字段）
interface PipelineStageResult {
  status: 'pending' | 'running' | 'success' | 'warning' | 'error' | 'skipped';
  label: string;
  attempts?: number;
  maxAttempts?: number;
  dataLength?: number;
  error?: string;
  skipped?: boolean;
  startTime?: number;
  endTime?: number;
  extra?: Record<string, unknown>;
}

// PipelineStatus — 管线状态快照
interface PipelineStatus {
  round: number;
  stages: Record<PipelineTaskId, PipelineStageResult>;
  startTime: number;
  endTime?: number;
}

// PipelineConfig — 执行配置
interface PipelineConfig {
  executionOrder: PipelineTaskId[][];   // 二维数组，同层并行、层间串行
  variableEnabled: boolean;
  variableDelayMs: number;
  variableMaxRetries: number;
  memoryEnabled: boolean;
}
```

**执行流程**:

```
execute()
  ├─ 阶段1: mainTask（独立API调用，流式）
  │    └─ onUpdate回调更新stages.main状态
  │
  ├─ 阶段2-4: memory_write / memory_summary / memory_vector（并行）
  │    └─ Promise.all([write(), summary(), vector()])
  │         任一失败 → 抛出异常 → 外部降级处理
  │
  ├─ 阶段5: memory_query_rewrite（串行，等待2-4完成）
  │
  ├─ 阶段6: memory_retrieve_plan（串行）
  │
  ├─ 阶段7: memory_multi_round（串行）
  │
  ├─ 阶段8: memory_rerank（串行）
  │
  ├─ 阶段9: memory_retrieve_finalize（串行）
  │
  ├─ 阶段10: memory_compile（串行）
  │
  └─ 阶段11: variableTask（独立API调用）
       └─ 提取变量更新 → applyModuleEffects()
```

---

### 1.3 变量管理器 — `src/engine/variableManager.ts`

**文件路径**: `src/engine/variableManager.ts`

**职责**: 游戏状态变量的路径访问、Patch、快照、钳位、NPC感知。

```typescript
class VariableManager {
  constructor(
    initial?: GameState,
    moduleRuntime?: { saveId: string; current: readonly ModuleStateRecord[]; checkpoints?: readonly ModuleStateRecord[] },
    worldClockConfig?: Partial<WorldClockConfig>,
  )
  
  // 状态访问
  getState(): GameState
  setState(state: GameState): void
  
  // 路径访问
  getVar(path: string, defaultValue?: unknown): unknown           // "玩家.生存状态.血量"
  setVar(path: string, value: unknown, forceReplace?: boolean): void
  
  // 变量更新（解析 AI 文本 / 事务载荷并应用到状态）
  applyUpdateVariable(updateText: string): boolean
  applyAiUpdateVariable(updateText: string): boolean
  
  // 快照
  createSnapshot(): GameState
  createSafeSnapshotForPrompt(): GameState  // 排除NPC私密字段
  restoreSnapshot(snapshot: GameState): void
  
  // 模块效果应用
  applyModuleEffects(
    effects: ModuleEffects,
    source: 'periodic' | 'rule' | 'manual',
    moduleIds: string[],
  ): void
  
  // 世界状态更新（规则引擎用）
  applyWorldStateUpdate(updates: WorldStateUpdate[]): void
  
  // 存档持久化
  createModulePersistenceBundle(saveId: string): ModulePersistenceBundle
}
```

#### 1.3.1 InventoryItem 完整结构

```typescript
// 物品栏物品
interface InventoryItem {
  数量: number;                                         // 当前持有数量
  类型: '武器' | '防具' | '消耗品' | '任务物品' | '关键道具' | '材料' | '货币' | '凭证';
  品质: '普通' | '精良' | '稀有' | '史诗' | '传说';
  备注: string;                                         // 物品描述/说明
  
  // 战斗用途（可选，消耗品/武器/防具才有）
  战斗用途?: {
    类型: 'heal' | 'resource' | 'damage' | 'cleanse' | 'buff' | 'debuff' | 'shield';
    目标?: 'self' | 'ally' | 'enemy' | 'all';
    数值?: number;                                      // 效果数值
    持续回合?: number;                                  // 持续性效果
  };
  
  // 额外属性
  等级?: number;                                        // 物品等级
  耐久度?: number;                                      // 装备耐久
  附魔?: Record<string, number>;                        // 附魔属性
  套装id?: string;                                      // 套装标识
}
```

#### 1.3.2 NPCData 完整结构

```typescript
// NPC完整数据
interface NPCData {
  // 基础信息
  姓名: string;
  种族: string;
  性别: string;
  年龄: string;
  
  // 社会身份
  社会身份: {
    职业: string;
    社会地位: string;
    组织: string;
    特殊身份?: string;
  };
  
  // 关系数据（以玩家ID为key）
  关系数据: Record<string, {
    好感度: number;       // -100 ~ 100
    关系名称: string;     // '陌生人'|'认识'|'朋友'|'挚友'|'恋人'|'敌人'等
    互动次数: number;     // 累计互动次数
    最后互动时间?: string;
  }>;
  
  // 当前状态（私密字段，快照中排除）
  当前状态: string;       // 正在做什么
  当前地点: string;       // 当前位置
  当前想法: string;       // 内心想法（私密）
  
  // 外在表现
  外貌: string;
  性格: string;
  隐藏性格: string;       // 不为人知的一面
  
  // 目标系统
  短期目标: string;
  长期目标: string;
  
  // 背景故事
  背景: string;
  纪事: string[];         // 重要经历记录
  
  // 能力系统
  技能列表: Record<string, {
    名称: string;
    描述: string;
    类型: string;
    品质: '普通' | '精良' | '稀有' | '史诗' | '传说';
    等级?: number;
    冷却?: number;
  }>;
  
  // 物品栏
  物品栏: Record<string, InventoryItem>;
  
  // 生存状态/属性（当世界启用数值属性模块时填充）
  生存状态: {
    血量: number;
    血量上限: number;
    体力值: number;
    体力值上限: number;
    // 六维属性
    dim1?: number;  // 力量
    dim2?: number;  // 敏捷
    dim3?: number;  // 体质
    dim4?: number;  // 智力
    dim5?: number;  // 感知
    dim6?: number;  // 魅力
    // 特殊属性（动态key）
    [key: string]: number | undefined;
  };
  
  // 段位索引（当世界启用成长体系模块时填充）
  当前段位索引?: number;
  当前经验值?: number;
  
  // 立绘
  立绘?: {
    来源: 'default' | 'custom';
    自定义URL?: string;
    缩放: number;
    位置X: number;
    位置Y: number;
  };
}
```

#### 1.3.3 安全机制详解

```typescript
// 危险路径段（原型链污染防护）
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);

// AI 写入白名单相关常量
const AI_STATE_ROOTS = new Set(['世界', '玩家', '人物档案']);        // AI 可写入的状态根
const AI_TRANSACTION_KEYS = new Set(['id', 'moduleId', 'source', 'label', 'conditions', 'costs', 'effects', 'rewards', 'events']);
const AI_FORBIDDEN_FIELDS = new Set(['before', 'after']);              // 事务中禁止出现的字段
```

#### 1.3.4 快照机制详解

```typescript
// createSafeSnapshotForPrompt() — 供提示词使用的净化快照
// 复制 state 后，用 selectPlayerKnownNPCs + createPromptSafeNpcSnapshot 重建人物档案，
// 并删除 人物已知资料 / playerKnowledge，避免 {{getvar}} 读到 NPC 内心想法。

// _slimForSnapshot() — 存档快照瘦身（私有）
// 人物档案的长文本字段超过 200 字截断：
//   背景 / 外貌 / 表性格 / 里性格 / 当前想法 / 当前穿着 / 当前状态 / 内心想法 / 备注；
// 并移除 portraitUrl 等大型缓存字段。
```

---

### 1.4 变量/业务/成长提取

| 文件                                    | 职责                                                                                 | 调用时机                   |
| ------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------- |
| `src/engine/variableExtraction.ts`    | 通过 `runVariableExtraction(...)` 提取变量并直接 mutate VariableManager（返回 void，非 patch 数组） | 管线阶段 11 `variableTask` |
| `src/engine/progressionSettlement.ts` | 经验结算/段位升级/突破处理（`settleProgressionAction`）                                          | sendMessage 内联后处理步骤 3  |
| `src/engine/responseExtractor.ts`     | 从流式响应中提取 `contenttext`/JSON/思维链                                                    | mainTask 步骤 17         |
| `src/engine/deepSeekResponseGuard.ts` | DeepSeek 推理模型格式补全(检测被截断的 `</contenttext>`)                                         | mainTask 步骤 15         |
| `src/engine/worldPersonality.ts`      | 世界人格(AI 语气风格种子)                                                                    | 提示词组装,影响叙事基调           |

**调用关系图**:

```
mainTask(complete)
   ↓
extractContentForPrompt(rawText) → contentText   // 注意：函数名是 extractContentForPrompt，非 extract
   ↓
runVariableExtraction({ varMgr, parsed, round, userText, mainApiConfig, worldBook, worldId, delayMs, maxRetries, signal })
   // 内部直接 mutate VariableManager（返回 void，不返回 patch 数组；无 VariableExtractionResult 结构）
   ↓
settleProgressionAction(manager, config, userText, baseline) → ProgressionSettlement | null
   ↓
sendMessage 内联后处理 → bumpVersion
```

**`runVariableExtraction` 说明**:

- 签名：`runVariableExtraction(params: { varMgr, parsed, round, userText, mainApiConfig, worldBook, worldId, delayMs, maxRetries, signal?, isCurrent? }): Promise<void>`
- 行为：直接对 `varMgr` 做变量解析并调用 `applyUpdateVariable`，**返回 void**，不产出结果对象；源码中不存在 `VariableExtractionResult` 接口、`extractVariables` 函数或 `variableExtraction.run` 方法。

### 1.5 宏引擎 — `src/engine/macroEngine.ts`

**文件路径**: `src/engine/macroEngine.ts`

**8种宏语法**:

| 宏    | 语法                                | 用途          | 示例                         |
| ---- | --------------------------------- | ----------- | -------------------------- |
| 读取变量 | `{{getvar::key}}`                 | 读取游戏变量      | `{{getvar::玩家.生存状态.血量}}`   |
| 写入变量 | `{{setvar::key::value}}`          | 写入游戏变量（副作用） | `{{setvar::玩家.状态::战斗中}}`   |
| 递增   | `{{incvar::key}}`                 | 变量+1        | `{{incvar::玩家.计数}}`        |
| 递减   | `{{decvar::key}}`                 | 变量-1        | `{{decvar::玩家.生命值}}`       |
| 条件分支 | `{{#if::condition::true::false}}` | 条件渲染        | `{{#if::玩家.血量>0::活着::死亡}}` |
| 随机选择 | `{{random::opt1::opt2}}`          | 随机选取        | `{{random::攻击::防御::观察}}`   |
| 骰子   | `{{roll NdM+K}}`                  | 投掷骰子        | `{{roll 2d6+3}}`           |
| 通用查找 | `{{key}}`                         | 按key查找变量    | `{{玩家名称}}`                 |

**嵌套处理**: 最多10轮迭代展平，防止无限循环

---

### 1.6 提示词组装器 — `src/engine/promptAssembler.ts`

**文件路径**: `src/engine/promptAssembler.ts`

**16个结构化组装条目**（按顺序）:

1. **核心快照** — 玩家状态/时间/地点
2. **模块概览** — 数值属性/成长/生存/经营/骰子/天赋/职业
3. **世界书注入** — scanAndBuildInjection结果（beforeChar/afterChar/atDepth）
4. **玩家角色设定** — PlayerProfile（姓名/性别/年龄/背景/性格/外貌）
5. **角色认知防火墙** — 防止AI角色混淆的规则
6. **用户输入原文中转** — 用户本轮输入
7. **回合数上下文** — 当前回合数
8. **编译记忆上下文** — memory_compile阶段输出
9. **世界模拟简报** — 后台推演状态（新闻/故事线摘要）
10. **玩家决策记录** — narrativeDecisionPromptSnapshot
11. **游戏格式规则** — contenttext标签等
12. **战斗边界规则** — 图形化战斗优先级护栏
13. **时间裁决规则** — 权威时间裁决说明
14. **Author's Note位置条目** — atDepth分组条目
15. **预设叠加** — prompt层叠加（多个preset的prompts数组合并）
16. **Assistant预填充** — assembleResult.assistantPrefill

---

### 1.7 事件总线 — `src/engine/eventBus.ts`

**文件路径**: `src/engine/eventBus.ts`

**职责**: 全局事件发布/订阅,解耦模块间直接调用。

```typescript
// 事件常量(实际值用下划线/点号,非冒号)
export const EVENTS = {
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',
  GENERATION_STARTED: 'generation_started',
  GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped',
  VARIABLE_UPDATE_ENDED: 'variable_update_ended',
  VARIABLE_EXTRACTION_FAILED: 'variable_extraction_failed',
  CHAT_CHANGED: 'chat_changed',
  AUTO_SAVE: 'auto_save',
  PIPELINE_UPDATE: 'pipeline_update',
  EVENT_CARD: 'mod:card',                       // addEvent 触发
  EVENT_CARD_OVERRIDE: 'mod:card:override',     // addEvent 覆盖卡片
  COMBAT_ENCOUNTER_REQUESTED: 'combat.encounter.requested',  // 触发战斗
} as const;

// API
eventBus.emit(event: string, payload?: unknown): void;
eventBus.on(event: string, handler: (payload: unknown) => void): () => void; // 返回 unsubscribe
eventBus.off(event: string, handler: Function): void;
eventBus.once(event: string, handler: Function): void;
```

**主要事件消费者**:

| 事件                           | 主要消费者                                 |
| ---------------------------- | ------------------------------------- |
| `MESSAGE_SENT`               | 卡片 UI / 自动存档调度                        |
| `PIPELINE_UPDATE`            | `PipelineMonitorModal` 实时管线状态         |
| `VARIABLE_UPDATE_ENDED`      | `GameScreen.bumpVersion` 触发全局重渲染      |
| `COMBAT_ENCOUNTER_REQUESTED` | `GameScreen.handleTypedCombatRequest` |

**设计原则**:

- 同步 emit,异步消费
- 不携带复杂 payload(复杂对象走 store)
- 失败不影响 emit 链路(`try/catch` 隔离 handler)

### 1.8 响应提取与守护

| 文件                                    | 职责                                                       |
| ------------------------------------- | -------------------------------------------------------- |
| `src/engine/responseExtractor.ts`     | 从原始流式响应提取 `contenttext`/`thinking` 标签,剥离思维链              |
| `src/engine/deepSeekResponseGuard.ts` | DeepSeek 推理模型:检测被截断的响应,触发 `buildDeepSeekRepairPrompt` 补全 |
| `src/engine/worldPersonality.ts`      | 世界人格(语气风格/价值观种子),注入到 system prompt 头部                    |

**响应提取流程**:

```
原始流式 chunks (concatenated)
  ↓
extractContentForPrompt(text)
  ├─ 提取 <contenttext>...</contenttext>
  ├─ 提取 <thinking>...</thinking> (剥离,不进入正文)
  ├─ JSON 检测({ ... } 包裹时尝试解析)
  └─ 兜底:返回原文

↓ 用于最终 UI 展示 + 后续变量提取的 batchText
```

**DeepSeek 守护触发条件**:

```typescript
useFormatRepairGuard && rawText.trim() && !isDeepSeekResponseComplete(rawText)
// isDeepSeekResponseComplete: 检查是否含配对的 </contenttext>、</thinking>、闭合 {}
```

### 1.9 引擎类型 — `src/engine/types.ts`

**文件路径**: `src/engine/types.ts`

**导出关键类型**:

```typescript
type PipelineTaskId =
  | 'main' | 'memory_write' | 'memory_summary' | 'memory_vector'
  | 'memory_query_rewrite' | 'memory_retrieve_plan' | 'memory_multi_round'
  | 'memory_rerank' | 'memory_retrieve_finalize' | 'memory_compile'
  | 'variable';

interface PipelineContext { /* 阶段间共享数据 */ }
interface PipelineStatus { /* UI 渲染用 */ }
interface ChatMessage { /* 消息结构 */ }
interface SendMessageOptions { /* userText + 内部 continuation 等 */ }
```

引擎内的 `LatestPipelineContext` 接口在 §1.1.2 已描述,作为扩展补充。

---

