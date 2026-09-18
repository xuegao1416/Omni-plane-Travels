> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（23、GameContext 导航与存档桥接 (散节整合)）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 23、GameContext 导航与存档桥接 (散节整合)

### 23.1 状态机 reducer 完整逻辑

**Action 类型总览(共 7 个)**:

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

**Reducer 完整逻辑**:

```typescript
// NAVIGATE: 推入 screenHistory 栈
case 'NAVIGATE':
  return {
    ...state,
    currentScreen: action.screen,
    screenHistory: [...state.screenHistory, state.currentScreen]
  };

// GO_BACK: 弹出栈顶
case 'GO_BACK': {
  const prev = state.screenHistory[state.screenHistory.length - 1];
  return {
    ...state,
    currentScreen: prev || 'start',
    screenHistory: state.screenHistory.slice(0, -1)
  };
}

// SET_WORLD: 更新世界 ID
case 'SET_WORLD':
  return { ...state, selectedWorld: action.worldId };

// SET_PERSONAL_INFO: 更新玩家 Profile
case 'SET_PERSONAL_INFO':
  return { ...state, personalInfo: action.info };

// SET_CHARACTER_HISTORY: 更新角色历史文本
case 'SET_CHARACTER_HISTORY':
  return { ...state, characterHistory: action.history };

// LOAD_SAVE: withProfileDefaults 兜底后恢复(用 ?? 而非 ||)
case 'LOAD_SAVE':
  return {
    ...state,
    selectedWorld: action.save.worldId || 'default',
    personalInfo: withProfileDefaults(action.save.personalInfo),
    characterHistory: action.save.characterHistory ?? '',
  };

// CLEAR_SAVE_DATA: 重置 personalInfo/characterHistory/worldId
case 'CLEAR_SAVE_DATA':
  return {
    ...state,
    personalInfo: null,
    characterHistory: '',
    selectedWorld: 'default',
  };

default:
  return state;
}
```

### 23.2 自动存档写入路径

```
engine.sendMessage() 结束(或 rollbackToSnapshot 末尾 / GameScreen 关键变更点)
  ↓
onAutoSaveRef.current?.() 调用(GameContext 注入的 handleAutoSave)
  ↓
handleAutoSave() → scheduleAutoSaveRef.current()(500ms debounce)
  ↓
saveStore.scheduleAutoSave()
  ├─ setTimeout 500ms → 调用 _autoSaveBuilder(由 setAutoSaveBuilder 注入)→ saveGame(_autoSaveBuilder)
  └─ saveGame() — coalescing 合并保存(saveStore.ts:347-369)
       ├─ if (_savePromise) { _saveQueued = true; return _savePromise; }  // 已有保存进行中,合并到下一轮
       └─ run 循环:
            do {
              _saveQueued = false;
              const saveData = buildSaveData();
              if (saveData) await performSave(saveData);
            } while (_saveQueued);  // 处理期间再次触发,继续合并执行一轮
  ↓
performSave() (saveStore.ts:204-345)
  ├─ 配额检查 → autoPruneIfNeeded(saveData.id)
  ├─ 截断/重roll 检测 → needsFullRewrite → deleteMessages
  ├─ 增量消息过滤(newMessages = filter seq > lastSeq)
  ├─ 滑动窗口补丁(刚离开最近 10 条窗口的旧消息强制重写)
  ├─ moduleCheckpoint 裁剪(只保留消息快照仍引用的 revision)
  ├─ saveGameIncremental(saveData.id, compactHead, newMessages, moduleStates, moduleCheckpoints)
  └─ saveAllSaveMeta(updated) 元数据持久化
```

**关键设计说明**:

- `_saveQueued` **实际存在**(`saveStore.ts:68`),用于合并并发触发的自动存档
- 写入流程有 `_savePromise` 单飞 + `_saveQueued` 队列重合并两层防抖
- `performSave` 失败时自动导出 JSON 备份(`save-backup-{timestamp}.json`),不阻塞主流程

### 23.3 setAutoSaveBuilder builder 函数闭包设计

```typescript
// 在 effect 中读取最新 ref,避免 stale closure
const handleAutoSave = useCallback(() => {
  scheduleAutoSaveRef.current();
}, []);

// builder 通过 engineRef.current 读取最新引擎状态
useEffect(() => {
  setAutoSaveBuilder(() => {
    const eng = engineRef.current;
    const s = stateRef.current;
    const saveId = useSaveStore.getState().currentSaveId;
    if (!eng || eng.messages.length === 0 || !saveId) return null;
    const optimized = optimizeSnapshots([...eng.messages]);
    // ... 组装存档对象
    return { id, name, timestamp, messages: optimized, gameState, ... };
  });
}, []);
```

### 23.4 Provider 嵌套与 DialogUI

```tsx
<GameProvider>
  <Provider value={contextValue}>
    {children}        {/* AppContent */}
    {engine.DialogUI}  {/* 引擎自带的浮层 UI(对话框/选项卡) */}
  </Provider>
</GameProvider>
```

`engine.DialogUI` 通过 React Portal 渲染到 `document.body`,独立于组件树层级,确保始终显示在游戏界面最顶层。

**F5 刷新恢复**:

```typescript
useEffect(() => {
  let cancelled = false;
  const savedId = localStorage.getItem(ACTIVE_SAVE_KEY);
  
  if (savedId) {
    loadGameFromDb(savedId).then(save => {
      if (cancelled || newGameStartedRef.current) return;
      
      if (save && save.messages && save.messages.length > 0) {
        useSaveStore.setState({ currentSaveId: savedId, currentSaveName: save.name });
        dispatch({ type: 'LOAD_SAVE', save });
        engine.loadSave(save);
      } else {
        localStorage.removeItem(ACTIVE_SAVE_KEY);
        dispatch({ type: 'CLEAR_SAVE_DATA' });
        engine.reset();
      }
    });
  }
  
  return () => { cancelled = true; };
}, []);
```

---

*审查方法: 子系统级逐文件目录盘点 + 与原文档交叉核对 + 逐字节代码核对*

*重组要点: 新增 §0 总览 / §5 gameplay / §6 simulation / §7 custom-modules / §10 Context / §11 Hooks / §12 data / §13 novel / §14 time / §15 worldgen / §16 主题 / §17 安全基础设施 / §18 utils / §19 根目录 / §20 docs;原 §5~§9 重新编号为 §8 / §9 / §21 / §22;原 §7 模块系统并入 §4.5;原 §10~§15 散节内容并入 §8 / §9 / §23*

