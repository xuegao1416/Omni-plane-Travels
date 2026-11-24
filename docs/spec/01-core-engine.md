> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（1、核心引擎系统）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。
>
> 全文行号以 `src/engine/` 当前源码为准（版本 `2.8.4`）。行数为 `Get-Content -Encoding UTF8` 口径。

## 1、核心引擎系统

### 1.1 游戏引擎核心 — `src/engine/useGameEngine.ts`

**文件路径**: `src/engine/useGameEngine.ts`（1779 行）

**职责**: 整合消息发送、12 阶段管线执行、变量管理、记忆系统、世界演化、快照回滚的单一入口 React Hook。是整个引擎的入口点和调度中心。

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

（`src/engine/useGameEngine.ts:215-222`）

**GameEngine 返回接口**（类型定义在 `src/engine/types.ts:51-77`，与 `useGameEngine.ts:1766-1778` 的返回对象逐项对应）:

```typescript
interface GameEngine {
  sendMessage: (userText: string, options?: SendMessageOptions) => Promise<void>;
  cancel: () => void;
  cancelAndWait: () => Promise<void>;                 // 等待当前生成真正停下
  readonly isReadOnly: boolean;                       // getter → isSaveReadOnly()
  commitPlayerState: (state: GameState) => boolean;   // 同步接受玩家态并刷新回滚点
  preparePlayerStateJSON: (json: string) => GameState | null;
  prepareSaveCapture: () => void;
  isGenerating: boolean;                              // getter → generatingRef.current
  messages: ChatMessage[];                            // getter → messagesRef.current
  variableManager: VariableManager;                   // getter
  worldBook: WorldBookManager | null;                 // 注意 nullable
  pipelineStatus: PipelineStatus | null;              // 注意 nullable
  deleteSingleMessage: (id: string) => void;
  editMessage: (id: string, content: string) => void;
  resendFromMessage: (id: string) => Promise<void>;
  resendFromAssistantMessage: (id: string) => Promise<void>;
  rollbackToSnapshot: (msgIndex: number) => void;
  loadSave: (save: GameSave) => void;                 // 同步
  restoreCombatCheckpoint: (restore: CombatCheckpointRestore, saveId?: string) => void;
  reset: (worldDef?: WorldDef) => void;
  addMessage: (msg: ChatMessage) => void;
  retryPipeline: () => Promise<void>;
  retrySingleStage: (taskId: PipelineTaskId) => Promise<void>;
  DialogUI: ReactNode;                                // 全局对话框(选项卡/骰子/战斗结算)
}
```

> ⚠ **与代码实际行为不符（已知缺陷）**：`rollbackAndTruncate` 在 `src/engine/useGameEngine.ts:448-511` 实现了完整的四层回滚并返回 `boolean`，但**未出现在返回对象 `GameEngine` 中**（`useGameEngine.ts:1766-1778`），外部只能通过 `rollbackToSnapshot(msgIndex)` 触发回滚。修复方向在代码侧：把 `rollbackAndTruncate` 补进 `GameEngine` 接口（`src/engine/types.ts:51-77`）与返回对象，或在注释中显式标注为内部函数。

#### 1.1.1 状态定义

```typescript
// src/engine/useGameEngine.ts:215-295
const { DialogUI, alert: dlgAlert } = useDialog();
const [messages, setMessagesState] = useState<ChatMessage[]>([]);
const messagesRef = useRef<ChatMessage[]>([]);
// 双写：React 状态 + ref 同步更新，供保存捕获/取消读取同一版本
const setMessages = useCallback((value: ChatMessage[] | ((previous: ChatMessage[]) => ChatMessage[])) => {
  const next = typeof value === 'function' ? value(messagesRef.current) : value;
  messagesRef.current = next;
  setMessagesState(next);
}, []);
const sendMessageRef = useRef<((text: string, options?: SendMessageOptions) => Promise<void>) | null>(null);
const [isGenerating, setIsGenerating] = useState(false);
const generatingRef = useRef(false);                       // 防止双击/同步多次触发
const generationWaiters = useRef(new Set<() => void>());   // cancelAndWait 等待集合
const finishGeneration = useCallback(() => {
  generatingRef.current = false;
  for (const resolve of generationWaiters.current) resolve();
  generationWaiters.current.clear();
}, []);
const varMgrRef = useRef(initialVarMgr || new VariableManager(undefined, undefined, getTimeSystemFromWorld(findWorldDef(selectedWorld))));
const cancelRef = useRef<AbortController | null>(null);
const operationsRef = useRef(new TurnOperations());        // 回合归属判定（src/engine/turnSafety.ts:2）
const roundRef = useRef(0);                                // 回合计数器
const seqRef = useRef(0);                                  // 消息序号，单调递增
const worldBookRef = useRef<WorldBookManager | null>(null);
const initializedRef = useRef(false);

// 快照相关
const initialSnapshotRef = useRef<unknown>(null);          // 全局初始快照（回滚兜底）
type MemorySnapshot = ReturnType<ReturnType<typeof useMemoryStore.getState>['toJSON']>;
const initialMemorySnapshotRef = useRef<MemorySnapshot | null>(null);
const [pipelineStatus, setPipelineStatus] = useState<PipelineStatus | null>(null);
const pendingRecoveryRef = useRef<TurnRecovery | null>(null);

// 配置 ref（避免闭包 stale）
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

// 存档生命周期
const saveLifecycleRef = useRef<'active' | 'ended'>('active');
const isSaveReadOnly = () =>
  saveLifecycleRef.current === 'ended' || isCombatSaveEnded(varMgrRef.current.getState());

// 最后一轮执行器 / 执行上下文（用于重试与恢复）
const lastExecutorRef = useRef<PipelineExecutor | null>(null);
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
```

#### 1.1.2 最后一轮执行上下文 — `lastPipelineCtxRef` 的内联类型

上一轮发送的上下文**不是具名 interface**，而是 `src/engine/useGameEngine.ts:277-295` 处 `useRef` 的内联类型。它只服务于 `retryPipeline` / `retrySingleStage` / `completeTurnSettlement` / `restoreTurnRecovery` 四条恢复路径：

```typescript
// src/engine/useGameEngine.ts:277-295（共 17 个字段：12 必填 + 5 可选）
const lastPipelineCtxRef = useRef<{
  round: number;                 // 当前回合
  userText: string;              // 用户输入原文
  aiMsgId: string;               // AI 消息 ID
  batchText: string;             // 记忆批次文本（用户 + AI）
  recentContext: string;         // 最近上下文（最近 6 条消息拼接）
  playerName: string;            // 玩家名
  manager: VariableManager;      // 变量管理器引用
  worldId: string;               // 世界 ID
  saveId: string | null;         // 当前存档 ID（可为空）
  memCtx: MemoryPipelineContext; // 记忆管线上下文
  stateVersion?: string;         // 变量状态指纹（恢复前校验）
  memoryVersion?: string;        // 记忆状态指纹（恢复前校验）
  recoveryRawText?: string;      // 已落盘的原始响应（恢复比对）
  pipelineConfig: PipelineConfig;
  apiConfig: ApiConfig;
  settle?: (result: PipelineResult) => void;   // 回合结算闭包
  settlement?: TurnSettlementInput;            // 结算输入（含 done 状态位）
} | null>(null);
```

字段语义要点：

- `saveId` 是 `string | null`，不再是必填 `string`。
- 上下文不含 `world` / `variableEnabled` / `internalContinuation` / `mainSucceeded` / `rawText` / `narrative` / `progressionBaseline` / `narrativeDecisionRequest`；这些数据分散在 `TurnSettlementInput`（`src/engine/turnSettlement.ts:14-24`）与 `PipelineResult` 中。
- 状态校验靠 `stateVersion` / `memoryVersion` 两个指纹，由 `src/engine/turnRecovery.ts` 的 `recoveryVersion` / `memoryRecoveryVersion` 生成。

#### 1.1.3 sendMessage 核心流程

