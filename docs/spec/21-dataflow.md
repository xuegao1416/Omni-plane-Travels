> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（21、数据流联动总图）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 21、数据流联动总图

### 21.1 消息发送 → AI 响应 → 状态更新

```
用户输入
  ↓
(navigate('game') 只切换 currentScreen,不触发 sendMessage;发送由用户点发送按钮或回车调用)
  ↓
engine.sendMessage(userText, options)
  ├─ [守卫检查] isSaveReadOnly / !apiConfig / generatingRef.current / 战斗暂停(combatContinuation 例外)
  ├─ generatingRef.current = true
  ├─ roundRef.current++
  ├─ 分配 userSeq / aiSeq 消息序号
  ├─ 创建用户消息 + AI消息(streaming: true)
  ├─ eventBus.emit(MESSAGE_SENT / GENERATION_STARTED)
  └─ executor.execute({ mainTask, memoryTasks, variableTask })
       │
       ├─ (管线开始前)本地机械结算(确定性,非后台 tick):
       │    prepareWorldMechanics(simEngine, {...}) → settlement
       │    → varMgrRef.setState(settlement.gameState)(若 settlement.settled)
       │    → applyModuleEffects(..., 'periodic', enabledModules)
       │    → commitWorldMechanics(simEngine, settlement, isCurrent)
       │    → useSimulationStore.syncFromEngine() → eventBus.emit(VARIABLE_UPDATE_ENDED)
       │    (失败只 console.warn,不影响正文管线)
       │
       ├─ 正文发送前:executeMemoryPrepareForMain(memStore, memCtx) — 刷新本轮记忆上下文
       │
       ├─ mainTask(正文生成回调)
       │    ├─ buildModuleContextProjection() → coreSnapshot + moduleProjection.summary
       │    ├─ worldBookRef.scanAndBuildInjection(chatHistory, userText)
       │    │    └─ 返回 { beforeChar, afterChar, atDepthEntries[] }
       │    ├─ simEngine.getWorldNewsBrief() + simEngine.getAllStorylineSummaries() → simulationBrief
       │    ├─ executeMemoryPrepareForMain() + 读取 memStore.lastCompiledContext?.fullText
       │    ├─ playerProfileBlock 拼接
       │    ├─ assembleSystemPrompt(preset, { varSnapshot, wbInjection, ... })
       │    │    └─ assembleResult.depthEntries 由 assembler 内部计算
       │    ├─ requestStreamWithRetry() — 流式实现在 src/api/client.ts:545(重试包装);底层 requestCompletionStream 在 :448、非流式 requestCompletion 在 :381
       │    │    └─ onDelta 中实时调用 applyCombatBoundary() = constrainPreCombatNarrative()(图形化战斗时),而非单一线性步骤
       │    ├─ DeepSeek 格式修复(useFormatRepairGuard)
       │    └─ StatusPlaceHolderImpl 处理
       │
       ├─ memoryTasks(buildMemoryTasks(memStore, memCtx, memConfig))
       │    ├─ write / summary / vector(并行) — vector 还受 memConfig.vectorEnabled 条件控制
       │    └─ query_rewrite → retrieve_plan → multi_round → rerank → finalize → compile(串行)
       │         └─ memoryStore.lastCompiledContext.fullText
       │
       ├─ variableTask(独立 API 调用) — pipelineExecutor 的 case 'variable' → runTurnVariableExtraction
       │    └─ applyModuleEffects() → 提取的 patch 应用到 varMgr
       │
       └─ settlement(executionOrder 循环结束后单独执行,不在 DEFAULT_EXECUTION_ORDER 内)
            └─ completeTurnSettlement → settleAcceptedTurn → settleNarrativeResponse /
               preserveCombatOwnedState / 世界时钟推进 / settleProgressionAction / settleTurnCycles,
               再跑 runCustomModuleTurnLifecycles()
  ↓
(无独立 finalizeNormalTurn 函数 — 逻辑全部内联在 sendMessage 主流程中;
 下面的结算顺序实际发生在 settlement 阶段的 settleAcceptedTurn 内,src/engine/turnSettlement.ts:27)
  ├─ 正文成功后(顺序):
  │    ├─ settleNarrativeResponse() → 叙事决策结算 → setState
  │    ├─ preserveCombatOwnedState()(若有 protectedState)
  │    ├─ ensureWorldClockOnGameState() + resolveTurnTimeAdvance() + advanceWorldClockForTurn() → 世界时钟推进
  │    ├─ settleProgressionAction() → 成长结算(若发生)
  │    └─ settleTurnCycles(...) → 返回 { state, changeLog }
  ├─ (finally 块,useGameEngine.ts:1413) saveSnapshot(varMgrRef, updateMessage, aiMsgId, round, gameTime, messagesRef.current)  // :1419
  │    ├─ varMgrRef.current.createSnapshot()
  │    ├─ memStore.createCheckpoint() — **可能为 undefined**(异常隔离)
  │    ├─ simEngine.createSnapshot(...) — **可能为 undefined**(异常隔离)
  │    └─ updateMessage(aiMsgId, { snapshot, snapshotTime, memoryCheckpointId, simulationSnapshotId })
  ├─ setMessages(prev => optimizeSnapshots(prev)) → 清理冗余快照  // :1420
  └─ (finally 块末尾) onAutoSaveRef.current?.() → handleAutoSave() → scheduleAutoSaveRef.current()(500ms debounce)  // :1433
  ↓
GameScreen bumpVersion()(监听 VARIABLE_UPDATE_ENDED) → 全组件重渲染
```

