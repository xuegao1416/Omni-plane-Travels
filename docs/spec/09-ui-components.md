> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（9、UI 组件系统 — `src/components/`）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 9、UI 组件系统 — `src/components/`

### 9.1 游戏主界面 — `src/components/game/GameScreen.tsx`

**布局组件实际位置**:`DesktopLayout` / `MobileLayout` / `DrawerPanel` / `navConfig.ts` / `types.ts` 均在 `src/components/game/gameScreen/`;`ChatPanel` 在 `game/chat/`;`RightPanel` / `WorldDynamicsPanel` 在 `game/panels/`;`JourneyDossierContent` 在 `game/shared/`。

**三栏桌面布局**:

```
DesktopLayout (gameScreen/DesktopLayout.tsx)
├── <nav className="game-journey__nav">   ← 内联渲染，没有 LeftNavBar 组件
│     由 navConfig.ts 的 navButtons 驱动（11 项，无 settings）:
│     home / profile / characters / tasks / profession / notebook
│     / variables / worldbook / dynamics / memory / modules
├── children = chatPanelEl (ChatPanel)
├── DrawerPanel (gameScreen/DrawerPanel.tsx) ← drawerContent 由 GameScreen 传入 JourneyDossierContent
└── rightPanel (可折叠, rightCollapsed / onToggleRightPanel) → RightPanel / WorldDynamicsPanel
```

**移动端布局**:

```
MobileLayout (gameScreen/MobileLayout.tsx)
├── 左滑出面板
├── 中央聊天区域 (children = chatPanelEl)
├── 右滑出面板
└── 中栏覆盖层 → JourneyDossierContent
```

移动端导航由 `navConfig.ts` 的工厂函数生成 12 项(比桌面多 `settings`),每项带 `action` 回调直接 `setMobileActivePanel(...)` 或 `navigate('settings')`。

**战斗 V3 集成**:

```typescript
useEffect(() => {
  const off = eventBus.on(EVENTS.COMBAT_ENCOUNTER_REQUESTED, handleTypedCombatRequest);
  return off;
}, [handleTypedCombatRequest]);

// 敌人自动行动（GameScreen.tsx:910-916）
useEffect(() => {
  const session = gameState.v3?.combatSession;
  const actor = session?.participants.find(unit => unit.id === session.activeUnitId);
  if (!readOnly && combatV3Enabled && session?.lifecycle === 'active' && actor?.side === 'enemy' && !combatAutomationTimerRef.current) {
    combatAutomationTimerRef.current = setTimeout(runCombatAutomationStep, 0);
  }
}, [gameState, combatV3Enabled, readOnly, runCombatAutomationStep]);
```

### 9.2 聊天面板 — `src/components/game/chat/ChatPanel.tsx`

**ChatPanel 实际子组件**(ChatPanel.tsx:1-10 导入):`MessageBubble`、`ErrorBoundary`、`InputArea`、`PipelineMonitorModal`,以及 `messageWindow.ts` 的 `getInitialMessageStart` / `getPreviousMessageStart`。

**`src/components/game/chat/` 实际文件**:`ChatPanel.tsx`、`MessageBubble.tsx`、`InputArea.tsx`、`PipelineMonitorModal.tsx`、`ContextMenu.tsx`、`InlineDiceCard.tsx`、`InlineTalentCard.tsx`、`InlineImageGenButton.tsx`、`messageWindow.ts`、`pipelineUI.ts`、`messageBubble/` 子目录(`BubbleContent.tsx` / `EditMode.tsx` / `InlinePortals.tsx` / `renderPipeline.ts` / `types.ts` / `useMenuItems.tsx`)+ 3 个测试。

**消息渲染管线**:

```
MessageBubble (MessageBubble.tsx:1-9 导入)
  ├─ useRenderedContent / useDisplayScripts (messageBubble/renderPipeline.ts)
  │    实际单行链式调用（renderPipeline.ts:69-73）:
  │    const cleanedByRegex = stripTimeAdvanceTags(processRegexScripts(stripTimeAdvanceTags(raw), displayScripts));
  │    const cleaned = message.streaming ? cleanedByRegex : renderDialogueMarkup(cleanedByRegex);
  │    return parseContent(cleaned, {...});   // → Markdown / iframe
  │    ├─ processRegexScripts  ← utils/regexScripts
  │    ├─ stripTimeAdvanceTags ← time/worldClock（内外各调一次，共 2 次）
  │    ├─ renderDialogueMarkup ← utils/dialogueMarkup（仅非 streaming 时执行）
  │    └─ parseContent / createIframeSrcDoc ← utils/markdown
  ├─ BubbleContent (messageBubble/BubbleContent.tsx) → pre-wrap / iframe / dangerouslySetInnerHTML
  ├─ useInlinePortals (messageBubble/InlinePortals.tsx)
  │    → .dice-roll-placeholder / .talent-gain-placeholder
  │    / .inline-image-gen-placeholder / .inline-dialogue-card
  ├─ EditMode (messageBubble/EditMode.tsx)
  ├─ useMenuItems (messageBubble/useMenuItems.tsx) → ContextMenu
  └─ mergeDisplayScripts (renderPipeline.ts:24, 合并多组 RegexScript)
```

**虚拟滚动**(`messageWindow.ts`):