```
用户输入（src/engine/useGameEngine.ts:815）
  ↓
[三重守卫]
  ├─ L817 isSaveReadOnly() && !internalContinuation → onComplete({success:false, error:'此存档已封存为只读，不能继续旅程或发送正文'})
  ├─ L821 !apiConfig || generatingRef.current || !userText.trim()
  │       → error: !apiConfig ? 'API 配置缺失' : '当前不可发送正文'
  └─ L825 !internalContinuation && isCombatInteractionPaused(...) → '战斗进行中，普通聊天已暂停'
  ↓
L830-835 generatingRef.current = true; setIsGenerating(true);
         if (!internalContinuation) directorReviews.setForegroundBusy(true);   // 注意：directorReviews，非 evolutionReviews
         roundRef.current++;
         const displayUserMessage = options.displayUserMessage !== false;
  ↓
L839-841 分配消息序号
  const userSeq = displayUserMessage ? ++seqRef.current : 0;
  seqRef.current++;
  const aiSeq = seqRef.current;
  ↓
L843-852 创建消息（**用户气泡受 displayUserMessage 控制**）
  const userMsg = { id: uuid(), role: 'user', rawText: userText, round, timestamp, seq: userSeq };
  if (displayUserMessage) { addMessage(userMsg); eventBus.emit(EVENTS.MESSAGE_SENT, userMsg); }
  const aiMsgId = uuid();
  const aiMsg = { id: aiMsgId, role: 'assistant', rawText: '', round, timestamp, streaming: true, seq: aiSeq };
  addMessage(aiMsg);
  eventBus.emit(EVENTS.GENERATION_STARTED, aiMsgId);
  ↓
L854-866 建立回合归属与上下文
  const controller = operationsRef.current.begin();
  const isCurrent = () => ownsTurn() && operationsRef.current.accept(controller) && currentSaveId === saveId;
  const assertCurrent = () => { if (!isCurrent()) throw new DOMException('回合已停止或旅程已切换','AbortError'); };
  const updateTurnMessage = (updates) => { if (isCurrent()) updateMessage(aiMsgId, updates); };
  ↓
L869-885 构建管线执行器（**三参构造：round / callbacks / 可选 recovered**）
  const pipelineConfig = loadPipelineConfig();
  const executor = new PipelineExecutor(round, {
    onUpdate: () => {
      if (!ownsTurn()) return;
      const status = executor.getStatus();
      setPipelineStatus({ ...status, stages: { ...status.stages } });
      if (!onAutoSaveRef.current) captureTurnRecovery();
      if (status.stages.main.status === 'success') onAutoSaveRef.current?.();
      eventBus.emit(EVENTS.PIPELINE_UPDATE, status);
    },
  });
  setPipelineStatus(executor.getStatus());
  lastExecutorRef.current = executor;
  ↓
L888-899 回合开始前置
  options.onAccepted?.();
  ensureWorldClockOnGameState(turnStartState, getActiveWorldDef());   // 权威时钟兜底
  pinCustomModuleDefinitions(definitionDraft, worldId);               // 固定自定义模块定义
  版本不一致 → throw new DOMException('模块加载期间旅程状态已变化','AbortError')
  ↓
L903-918 记忆上下文（正文前）
  const recentContext = sanitizeForContext(messagesRef.current, round).slice(-6).map(m => m.content || '').join('\n\n');
  const memCtx = await buildMemoryContext(round, batchText, userText, recentContext, playerName, apiConfig);
  memCtx.signal = controller.signal;
  lastPipelineCtxRef.current = { round, userText, aiMsgId, batchText, recentContext, playerName,
                                 manager, worldId, saveId, memCtx, pipelineConfig, apiConfig: {...apiConfig} };
  ↓
L920-951 世界机械结算（**确定性结算先于正文生成**）
  const settlement = await prepareWorldMechanics(simEngine, { gameState: gs, world: currentWorldDef, round, turnId: aiMsgId });
  if (settlement.settled) {
    varMgrRef.current.setState(settlement.gameState);
    varMgrRef.current.applyModuleEffects(settlement.mechanicalEffects, 'periodic', enabledModules);
    mechanicalEffectsSummary = formatMechanicalEffectsSummary(settlement.mechanicalEffects);
    if (await commitWorldMechanics(simEngine, settlement, isCurrent)) { syncFromEngine(simEngine.state); }
    eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
  }
  catch → console.warn('[世界演化] 本地机械结算失败（不影响正文管线）:')
  ↓
L953-961 记忆准备
  await executeMemoryPrepareForMain(memStore, memCtx);   // 失败只 warn，正文用现有热态记忆
  ↓
L964-1004 组装结算输入
  progressionBaseline = { tierIndex: 玩家.当前段位索引 ?? 0, currentXP: 玩家.当前经验值 ?? 0 };
  const settlement: TurnSettlementInput = { world, progressionBaseline, narrativeDecisionRequest,
                                            internalContinuation, protectedState, mechanicalTickSettled, done: false };
  const settle = (pipelineResult) => {  // 变量阶段未 success/skipped 时直接 return，不结算
    const accepted = settleAcceptedTurn(manager.getState(), settlement, pipelineResult, aiMsgId, round, userText);
    manager.setState(accepted.state);
    settlement.done = true;
    eventBus.emit(EVENTS.TURN_SETTLED, manager, accepted.changeLog);
    if (boundaryEncounter) eventBus.emit(EVENTS.COMBAT_ENCOUNTER_REQUESTED, boundaryEncounter);
    eventBus.emit(EVENTS.VARIABLE_UPDATE_ENDED);
  };
  ↓
L1006-1020 executor.execute({
  config, signal, isCurrent,
  onMainAccepted: () => { if (isCurrent()) eventBus.emit(EVENTS.MESSAGE_RECEIVED, aiMsgId); },  // 事件在此触发
  varMgr, worldBook, userText, mainApiConfig, worldId,
  settlementTask: result => completeTurnSettlement(result, isCurrent),
  memoryTasks: buildMemoryTasks(memStore, memCtx, memConfig),
  mainTask: async () => { ... },
})
  ↓
mainTask（L1023-1368）
  ├─ L1031-1045 模块上下文投影
  │    const moduleProjection = buildModuleContextProjection({
  │      state: varMgrRef.current.createSafeSnapshotForPrompt(), worldDef, userText, target: 'main' });
  │    const coreSnapshot = formatSnapshotForMainAI(moduleProjection.state, clockConfigForPrompt);
  │    const varSnapshot = moduleProjection.summary
  │      ? `${coreSnapshot}\n### 【模块概览】\n> ${moduleProjection.summary}${professionDetail ? ... : ''}`
  │      : coreSnapshot;
  ├─ L1048-1060 世界书扫描注入
  │    const scanResult = worldBookRef.current.scanAndBuildInjection(scanHistory, userText);
  │    if (scanResult.beforeChar) wbInjection += scanResult.beforeChar + '\n\n';
  │    if (scanResult.afterChar)  wbInjection += scanResult.afterChar  + '\n\n';
  │    atDepthEntries.push(...scanResult.atDepthEntries);
  ├─ L1062-1109 玩家角色设定块（<PlayerProfile> / 叙事视角映射 / 自建 NPC / 职业 / 角色经历）
  ├─ L1112 编译记忆上下文
  │    const compiledMemoryContext = memStore.lastCompiledContext?.fullText || '';
  ├─ L1114-1148 剧情导演简报 directorBrief（**取代旧的世界模拟简报 + 小说主线注入**）
  │    const directive = await directorReviews.prepareForTurn({ engine, world, config, turnId, signal, context, isCurrent, onDegraded });
  │    parts.push(formatDirectorDirective(directive));
  │    parts.push(buildEncounterContext(directorState, participants));
  │    if (mechanicalEffectsSummary) parts.push(`【玩法机械 — 本轮已自动结算的确定性效果】\n${mechanicalEffectsSummary}`);
  │    失败 → useSimulationStore.getState().setLastError(...)
  ├─ L1154-1160 玩家决策记录
  │    narrativeDecisionRequest.decisionIds = decisionSnapshot.decisionIds;
  │    const playerDecisionContext = [getPlayerDecisionContext(), decisionSnapshot.context].filter(Boolean).join('\n\n');
  ├─ L1162-1184 预设与生图/格式补尾开关（内联生图条目注入、useFormatRepairGuard 判定）
  ├─ L1185-1199 组装系统提示
  │    const assembleResult = assembleSystemPrompt(preset, {
  │      varSnapshot, wbInjection, playerProfileBlock,
  │      firewallTitle: ROLE_COGNITION_FIREWALL_TITLE, firewallContent: ROLE_COGNITION_FIREWALL_CONTENT,
  │      userText, round, macroEngine, compiledMemoryContext, directorBrief, playerDecisionContext,
  │      userPersonaName });
  ├─ L1200-1211 系统提示尾部追加（生图格式提醒 / 图形化战斗边界 / 权威时间裁决 + <TimeAdvance> 契约）
  ├─ L1213-1231 构建 API 消息（**userText 先并入 chatHistory 再做 atDepth 注入**）
  │    const chatHistory = sanitizeForContext(messagesRef.current, round);
  │    const mergedAtDepth = [...resolvedWbAtDepth, ...(assembleResult.depthEntries || [])];
  │    const chatHistoryWithDepth = injectAtDepthEntries(
  │      [...chatHistory, { role: 'user', content: userText }], mergedAtDepth);
  │    let apiMessages = [{ role: 'system', content: systemPrompt }, ...chatHistoryWithDepth];
  ├─ L1233-1235 尾部 assistant 预填充（SillyTavern 兼容）
  ├─ L1236-1256 tool-channel → syntheticTool（工具通道替代 Tavern 请求钩子）
  ├─ L1258-1273 请求（**强制非流式**）
  │    const narrativeApiConfig = { ...apiConfig, stream: false };
  │    const result = await requestStreamWithRetry(narrativeApiConfig, apiMessages, {
  │      signal: controller.signal,
  │      onDelta: (_delta, acc) => { if (isCurrent()) { accumulated = acc; updateTurnMessage({ rawText: applyCombatBoundary(acc) }); } },
  │      ...presetRequestOpts });
  ├─ L1276-1296 空响应重试（**仅重试 1 次**）
  │    if (!rawText.trim()) {
  │      const retryResult = await requestStreamWithRetry(...);   // 第 2 次，不再继续
  │      if (!rawText.trim()) {
  │        fallbackText ? rawText = `<contenttext>${fallbackText}</contenttext>`
  │                     : throw new Error('模型返回空内容，可能触发了服务商内容审核或上下文过滤；请重试，或先回滚到较早快照再继续。');
  │      }
  │    }
  ├─ L1300-1337 格式补尾三段式
  │    buildDeepSeekRepairPrompt → appendDeepSeekRepair → 仍不完整则 ensureDeepSeekResponseFallback（本地兜底选项）
  ├─ L1339-1345 StatusPlaceHolderImpl 替换
  │    移除占位符；若正文变空，填入内联硬编码的欢迎语（**无 defaultWelcomeText 常量**）
  ├─ L1347 applyCombatBoundary(rawText)
  ├─ L1351-1359 记忆批次回填
  │    const completedBatchText = buildMemoryBatchText(userText, extractContentForPrompt(rawText).trim() || rawText);
  │    memCtx.batchText = completedBatchText; memCtx.assistantText = ...;
  │    lastPipelineCtxRef.current.batchText = completedBatchText;
  ├─ L1362-1365 updateTurnMessage({ rawText, streaming: false });
  └─ L1367 return { text: rawText, parsed: { content: extractContentForPrompt(rawText), thinking: '' } };
  ↓
