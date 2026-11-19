> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（9、UI 组件系统 — `src/components/`）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 9、UI 组件系统 — `src/components/`

### 9.1 游戏主界面 — `src/components/game/GameScreen.tsx`

**布局组件位置**:`DesktopLayout` / `MobileLayout` / `DrawerPanel` / `navConfig.ts` / `types.ts` 均在 `src/components/game/gameScreen/`(该目录 10 个文件,另含 `mobileTitleContract.test.ts` 与 `hooks/useSimulation.ts`、`hooks/useSurvivalCraft.ts`(+test)、`hooks/useSurvivalSettlement.ts`);`ChatPanel` 在 `game/chat/`;`RightPanel` / `WorldDynamicsPanel` 在 `game/panels/`;`JourneyDossierContent` 在 `game/shared/`。

**三栏桌面布局**:

```
DesktopLayout (gameScreen/DesktopLayout.tsx)
├── <nav className="game-journey__nav">   ← 内联渲染，没有 LeftNavBar 组件
│     由 navConfig.ts 的 navButtons 驱动（11 项，无 settings）:
│     home / profile / characters / tasks / profession / notebook
│     / variables / worldbook / dynamics / memory / modules
├── children = chatPanelEl (ChatPanel)
├── DrawerPanel (gameScreen/DrawerPanel.tsx) ← drawerContent 由 GameScreen 传入 JourneyDossierContent
└── rightPanel (可折叠, rightCollapsed / onToggleRightPanel) → RightPanel
```

注:`WorldDynamicsPanel` **不在** `rightPanelEl` 里——它是 `GameScreen.tsx:982 renderPanelContent` 的 `case 'dynamics'`(`:998`)分支,通过 `DrawerPanel`(桌面)或 `MobileLayout` 左侧面板(移动端)作为覆盖层渲染。

**移动端布局**:

```
MobileLayout (gameScreen/MobileLayout.tsx, 166 行)
├── <main> 中央聊天区域 (children = chatPanelEl)
├── MobileOverlay side="left"  width={260}  ← 左侧导航 (:99-138, showLeftOverlay)
├── MobileOverlay side="left"  width={300}  ← 左侧面板 (:141-152, mobileActivePanel, 内容 = panelContent)
└── MobileOverlay side="right" width={320}  ← 右侧信息面板 (:155-163, showRightOverlay, 内容 = rightPanel)
```

**不存在「中栏覆盖层」**:`JourneyDossierContent` 不在此层,它是 `GameScreen.tsx:1003` 在 `renderPanelContent` 末尾对抽屉内容做的一层包装(`panel && content ? <JourneyDossierContent panel={normalizeDossierPanel(panel)}>{content}</JourneyDossierContent> : content`)。

移动端导航由 `navConfig.ts:46 buildMobileNavItems({ navigate, setShowLeftOverlay, setMobileActivePanel })` 生成 **12 项**(桌面 `navButtons`(:5-17) 是 11 项,移动端多 `settings`),每项带 `action` 回调:导航类先 `setShowLeftOverlay(false)` 再 `setMobileActivePanel('profile' | 'characters' | ...)`(`:54-64`),`home` 走 `navigate('start')`(`:54`),`settings` 走 `navigate('settings')`(`:65`)。

**战斗 V3 集成**:

```typescript
useEffect(() => {
  const off = eventBus.on(EVENTS.COMBAT_ENCOUNTER_REQUESTED, handleTypedCombatRequest);
  return off;
}, [handleTypedCombatRequest]);

// 敌人自动行动（GameScreen.tsx:864-870）
useEffect(() => {
  const session = gameState.v3?.combatSession;
  const actor = session?.participants.find(unit => unit.id === session.activeUnitId);
  if (!readOnly && combatV3Enabled && session?.lifecycle === 'active' && actor?.side === 'enemy' && !combatAutomationTimerRef.current) {
    combatAutomationTimerRef.current = setTimeout(runCombatAutomationStep, 0);
  }
}, [gameState, combatV3Enabled, readOnly, runCombatAutomationStep]);
```

### 9.2 聊天面板 — `src/components/game/chat/ChatPanel.tsx`