```typescript
export const MESSAGE_BATCH_SIZE = 80;
export function getInitialMessageStart(totalMessages: number): number {
  return Math.max(0, totalMessages - MESSAGE_BATCH_SIZE);
}
export function getPreviousMessageStart(currentStart: number): number {
  return Math.max(0, currentStart - MESSAGE_BATCH_SIZE);
}
```

- 初始:最近 `MESSAGE_BATCH_SIZE = 80` 条
- 上滑加载历史(锚点保留),每次再放开一个 80 条批次
- 存档替换检测(ChatPanel.tsx:52)完整条件是**两个或条件**:
    
  `previousHistory.firstId !== messages[0]?.id || messages.length < previousHistory.length` → `historyWasReplaced` → 重置窗口
- 历史指纹存在 `messageHistoryRef = useRef({ firstId: messages[0]?.id, length: messages.length })`(:41)

### 9.3~9.9 (其他 UI 组件目录)

7 个子目录(实际内容见上方 §9.3~9.9):

- §9.3 卡片工作流 UI — `card-workflow/`
- §9.4 事件组件 — `event/`
- §9.5 工作流编辑器 — `workflow/`
- §9.6 职业组件 — `profession/`
- §9.7 设置屏 — `settings/` + `SettingsScreen.tsx`
- §9.8 共享/起始/用户中心 — `shared/` + `start/` + `UserCenterPage.tsx`
- §9.9 通用组件 — `ErrorBoundary` / `TelemetryConsentBanner`

### 9.10 GameScreen 完整布局与面板系统 (散节整合)

#### 9.10.1 DesktopLayout 布局参数

| 区域          | 宽度                                                                 | 条件                     |
| ----------- | ------------------------------------------------------------------ | ---------------------- |
| 左侧导航        | 内联 `<nav className="game-journey__nav">`(CSS 类控制宽度,源码无 `52px` 字面量) | 桌面端                    |
| ChatPanel   | `flex: 1`                                                          | 始终显示                   |
| RightPanel  | 可折叠                                                                | ≤900px 自动折叠            |
| DrawerPanel | 覆盖 ChatPanel                                                       | `overlay !== null` 时滑出 |

#### 9.10.2 移动端断点

| 断点        | 行为                       |
| --------- | ------------------------ |
| ≤640px    | 渲染 MobileLayout          |
| 641-900px | DesktopLayout + 右侧面板自动折叠 |
| >900px    | DesktopLayout + 右侧面板默认展开 |

#### 9.10.3 事件包二级开关

```typescript
let enabledIds: string[];
if (sessionActivePacks !== undefined) {
  enabledIds = sessionActivePacks;  // 会话级优先
} else {
  const entries = await listPacks(true);
  enabledIds = entries.filter(e => e.enabled).map(e => e.meta.id);
}
```

#### 9.10.4 worldSystem 融合

```typescript
const worldSystem = useMemo(() => ({
  stat: { ...worldDef.modules.stat, ...gameState.current },
  profession: resolveProfessionBinding(worldDef, gameState),
  combat: resolveCombatRuleset(worldDef, gameState),
  dice: { ...config, runtime: runtimeData },
}), [worldDef, gameState]);
```

#### 9.10.5 CombatWireframe 显示条件

```typescript
combatV3Enabled &&
gameState.v3?.combatSession &&
(
  gameState.v3.combatSession.lifecycle !== 'terminal'
  || gameState.v3.combatSession.result?.narration.status !== 'succeeded'
)
```

### 9.11 ChatPanel 虚拟滚动实现 (散节整合)

#### 9.11.1 滚动锚点技术

```
handleMessageListScroll
  ↓
!atBottom && !capturing && scrollUp → 捕获锚点 { scrollHeight, scrollTop }
  ↓
setVisibleStart(getPreviousMessageStart(current))
  ↓
useLayoutEffect 追加消息后
  el.scrollTop = anchor.scrollTop + (el.scrollHeight - anchor.scrollHeight)
```

**首次加载**: `getInitialMessageStart(messages.length)` 默认返回最近 80 条。

**存档替换检测**: `previousHistory.firstId !== messages[0]?.id` → 重置窗口。

#### 9.11.2 Inline Portals 渲染层

`MessageBubble` 使用 `ReactDOM.createPortal`:

- `.dice-roll-placeholder` → `InlineDiceCard`
- `.talent-gain-placeholder` → `InlineTalentCard`
- `.inline-image-gen-placeholder` → `InlineImageGenButton`
- `.inline-dialogue-card` → 头像补水(portraitStore)

#### 9.11.3 输入处理

```typescript
const handleOptionClick = (optionText: string) => {
  setInputText(prev => prev.trim() ? `${prev} ${optionText}` : optionText);
};

useEffect(() => {
  if (externalDraft?.id !== lastDraftIdRef.current) {
    setInputText(externalDraft.text);
    lastDraftIdRef.current = externalDraft.id;
  }
}, [externalDraft]);
```

---


### 9.12 世界编辑器当前入口

`WorldEditorForm` 现在只有 Dawn V4 `world-weave` 展示路径。历史 `presentationMode="legacy"`、旧编辑器 body/footer 分支与对应 `.world-editor-legacy-frame` 样式已经删除。当前两个生产入口（开始页创建、自定义资产编辑）共享同一世界编织 UI。