L1370-1389 主线提交后
  const mainContent = pipelineResult.mainResult?.parsed.content?.trim() || '';
  await reviewCommittedTurn({ turnId, round, narrative: mainContent, playerInput: userText,
                              canReview: () => canReviewCommittedTurn(executor.getStatus()), signal });
  if (internalContinuation && 失败) removeMessage(aiMsgId);
  setPipelineStatus(pipelineResult.status);
  ↓
L1391-1412 catch
  AbortError：不覆盖已生成正文，仅置 streaming:false（正文为空则写 '[已停止生成]'）
  internalContinuation：removeMessage(aiMsgId)
  其他：保留已流式输出的正文，追加 `\n\n⚠️ [管线错误] ${errMsg}`（无正文时写 `[错误] ${errMsg}`）
  ↓
L1413-1437 finally
  if (!ownsTurn()) return;
  if (executor.getMainResult()) {
    saveSnapshot(varMgrRef, updateMessage, aiMsgId, round, gameTime, messagesRef.current);  // 6 个实参
    setMessages(prev => optimizeSnapshots(prev));
  }
  captureTurnRecovery();
  finishGeneration(); setIsGenerating(false);
  directorReviews.setForegroundBusy(false);
  eventBus.emit(EVENTS.GENERATION_ENDED, aiMsgId);
  options.onComplete?.(completion); onAutoSaveRef.current?.();