**ChatPanel 子组件**(ChatPanel.tsx:1-10 导入):`MessageBubble`、`ErrorBoundary`、`InputArea`、`PipelineMonitorModal`,以及 `messageWindow.ts` 的 `getInitialMessageStart` / `getPreviousMessageStart`。发送回调类型是 `import('./draftSubmission').ActionSender`(`ChatPanel.tsx:15`)。

**`src/components/game/chat/` 文件**(顶层 15 个):`ChatPanel.tsx`、`MessageBubble.tsx`、`InputArea.tsx`、`PipelineMonitorModal.tsx`、`ContextMenu.tsx`、`InlineDiceCard.tsx`、`InlineTalentCard.tsx`、`InlineImageGenButton.tsx`、`messageWindow.ts`、`pipelineUI.ts`、`draftSubmission.ts`,+ **4 个测试**(`dialoguePipeline.test.ts` / `draftSubmission.test.ts` / `messageWindow.test.ts` / `PipelineMonitorModal.mobile.test.ts`);另有 `messageBubble/` 子目录 6 个文件(`BubbleContent.tsx` / `EditMode.tsx` / `InlinePortals.tsx` / `renderPipeline.ts` / `types.ts` / `useMenuItems.tsx`)。

**消息渲染管线**:

```
MessageBubble (MessageBubble.tsx:1-9 导入)
  ├─ useRenderedContent / useDisplayScripts (messageBubble/renderPipeline.ts)
  │    单行链式调用（renderPipeline.ts:69-73）:
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
- 存档替换检测(ChatPanel.tsx:56)完整条件是**两个或条件**:
    
  `previousHistory.firstId !== messages[0]?.id || messages.length < previousHistory.length` → `historyWasReplaced` → 重置窗口
- 历史指纹存在 `messageHistoryRef = useRef({ firstId: messages[0]?.id, length: messages.length })`(:45)

### 9.3~9.9 (其他 UI 组件目录)

`src/components/` 顶层共 **8 个子目录**:`game/`(已在 §9.1–§9.2 说明)、`card-workflow/`、`event/`、`workflow/`、`profession/`、`settings/`、`shared/`、`start/`;另有 `SettingsScreen.tsx`、`UserCenterPage.tsx`、`ErrorBoundary.tsx`、`TelemetryConsentBanner.tsx` 等散落文件。逐条说明见下方:

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
| RightPanel  | 可折叠(`RightPanel.tsx`,位于 `game/panels/`)                             | ≤1100px 自动折叠          |
| DrawerPanel | 覆盖 ChatPanel                                                       | `overlay !== null` 时滑出 |

#### 9.10.2 移动端断点

断点常量见 `src/components/game/GameScreen.tsx`:`:123 const isMobile = useMediaQuery('(max-width: 640px)');` 与 `:167 const mq = window.matchMedia('(max-width: 1100px)');`(创建后立即以 `handler(mq)` 赋初值)。

| 断点         | 行为                       |
| ---------- | ------------------------ |
| ≤640px     | 渲染 MobileLayout          |
| 641-1100px | DesktopLayout + 右侧面板自动折叠 |
| >1100px    | DesktopLayout + 右侧面板默认展开 |

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
const worldSystem = useMemo((): WorldSystemData => {
  if (!worldDef?.modules) return {};
  const keyMap: Record<string, string> = {
    stat: '数值属性', progression: '成长体系', survival: '生存资源',
    business: '经营资产', dice: '骰子检定', talent: '天赋体系',
    profession: '职业体系', combat: '战斗系统',
  };
  const result: WorldSystemData = {};
  for (const mod of worldDef.modules) {
    if (!mod.enabled) continue;
    if (mod.moduleId === 'profession' && !isProfessionModuleEnabled(worldDef)) continue;
    const key = keyMap[mod.moduleId];
    if (!key || (!mod.moduleConfig && mod.moduleId !== 'dice')) continue;
    const config = (mod.moduleConfig || createDefaultDiceModule()) as Record<string, any>;
    if (mod.moduleId === 'stat') {
      const live = gameState.玩家?.生存状态 ?? {};
      // attrA/attrB 取 live.血量 / live.体力值；dim1..dim6 与 special[] 用 live[id] 覆盖 config 值
      ...
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
  // 末尾把 resolveProfessionBonuses(gameState, professionConfig).checks 塞进骰子模块的 runtimeBonuses
  return result;
}, [worldDef, gameState, stateVersion]);
```

