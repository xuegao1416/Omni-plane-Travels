> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（23、GameContext 导航与存档桥接 (散节整合)）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 23、GameContext 导航与存档桥接 (散节整合)

### 23.1 状态机 reducer 完整逻辑

**Action 类型总览(共 7 个，`src/context/GameContext.tsx:36-43`)**:

```typescript
type Action =
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'GO_BACK' }
  | { type: 'SET_WORLD'; worldId: string }
  | { type: 'SET_PERSONAL_INFO'; info: PlayerProfile | null }
  | { type: 'SET_CHARACTER_HISTORY'; history: string }
  | { type: 'LOAD_SAVE'; save: GameSave }
  | { type: 'CLEAR_SAVE_DATA' };
```

**Reducer 完整逻辑**（`src/context/GameContext.tsx:53-84`，与源码逐字一致）:

```typescript
// NAVIGATE(:56): 推入 screenHistory 栈
case 'NAVIGATE':
  return { ...state, currentScreen: action.screen, screenHistory: [...state.screenHistory, state.currentScreen] };

// GO_BACK(:57-60): 弹出栈顶
case 'GO_BACK': {
  const prev = state.screenHistory[state.screenHistory.length - 1];
  return { ...state, currentScreen: prev || 'start', screenHistory: state.screenHistory.slice(0, -1) };
}

// SET_WORLD(:61-62)
case 'SET_WORLD':
  return { ...state, selectedWorld: action.worldId };

// SET_PERSONAL_INFO(:63-64)
case 'SET_PERSONAL_INFO':
  return { ...state, personalInfo: action.info };

// SET_CHARACTER_HISTORY(:65-66)
case 'SET_CHARACTER_HISTORY':
  return { ...state, characterHistory: action.history };

// LOAD_SAVE(:67-73): withProfileDefaults 兜底后恢复(用 ?? 而非 ||)
case 'LOAD_SAVE':
  return {
    ...state,
    selectedWorld: action.save.worldId || 'default',
    personalInfo: withProfileDefaults(action.save.personalInfo),
    characterHistory: action.save.characterHistory ?? '',
  };

// CLEAR_SAVE_DATA(:74-80): 重置 personalInfo/characterHistory/worldId
case 'CLEAR_SAVE_DATA':
  return { ...state, personalInfo: null, characterHistory: '', selectedWorld: 'default' };

default:
  return state;
```

### 23.2 自动存档写入路径

真实链路分四段：**引擎触发 → 500ms 防抖排程 → 协调器串行落盘 → performSave 计算增量**。

```
第 1 段 引擎侧触发
  src/engine/useGameEngine.ts:880   main 阶段成功时提前触发一次
  src/engine/useGameEngine.ts:1433  finally 块再触发一次
    ↓  onAutoSaveRef.current?.()
  src/context/GameContext.tsx:115-117  handleAutoSave = useCallback(() => { scheduleAutoSaveRef.current(); }, [])
    ↓  (ref 化以避免 stale closure, :112-113)
第 2 段 排程（store 层）
  src/stores/saveStore.ts:309-319  scheduleAutoSave()
    └─ saveCoordinator.scheduleCapture(saveId, () => { ...若 currentSaveId 或 builder 已变则返回 null... })
  src/storage/saveCoordinator.ts:66-84  schedule/scheduleCapture/scheduleOperation —— 默认 delay = 500ms
    ↓  到点后 runScheduled(:107) 取回 capture
第 3 段 协调器串行化
  saveCoordinator.request(capture)(:34) → enqueue(:54-64)
    └─ 若该 saveId 队列里已有 pending,直接就地覆盖(单槽合并,只保留最新一次捕获)
  drain(:146-166)  串行 while(queue.pending):取出 → 置空 → await save(next)
    └─ save 回调 = capture => useSaveStore.getState().performSave(capture)(绑定点 saveStore.ts:71)
    └─ 失败可经 getFailedCapture(:132)/retryFailed(:137) 重放;结果经 subscribe(:25) 以 SaveOutcome 广播
第 4 段 performSave（src/stores/saveStore.ts:205-301）
  ├─ autoPruneIfNeeded(saveData.id)(:207, 配额检查 → 必要时清理冷消息)
  ├─ 构造 SaveMeta(:210-214)
  ├─ planMessageSave(saveId, allMessages)(:217) → { changedMessages, replaceMessages }
  │    └─ 用 SHA-256 contentFingerprint 逐条比对,替代早先「按 seq 递增过滤」的增量假设
  ├─ 计算 keptModuleRevisions(:220-230)：来自 moduleStates + 每条消息快照的 moduleRevisions
  ├─ 过滤 moduleCheckpoints(:231-233)：只保留仍被引用的 <moduleId>#<revision>
  ├─ 构造 compactHead(:236-256,不含 messages)
  ├─ saveGameIncremental(id, compactHead, newMessages, moduleStates, moduleCheckpoints,
  │                      { replaceMessages, keptModuleRevisions, createCommit })(:260-267)
  ├─ 失败兜底(:268-283):SaveCreationConflictError 直接上抛;其余导出 save-backup-{Date.now()}.json 后仍然 throw
  └─ 更新 savesMeta(:287-293) → saveAllSaveMeta(updated)(:296),元数据写失败只 warn(:297-300)
```

**关键设计说明**（此前版本三处说法已作废）:

- **不存在 `_savePromise` / `_saveQueued`**。并发合并完全由 `src/storage/saveCoordinator.ts`（167 行）承担：`queues: Map<string, SaveQueue>` 持有每存档队列，`enqueue` 里 `if (queue.pending) { queue.pending = capture; return; }` 做单槽覆盖，`drain` 用 `while (queue.pending)` 串行执行。
- **不存在「按 seq > lastSeq 过滤新消息」和「滑动窗口补丁（刚离开最近 10 条窗口的旧消息强制重写）」**。改动的判定是 `planMessageSave`（`src/storage/db.ts:302`）基于 SHA-256 `contentFingerprint` 的逐条比对，返回 `{ changedMessages, replaceMessages }`；需要整段替换时由 `saveGameIncremental` 的第 6 参 `replaceMessages` 先按 saveId 清空再全量重写（`src/storage/db.ts:847-853`）。
- **失败时导出 JSON 备份不阻塞主流程**——属实，但会**继续 throw**（`:282`），由协调器记成 `SaveOutcome{ status: 'failed' }` 并写入 `saveStore.saveFailure`（`src/stores/saveStore.ts:331-336`）。

### 23.3 setAutoSaveBuilder builder 函数闭包设计

`src/context/GameContext.tsx:120-176`，仅在挂载时执行一次（依赖数组为空），builder 内部通过 `engineRef` / `stateRef` / `useSaveStore.getState()` 读取最新状态：

```typescript
useEffect(() => {
  setAutoSaveBuilder(() => {
    const eng = engineRef.current;
    const s = stateRef.current;
    const saveId = useSaveStore.getState().currentSaveId;
    if (!eng || !saveId) return null;          // :125 只判 engine 与 saveId,不判 messages 长度

    eng.prepareSaveCapture();                  // :130
    const optimized = optimizeSnapshots([...eng.messages]);   // :131
    const memData = useMemoryStore.getState().toJSON();       // :132-133
    const moduleBundle = eng.variableManager.createModulePersistenceBundle(saveId);  // :134
    // :135-140 炼狱死亡判定 → lifecycle
    // :142-147 自建世界从 localStorage 的 STORAGE_KEYS.CUSTOM_WORLDS 取完整定义
    return { id, assetSourceSessionIds, name, timestamp, messages: optimized,
             gameState: moduleBundle.coreState, moduleStates: moduleBundle.current,
             moduleCheckpoints: moduleBundle.checkpoints, worldId, personalInfo,
             characterHistory, memoryRuntime, memoryConfig, vectorMemory,
             variableConfig, customWorld, simulationState: getEngineState(),
             lifecycle, endedAt?, endReason? };          // :149-174
  });
}, []);
```

注意两点：`variableConfig` 只存 `apiPresetId`（从 `STORAGE_KEYS.VARIABLE_API_PRESET` 读，`:164-166`），不存密钥；`endedAt` / `endReason` 仅在 `lifecycle === 'ended'` 时写入（`:170-173`）。

### 23.4 Provider 嵌套与 DialogUI

`src/context/GameContext.tsx:248-253`——**只有一层 `GameContext.Provider`**，不存在外层 `GameProvider` 组件（`GameProvider` 只是本文件导出的函数名）：

```tsx
return (
  <GameContext.Provider value={contextValue}>
    {children}        {/* AppContent */}
    {engine.DialogUI}  {/* 引擎自带的浮层 UI(对话框/选项卡) */}
  </GameContext.Provider>
);
```

`contextValue`（`:243-246`）= `{ state, dispatch, navigate, goBack, engine, markNewGameStarted }`，用 `useMemo` 稳定引用。

`engine.DialogUI` 由 `src/components/shared/Dialog.tsx:24` 的 `useDialog()` 提供（`src/engine/useGameEngine.ts:223` 解构，`:1777` 透出）；它基于 `src/components/shared/OverlayPortal.tsx:109` 的 `createPortal(..., getOverlayPortalTarget())`，而 `getOverlayPortalTarget()` 恒返回 `document.body`（`src/components/shared/overlayPortalContract.ts:1-3`）。因此浮层渲染到 `document.body`、独立于组件树层级——结论与原文一致，但实现是 `react-dom` 的 `createPortal` + `OverlayPortal`，不是引擎内部自建 Portal。

`OverlayPortal` 同时负责叠加顺序、焦点恢复、Escape 栈（`escapeStack`，`:22-32`）、Tab 循环与 body 滚动锁（`useBodyScrollLock`，`:104`）。

**F5 刷新恢复**（`src/context/GameContext.tsx:196-222`）:

```typescript
useEffect(() => {
  let cancelled = false;
  const savedId = localStorage.getItem(ACTIVE_SAVE_KEY);
  if (savedId) {
    loadGameFromDb(savedId).then(save => {
      if (newGameStartedRef.current) return;              // 新游戏已开始，丢弃旧存档
      if (!cancelled && save && Array.isArray(save.messages)) {
        engine.loadSave(save);                            // :204
        useSaveStore.getState().activateSave(save);       // :205
        dispatch({ type: 'LOAD_SAVE', save });            // :206
      } else if (!cancelled) {
        localStorage.removeItem(ACTIVE_SAVE_KEY);          // :209
        useSaveStore.setState({ currentSaveId: null, currentSaveName: '' });  // :210
        dispatch({ type: 'CLEAR_SAVE_DATA' });
        engine.reset();
      }
    }).catch(err => {
      console.warn('[auto-restore] 加载存档失败:', err);    // :215
      // 读取失败可恢复：不清除已选存档、不重置在此期间创建的新旅程
    });
  }
  return () => { cancelled = true; };
}, []);
```

与旧文的三处差异：进入条件只看 `Array.isArray(save.messages)`（**不要求 `length > 0`**）；恢复走 `activateSave` 而不是裸 `setState`；`.catch` 分支**不做任何清理**（注释明确说明理由）。