```

**记忆任务集合**（`buildMemoryTasks`，`src/engine/useGameEngine.ts:152-172`）返回：

```typescript
{
  write,            // memory_write
  summary,          // memory_summary
  vector,           // memory_vector（仅 memConfig.vectorEnabled 时存在）
  queryRewrite, retrievePlan, multiRound, rerank,   // 三阶段均包了 withDegradationCheck
  retrieveFinalize, compile,
  debugLogger,
}
```

变量阶段**不由外部 `variableTask` 注入**：`PipelineExecutor.execute` 的参数表里没有该字段，变量阶段由执行器内部 `executeVariable()`（`src/engine/pipelineExecutor.ts:290-341`）调用 `runTurnVariableExtraction()`（`pipelineExecutor.ts:309`）完成，延迟与重试读 `config.variableDelayMs` / `config.variableMaxRetries`。

#### 1.1.4 回合终结后处理 — `completeTurnSettlement` + `settleAcceptedTurn`

后处理**不在 sendMessage 内联**，而是跟随 `settlement` 阶段执行，分两层：

**第一层：`completeTurnSettlement`（`src/engine/useGameEngine.ts:1458-1476`）** — 只负责「提交结算 + 自定义模块生命周期」：

```typescript
const completeTurnSettlement = async (result: PipelineResult, isCurrent: () => boolean) => {
  const ctx = lastPipelineCtxRef.current;
  if (!ctx?.settlement || !isCurrent()) throw new DOMException('回合已失效', 'AbortError');
  ctx.settle?.(result);                                  // → 下面的 settle 闭包
  if (!ctx.settlement.done) throw new Error('变量尚未接纳，请先补交变量提取，再结算本轮玩法。');
  if (!ctx.settlement.internalContinuation && !ctx.settlement.modulesDone) {
    const moduleResult = await runCustomModuleTurnLifecycles(ctx.manager.getState(), ctx.worldId, {
      round, tick, settled: mechanicalTickSettled, time, now: Date.now(),
    }, { isCurrent, getCurrentState, commit, notify });
    ctx.settlement.modulesDone = true;
  }
};
```

**第二层：`settleAcceptedTurn`（`src/engine/turnSettlement.ts:27-118`）** — 真正改写状态：

```typescript
export function settleAcceptedTurn(
  state: GameState,
  input: TurnSettlementInput,       // { world?, progressionBaseline, narrativeDecisionRequest, internalContinuation,
                                    //   protectedState?, done, modulesDone?, mechanicalTickSettled?, encounter? }
  pipelineResult: PipelineResult,
  aiMsgId: string,
  round: number,
  userText: string,
) {
  const settlementManager = new VariableManager(state, undefined, getTimeSystemFromWorld(settlementWorld));

  // 1. 叙事决策结算 + 战斗态保护
  let narrativeState = settleNarrativeResponse(settlementManager.getState(), {
    status: 'success', narrativeId: aiMsgId, content: mainContent,
    saveId: narrativeDecisionRequest.saveId, decisionIds: narrativeDecisionRequest.decisionIds,
  });
  if (input.protectedState) narrativeState = preserveCombatOwnedState(narrativeState, input.protectedState);
  settlementManager.setState(narrativeState);

  // 2. 世界时钟推进（仅非 internalContinuation）
  const suggestion = resolveTurnTimeAdvance({ rawResponse, narrativeText: mainContent, userText, clock, config });
  if (suggestion && suggestion.minutes > 0) {
    const nextClock = advanceWorldClockForTurn(currentClock, clockConfigForTurn, suggestion.minutes, {
      reason: suggestion.reason,
      source: suggestion.source === 'player-explicit' ? 'local-estimate' : 'ai',
      turnId: aiMsgId, round,
    });
    if (nextClock.elapsedMinutes !== currentClock.elapsedMinutes) {
      stateBeforeClock.世界.时间系统.时钟 = nextClock;
      stateBeforeClock.世界.时间系统.当前时间 = formatWorldClock(nextClock, clockConfigForTurn);
    }
  }

  // 3. 成长/职业结算
  settleProgressionAction(settlementManager, progressionConfig, userText, progressionBaseline,
                          professionConfig?.abilityPointsPerTier);

  // 4. 战斗态再保护一次
  if (input.protectedState) settlementManager.setState(preserveCombatOwnedState(...));

  // 5. 资源/周期收尾
  return settleTurnCycles(...);     // src/gameplay/settleTurnCycles.ts:13
}
```

要点：

- 不再有 `finalizeNormalTurn` 函数，也没有 `narrativeCommitted` 字段（`ChatMessage` 无此字段，见 `src/engine/types.ts:10-32`）。
- 世界机械结算（`prepareWorldMechanics` / `commitWorldMechanics`）发生在**正文之前**的 `useGameEngine.ts:920-951`，不在后处理里。
- 自定义模块的回合生命周期走 `runCustomModuleTurnLifecycles`（`src/custom-modules/engineBridge.ts:81`），其中包含原来的 onTurnEnd / onTick 语义。
- 演化评审由 `reviewCommittedTurn`（`src/engine/useGameEngine.ts:345-376`）在主线提交后触发，内部调用 `directorReviews.run({...}, { backgroundOnly })`（`:353-375`）；手动重试入口是 `retryDirectorReview`（`:377-405`），走 `directorReviews.retryBackground()` / `retryMainline()`。**不存在** `reviewLatest('mainline'/'background')` 这种 API，也不存在 `evolutionReviews`（真实单例名是 `directorReviews`，`src/simulation/SimulationApi.ts:24`）。

#### 1.1.5 快照保存机制

```typescript
// src/engine/useGameEngine.ts:175-213（模块级函数，非 useCallback）
function saveSnapshot(
  varMgrRef: React.RefObject<VariableManager>,
  updateMessage: (id: string, updates: Partial<ChatMessage>) => void,
  aiMsgId: string,
  msgIndex: number,
  gameTime?: string,
  retainedMessages: readonly ChatMessage[] = [],   // 第 6 参：用于共享历史快照、避免重复存储
) {
  try {
    // 1. 变量快照
    const snapshot = varMgrRef.current.createSnapshot();

    // 2. 记忆检查点（把保留消息的已有 checkpoint id 传进去做共享）
    const memCheckpoint = useMemoryStore.getState().createCheckpoint(
      retainedMessages.flatMap(m => m.memoryCheckpointId ? [m.memoryCheckpointId] : []));

    // 3. 世界演化快照（失败不阻断，simulationSnapshotId 可能为 undefined）
    let simulationSnapshotId: string | undefined;
    try {
      const simSnapshot = getSimulationEngine().createSnapshot(
        msgIndex, gameTime || '', false, undefined,
        retainedMessages.flatMap(m => m.simulationSnapshotId ? [m.simulationSnapshotId] : []));
      simulationSnapshotId = simSnapshot.id;
    } catch (simErr) {
      console.warn('[快照] 世界演化快照创建失败（不影响正文）:', simErr);
    }

    // 4. 绑定到 AI 消息
    updateMessage(aiMsgId, { snapshot, snapshotTime: Date.now(), memoryCheckpointId: memCheckpoint?.id, simulationSnapshotId });
  } catch (snapErr: any) {
    console.warn('[快照] 创建失败（不影响正文）:', snapErr.message);
  }
}
```

调用点：`src/engine/useGameEngine.ts:1419`（finally，条件 `executor.getMainResult()` 为真）与 `:1706`（`retryPipeline`）。

#### 1.1.6 回滚机制

```typescript
// rollbackAndTruncate（内部函数，返回 boolean；src/engine/useGameEngine.ts:448-511）
// 四层回滚：变量 → 记忆 → 演化 → 消息截断
const rollbackAndTruncate = useCallback((truncateAt: number) => {
  if (generatingRef.current || isSaveReadOnly()) return false;
  if (!canRollbackCombat(combatSession?.riskMode ?? 'normal', combatSession?.lifecycle ?? 'active')) return false;

  const currentMessages = messagesRef.current;
  const rollback = resolveRollbackTarget(currentMessages, truncateAt);   // src/engine/rollbackTarget.ts:4
  if (!rollback.ok) {
    void dlgAlert(`第 ${rollback.target.round} 轮的变量快照已被旧版清理，无法精确恢复。…`, { title: '无法精确回退' });
    return false;
  }

  // 1. 变量快照：目标快照 → 初始快照兜底 → 重建结构化时钟
  clearTurnRecovery();
  if (rollback.target?.snapshot) varMgrRef.current.restoreSnapshot(rollback.target.snapshot as GameState);
  else if (initialSnapshotRef.current) varMgrRef.current.restoreSnapshot(initialSnapshotRef.current as any);
  const restoredState = varMgrRef.current.getState();
  ensureWorldClockOnGameState(restoredState, getActiveWorldDef());
  varMgrRef.current.setState(restoredState);

  // 2. 记忆：倒序找最近一个可恢复的 checkpoint，全失效则回落到初始记忆快照
  const memStore = useMemoryStore.getState();
  let memRestored = false;
  for (let i = truncateAt - 1; i >= 0; i--) {
    if (currentMessages[i].memoryCheckpointId) {
      memRestored = memStore.restoreCheckpoint(currentMessages[i].memoryCheckpointId!);
      if (memRestored) break;
    }
  }
  if (!memRestored && initialMemorySnapshotRef.current) memStore.fromJSON(initialMemorySnapshotRef.current);
  memStore.clearPipelineOutputs();

  // 3. 世界演化：同样倒序；失败只 warn
  try {
    const simEngine = getSimulationEngine();
    for (let i = truncateAt - 1; i >= 0; i--) {
      if (currentMessages[i].simulationSnapshotId && simEngine.restoreSnapshot(currentMessages[i].simulationSnapshotId!)) break;
    }
  } catch (simErr) { console.warn('[回滚] 世界演化引擎恢复失败（不影响其他系统）:', simErr); }

  // 4. 截断消息 + 重置轮次/序号/管线状态
  roundRef.current = rollback.round;
  seqRef.current = rollback.seq;
  lastExecutorRef.current = null;
  lastPipelineCtxRef.current = null;
  setPipelineStatus(null);
  messagesRef.current = rollback.retainedMessages;
  setMessages(rollback.retainedMessages);
  return true;
}, [dlgAlert]);
```

```typescript
// rollbackToSnapshot（useCallback，返回 void；src/engine/useGameEngine.ts:514-564）
// 回滚到特定 AI 消息的快照，保留该消息本身
const rollbackToSnapshot = useCallback((msgIndex: number) => {
  if (generatingRef.current) return;
  if (isSaveReadOnly()) return;
  if (!canRollbackCombat(...)) return;

  const target = messagesRef.current[msgIndex];
  if (msgIndex < 0 || !target?.snapshot) return;         // 目标必须自带快照

  clearTurnRecovery();
  varMgrRef.current.restoreSnapshot(target.snapshot as any);

  // 记忆：从 msgIndex 起倒序找可恢复 checkpoint + 初始快照兜底
  // 演化：从 msgIndex 起倒序找可恢复 snapshot
  memStore.clearPipelineOutputs();

  const retainedMessages = currentMessages.slice(0, msgIndex + 1);
  roundRef.current = retainedMessages.reduce((max, m) => Math.max(max, m.round), 0);   // 取最大值，不是直接取 target.round
  seqRef.current = retainedMessages.reduce((max, m) => Math.max(max, m.seq ?? 0), 0);
  lastExecutorRef.current = null;
  lastPipelineCtxRef.current = null;
  setPipelineStatus(null);
  setMessages(prev => { const truncated = prev.slice(0, msgIndex + 1); messagesRef.current = truncated; return truncated; });
  try { onAutoSaveRef.current?.(); } catch (error) { console.error('[回滚] 自动保存失败:', error); }
}, []);
```

#### 1.1.7 加载存档

```typescript
// loadSave（useCallback；src/engine/useGameEngine.ts:670-785）
const loadSave = useCallback((save: GameSave) => {
  // 1. 前置守卫：生成中或存档不完整一律抛错，不替换当前旅程
  if (generatingRef.current) throw new Error('当前旅程仍在处理，请停止并等待完成后再读取存档。');
  if (!save?.id || !save.worldId || !Array.isArray(save.messages) || !save.gameState)
    throw new Error('存档缺少完整的旅程状态，未替换当前旅程。');

  // 2. 重建快照共享 + 清理冗余快照
  save = structuredClone({ ...save,
    messages: optimizeSnapshots(save.messages),
    memoryRuntime: savedMemory?.checkpoints ? { ...savedMemory, checkpoints: shareSnapshotHistory(savedMemory.checkpoints) } : save.memoryRuntime,
    simulationState: save.simulationState ? { ...save.simulationState, snapshots: shareSnapshotHistory(save.simulationState.snapshots ?? []) } : save.simulationState,
  });

  // 3. 世界定义：优先存档内自建世界，其次内置
  const saveWorldDef = (save.customWorld as WorldDef | undefined) ?? findWorldDef(save.worldId);

  // 4. 重建 VariableManager
  const migratedClockState = ensureWorldClockOnGameState(save.gameState, saveWorldDef);
  const restoredManager = VariableManager.fromJSON({
    state: migratedClockState, saveId: save.id,
    moduleStates: save.moduleStates, moduleCheckpoints: save.moduleCheckpoints,
  }, getTimeSystemFromWorld(saveWorldDef));

  // 5. 自建世界回填 localStorage
  if (save.customWorld) { /* 写入 STORAGE_KEYS.CUSTOM_WORLDS */ }

  // 6. v3 状态迁移 + 特性开关对齐
  const preparedGameplayState = prepareGameplayState(normalizeGameStateV3(normalizedSaveState), saveWorldDef?.modules, { mode: 'load' }).state;
  const preparedSaveState = synchronizeV3FeatureFlagsForWorld(preparedGameplayState, {
    professionsEnabled: isProfessionModuleEnabled(saveWorldDef),
    combatEnabled: saveWorldDef?.modules?.some(m => m.moduleId === 'combat' && m.enabled) === true,
    fallbackRiskMode: save.personalInfo?.combatRiskMode ?? 'normal',
  });
  restoredManager.setState(preparedSaveState);
  restoredManager.setWorldClockConfig(getTimeSystemFromWorld(saveWorldDef));

  // 7. 生命周期与 ref 群
  clearTurnRecovery();
  saveLifecycleRef.current = save.lifecycle === 'ended' ? 'ended' : 'active';
  activeWorldDefRef.current = saveWorldDef;
  selectedWorldRef.current = save.worldId;
  playerProfileRef.current = save.personalInfo ?? null;
  characterHistoryRef.current = save.characterHistory ?? '';
  setMessages(save.messages);
  varMgrRef.current = restoredManager;

  // 8. 初始快照：优先第一条带快照的消息，兜底用当前状态
  const firstMsg = save.messages.find(m => m.snapshot);
  initialSnapshotRef.current = firstMsg?.snapshot
    ? ensureWorldClockOnGameState(structuredClone(firstMsg.snapshot) as any, saveWorldDef)
    : varMgrRef.current.createSnapshot();

  // 9. 轮次与序号取最大值
  roundRef.current = save.messages.length ? save.messages.reduce((max, m) => Math.max(max, m.round), 0) : 0;
  seqRef.current = save.messages.length ? Math.max(...save.messages.map(m => m.seq ?? 0)) : 0;

  // 10. 世界书 / 记忆 / 演化
  if (save.worldId && worldBookRef.current) applyWorldAndModules(worldBookRef.current, save.worldId);
  memStore.resetMemoryRuntime();
  memStore.clearPipelineOutputs();
  if (save.memoryRuntime || save.memoryConfig || save.vectorMemory) {
    memStore.fromJSON({ memoryRuntime: save.memoryRuntime, config: save.memoryConfig, vectorMemory: save.vectorMemory });
  }
  initialMemorySnapshotRef.current = memStore.toJSON();
  if (save.simulationState) restoreEngineState(save.simulationState);
  else getSimulationEngine().reset();

  // 11. 未完成回合的恢复
  const recovery = readTurnRecovery(lastMessage?.turnRecovery);
  if (recovery && 版本/归属全部匹配) {
    pendingRecoveryRef.current = recovery;
    const restored = new PipelineExecutor(recovery.round, { onUpdate: () => {} }, recovery.result);
    setPipelineStatus(restored.getStatus());
  }
}, []);
```

---

### 1.2 管线执行与上下文管理

#### 1.2.1 管线执行器 — `src/engine/pipelineExecutor.ts`

**文件路径**: `src/engine/pipelineExecutor.ts`（373 行）

**职责**: 12 阶段管线的编排器，支持同层并行/层间串行执行；`settlement` 阶段在层循环之后单独执行。

```typescript
// 核心类（非 interface）
export class PipelineExecutor {
  constructor(round: number, callbacks: PipelineCallbacks, recovered?: PipelineResult);  // 第三参用于回放已恢复的管线结果
  getStatus(): PipelineStatus;
  getMainResult(): PipelineResult['mainResult'];
  async execute(params: {
    config: PipelineConfig;
    mainTask: () => Promise<{ text: string; parsed: ParsedResponse }>;
    varMgr: VariableManager;
    worldBook: WorldBookManager | null;
    userText: string;
    mainApiConfig: ApiConfig;
    worldId?: string;
    signal: AbortSignal;
    isCurrent?: () => boolean;                       // 回合归属校验
    resume?: boolean;                                // 续跑同一回合，跳过已成阶段
    onMainAccepted?: () => void;                     // 主线成功提交后的回调
    memoryTasks?: MemoryTasks;
    settlementTask?: (result: PipelineResult) => Promise<void>;
  }): Promise<PipelineResult>;
  async retryStage(
    taskId: PipelineTaskId,
    taskFn: () => Promise<void>,
    isCurrent: () => boolean = () => true,           // 第三参：单步重试的归属校验
  ): Promise<void>;
}
```

```typescript
// PipelineTaskId — 阶段标识（联合类型，12 个值；src/engine/pipelineTypes.ts:6-18）
type PipelineTaskId =
  | 'main'                       // 正文生成
  | 'memory_write'               // 叙事记忆写入
  | 'memory_summary'             // 摘要保存
  | 'memory_query_rewrite'       // 查询改写
  | 'memory_retrieve_plan'       // 检索规划
  | 'memory_multi_round'         // 多轮补充
  | 'memory_rerank'              // 精排
  | 'memory_retrieve_finalize'   // 检索收尾
  | 'memory_compile'             // 上下文编译
  | 'memory_vector'              // 向量事实提取
  | 'variable'                   // 变量提取
  | 'settlement';                // 本地玩法、时间及模块回合收尾