**关键设计说明**:

- `navigate('game')` 只切换 `currentScreen`,不调用 `sendMessage`;发送动作由用户交互触发
- `simEngine.tick()` 在 `sendMessage` 中**不存在**(全仓库无该调用);世界演化走正文前的确定性本地机械结算 `prepareWorldMechanics` + `commitWorldMechanics`(`src/engine/useGameEngine.ts:929-951`)。该路径刻意独立于 Director/后台 AI 开关:关掉 Director 不会关掉时间/资源/事件机制
- `evolutionReviews.run()` 也不在 `sendMessage` 中显式调用
- `saveSnapshot()` 在 `finally` 块内调用(`src/engine/useGameEngine.ts:1419`,条件是 `executor.getMainResult()` 为真),紧随其后 `optimizeSnapshots`;自动存档由 `finally` 块末尾的 `onAutoSaveRef.current?.()`(`:1433`)触发,另有 `:880` 在 `main` 阶段成功时提前触发一次
- 三重快照中任一项失败都会 catch 并 warn,不阻塞主线(`memoryCheckpointId` / `simulationSnapshotId` 可能为 undefined)

### 21.2 事件卡触发 → 卡片弹出 → 选择 → 效果应用

```
事件触发(AI 响应 / 周期规则 / 按钮)
  ↓
(emitCanonicalEventCard 由 mechanicalRuntime 在机械结算中触发:src/gameplay/mechanicalRuntime.ts:13 定义、:96 调用;
 另经 src/simulation/engine.ts:21 re-export。不存在后台 simEngine.tick)
  ↓
emitCanonicalEventCard(eventId, eventPackIds, isCurrent)  // 3 参数,返回 Promise<boolean>
  ↓
CardOverlay(React 函数组件,工作流执行在 openCard 回调中)
  ├─ eventBus.on(EVENTS.EVENT_CARD, evt => void openCard(evt))  // CardOverlay.tsx:96-100
  └─ openCard(CardEvent)  // CardOverlay.tsx:39 起
       ├─ getRuntimePack(evt.eventPackId) → readCanonicalEventPack(rec.files) → 取 workflowByEventId
       ├─ 调用 executeCardWorkflow(workflow, ctx)  // CardOverlay.tsx:58,内部走 src/modules/cardWorkflowEngine.ts
       │    ├─ narrative 节点 → renderData 收集
       │    ├─ choice 节点 → choices 输出(static / conditional / weighted / dynamic)
       │    └─ effect 节点 → pendingEffects 收集
       ├─ 用户看到渲染内容
       ├─ 用户选择选项
       └─ 用户点击选项
            ↓
       createNarrativeDecisionRecord({ ... }) → record  // CardOverlay.tsx:138
            ↓
       applyNarrativeDecision(gameState, record)  // CardOverlay.tsx:149
            ├─ 内部对 effect 调用 applyEffectTarget(state, effect.effect) (src/modules/eventChoiceState.ts:133,调用点 :152)
            │    ├─ effect.stat → state 数值属性 delta
            │    ├─ effect.resource → state 资源 delta
            │    └─ effect.flag → state 标志位 set
            └─ 返回新的 state → 写入 varMgr
            ↓
       (CardOverlay 中**没有** bumpVersion 调用 — bumpVersion 在 GameScreen 内,需要通过 VARIABLE_UPDATE_ENDED 事件触发)
```

