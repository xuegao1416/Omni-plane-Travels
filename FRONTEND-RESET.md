# 前端重铺记录（位面星仪 · 夜色 + 黄铜）

## 结论

旧的四代表皮（蓝白极简 → 神殿穹顶 → dawn → planar-surfaces 叠皮）已经**删除**，不是注释停用。
删除前的完整状态存档在 commit `23f7c44`，删除本身在 `154ab90`。需要对照旧写法时用
`git show 23f7c44:src/styles/<文件名>` 查看，**不要把它们恢复回来，也不要再 import**。

已删除：`layout-wizard` `layout-settings` `layout-game` `entry-crystal` `creation-ritual`
`creation-tarot` `game-journey` `planar-surfaces` `custom-modules` 九张样式表，以及
`components/start/EntryTransition.tsx` 与 `EntrySurface.tsx` 里的 `EntrySlicedProgress`。

## 现在的样式结构

**全局（`src/index.css` 依次 import）**

| 文件 | 内容 |
|---|---|
| `styles/tokens.css` | `--accent` / `--bg-*` / `--text-*` 等变量，已解析为夜色 + 黄铜 |
| `styles/base.css` | 重置、滚动条、`:focus-visible`、`data-effects='off'` 性能模式 |
| `styles/responsive.css` | 断点，无配色 |
| `styles/planar.css` | `--pl-*` 星仪 Token（字体、墨色、黄铜、弹簧曲线） |
| `styles/planar-entry.css` | 首页 / 大厅 |
| `ui/planar/planar-base.css` | 全局基础控件（按钮、输入、标签） |
| `ui/planar/planar-kit.css` | `.pk-*` 材质组件：板、井、黄铜钉、角花、ReactFlow 星图主题 |
| `ui/screens/overlays.css` | 通用浮层 / 对话框 |

kit 变量：`--pk-plate` `--pk-well` `--pk-well-edge` `--pk-lit` `--pk-brass-face` `--pk-spring` `--pk-ease`。

**按屏由组件直接 import（`src/ui/screens/`）**

| 样式表 | 引入方 |
|---|---|
| `wizard.css` + `wizard-steps.css` | `WizardShell.tsx`（含加点条、步骤栏、前尘编年） |
| `world-weave.css` | `WorldEditorForm.tsx`、`GuidedChoiceOverlay.tsx` |
| `ritual-overlays.css` | `ProfessionTarotOverlay.tsx`、`TalentCodexOverlay.tsx`、`WorldForkSelectModal.tsx` |
| `game.css` `game-story.css` `game-dossier.css` `game-panels.css` | `GameScreen.tsx`、`dev/GameShellPreview.tsx` |
| `settings.css` | `SettingsScreen.tsx` |
| `traveler-registry.css` | `UserCenterPage.tsx` |
| `event-archive.css` | `EventArchiveWorkspace.tsx` |
| `event-workbench.css` | `WorkflowEditor.tsx`、`CardEditor.tsx`、`AiEventGenerator.tsx`、`CardWorkflowEditor.tsx` |
| `combat.css` | `CombatWireframe.tsx`、`CombatEncounterDecisionCard.tsx`、`AbilityProposalCard.tsx` |
| `game-equipment.css` | `components/game/inventory/*`（星仪人偶纸娃娃、NPC 装备环、有容量的行囊格子、物品详情浮层） |
| `game-npc.css` | `panels/characterGrid/NPCDetail.tsx`（人物卷宗，挂到 body 的居中卷宗 / 手机整屏卷宗） |
| `module-workshop.css` | `CustomModulePanel.tsx`、`CustomModuleAgentWorkspace.tsx` |
| `map.css` | `components/map/MapView.tsx`、`MapEditorWorkspace.tsx`、`panels/MapPanel.tsx`、`moduleEditors/MapModuleEditor.tsx`、`dev/MapPreview.tsx`（2D 三种画风的画布、3D 标签、视图外壳、游戏内地图卷宗与右栏小地图；画布里的颜色属于地图画风，不随界面主题变） |
| `map-editor.css` | `MapEditorWorkspace.tsx`、`moduleEditors/MapModuleEditor.tsx`（地图编辑器三栏工作台、世界编辑里的「世界地图」卡；标题渐变字的晨雾版在 `dawn-kit.css`） |

**仍在 `src/styles/` 的局部样式**：`profession-book.css`（`ProfessionBook.tsx`）、
`profession-library.css`（`ProfessionTreePanel.tsx` / `ProfessionTreeCanvas.tsx`，末尾有夜色黄铜段）。