// PipelineStageStatus — 阶段状态（独立导出类型；src/engine/pipelineTypes.ts:21）
type PipelineStageStatus = 'pending' | 'running' | 'success' | 'warning' | 'error' | 'skipped';

// PipelineStageResult — 单阶段结果（src/engine/pipelineTypes.ts:24-36）
interface PipelineStageResult {
  status: PipelineStageStatus;
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

// PipelineStatus — 管线状态快照（src/engine/pipelineTypes.ts:39-44）
interface PipelineStatus {
  round: number;
  stages: Record<PipelineTaskId, PipelineStageResult>;
  startTime: number;
  endTime?: number;
}

// PipelineConfig — 执行配置（src/engine/pipelineTypes.ts:47-58）
interface PipelineConfig {
  executionOrder: PipelineTaskId[][];   // 二维数组，同层并行、层间串行
  variableEnabled: boolean;
  variableDelayMs: number;              // 默认 1000（1 秒），界面按 0-10 秒钳位
  variableMaxRetries: number;           // 默认 3，钳位 0-5
  memoryEnabled: boolean;
}
```

**默认执行顺序**（`src/engine/pipelineTypes.ts:72-82`，共 9 层，**`settlement` 不在其中**）:

```typescript
export const DEFAULT_EXECUTION_ORDER: PipelineTaskId[][] = [
  ['main'],
  ['memory_write', 'memory_summary', 'memory_vector'],   // 写入阶段并行
  ['memory_query_rewrite'],
  ['memory_retrieve_plan'],
  ['memory_multi_round'],
  ['memory_rerank'],
  ['memory_retrieve_finalize'],
  ['memory_compile'],
  ['variable'],
];
```

**阶段标签** `STAGE_LABELS`（`src/engine/pipelineTypes.ts:85-98`）覆盖全部 12 个阶段，其中 `settlement: '玩法结算'`（`:97`）；`createPipelineStatus`（`:101-120`）在初始化时同样包含 `settlement: { status: 'pending', label: STAGE_LABELS.settlement }`（`:116`）。

**执行流程**（`src/engine/pipelineExecutor.ts:100-177`）:

```
execute()
  ├─ 逐层遍历 config.executionOrder（层内并行、层间串行）
  │    ├─ 层内过滤：variable 关闭 / memory 关闭 → 该阶段标记 skipped
  │    ├─ 纯本地阶段（memory_retrieve_finalize / memory_compile）不限流
  │    ├─ 含 main 的层：先 executeMain → onMainAccepted → 限流 → 并行跑该层其余任务
  │    └─ 不含 main 的层：整层 Promise.allSettled 并行
  ├─ 层循环结束后：assertCurrent()
  ├─ settlement 阶段单独执行（不占 executionOrder 的层）
  │    └─ executeMemoryTask('settlement', Boolean(mainResult), settlementTask ? ... : undefined)
  └─ 返回 { mainResult, status }
```

**失败语义**（与直觉相反，需注意）:

- `settleTasks()`（`:179-184`）用 `Promise.allSettled` 后**抛出第一个 rejected**，即同层任一任务抛错会向调用方冒泡。
- 但 `executeMemoryTask()`（`:255-287`）在 catch 里**不重新抛出**（AbortError 除外）：只把阶段状态置为 `warning`（错误信息以 `[降级]` 开头时）或 `error`，写 `debugLogger` 与 `console.warn`，管线继续。
- `executeVariable()`（`:290-341`）同样吞掉非 AbortError 异常，注释明确「变量提取失败不应阻断管线，快照仍需保存以保持轮次连续性」。
- 因此**记忆与变量阶段的失败默认不会中断回合**，只有 `main` 阶段失败会冒泡。旧文档「任一失败 → 抛出异常 → 外部降级处理」的表述不准确。

`RETRYABLE_STAGES`（`:20-25`）列出 10 个可重试阶段，包含 `settlement`（`:24`）；`LOCAL_ONLY_STAGES`（`:17`）为 `memory_retrieve_finalize` 与 `memory_compile`。

#### 1.2.2 上下文管理器 — `src/engine/contextManager.ts`

**文件路径**: `src/engine/contextManager.ts`（53 行）

```typescript
export function getMessageContent(msg: ChatMessage): string    // :12，返回 msg.rawText || ''
export function sanitizeForContext(messages: ChatMessage[], currentRound: number): Message[]   // :17
```

`sanitizeForContext` 的行为：

- `MAX_HISTORY = 20`（`:18`）、`SUMMARY_DEPTH_THRESHOLD = 10`（`:19`）。
- 内置 API 正则（`getBuiltinPromptScripts()`）**始终执行**，叠加当前预设里 `promptOnly && !disabled` 的正则（`:21-23`）。
- 只取 `m.round < currentRound` 的最近 20 条（`:26-28`）。
- assistant 消息先走 `extractContentForPrompt` 抽正文，再走 `processRegexScripts(content, promptScripts, 'Output', depth)` 清元数据（`:32-40`）。
- `depth > 10` 时退化为 `m.summary || content`（`:43-45`）。
- 压缩多余空行（`/\n{3,}/g`）并过滤空内容（`:49-52`）。

---

### 1.3 变量管理器 — `src/engine/variableManager.ts`

**文件路径**: `src/engine/variableManager.ts`（1059 行）

**职责**: 游戏状态变量的路径访问、事务式更新、快照、模块效果应用、NPC 感知。

```typescript
class VariableManager {
  constructor(
    initial?: GameState,
    moduleRuntime?: { saveId: string; current: readonly ModuleStateRecord[]; checkpoints?: readonly ModuleStateRecord[] },
    worldClockConfig?: Partial<WorldClockConfig>,
  )                                                                         // :129

  // 状态访问
  getState(): GameState                                                     // :174
  setState(state: GameState): void                                          // :179

  // 路径访问（支持 NPC 名称 → 规范 ID 的自动映射）
  getVar(path: string, defaultValue?: unknown): unknown                     // :192
  setVar(path: string, value: unknown, forceReplace = false): void          // :199

