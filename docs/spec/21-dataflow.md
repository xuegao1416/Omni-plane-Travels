> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（21、数据流联动总图）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 21、数据流联动总图

### 21.1 消息发送 → AI 响应 → 状态更新

```
用户输入
  ↓
(navigate('game') 只切换 currentScreen,不触发 sendMessage — 实际由用户点发送按钮或回车调用)
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
       ├─ (管线开始前)后台 fire-and-forget: simEngine.tick() — 后台世界演化,不阻塞管线
       │
       ├─ 正文发送前:executeMemoryPrepareForMain(memStore, memCtx) — 刷新本轮记忆上下文
       │
       ├─ mainTask(正文生成回调)
       │    ├─ buildModuleContextProjection() → coreSnapshot + moduleProjection.summary
       │    ├─ worldBookRef.scanAndBuildInjection(chatHistory, userText)
       │    │    └─ 返回 { beforeChar, afterChar, atDepthEntries[] }
       │    ├─ (无 buildMainlineInjection) — 实际通过 simEngine.getWorldNewsBrief() + simEngine.getAllStorylineSummaries() 注入 simulationBrief
       │    ├─ (无 compileMemoryContext) — 实际是 executeMemoryPrepareForMain + 读取 memStore.lastCompiledContext?.fullText
       │    ├─ playerProfileBlock 拼接
       │    ├─ assembleSystemPrompt(preset, { varSnapshot, wbInjection, ... })
       │    │    └─ assembleResult.depthEntries 由 assembler 内部计算,**不是入参**
       │    ├─ requestStreamWithRetry() — 实际流式在 src/api/client.ts:165-235(parseSSEStream 不在 useGameEngine.ts)
       │    │    └─ onDelta 中实时调用 applyCombatBoundary() = constrainPreCombatNarrative()(图形化战斗时),而非单一线性步骤
       │    ├─ DeepSeek 格式修复(useFormatRepairGuard)
       │    └─ StatusPlaceHolderImpl 处理
       │
       ├─ memoryTasks(buildMemoryTasks(memStore, memCtx, memConfig))
       │    ├─ write / summary / vector(并行) — vector 还受 memConfig.vectorEnabled 条件控制
       │    └─ query_rewrite → retrieve_plan → multi_round → rerank → finalize → compile(串行)
       │         └─ memoryStore.lastCompiledContext.fullText
       │
       └─ variableTask(独立 API 调用)
            └─ applyModuleEffects() → 提取的 patch 应用到 varMgr
  ↓
(无独立 finalizeNormalTurn 函数 — 逻辑全部内联在 sendMessage 主流程中)
  ├─ 正文成功后(顺序):
  │    ├─ settleNarrativeResponse() → 叙事决策结算 → setState → eventBus.emit(VARIABLE_UPDATE_ENDED) → onAutoSaveRef.current?.()(事件决策后立即存档)
  │    ├─ resolveTurnTimeAdvance() + advanceWorldClockForTurn() → 世界时钟推进
  │    ├─ settleProgressionAction() → 成长结算(若发生)→ eventBus.emit(VARIABLE_UPDATE_ENDED)
  │    └─ (已无独立 evolutionReviews.run() 调用 — 评审已迁移或废弃)
  ├─ saveSnapshot(varMgrRef, updateMessage, aiMsgId, round, gameTimeStr)
  │    ├─ varMgrRef.current.createSnapshot()
  │    ├─ memStore.createCheckpoint() — **可能为 undefined**(异常隔离)
  │    └─ simEngine.createSnapshot(...) — **可能为 undefined**(异常隔离)
  │    └─ updateMessage(aiMsgId, { snapshot, snapshotTime, memoryCheckpointId, simulationSnapshotId })
  ├─ setMessages(prev => optimizeSnapshots(prev)) → 清理冗余快照
  └─ (finally 块) onAutoSaveRef.current?.() → handleAutoSave() → scheduleAutoSaveRef.current()(500ms debounce)
  ↓
GameScreen bumpVersion()(监听 VARIABLE_UPDATE_ENDED) → 全组件重渲染
```

**关键设计说明**:

- `navigate('game')` 只切换 `currentScreen`,不调用 `sendMessage`;发送动作由用户交互触发
- `simEngine.settleMechanics()` / `evolutionReviews.run()` 不在 sendMessage 中显式调用;演化走 `simEngine.tick()` 的 fire-and-forget,效果在下一轮正文时已可见
- `saveSnapshot()` 由 try 块末尾调用,自动存档由 finally 块的 `onAutoSaveRef.current?.()` 触发
- 三重快照中任一项失败都会 catch 并 warn,不阻塞主线(`memoryCheckpointId` / `simulationSnapshotId` 可能为 undefined)

### 21.2 事件卡触发 → 卡片弹出 → 选择 → 效果应用