**关键设计说明**:

- `emitCanonicalEventCard(eventId: string, eventPackIds: readonly string[], isCurrent: (() => boolean) = () => true)` 定义在 `src/gameplay/mechanicalRuntime.ts:13`,返回 `Promise<boolean>`(成功/失败/过期);`src/simulation/engine.ts:21` 只是 re-export
- `CardOverlay` 是 React 函数组件,工作流执行在 `openCard` 回调(`:39`)中;`eventBus.on(EVENTS.EVENT_CARD, ...)` 在 `:96`
- 选项点击后通过 `createNarrativeDecisionRecord`(`:138`)+ `applyNarrativeDecision`(`:149`)链路应用效果(`applyEffectTarget` 在 `eventChoiceState.ts:133`,是 `applyNarrativeDecision` 的内部实现细节)
- `bumpVersion` 仅存在于 `GameScreen`,通过 `EVENTS.VARIABLE_UPDATE_ENDED` 事件链路触发

### 21.3 世界书扫描 → 提示词注入

```
用户输入 + chatHistory
  ↓
worldBookRef.scanAndBuildInjection(chatHistory, userText)  // 接口声明 src/worldbook/index.ts:163,实现 :351
  ├─ entries.filter(e => e.enabled) → toWorldInfoEntry 映射
  ├─ mergedOptions 合并(注入默认 NPC 抑制回调)
  │    └─ suppressCharacterEntry = options.suppressCharacterEntry ?? shouldSuppressCharacterWorldBookEntry
  └─ scanWorldInfo(chatHistory, worldInfoPack, userText, mergedOptions)
       ├─ WIScanner.checkEntry()(排除词 → 主关键词 → 次级关键词+逻辑 → 概率)
       │    ├─ exclude_key 排除关键词命中 → 跳过
       │    ├─ 常驻条目(constant=true / 无 key)始终激活
       │    ├─ 主关键词 + selectiveLogic 次级关键词(AND_ANY / NOT_ALL / NOT_ANY / AND_ALL)
       │    └─ useProbability 概率门控
       ├─ resolveGroupExclusions()(分组互斥,内部使用 winners)
       ├─ 递归轮次控制:excludeRecursion=true → 后续轮次不参与;preventRecursion=true → 终止
       └─ compareWorldInfoEntriesBySendOrder()(排序)
  ↓
返回 { beforeChar, afterChar, atDepthEntries[], activatedEntries }
  ↓
(useGameEngine.ts:1216-1227):
  resolvedWbAtDepth = atDepthEntries.map(e => macroEngine.resolve(e.content))   // :1216
  mergedAtDepth = [...resolvedWbAtDepth, ...assembleResult.depthEntries]       // :1220
  ↓
injectAtDepthEntries(chatHistory, mergedAtDepth)
  ↓
assembleSystemPrompt(preset, {
  varSnapshot,
  wbInjection: beforeChar + '\n\n' + afterChar,
  // 注意:depthEntries 不是参数,是 assembleResult 的返回值
  ...
})
  ↓
最终 system prompt → API 请求
```

**关键设计说明**:

- `scanAndBuildInjection` 中间会合并 `mergedOptions`,默认注入 NPC 抑制回调 `shouldSuppressCharacterWorldBookEntry`
- `WIScanner.checkEntry` 还包含常驻条目(constant)始终激活、递归轮次控制(`excludeRecursion` / `preventRecursion`)、`suppressCharacterEntry` 回调检查等
- 分组互斥裁决在 `scanWorldInfo` 内部使用 `winners` 变量
- `depthEntries` 由 `assembleSystemPrompt` 返回(`assembleResult.depthEntries`),不作为入参

---


### 21.4 Canonical ingress 原则

跨系统数据进入运行时前先在边界规范化：世界模块由 `worldLoader.ts` + `normalizeModule.ts` 统一成 `moduleConfig + initialState`；卡片事件包由 `eventPackFormat.ts` 统一成 v2；内部存档只允许 v4→v5（`SAVE_SCHEMA_VERSION = 5`，见 `src/storage/db.ts:715` / `planV4ToV5Migration` `:745`）。运行时组件和引擎不再各自维护更早格式的 fallback。
