> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（10、导航与 Context — `src/context/`）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 10、导航与 Context — `src/context/`

`src/context/` 共 **6 个文件**:`GameContext.tsx`、`UISettingsContext.tsx`、`createJourney.ts`(+`createJourney.test.ts`)、`journeyNavigation.ts`(+`journeyNavigation.test.ts`)。

### 10.1 游戏导航 — `src/context/GameContext.tsx`

**文件路径**: `src/context/GameContext.tsx`

全局导航状态机,管理 5 个 Screen(start/settings/game/events/user-center)。

**状态机**(`src/context/GameContext.tsx:26`):

```typescript
type Screen = 'start' | 'settings' | 'game' | 'events' | 'user-center';

interface AppState {
  currentScreen: Screen;
  screenHistory: Screen[];  // 导航历史栈
  selectedWorld: string;
  personalInfo: PlayerProfile | null;
  characterHistory: string;
}

type Action =   // :36-43, 共 7 个
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'GO_BACK' }
  | { type: 'SET_WORLD'; worldId: string }
  | { type: 'SET_PERSONAL_INFO'; info: PlayerProfile | null }
  | { type: 'SET_CHARACTER_HISTORY'; history: string }
  | { type: 'LOAD_SAVE'; save: GameSave }
  | { type: 'CLEAR_SAVE_DATA' };
```

`reducer`(`:53-84`)各分支行号:`NAVIGATE` `:56`、`GO_BACK` `:57-60`、`SET_WORLD` `:61-62`、`SET_PERSONAL_INFO` `:63-64`、`SET_CHARACTER_HISTORY` `:65-66`、`LOAD_SAVE` `:67-73`、`CLEAR_SAVE_DATA` `:74-80`。`withProfileDefaults(raw)`(`:13-24`)补齐玩家档案默认字段。Context 值(`:241-244`)为 `{ state, dispatch, navigate, goBack, engine, markNewGameStarted }`,`GameContextType` 定义在 `:86-93`。

**Provider 嵌套**(`src/App.tsx:60-71`):

```
ErrorBoundary
  └─ UISettingsProvider (主题/字体/语言/i18n)
        ├─ GameProvider (导航状态/游戏引擎/存档逻辑)
        │     └─ AppContent
        └─ TelemetryConsentBanner (与 GameProvider 平级,同为 UISettingsProvider 的子节点)
```

**路由分发**(`src/App.tsx:30-57`):`game` 与 `settings` **不在 `switch` 里**——先处理 `currentScreen === 'game'` 或「settings 叠在 game 上」的情形(`:32-41`,渲染 `GameScreen` + 可选的 `SettingsScreen` 覆盖层),再处理独立的 `settingsOpen`(`:42-51`,背景挂 `StartScreen`),最后才 `switch` 剩余三项:`events` → `EventsScreen`(`:54`)、`user-center` → `UserCenterPage`(`:55`)、`default` → `StartScreen`(`:56`)。

**F5 刷新恢复**:见 §23.4(完整逻辑)。

### 10.2 UI 设置 — `src/context/UISettingsContext.tsx`

主题/字体/语言/i18n/动画开关等全局 UI 偏好。

- Context 值仅三个字段:`{ settings, update, t }`(`src/context/UISettingsContext.tsx:6-10`)。
- `settings: UISettings` 共 **9 个字段**:`language` / `theme` / `font` / `uiFontSize` / `bodyFontSize` / `lineHeight` / `centeredNarrative` / `autoScroll` / `disableEffects`。
- `t(key)` 是查表翻译函数,不是带命名空间的 i18n 框架;支持 `zh-CN` / `en` 两套词条。
- `UISettingsContext.tsx:4` 从 `src/stores/configStore.ts` 再导出 `Theme` 类型(取值 `'light' | 'dark' | 'metal' | 'green'`)。

### 10.3 旅程事务 — `createJourney.ts` / `journeyNavigation.ts`

这两个文件把「创建旅程」「离开旅程」抽成显式事务,**落盘先于替换当前存档**,避免中途失败留下半截状态。

**建档事务 `src/context/createJourney.ts`**(`:17-27` 暴露类型,`:30` 起为实现):

- 导出 `JourneyCreationInput` / `JourneyCreationPorts` / `CreateJourney`。
- `:34 start` 是入口;`:72` 用 `save_${Date.now()}_${uuid}` 生成存档 id;`:115 persist` 只写新记录、不动当前存档;`:118 activate` 成功后才切换当前存档。`prepare` 阶段只产出游离对象,任何一步失败都不影响既有存档。

**离开事务 `src/context/journeyNavigation.ts`**(`:1-18` 导出):

- 导出 `JourneyDestination`(目的地 `'start'` / `'settings'`)与 `LeaveJourney`。
- `:25` 为离开流程:先确认并中止在途流式生成 → `flush` 完整捕获 → 持久化成功后才导航;失败则停留在当前旅程。另导出 `LoadJourney`(`:52`)与 `:57`。

两者均带测试(`createJourney.test.ts` / `journeyNavigation.test.ts`),消费者为 `src/components/game/GameScreen.tsx:38` 与 `src/components/start/useStartScreen.ts:1,:5`。

---