要点:数值属性把玩家实时值(`gameState.玩家.生存状态`)合并进配置;`profession` 走 `resolveProfessionBinding(config)`、`combat` 走 `resolveCombatRuleset(config)`、`dice` 用 `gameState.dice` 覆盖;依赖是 `[worldDef, gameState, stateVersion]`。**不存在 `gameState.current` 或 `runtimeData`**。

#### 9.10.5 CombatWireframe 显示条件

`src/components/game/GameScreen.tsx:1139`:

```typescript
{combatV3Enabled && gameState.v3?.combatSession && (gameState.v3.combatSession.lifecycle !== 'terminal' || gameState.v3.combatSession.result?.narration.status !== 'succeeded') && <CombatWireframe ... />}
```

即:战斗特性开启、存在战斗会话,且「未终结」或「已终结但叙事尚未成功」时显示。紧随其后 `:1155` 是待决遭遇卡 `CombatEncounterDecisionCard`(条件 `combatV3Enabled && !readOnly && gameState.v3?.pendingEncounterRequest`)。

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

**存档替换检测**(ChatPanel.tsx:55-57):`const previousHistory = messageHistoryRef.current;` → `const historyWasReplaced = previousHistory.firstId !== messages[0]?.id || messages.length < previousHistory.length;` → `renderedStart = historyWasReplaced ? getInitialMessageStart(messages.length) : visibleStart`。**两个条件是或关系**——首条 id 变化或消息数变少都判定为存档被替换。

#### 9.11.2 Inline Portals 渲染层（组件层）

`MessageBubble` 不使用 `ReactDOM.createPortal`。内联卡片由 `messageBubble/InlinePortals.tsx` 用 **`react-dom/client` 的 `createRoot`** 就地挂载:

```typescript
import { createRoot, type Root } from 'react-dom/client';   // InlinePortals.tsx:2
```

挂载流程:`BubbleContent.tsx:35` 调用 `useInlinePortals(messageHtmlRef, ...)` → 在 `messageHtmlRef.current` 上按选择器 `querySelectorAll` 找占位符 → 逐个 `createRoot(el)` 渲染(`:78` / `:122` / `:167`)。

- `.dice-roll-placeholder` → `InlineDiceCard`(`:65-78`)
- `.talent-gain-placeholder` → `InlineTalentCard`(`:110-122`)
- `.inline-image-gen-placeholder` → `InlineImageGenButton`(`:156-167`)
- `.inline-dialogue-card` → 头像补水(`:188` 起):走 `stores/imageStore` + `storage/imageDb` + `storage/imageUrls`,以 `portrait-<id>` 为 key `await imageUrls.acquire(...)`(`:202`)、`imageDb.findPortraitKeyByName(name)`(`:204`)、并 `imageUrls.subscribe(...)`(`:225`)订阅后续变更。**`portraitStore` 不存在**。

#### 9.11.3 输入处理

```typescript
// ChatPanel.tsx:88
const handleOptionClick = useCallback((optionText: string) => {
  setInputText(prev => {
    const trimmed = prev.trim()
    if (!trimmed) return optionText
    return `${trimmed} ${optionText}`
  })
}, [])

// ChatPanel.tsx:49-53
useEffect(() => {
  if (!externalDraft?.text || externalDraft.id === lastDraftIdRef.current) return;
  lastDraftIdRef.current = externalDraft.id;
  setInputText(externalDraft.text);
}, [externalDraft]);
```

---


### 9.12 世界编辑器当前入口

`WorldEditorForm` 现在只有 Dawn V4 `world-weave` 展示路径。历史 `presentationMode="legacy"`、旧编辑器 body/footer 分支与对应 `.world-editor-legacy-frame` 样式已经删除。当前两个生产入口（开始页创建、自定义资产编辑）共享同一世界编织 UI。