战斗界面已重做为 `ui/screens/combat.css`（`CombatWireframe.tsx`、`CombatEncounterDecisionCard.tsx`、`AbilityProposalCard.tsx`），人物立绘与场景底图为离线生图（MOSS Anime Turbo + BiRefNet 抠图）后的静态 WebP，放在 `public/art/combat/`（`fig-*` 全身透明立绘、`bust-*` 192px 头像、`bg-*` 1600×900 场景底图 + `-960` 手机版，`srcset` 自动挑选；敌人按名字关键词映射到 12 种造型，见 `ENEMY_RULES`），由 `components/game/combat/combatArt.tsx` 映射（按场景换装：ink 汉服、ruins/city/dusk 现代、void 科幻、castle/wilds 奇幻；15 种造型 × 4 套服装全覆盖，`VARIANTS` 未列出的套装沿用本身就合适的基础立绘）；框体、图标、徽记仍为代码绘制；纯代码绘制版存档于 commit `66fd831`，特效由 `useCombatFx.ts` 依据已结算行动记录驱动；战场背景由 `combat/battleScene.ts` 按世界名称/标签/简介关键词选七种场景之一（ink/ruins/city/wilds/castle/void/dusk，无匹配回落 dusk，自定义世界同样适用，不按世界 id 硬编码），`combat/BattleBackdrop.tsx` 叠三层：当前场景底图（只请求这一张）→ 星盘地面 SVG（`combat/backdrop/paint.tsx` 的 `Arena`）→ CSS 氛围层，只有雾气/浮尘层做 transform/opacity 动画；只有启用战斗模块的世界才会出现战斗界面；预览可加 `&world=名称&tags=a,b&desc=简介` 切换场景；本机 `?plshot=combat&stage=active|terminal` 可直接预览。

## 规则

1. 不写 `!important` 去盖别的表；新样式直接写进对应屏的 `ui/screens/*.css` 或 kit。
2. 禁止薄荷绿 / 浅绿 / 蓝白残留色；亮底按钮上的文字用 `#2a1a04`。
3. 禁用原生 `alert` / `confirm` / `prompt`，走 `components/shared/Dialog.tsx`。
4. 动画统一用 `var(--pk-spring)`，每张表都带 `prefers-reduced-motion` 降级。
5. 截图自查：本机 `?plshot=hall|home|game|settings|events|user|wizard|editor|kit|combat`。

## 契约测试

以下测试 `readFileSync` 样式表做字符串断言，已改为读新表：

| 测试 | 读取 |
|---|---|
| `historySurfaceContract.test.ts` | `ui/screens/wizard-steps.css` |
| `entryHallVisualContract.test.ts` | `styles/planar-entry.css` |
| `CardOverlay.mobile.test.ts`、`nestedDetailSurface.test.ts` | `ui/screens/game-dossier.css` |
| `mobileTitleContract.test.ts` | `ui/screens/game-story.css` |
| `guidedChoiceDawn.test.ts` | `ui/screens/world-weave.css` |
| `dawnV4Migration.test.ts` | `ui/screens/wizard.css`、`game-story.css`、`game.css` |

改样式时如果它们失败，先判断是断言过时还是真的丢了功能性规则（滚动、溢出、安全区）。

## 大扫除（重构收尾）

- 删除无引用旧美术约 43MB（`public/art/theme/{entry,save,saves,crystals}`、`ui-kit/dawn-v4/{portraits,ritual}`、`ui-kit/{fill,track}-*`）与无挂载组件（`SavesView`、`worldDynamics` 四个旧 Tab 及其卡片、`dev/layout-calibration`）。
- 全仓 `!important` 只剩 `prefers-reduced-motion` / 关闭动效重置与 `[hidden]`；原先压内联样式的地方改为删去静态内联值或抬高作用域选择器。`Seal` 尺寸改走 `--pk-seal-size`，样式表可直接改。

## 晨雾琉璃（亮色主题）

`:root[data-ui-theme='dawn']` 下生效；颜色走 `--d-*` 角色变量（夜色回落原值），覆盖层为 `ui/planar/dawn.css` → `dawn-kit.css` → `ui/dawn/dawn-entry.css` → `dawn-hall.css` → `dawn-backdrop.css` → `dawn-combat.css`（`index.css` 末尾依次 import）；首页/大厅主视觉是代码绘制的 three.js 场景（`ui/dawn/DawnScene.tsx` + `ui/dawn/scene/`），不再用位图，没有 WebGL2 时由 `dawn-backdrop.css` 的 CSS 背景兜底。新样式写颜色时也用 `--d-*` 角色并带夜色回落值。