```
事件触发(AI 响应 / 周期规则 / 按钮)
  ↓
(可能走 simEngine.tick 后台 tick,也可能在 evaluateTick 子流程中)
  ↓
emitCanonicalEventCard(eventId, eventPackIds, isCurrent)  // 3 参数,返回 Promise<boolean>
  ↓
CardOverlay(React 函数组件,不是 .render() 方法)
  ├─ eventBus.on(EVENTS.EVENT_CARD) → openCard(evt)  // CardOverlay.tsx:39
  └─ openCard(CardEvent)  // CardOverlay.tsx:44-72
       ├─ 调用 executeCardWorkflow(workflow, ctx)  // 内部走 src/modules/cardWorkflowEngine.ts
       │    ├─ narrative 节点 → renderData 收集
       │    ├─ choice 节点 → choices 输出(static / conditional / weighted / dynamic)
       │    └─ effect 节点 → pendingEffects 收集
       ├─ 用户看到渲染内容
       ├─ 用户选择选项
       └─ 用户点击选项
            ↓
       createNarrativeDecisionRecord({ ... }) → record  // CardOverlay.tsx:110-118
            ↓
       applyNarrativeDecision(gameState, record)  // CardOverlay.tsx:121-124
            ├─ 内部对 effect 调用 applyEffectTarget(state, effect.effect) (src/modules/eventChoiceState.ts:135)
            │    ├─ effect.stat → state 数值属性 delta
            │    ├─ effect.resource → state 资源 delta
            │    └─ effect.flag → state 标志位 set
            └─ 返回新的 state → 写入 varMgr
            ↓
       (CardOverlay 中**没有** bumpVersion 调用 — bumpVersion 在 GameScreen 内,需要通过 VARIABLE_UPDATE_ENDED 事件触发)
```

**关键设计说明**:

- `emitCanonicalEventCard` 实际签名是 `emitCanonicalEventCard(eventId: string, eventPackIds: string[], isCurrent: boolean)`,返回 `Promise<boolean>`(成功/失败/过期),不是 1 参数
- `CardOverlay` 是 React 函数组件,工作流执行在 `openCard` 回调中(不是 `.render()` 方法)
- 选项点击后通过 `createNarrativeDecisionRecord` + `applyNarrativeDecision` 链路应用效果(`applyEffectTarget` 在 `eventChoiceState.ts` 中,是 `applyNarrativeDecision` 的内部实现细节,不直接调用)
- `CardOverlay` 中没有 `bumpVersion`(`bumpVersion` 仅存在于 `GameScreen`,通过 `EVENTS.VARIABLE_UPDATE_ENDED` 事件链路触发)

### 21.3 世界书扫描 → 提示词注入

```
用户输入 + chatHistory
  ↓
worldBookRef.scanAndBuildInjection(chatHistory, userText)  // src/worldbook/index.ts:344-397
  ├─ entries.filter(e => e.enabled) → toWorldInfoEntry 映射
  ├─ mergedOptions 合并(注入默认 NPC 抑制回调)
  │    └─ suppressCharacterEntry = options.suppressCharacterEntry ?? shouldSuppressCharacterWorldBookEntry
  └─ scanWorldInfo(chatHistory, worldInfoPack, userText, mergedOptions)
       ├─ WIScanner.checkEntry()(排除词 → 主关键词 → 次级关键词+逻辑 → 概率)
       │    ├─ exclude_key 排除关键词命中 → 跳过
       │    ├─ 常驻条目(constant=true / 无 key)始终激活
       │    ├─ 主关键词 + selectiveLogic 次级关键词(AND_ANY / NOT_ALL / NOT_ANY / AND_ALL)
       │    └─ useProbability 概率门控
       ├─ resolveGroupExclusions()(分组互斥) — 实际变量名是 winners,不是 allActivated
       ├─ 递归轮次控制:excludeRecursion=true → 后续轮次不参与;preventRecursion=true → 终止
       └─ compareWorldInfoEntriesBySendOrder()(排序)
  ↓
返回 { beforeChar, afterChar, atDepthEntries[], activatedEntries }
  ↓
(useGameEngine.ts:1087-1092):
  resolvedWbAtDepth = atDepthEntries.map(e => macroEngine.resolve(e.content))
  mergedAtDepth = [...resolvedWbAtDepth, ...assembleResult.depthEntries]
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
- 分组互斥裁决使用 `winners` 变量(在 `scanWorldInfo` 内部),不是 `allActivated`
- `assembleSystemPrompt` 的 `depthEntries` 不是入参,而是返回值 `assembleResult.depthEntries`

---


### 21.4 Canonical ingress 原则

跨系统数据进入运行时前先在边界规范化：世界模块由 `worldLoader.ts` + `normalizeModule.ts` 统一成 `moduleConfig + initialState`；卡片事件包由 `eventPackFormat.ts` 统一成 v2；内部存档只允许 v3→v4。运行时组件和引擎不再各自维护更早格式的 fallback。
