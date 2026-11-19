> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（16、主题与样式系统）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 16、主题与样式系统

> **2026-11-17 更新**：UI 四主题（`light` / `dark` / `metal` / `green`）与 `src/theme/` 世界自适应皮肤已删除。界面只有一套星仪夜色主题，由 `src/ui/planar/planar-base.css` 统一映射变量；设置页主题行为只读占位。删除前的实现见 git tag `archive/themes-before-removal`。下文为历史记录。


系统里有**两套互不相干的主题概念**，读代码时必须分清：

| 概念 | 载体 | 取值 | 用途 |
| --- | --- | --- | --- |
| UI 主题 | `src/stores/configStore.ts:8` `Theme` | `'light' \| 'dark' \| 'metal' \| 'green'` | 用户偏好，写到 `dataset.theme`（`configStore.ts:141`）；`src/context/UISettingsContext.tsx:4` 再导出 |
| 世界自适应皮肤 | `src/theme/types.ts:3-8` `ThemeSkinId` | `crystal-neutral` / `crystal-cyber` / `crystal-forest` / `crystal-ruins` / `crystal-sakura` | 按世界自动选色板，仅覆盖 CSS 变量 |

### 16.1 主题系统 — `src/theme/`

| 文件 | 行数 | 职责 |
| --- | --- | --- |
| `types.ts` | 34 | `ThemeMode = 'light' \| 'dark'`（`:1`）、`ThemeSkinId`（`:3-8`，5 个值）、`ThemeTokenSet`（`:10`）、`ThemeMotionSpec`（`:17`）、`ThemeSkinDefinition`（`:23`）、`AdaptiveThemeSpec`（`:29`） |
| `registry.ts` | 63 | `THEME_REGISTRY`（`:5`）注册 5 套皮肤；`BUILTIN_WORLD_SKINS`（`:48-56`）共 7 条映射 = 6 个内置世界（`japanese_school` / `desire_metropolis` / `wuxia_world` / `wasteland_apocalypse` / `stranded_island` / `border_trade`）+ 1 个历史兼容键 `world-cyber-city`；`TAG_SKINS`（`:59-`）按标签兜底 |
| `resolveAdaptiveTheme.ts` | 50 | `resolveAdaptiveTheme(world: WorldDef, mode: ThemeMode \| string): AdaptiveThemeSpec`（`:39`） |
| `applyAdaptiveTheme.ts` | 16 | 把 `AdaptiveThemeSpec` 写成 DOM/CSS 变量 |
| `useAdaptiveTheme.ts` | 32 | React Hook 包装（`App.tsx:11` 使用） |

`resolveAdaptiveTheme` **只吃两个参数**（`world` 与 `mode`），与「时间」「玩家偏好」无关。选皮肤的顺序（`resolveSkin`，`:27-37`）：

1. `world.presentation?.skin`（须为已注册 skin，`:28-29`）；
2. `BUILTIN_WORLD_SKINS[world.id]`（`:31-34`）；
3. `skinFromTags(world.tags)`（`:13`）→ `skinFromDescription(world.description)`（`:21`）→ 兜底 `'crystal-neutral'`（`:36`）。

### 16.2 样式系统 — `src/styles/`

**共 16 个 CSS 文件**（`src/styles/*.css` 实测 16 个，此处不再有「17 个」）。

- 基础：`tokens.css` / `base.css` / `responsive.css`
- 战斗：`combat-battle-v3.css` / `combat-formal.css` / `combat-wireframe.css`
- 创建：`creation-ritual.css` / `creation-tarot.css`
- 布局：`layout-game.css` / `layout-settings.css` / `layout-wizard.css`
- 职业：`profession-book.css` / `profession-library.css`
- 其他：`entry-crystal.css` / `game-journey.css` / `custom-modules.css`

**加载方式分两级**——全局入口 `src/index.css` 只 `@import` 10 个（`:8-17`：tokens、base、layout-wizard、layout-settings、layout-game、responsive、entry-crystal、creation-ritual、creation-tarot、game-journey），加载顺序在文件头注释里声明为 `tokens → base → layout-wizard → layout-settings → layout-game → responsive`，`responsive` 最后以保证移动端断点覆盖生效。

其余 6 个按需由组件局部 `import`（进页面才带进来）：

| CSS | 引入点 |
| --- | --- |
| `combat-wireframe.css` / `combat-battle-v3.css` / `combat-formal.css` | `src/components/game/CombatWireframe.tsx:23-25` |
| `profession-book.css` | `src/components/profession/ProfessionBook.tsx:5` |
| `profession-library.css` | `src/components/game/panels/ProfessionTreePanel.tsx:7`、`src/components/profession/ProfessionTreeCanvas.tsx:17` |
| `custom-modules.css` | `src/components/game/panels/CustomModulePanel.tsx:3`、`src/components/start/CustomModuleAgentWorkspace.tsx:15` |

> 全仓 `*.css` 中 **没有** `@layer` 声明——CSS cascade layers 未启用，优先级完全靠源码顺序与选择器权重。

---
