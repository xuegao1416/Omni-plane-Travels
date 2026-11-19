# 新会话提示词：逻辑层重构（另一台电脑）

> 用法：把仓库拷到另一台电脑（或 `git clone` 后切到下文分支），装好 Bun，在仓库根目录新开 Claude Code 会话，把下面分隔线以下的全文粘贴进去。重构目标由你在后面补一句，例如「重构管线执行器与变量提取」。

---

你接手这个仓库的**逻辑层重构**（React 19 + TypeScript + Zustand + Bun + Tauri，AI 驱动的互动小说引擎）。先读根目录 `CLAUDE.md`：它是项目知识库，所有结构性断言都标了文件和行号，读完就不用通读源码了。再扫一眼 `FRONTEND-RESET.md`，了解哪些属于界面层、不归你管。

## 背景：前端刚重构完，另一路正在同时改界面主题

- 界面层刚完成整体重做，正在另一台机器上加第二套主题。你和那一路会在不同分支上并行工作，最后合并。所以界面层文件你改得越少，合并越顺。
- 起点：分支 `redesign/library`，提交 `67bf247`（或之后）。请新建自己的分支开始，比如 `refactor/logic`，不要直接在 `redesign/library` 上提交。

## 范围

**归你（可以重构）**：
`src/engine/`、`src/memory/`、`src/gameplay/`、`src/modules/`、`src/director/`、`src/simulation/`、`src/worldbook/`、`src/worldgen/`、`src/api/`、`src/storage/`、`src/stores/`、`src/context/`、`src/novel/`、`src/custom-modules/`、`src/time/`、`src/schema/`、`src/utils/`、`src/server/`、`functions/`、`migrations/`、`src-tauri/`。

**不要动（界面层）**：
- 所有 `*.css`、`src/ui/`、`src/styles/`、`public/art/`
- `src/components/game/combat/`（战斗美术与布局）
- `src/dev/`（本机预览工具；接口变了只做最小适配，让它能编译）
- 组件的 `className`、DOM 结构和文案

确实需要改组件时，只改它调用逻辑层的那几行，比如 import 路径、函数名、参数。不要顺手改样式或结构。

## 界面依赖的契约（改了就要同步保证兼容）

这些是界面直接消费的出口。可以改内部实现，但签名和返回形状要保持；非改不可的话，在同一个提交里把所有调用方一起改好：
- 战斗：`src/gameplay/combatViewModel.ts`（`buildCombatViewModel`、`CombatUnitCardModel`），`src/gameplay/combatV2.ts`（预览用到的 `createPreparingCombatSession`、`selectCombatants`、`startPreparedCombat`、`resolveCombatCommandV2`、`chooseAutomaticCommand`、`buildValidatedCombatRoster`、`balanceCombatItemProposal`），`src/gameplay/protocols.ts` 里的 `CombatSessionV2` / `CombatResult`。
- 游戏：`useGameEngine`（`src/engine/useGameEngine.ts`）对外返回的字段、`GameContext` 的导航状态机、`eventBus` 的 `EVENTS` 常量。
- 存档：`SAVE_SCHEMA_VERSION`、`v4 → v5` 迁移和对外导入导出格式 `2.0`。不能让已有存档读不出来。如果要改存档结构，必须加迁移和测试。

## 预设正文已还原（原「硬性禁令」已失效）

`src/data/builtinPresets.ts`、`presetDrcJcz.ts`、`presetDrcV12.ts`、`presetDeepSeekStyles.ts` 与 `presets/kunlun-linux-1.4-adapted.json` 里的 `【占位条目】原文内容已移除…` 已由项目所有者从源仓库（`D:\Omni-plane-Travels`）原件还原，当前与源盘逐字节相同。

- `src/data/presetPlaceholders.test.ts` 随占位一起删除。
- 条目仍须保持 id、顺序、所在字段（`content`、`enabled`、`role`、注入位置等）原样；改动正文前先确认是有意为之。
- `src/engine/promptAssembler.golden.test.ts` 与 `src/engine/mainPrompt.baseline.test.ts` 的基线已按还原后的正文重新生成。

## 工作方式

- 先出重构方案再动手：模块边界、迁移步骤、风险点、每一步怎么验证。等我确认后再开始。
- 小步提交。每步都要保证 `bunx tsc --noEmit -p .` 无错误、`bun test` 全部通过（起点是 1443 条全过）。不要通过删测试来让测试变绿。
- 收尾时还要 `bun run build` 成功，并在 `CLAUDE.md` 里更新你改过的结构性断言，带上文件和行号，行数按 CLAUDE.md 开头说明的口径统计。
- 不写 `!important`，不用原生弹窗。
- 省 token：不要通读仓库，按 CLAUDE.md 定位后只读相关文件。批量机械改动用脚本，不要开长时间运行的子代理。回复要简短。

## 你的重构目标

（在这里写一句具体目标，例如：拆分 `useGameEngine.ts` 的回合编排，把管线执行和结算移出 Hook。）
