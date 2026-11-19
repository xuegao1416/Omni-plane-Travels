# 新会话提示词：第二套界面主题「晨雾水晶」（本机）

> 用法：在本机新开 Claude Code 会话，工作目录 `d:\Omniplane-Frontend`，把下面分隔线以下的全文粘贴进去。

---

你接手 `d:\Omniplane-Frontend`（React 19 + TypeScript + Bun，纯 CSS，无 Tailwind / CSS-in-JS）。先读根目录 `CLAUDE.md` 和 `FRONTEND-RESET.md`，其余文件按需读，不要通读仓库。

## 目标

现在界面只有一套主题「星仪夜色」（深蓝夜空 + 黄铜）。新增第二套**亮色**主题，复刻旧版大厅「水晶」主题的色调基调，用纯代码实现（CSS / SVG / Canvas，不用 AI 生图、不引入新位图）。夜色主题保持原样，两套可在设置里切换。

## 色调底线（来自旧版 `git show baseline:src/styles/entry-crystal.css`）

旧水晶主题的主色（按使用频次）：
- 晨雾青灰：`#648078` `#657a7f` `rgba(122,166,153,.42)` `rgba(100,128,120,.45)`
- 深石板绿（文字、描边）：`#29424a` `#294d42` `#35584d` `#294b45` `#315849`
- 旧金（强调、边饰）：`#b39453` `rgba(190,150,80,.72)` `rgba(211,179,111,.22)` `rgba(236,218,151,.16)`
- 羊皮纸白（底面）：`#edf5f0` `rgba(229,242,235,.76)` `rgba(255,255,248,.86)`
- 警示朱红：`#a45454`

底线是这个色调：白 / 雾青为底，石板绿做文字，旧金做点缀。水晶、篝火这些母题可留可换，换成你认为更好的意象也行。只看这一个文件的配色即可，不要翻旧版其他样式表。

## 先出方案，再写代码

动手前给出三个差异明显的视觉方向。三个方向的构图、材质和视觉语言都要不同，不能是同一模板换三套颜色。每个方向写清楚：
1. 视觉情绪和核心意象。
2. 底色、文字色、强调色、状态色（成功 / 警告 / 危险），给出具体色值。
3. 字体搭配：标题、正文、数字和标签。现有字体变量 `--pl-font-display`、`--pl-font-serif`、`--pl-font-ui` 在 `src/styles/planar.css:26-28`。
4. 材质语言：亮色下面板、按钮、输入框、边框和分隔线怎么做，替换掉现在的黄铜描边和暗色井槽。
5. 大厅 / 首页的主视觉怎么用代码画，各项技术怎么分工。
6. 最值得投入的三个细节。

给完方案后停下来等我选，不要先写代码。

## 审美约束（具体到可执行）

- **字体**：标题、正文、辅助信息的字号和字重要拉开层级，同时照顾字距和行高，不要全屏都是同一字号。
- **配色**：亮色主题不要做成「白底加灰卡片」的通用后台。底面要有温度和质地，比如雾气渐变、纸纹、极细的噪点。
- **背景**：要有前、中、后景的层次。光源方向在全站保持一致。
- **动效**：只用 transform / opacity。入场要分层错落，悬停反馈要克制。必须尊重 `prefers-reduced-motion` 和设置里的「关闭动效」（`:root[data-effects='off']`）。
- **必须避开的套路**：紫色渐变、毛玻璃堆叠、到处发光、清一色胶囊按钮和大圆角卡片、组件等距平铺、emoji 当图标。

## 现状与实现路径（读这些就够）

- `src/ui/planar/planar-base.css` 的 `:root` 把 `tokens.css` 的共享变量改成夜色值，大约 2400 处内联样式靠这些变量取色。`src/ui/planar/planar-kit.css` 是材质组件（`--pk-*`）。
- 主题切换用 `:root[data-ui-theme='dawn']` 覆盖这两层变量。属性名不要用 `data-theme`，旧四主题用过它，CLAUDE.md 里明令不要恢复。切换的持久化走 `configStore` 的 UI 设置。注意 `configStore.ts:158` 会丢弃旧的 `theme` 字段，所以要换一个新字段名。设置页的主题行在 `GeneralSettingsTab.tsx:21` 附近，文案键是 `theme.current` / `theme.placeholder`。
- **工作量预警**：各屏样式表（`src/ui/screens/*.css`、`src/styles/*.css`）里大约有 1700 个写死的十六进制颜色，大多是夜色的深底和金色。只换变量不够，要逐屏把写死的颜色改成变量，或者为亮色写覆盖规则。建议顺序：
  1. 先做变量层和设置开关。
  2. 再按屏推进：首页 / 大厅 → 向导 → 游戏主界面 → 二级界面 → 事件工作台 → 战斗。
  3. 每屏完成后截图验收，再进入下一屏。
- **战斗**：立绘和场景底图是 `public/art/combat/*.webp`，直接复用，不需要再生图。场景底图本身是夜景，所以战斗界面在亮色主题下只换外围的框、条和面板，战场可以保持原样。
- **夜色主题不能退化**：每改一屏，两套主题都要截图对比。

## 硬性规矩

- 不写 `!important`。现在全仓只剩减弱动效重置和 `[hidden]`，不要增加。
- 不用原生弹窗（alert / confirm / prompt）。
- 不改逻辑层和数据流。只动样式、展示组件，以及设置开关这一处状态。
- 预设正文已还原为原文（不再是 `【占位条目】`），`src/data/presetPlaceholders.test.ts` 已删除；条目 id、顺序与所在字段仍不许动。
- 删文件或大改之前先提交一个存档 commit，之后删死文件不用问我。每完成一屏提交一次。
- 收尾时要满足四条：`bunx tsc --noEmit -p .` 无错误，`bun test` 全部通过，`bun run build` 成功，`!important` 数量不增加。

## 验证工具（本机已有）

- 开发服务器在 `http://localhost:3457`，如果没在跑就用 `bun run dev`。
- 截图脚本用法：`node C:/tmp/cbtools/cdp.mjs <out.png> "?plshot=hall" 1440 900 3500 ["可选 JS 表达式"]`。第二个参数以 `?` 开头时会原样作为查询串。必须串行运行，每次跑完执行 `taskkill //IM msedge.exe //F`。
- 可用预览：`?plshot=hall|home|game|settings|events|user|wizard|editor|kit|combat`。游戏面板用 `?plshot=game&panel=profile|characters|tasks|notebook|worldbook|dynamics|variables|profession|memory|modules`。战斗用 `?plshot=combat&stage=active&tags=都市`，完整参数见 `src/dev/CombatPreview.tsx` 顶部注释。
- 每屏都要截桌面 1440×900 和手机 390×844 两种。

## 省 token（重要）

- 同一张图不要重复读。多张截图先用 Python PIL（`python -I`）拼成一张缩小的对比图，再看一次。
- 不要开长时间运行的后台子代理做批量样式改造，上一轮有一个跑了五十多万 token。批量改动自己用脚本做，子代理只用于范围明确的只读搜索。
- 回复我要简短。动效我自己验收，所以完成后给一份「请你验」清单，写明每个动效的位置和应有的样子。