  // AI 事务更新（只接受 GameplayTransaction JSON，不做自由文本解析）
  applyUpdateVariable(updateText: string): boolean                          // :557
  applyAiUpdateVariable(updateText: string): boolean                        // :552（转调上一行）

  // 快照
  createSnapshot(): GameState                                               // :949
  createSafeSnapshotForPrompt(): GameState                                  // :597（排除 NPC 私密字段）
  restoreSnapshot(snapshot: GameState): void                                // :979

  // 模块效果应用：source 有 4 个取值，返回效果日志而非 void
  applyModuleEffects(
    effects: ModuleEffects,
    source: 'rule' | 'periodic' | 'ai' | 'npc',     // 默认 'rule'
    enabledModules?: string[],                       // 可选，用于校验模块开关
  ): EffectLogEntry[]                                // :784-788

  // 世界状态更新（规则引擎用）
  applyWorldStateUpdate(updates: Record<string, Record<string, string>>): void   // :923

  // 存档持久化（返回内联结构，无独立类型名）
  createModulePersistenceBundle(saveId: string): {
    coreState: GameState;
    current: ModuleStateRecord[];
    checkpoints: ModuleStateRecord[];
  }                                                                          // :160-172

  // 静态重建
  static fromJSON(data: {
    state: GameState; saveId?: string;
    moduleStates?: readonly ModuleStateRecord[]; moduleCheckpoints?: readonly ModuleStateRecord[];
  }, worldClockConfig?: Partial<WorldClockConfig>): VariableManager           // :1047
}
```

**`applyUpdateVariable` 的校验链**（`src/engine/variableManager.ts:557-575`）:

1. `JSON.parse(updateText)` 失败 → `rejectAiUpdate('JSON解析失败…')`。
2. 非对象 → `'GameplayTransaction 必须是 JSON 对象'`。
3. 顶层出现 `AI_TRANSACTION_KEYS` 之外的键 → 拒绝并列出允许字段。
4. `conditions` / `costs` / `effects` / `rewards` / `events` 至少要有一个是数组。
5. `isAllowedAiTransaction(parsed)` 校验事务结构与权限。
6. 通过后交由 `applyGameplayTransactionPayload(parsed)` 落地。

#### 1.3.1 InventoryItem 完整结构

```typescript
// src/schema/variables.ts:39-52
interface InventoryItem {
  数量: number;
  类型: string;                                            // 自由字符串，不是字面量联合
  品质: '普通' | '精良' | '稀有' | '史诗' | '传说';
  备注: string;

  // 可选的、语义化的战斗用途（本地结算拥有全部数值，存档不接受来自正文的任意伤害/治疗值）
  战斗用途?: {
    类型: 'heal' | 'resource' | 'damage' | 'cleanse' | 'buff';
    目标?: 'self' | 'ally' | 'enemy';
  };
}
```

字段说明：`InventoryItem` **没有** `数值` / `持续回合` / `等级` / `耐久度` / `附魔` / `套装id`；`类型` 是 `string` 而非 8 值联合；`战斗用途.类型` 只有 5 个取值（无 `debuff` / `shield`），`目标` 只有 3 个（无 `all`）。

#### 1.3.2 NPCData 完整结构

```typescript
// src/schema/variables.ts:330-379
interface NPCData {
  姓名: string;
  种族: string;
  性别: string;
  年龄: string | number;
  背景?: string;
  生存状态: SurvivalStats;
  战斗状态?: '正常' | '失去战力' | '重伤' | '死亡';

  // 社会身份（只有 2 个字段）
  社会身份: { 职业: string; 社会地位: string };

  // 关系数据是单个对象，不是以玩家 ID 为 key 的 Record
  关系数据: {
    好感度: number;
    关系类型: string;
  };

  // 个人信息（状态类字段全部嵌套在此，不是扁平顶层）
  个人信息: {
    外貌: string;
    表性格: string;
    里性格: string;
    当前想法: string;
    当前穿着: string;
    当前位置: string;
    当前状态: string;
    备注: string;
  };

  重要NPC: boolean;
  _关注: boolean;
  $time: number;

  // NPC 管理扩展字段
  人物分类?: '在场' | '离场' | '重点';
  人物事迹?: string[];
  种族描述?: string;
  种族效果?: string;
  种族特性?: string[];
  性格?: string;
  穿着?: string;
  当前行动?: string;
  短期目标?: string;
  长期目标?: string;
  内心想法?: string;

  // 成长体系（嵌套在 成长状态 下，不是顶层字段）
  成长状态?: {
    当前段位索引?: number;
    当前经验值?: number;
    可用属性点?: number;
  };

  天赋?: string[];
  技能列表?: string[] | Record<string, unknown>;
  物品列表?: string[] | Record<string, unknown>;
  装备列表?: Record<string, unknown>;
}
```

字段说明：`社会身份` 只有 `职业` / `社会地位`（无 `组织` / `特殊身份`）；`关系数据` 是单对象（无 `关系名称` / `互动次数` / `最后互动时间`）；`个人信息` 内字段名是 `表性格` / `里性格`（不是 `性格` / `隐藏性格`）；段位与经验在 `成长状态` 下；`技能列表` / `物品列表` 是 `string[] | Record<string, unknown>`；**不存在** `立绘` 字段。剧情中会增减的随身物品是可选的 `物品栏`（`src/schema/variables.ts:396`，与静态 `物品列表` 一起占用 NPC 的行囊格子），穿戴中的装备是可选的 `装备栏`（`:398`，部位 → 物品，结构同 `玩家.装备栏`，读取时与旧 `装备列表` 合并）；玩家的 `物品栏` / `装备栏` 见 `:281` / `:286`。

#### 1.3.3 安全机制详解

```typescript
// src/engine/variableManager.ts:24-28（模块内 const，未 export）
const DANGEROUS_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);   // 原型链污染防护
const AI_STATE_ROOTS = new Set(['世界', '玩家', '人物档案']);                          // AI 可写入的状态根
const AI_TRANSACTION_KEYS = new Set([
  'id', 'moduleId', 'source', 'label', 'conditions', 'costs', 'effects', 'rewards', 'events',
]);
const AI_FORBIDDEN_FIELDS = new Set(['before', 'after']);                              // 事务中禁止出现的字段
```

#### 1.3.4 快照机制详解

```typescript
// createSafeSnapshotForPrompt() — 供提示词使用的净化快照（src/engine/variableManager.ts:597）
// 复制 state 后，用 selectPlayerKnownNPCs + createPromptSafeNpcSnapshot 重建人物档案，
// 并删除 人物已知资料 / playerKnowledge，避免 {{getvar}} 读到 NPC 内心想法。

// _slimForSnapshot() — 存档快照瘦身（私有，src/engine/variableManager.ts:956-976）
// 人物档案的长文本字段超过 200 字截断并追加 "…"，字段清单（:964）：
//   背景 / 外貌 / 表性格 / 里性格 / 当前想法 / 当前穿着 / 当前状态 / 内心想法 / 备注；
// 并移除 portraitUrl 等大型缓存字段（:970）；人物事迹全量保留，不截断。
```

---

### 1.4 变量/业务/成长提取

| 文件 | 职责 | 调用时机 |
| --- | --- | --- |
| `src/engine/variableExtraction.ts`（542 行） | 通过 `runVariableExtraction(...)` 提取变量并写入 VariableManager（返回 void，不产出 patch 数组） | `pipelineExecutor.executeVariable()` → `runTurnVariableExtraction()` |
| `src/engine/turnVariableExtraction.ts`（26 行） | 事务包装层：在 draft 管理器上跑提取，版本比对通过后一次性提交 | 管线 variable 阶段 |
| `src/engine/progressionSettlement.ts`（68 行） | 经验结算/段位升级/突破处理（`settleProgressionAction`） | `settleAcceptedTurn` 内部，正文提交后 |
| `src/engine/turnSettlement.ts`（118 行） | 回合终结结算：叙事决策、时钟推进、成长结算、周期收尾 | `settlement` 阶段 |
| `src/engine/responseExtractor.ts`（73 行） | 从原始响应中提取 `contenttext` 正文并剥离思维链 | mainTask 全流程（L1353/1367 等） |
| `src/engine/deepSeekResponseGuard.ts`（124 行） | 检测并补齐被截断的 DeepSeek 响应 | mainTask 格式补尾（L1300-1337） |
| `src/engine/worldPersonality.ts`（28 行） | **世界书装载与世界条目切换**（`loadWorldBook` / `applyWorld`） | 引擎初始化与 `loadSave` |

> ⚠ **与代码实际行为不符（已知缺陷）**：`src/engine/worldPersonality.ts` 的命名与内容不符——文件里只有世界书管理器的创建（`loadWorldBook`，`:4`）与世界专属条目注入（`applyWorld`，`:14`），**不含任何「世界人格 / 语气风格种子 / 价值观」实现**，也没有任何代码把它注入 system prompt。修复方向在代码侧：要么把文件重命名为 `worldBookBootstrap.ts` 使其名副其实，要么补齐人格种子模块并在 `assembleSystemPrompt` 前置区块中真正注入。

**关于「业务（经营）」**：`src/engine/` 下**不存在** `businessExtraction.ts`（旧文档所列已过时）。业务结算的实现在 `src/gameplay/modules/business.ts`（319 行，导出 `previewBusinessModule` / `purchaseBusinessAsset` / `upgradeBusinessAsset` / `assignBusinessStaff` / `settleBusinessCycle`，见 `:85`、`:109`、`:151`、`:184`、`:207`）；`VariableManager` 只负责把 `effects.business` 白名单化并落成 `玩家.经营资产.资金` 等路径（`src/engine/variableManager.ts:713-721`、`:847-854`），变量提取器里则只保留字段名映射表（`src/engine/variableExtraction.ts:217`）。

**调用关系图**:

```
mainTask 完成
   ↓
