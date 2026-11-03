> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（10、导航与 Context — `src/context/`）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 10、导航与 Context — `src/context/`

### 10.1 游戏导航 — `src/context/GameContext.tsx`

**文件路径**: `src/context/GameContext.tsx`

全局导航状态机,管理 5 个 Screen(start/settings/game/events/user-center)。

**状态机**:

```typescript
type Screen = 'start' | 'settings' | 'game' | 'events' | 'user-center';

interface AppState {
  currentScreen: Screen;
  screenHistory: Screen[];  // 导航历史栈
  selectedWorld: string;
  personalInfo: PlayerProfile | null;
  characterHistory: string;
}

type Action =
  | { type: 'NAVIGATE'; screen: Screen }
  | { type: 'GO_BACK' }
  | { type: 'SET_WORLD'; worldId: string }
  | { type: 'SET_PERSONAL_INFO'; info: PlayerProfile | null }
  | { type: 'SET_CHARACTER_HISTORY'; history: string }
  | { type: 'LOAD_SAVE'; save: GameSave }
  | { type: 'CLEAR_SAVE_DATA' };
```

**Provider 嵌套**:

```
ErrorBoundary
  └─ UISettingsProvider (主题/字体/语言/i18n)
        └─ GameProvider (导航状态/游戏引擎/存档逻辑)
              └─ AppContent (switch分发5个Screen)
```

**F5 刷新恢复**:见 §23.4(完整逻辑)。

### 10.2 UI 设置 — `src/context/UISettingsContext.tsx`

主题/字体/语言/i18n/动画开关等全局 UI 偏好。

---