extractContentForPrompt(rawText) → contentText      // 函数名是 extractContentForPrompt，非 extract
   ↓
runTurnVariableExtraction({ varMgr, parsed, round, userText, mainApiConfig, worldBook, worldId,
                            delayMs, maxRetries, signal, isCurrent?, onEncounter?, onUpdate? })
   // 内部先 clone draft manager，提取成功后做版本比对再 setState（返回 void）
   ↓
settleAcceptedTurn(state, input, pipelineResult, aiMsgId, round, userText)
   ↓
settleProgressionAction(manager, config, userText, baseline, professionAbilityPointsPerTier?)
   ↓
settleTurnCycles(...) → 事件 EVENTS.TURN_SETTLED
```

**`runVariableExtraction` 说明**（`src/engine/variableExtraction.ts:251-267`）:

- 签名：`runVariableExtraction(params: { varMgr; parsed; round; userText; mainApiConfig; worldBook; worldId; delayMs; maxRetries; signal?; isCurrent?; onEncounter?; onUpdate? }): Promise<void>`
- 行为：直接对 `varMgr` 做变量解析并调用 `applyUpdateVariable`，**返回 void**，不产出结果对象；源码中不存在 `VariableExtractionResult` 接口、`extractVariables` 函数或 `variableExtraction.run` 方法。
- 提示词中会带上 `simulationRuntime.effectLog.slice(-12)`（`:245-246`），防止正文重复提及已机械结算的效果而被二次加减。

---

### 1.5 宏引擎 — `src/engine/macroEngine.ts`

**文件路径**: `src/engine/macroEngine.ts`（186 行）

**实际支持的宏共 13 类**（按 `processPass` 处理顺序，`src/engine/macroEngine.ts:75-184`）:

| 宏 | 语法 | 用途 | 行号 |
| --- | --- | --- | --- |
| 注释 | `{{// ... }}` | 剥离，兼容 SillyTavern 多行注释 | `:79` |
| 写入变量 | `{{setvar::key::value}}` | 写入游戏变量（副作用） | `:82` |
| 追加变量 | `{{addvar::key::value}}` | 追加到现有变量（字符串拼接，SillyTavern 兼容） | `:88` |
| 递增 | `{{incvar::key}}` | 变量 +1 | `:96` |
| 递减 | `{{decvar::key}}` | 变量 -1 | `:103` |
| 读取变量 | `{{getvar::key}}` | 读取游戏变量 | `:110` |
| 清理 | `{{trim}}` | 返回空串，压缩残留空行 | `:115` |
| 玩家名 | `{{user}}` | 由 AssemblerContext 注入的玩家角色名 | `:118` |
| 上一条输入 | `{{lastUserMessage}}` | 本轮用户输入原文 | `:119` |
| 随机选择 | `{{random::a::b}}` 或 `{{random::a,b}}` | 随机选取（两种分隔符都支持） | `:122-127` |
| 骰子 | `{{roll NdM+K}}` | 投掷骰子（正则 `(\d+)d(\d+)(?:([+-])(\d+))?`，结果下限 0） | `:130-142` |
| 条件分支 | `{{#if::condition::true::false}}` | 条件渲染，支持 `==` / `!=`，非空即真 | `:145-162` |
| 通用查找 | `{{key}}` | 按 key 兜底查找变量，未命中保留原文 | `:168-182` |

**保留占位符**: `{{VAR_SNAPSHOT}}`（`:164`）在此不处理，留给 `promptAssembler` 在组装时做延迟绑定。

**嵌套处理**: `resolve()`（`:64-72`）使用 `for (let depth = 0; depth < 10; depth++)` 迭代展平，**最多 10 轮**，某轮无变化即提前退出，防止无限循环。

---

### 1.6 提示词组装器 — `src/engine/promptAssembler.ts`

**文件路径**: `src/engine/promptAssembler.ts`（285 行）

**组装器自身负责的 7 个区块**（`assembleSystemPrompt(preset, ctx)`，`src/engine/promptAssembler.ts:111-252`，最终拼接顺序见 `:214-244`）:

| 序号 | 区块 | 说明 | 行号 |
| --- | --- | --- | --- |
| 1 | `wbInjection` | 世界书注入（beforeChar + afterChar 合并），拼接前过一遍宏引擎 | `:216-219` |
| 2 | `playerProfileBlock` | 玩家角色设定块 | `:221-223` |
| 3 | `firewallTitle + firewallContent` | 角色认知防火墙 | `:225-227` |
| 4 | `compiledMemoryContext` | 编译后的记忆上下文 | `:230-232` |
| 5 | `directorBrief` | 剧情导演指导（放在记忆之后、玩家决策之前） | `:235-237` |
| 6 | `playerDecisionContext` | 玩家决策记录（选择卡路径 C 的 aiNote） | `:239-242` |
| 7 | `presetBody` | 预设条目主体（按 order 排序、过滤 enabled + 触发模式、逐条解析宏） | `:244` |

预设主体的处理规则（`:173-211`）:

- `{{VAR_SNAPSHOT}}` 用裁剪后的快照替换，预算 `VAR_SNAPSHOT_TOKEN_BUDGET = 1800`（`:119-120`）。
- 其余宏交给 `macroEngine.resolve()`（`:190`）。
- `injectionPosition === 1` 的条目从正文剥离，转成 `depthEntries`（默认 `depth = 4`，`:193-198`）。
- 最后一个 `role === 'assistant'` 条目剥离为 `assistantPrefill`（`:201-206`）。
- 其余条目按序 `join('\n\n')` 组成 `presetBody`（`:211`）。

**装配结果**（`AssembleResult`，`:71-91`）: `{ systemPrompt, assistantPrefill?, depthEntries, toolChannel? }`。

**工具通道**（`:124-168`）: 当预设配置了 `toolChannel` 且 description / fieldDescription / 全部 guide 条目都存在且启用时，这些条目会从普通 system prompt 与 at-depth 历史中隔离出来，另行组装为 `toolChannel` 对象（`toolNamePrefix` / `paramName` / `description` / `fieldDescription` / `controlPrompt` / `relocateContext` / `pipelineMessages`），由 `useGameEngine` 在 `:1236-1256` 转成 `syntheticTool` 传给 API。

**深度注入**（`injectAtDepthEntries`，`:264-285`）: 按 depth 从大到小插入到聊天历史，带 `[label - depth:N]` 前缀。

> 说明：系统提示的**其余部分由 `useGameEngine` 的 mainTask 内联拼接**——核心快照与模块概览（`useGameEngine.ts:1036-1045`）、生图指令（`:1162-1181`）、生图格式提醒（`:1203-1205`）、图形化战斗边界（`:1206-1208`）、权威时间裁决（`:1209-1211`）。这些不属于 `promptAssembler` 的职责。

---

### 1.7 事件总线 — `src/engine/eventBus.ts`

**文件路径**: `src/engine/eventBus.ts`（54 行）

**职责**: 全局事件发布/订阅，解耦模块间直接调用。单例导出（`:32`）。

```typescript
// 事件常量（命名用下划线 / 点号 / 冒号，非统一风格；src/engine/eventBus.ts:35-54）
export const EVENTS = {
  MESSAGE_RECEIVED: 'message_received',
  MESSAGE_SENT: 'message_sent',
  GENERATION_STARTED: 'generation_started',
  GENERATION_ENDED: 'generation_ended',
  GENERATION_STOPPED: 'generation_stopped',
  VARIABLE_UPDATE_ENDED: 'variable_update_ended',
  TURN_SETTLED: 'turn_settled',                              // 回合已接受的确定性结算
  VARIABLE_EXTRACTION_FAILED: 'variable_extraction_failed',
  CHAT_CHANGED: 'chat_changed',
  AUTO_SAVE: 'auto_save',
  PIPELINE_UPDATE: 'pipeline_update',
  EVENT_CARD: 'mod:card',                                    // addEvent 触发
  EVENT_CARD_OVERRIDE: 'mod:card:override',                  // addEvent 覆盖卡片
  COMBAT_ENCOUNTER_REQUESTED: 'combat.encounter.requested',
} as const;

// API（事件名自由，参数为变参）
eventBus.emit(event: string, ...args: any[]): void;                       // :17
eventBus.on(event: string, handler: (...args: any[]) => void): () => void; // :7，返回 unsubscribe
eventBus.off(event: string, handler: EventHandler): void;                  // :13
eventBus.once(event: string, handler: EventHandler): void;                 // :23，不返回 unsubscribe
```

**主要事件消费者**:

| 事件 | 主要消费者 |
| --- | --- |
| `VARIABLE_UPDATE_ENDED` | `GameScreen`（`src/components/game/GameScreen.tsx:628`）触发 `setStateVersion` 重渲染；同一文件的 `:344`、`:478`、`:499` 等本地改写点也会自行 emit |
| `VARIABLE_EXTRACTION_FAILED` | `GameScreen`（`src/components/game/GameScreen.tsx:629`）弹出失败提示 |
| `TURN_SETTLED` | `useSurvivalSettlement`（`src/components/game/gameScreen/hooks/useSurvivalSettlement.ts:13`）收集资源变更日志 |
| `COMBAT_ENCOUNTER_REQUESTED` | `GameScreen.handleTypedCombatRequest`（`src/components/game/GameScreen.tsx:511`） |
| `EVENT_CARD` | `CardOverlay`（`src/components/event/CardOverlay.tsx:96`）弹卡 |

> ⚠ **与代码实际行为不符（已知缺陷）**：`MESSAGE_SENT`（`src/engine/useGameEngine.ts:846`）、`PIPELINE_UPDATE`（`:881`）、`GENERATION_STARTED`（`:852`）、`GENERATION_ENDED`（`:1428`）、`AUTO_SAVE`、`CHAT_CHANGED`、`EVENT_CARD_OVERRIDE` 这七个事件**只有 emit 没有生产代码 subscribe**（全仓 `eventBus.on(EVENTS.X)` 检索仅在 `src/components/game/GameScreen.tsx:511`、`:628`、`:629`、`src/components/game/gameScreen/hooks/useSurvivalSettlement.ts:13`、`src/components/event/CardOverlay.tsx:96` 与若干 `*.test.ts` 命中）。其中 `PIPELINE_UPDATE` 的实时监控并非由事件驱动：`ChatPanel` 直接把 `engine.pipelineStatus` 作为 `status` prop 传给 `PipelineMonitorModal`（`src/components/game/chat/ChatPanel.tsx:178-179`）。修复方向在代码侧：要么删掉无人订阅的事件与 emit 调用，要么把 `PipelineMonitorModal` 改为订阅 `PIPELINE_UPDATE`，避免「事件名存在但无消费者」的误导性契约。

**设计原则**:

- 同步 emit，异步消费。
- 不携带复杂 payload（复杂对象走 store）。
- 失败不影响 emit 链路（`try/catch` 隔离 handler，`:19`）。

---

### 1.8 响应提取与守护

| 文件 | 职责 |
| --- | --- |
| `src/engine/responseExtractor.ts`（73 行） | 从原始响应提取 `contenttext` 正文，剥离 `<thinking>` 等思维链与元数据标签 |
| `src/engine/deepSeekResponseGuard.ts`（124 行） | DeepSeek 推理模型：检测被截断的响应，触发 `buildDeepSeekRepairPrompt` 补全，失败再本地兜底 |
| `src/engine/worldPersonality.ts`（28 行） | 世界书装载与世界条目切换（**非**世界人格） |

**响应提取流程**（`src/engine/responseExtractor.ts:11-26`）:

```
原始流式 chunks (concatenated)
  ↓
extractContentForPrompt(text)
  ├─ 先 stripTimeAdvanceTags + stripUnclosedKernelTrace（:13）
  ├─ 合并所有非空 <contenttext> 块（:17-22，多块用 \n\n 连接）
  │    └─ 每块内部再 stripInnerTags：剥 TimeAdvance / details / summary / Auto / safe /
  │       thinking / analysis_block / image_think / image / imgthink
  └─ 兜底：无 contenttext 时剥掉全部已知标签，剩余即为正文（:25）

↓ 用于最终 UI 展示 + 后续变量提取的 batchText
```

说明：**没有 JSON 检测分支**，提取器只做标签剥离与正文合并。

**DeepSeek 守护触发条件**（`src/engine/useGameEngine.ts:1300`）:

```typescript
useFormatRepairGuard && rawText.trim() && !isDeepSeekResponseComplete(rawText)
// isDeepSeekResponseComplete（src/engine/deepSeekResponseGuard.ts:49-55）只校验三件事：
//   1) <contenttext> 已闭合；
//   2) [OPTION_START] + 至少 3 条完整的 [OPTION]{t,d} + [OPTION_END] 存在且闭合；
//   3) 其后仅允许一段可被权威时钟解析的尾部 <TimeAdvance> 回执（或没有尾巴）。
// 不检查 </thinking>，也不检查 {} 是否闭合。
```

补尾链路（`useGameEngine.ts:1300-1337`）: `buildDeepSeekRepairPrompt` → 请求补写 → `appendDeepSeekRepair` 拼接 → 若仍不完整再走 `ensureDeepSeekResponseFallback`（本地补通用行动选项，不虚构剧情）。

---

### 1.9 引擎类型 — `src/engine/types.ts`

**文件路径**: `src/engine/types.ts`（77 行）

**导出关键类型**（全量，仅 4 个）:

```typescript
export interface ChatMessage { ... }            // :10-32
export interface SendMessageOutcome { ... }     // :34-39
export interface SendMessageOptions { ... }     // :41-49
export interface GameEngine { ... }             // :51-77
```

```typescript
export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  rawText: string;                // 完整 API 响应（唯一存储源）
  summary?: string;               // 老消息压缩摘要
  round: number;
  timestamp: number;
  streaming?: boolean;
  snapshot?: unknown;
  snapshotTime?: number;
  memoryCheckpointId?: string;
  simulationSnapshotId?: string;  // 世界演化引擎快照 ID
  turnRecovery?: TurnRecovery;    // 未完成回合的恢复载荷
  seq?: number;                   // 消息序号，单调递增，用于增量存档
}

export interface SendMessageOptions {
  displayUserMessage?: boolean;   // 内部 continuation 不显示用户气泡
  combatContinuation?: { protectedState: GameState; fallbackText?: string };
  onAccepted?: () => void;        // 输入已被当前回合接纳（生成仍可能失败）
  onComplete?: (outcome: SendMessageOutcome) => void;
}
```

**注意**: `PipelineTaskId` / `PipelineStageStatus` / `PipelineStatus` / `PipelineConfig` / `DEFAULT_EXECUTION_ORDER` / `STAGE_LABELS` **都定义在 `src/engine/pipelineTypes.ts`**，`types.ts` 只是从那里 `import type`（`:5`）。**不存在** `PipelineContext` 接口。

---

### 1.10 `src/engine/` 目录文件清单

生产代码 24 个文件（另有 18 个 `*.test.ts` 与 3 个 fixture JSON）：

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `useGameEngine.ts` | 1779 | 引擎主 Hook：消息发送、管线调度、快照与回滚、存档装载 |
| `variableManager.ts` | 1059 | 变量管理器：路径访问、AI 事务、快照、模块效果 |
| `variableExtraction.ts` | 542 | 变量提取：提示词构建、观察/遭遇/能力提案解析 |
| `pipelineExecutor.ts` | 373 | 管线编排：同层并行、层间串行、settlement 独立执行 |
| `promptAssembler.ts` | 285 | 提示词组装：7 个前置区块 + 预设主体 + 深度注入 |
| `playerKnowledge.ts` | 234 | 玩家已认知 NPC 与字段级知识（提示词净化依赖） |
| `macroEngine.ts` | 186 | 宏引擎：13 类宏、最多 10 轮展平 |
| `pipelineTypes.ts` | 144 | 管线类型、默认执行顺序、阶段标签、配置读取 |
| `sessionInitialization.ts` | 139 | 新会话初始化：`createNewSessionManager` / `setPlayerProfile` / `applyModuleInitData` / `setInitialNPCs` |
| `deepSeekResponseGuard.ts` | 124 | DeepSeek 响应完整性检测、补写提示词、本地兜底 |
| `turnSettlement.ts` | 118 | 回合终结结算：叙事决策、时钟、成长、周期收尾 |
| `turnRecovery.ts` | 89 | 未完成回合的持久化与版本指纹校验 |
| `types.ts` | 77 | 引擎对外类型（ChatMessage / GameEngine 等 4 个） |
| `responseExtractor.ts` | 73 | 响应正文提取与标签剥离 |
| `progressionSettlement.ts` | 68 | 成长/段位结算 |
| `eventBus.ts` | 54 | 全局事件总线单例与事件常量 |
| `contextManager.ts` | 53 | 上下文清理：历史截断、正则清洗、深度摘要 |
| `offscreenAcceptance.ts` | 51 | 幕后事件落库与回执 |
| `turnSafety.ts` | 42 | 回合归属（`TurnOperations`）与记忆守卫 |
| `worldPersonality.ts` | 28 | 世界书装载与条目切换（命名待正名） |
| `turnVariableExtraction.ts` | 26 | 变量提取的事务包装（draft → 提交） |
| `encounterContext.ts` | 20 | 遭遇上下文文本构建 |
| `narrativeKnowledge.ts` | 16 | 叙事知识应用 |
| `rollbackTarget.ts` | 15 | 回滚目标解析（`resolveRollbackTarget`） |

---

