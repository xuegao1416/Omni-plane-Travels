# 更新日志

## v2.6.1 — 事件中心二级开关 + 预览折叠列表 (2026-07-13)

### ✨ 新增

- **事件中心二级开关**：事件中心新增二级开关控制
- **预览折叠列表**：预览面板支持折叠列表展示
- **内置包自动安装**：内置事件包自动安装
- **分区标签修正**：修正事件分区标签显示
- **主页 Beta 测试标签**：主页新增 Beta 测试标签

## v2.6.0 — 事件系统重构四级模型 (2026-07-13)

### ✨ 新增

- **事件系统重构**：库→包→事件→卡四级模型
- **规则引擎**：新增规则引擎系统
- **Rust 后端**：事件系统 Rust 后端支持
- **Web 端 IndexedDB**：Web 端事件数据 IndexedDB 持久化

## v2.5.0 — 发布就绪改造 + 功能增强 (2026-07-12)

### 🔒 安全 / 稳定（G0）

- **L-01** API Key 加密存储（Web Crypto AES-GCM non-extractable + IndexedDB）
- **L-02** iframe DOMPurify 净化 + sandbox=allow-scripts（移除 allow-same-origin 防沙箱逃逸）
- **L-03** Tauri CSP 最小白名单（非 null）
- **L-04** 流式超时 120s AbortController 真正 abort（消除永久卡死）
- **L-05** 依赖钉定精确版本 + 移除冗余 @types/uuid/@types/dompurify
- **L-06** build.ts 全量输出多 chunk
- **L-07** Tauri devUrl→3456 + http:default 能力

### 📄 发布就绪（G1）

- **L-08** 新增 LICENSE（MIT）、CONTRIBUTING、PRIVACY.md
- **L-09** 新增用户教程（配 Key→建世界→发消息→回滚变量全流程）
- **L-10** 新增独立落地页（docs/site/index.html）
- **L-11** 新增内容政策 + 社区准则
- **L-12** 新增治理文档（永久开源免费）
- **L-13** 语义色全量 token 化（var() 替代硬编码色值）
- **L-14** 桌面 DrawerPanel a11y（role/aria-modal/Esc/焦点陷阱）
- **L-15** 桌面图标导航补 aria-label
- **L-16** 核心纯函数单测（variableManager/responseExtractor/rateLimiter/db迁移）
- **L-17** 429 尊重 Retry-After + 分桶限流
- **L-18** 补最小 sw.js（PWA 可安装）
- **L-19** 原型污染防护（isSafePath/containsDangerousKey）
- **L-20** @types/uuid 版本错配清理 + typecheck 脚本

### ⚡ 功能增强

- **ComfyUI 工作流管线升级**：格式自动检测 + 拓扑注入 + 资源校验 + 代理穿透
- **世界演化引擎**：注入玩家对话上下文，解决前后台叙事不同步
- **反八股模块化改造**：禁用词扩充 + 6 个可开关子模块 + 正则后处理安全网
- **生存系统增强**：配方存档持久化 + 运行时资源元数据显示 + 产出校验

## v2.2.0 — 全量代码审查修复 + 延迟优化 + 记忆空间感知 (2026-07-06)

### 🐛 Bug 修复

- **模拟规则匹配**：修复 `matchEventEffect` 无 keywords 时永远返回 false，导致依赖 tag/eventType 的规则全部失效
- **JSON 修复正则**：修复 `repairJSON` 中 `,s*` typo（应为 `,\s*`），尾逗号修复现在能正确处理空格/换行
- **维度值静默丢失**：修复 dim 键名不匹配（`dim1Value` vs `dim1`），维度值不再回退为默认 50
- **setvar 宏截断**：修复 `{{setvar::key::value}}` 在值包含 `}` 时截断的问题
- **brewing 事件零生命周期**：brewing 事件现在至少存活 1 tick 才升级为 active
- **entity stableFacts 覆盖**：pipeline 版本的实体档案写入改为累积 stableFacts，与 hook 版本一致，不再丢失历史事实
- **retrySingleStage 竞态**：修复单步重试未设置 `generatingRef`，导致可并发发送请求

### ⚡ 性能优化

- **世界演化非阻塞**：`simEngine.tick()` 改为 fire-and-forget 后台执行，正文生成不再等待世界演化 API 调用（节省 2-15 秒）
- **速率限制器默认值**：从 10 秒降到 3 秒，减少管线阶段间等待（可通过 `detectOptimalRateLimit` 自动调整）
- **变量提取延迟**：移除硬编码 3 秒 sleep，仅保留可配置延迟（默认 1 秒）
- **MessageBubble memo**：添加 `React.memo` + `useCallback` 稳定回调，避免聊天列表不必要的重渲染
- **限流日志降级**：`console.log` 改为 `console.debug`，减少控制台噪音

### 🛡️ 健壮性

- **useMemorySystem.callAI 超时**：添加 120 秒超时保护，防止 API 挂起导致无限等待
- **Chat Error Boundary**：每条消息独立 Error Boundary，单条消息渲染失败不影响整体聊天

### 🧠 记忆空间感知（解决记忆混乱）

- **类型扩展**：`relationNetwork`/`relationEdge` 新增 `locationScope` 字段，`entityCards` 新增 `locationFacts` 带地点的事实数组
- **写入提示词改造**：CoT 增加空间检查步骤，事件卡强制填写 `locationRefs`，关系要求填写 `locationScope`，实体事实要求包含地点信息
- **sceneAnchor 替换式更新**：不再用 `??` 回退旧值，AI 返回空即清空，防止旧地点的 goal/risk 泄漏到新场景
- **地点变化自动降级**：切换地点时，旧地点的空间关系从 `active` 自动降级为 `changed`
- **编译输出空间排序**：关系选择按当前地点排序（当前地点优先），格式化输出包含 `[地点]` 标注
- **模拟快照指数膨胀修复**：`_slimForSnapshot` 未排除 `snapshots` 字段导致每个快照嵌套所有旧快照（119MB → ~1MB）

## v2.1.0 — Simulation模块配置系统 + 世界演化规则编辑器 (2026-07-05)

### ✨ 新增

- **Simulation模块配置系统**：创建世界时可选择"世界演化"模块，自动注入默认规则
- **游戏内规则编辑器**：在世界动态面板的"设置" tab 中配置演化规则
- **事件效果编辑**：支持配置触发条件（关键词/标签）和效果（联动生存/属性/经营模块）
- **周期事件编辑**：支持配置周期间隔、首次偏移、效果
- **安全护栏配置**：属性/资源最大变动、允许AI创建新资源
- **导入导出系统**：规则 JSON 可复制到剪贴板，方便分享和复用
- **5个世界预设规则**：边贸风云、日式校园、孤岛求生、余烬废土、江湖风云录
- **烟火人间**：新增都市日常题材世界（原霓虹迷都重构）

### 🔧 改进

- **模块选择器**：新增"世界演化"选项
- **SimSettings**：集成规则编辑器，可展开/折叠
- **世界定义**：6个内置世界全部配备世界演化规则

## v2.0.0 — Tauri 桌面应用 + 自动更新 (2026-07-05)

### ✨ 新增

- **Tauri 桌面应用**：支持打包为 Windows .exe/.msi 安装包
- **自动更新**：内置 Tauri 更新器，支持 GitHub Releases 自动更新
- **GitHub Actions**：自动化构建和发布工作流
- **防八股模块**：AntiFormula 预设，解决 AI 输出重复问题

### 🔧 改进

- **版本号统一**：所有版本号同步更新到 2.0.0
- **窗口优化**：默认大小 1280x800，最小 800x600
- **安装包优化**：支持 NSIS 和 MSI 两种安装格式

## v1.9.9 — 世界演化规则系统 + 变量提取联动重构 (2026-07-04)

### ✨ 新增

- **世界演化规则系统**：SimulationRules 类型定义、机械层结算器、统一应用器
- **世界状态泛化更新**：worldStateAxes 替代写死的社会环境/信息层级字段
- **AI 生成规则提示词**：buildSimulationRulesPrompt + validateSimulationRules
- **叙事层护栏**：validateNarrativeEffects 校验 AI 越界声明
- **可观测性**：EffectLogTab 面板展示变量变化日志
- **性能索引**：tag→rule/keyword→rule 索引优化匹配速度
- **快照系统**：世界演化快照 + 变量/记忆/世界演化三系统联动回滚

### 🔧 改进

- **变量提取联动**：世界演化输出 mechanicalEffects，变量提取统一处理
- **前端数据源修复**：SurvivalCard 从 GameState 读取运行时值
- **NPC 属性结构统一**：属性字段改为生存状态，与玩家一致
- **hasProgression 支持等级制**：levelData 判断生效
- **移除社会环境/信息层级**：精简 WorldState 结构

### 🐛 修复

- **NPC survivalStats 写入**：useStartScreen.ts 正确写入生存状态
- **npcHelpers.ts 字段引用**：ext.属性 → ext.生存状态
- **NPCDetail.tsx 字段引用**：ext.属性 → ext.生存状态

## v1.9.8 — 变量瘦身与 UI 去重 (2026-07-03)

### 🔧 改进

- **变量系统瘦身**：删除 `有效期`、`特殊属性`、`次级货币`、`阶层`、`所属组织`、`特殊身份`、`主流价值观`、`纪元名称`、`区域特征` 共 9 个冗余空字段，减少每轮 JSON 体积
- **UI 去重**：左档案栏移除「世界状态」和「当前目标」（右面板已有），右面板移除「待办事项」（笔记本已有）
- **SSE 流解析优化**：`response.body` 空值检查 + flush 代码去重
- **ComfyUI 轮询优化**：连续错误 15 次提前终止，不再等 5 分钟
- **sendMessage 依赖优化**：移除多余的 `isGenerating` 依赖

### 🐛 修复

- **变量提取错误不再被静默吞掉**：管线变量提取失败时正确抛出错误，防止保存未更新变量的快照
- **推演引擎状态突变修复**：`applyChronicleOps` 先复制再修改，避免直接 mutate 游戏状态
- **经营模块 Bug 修复**：变量泄漏到正文、经营模块不更新、结算逻辑缺陷、世界书标记错误
- **类型声明补全**：新增 `global.d.ts` 解决 CSS Module 和 highlight.js 类型错误
- **RightPanel 导入修复**：补上缺失的 `BusinessModuleSchema` 导入

## v1.8.0 — 世界创建多选支持 (2026-06-27)

### ✨ 新功能

- **GuidedChoiceOverlay 多选支持**：地理格局、势力结构、关键人物、文化风俗维度支持多选（最多 2-3 个选项）
- **自定义选项 E 卡片**：多选模式下支持添加自定义选项，并正确维护选择状态

### 🔧 改进

- **conflict 维度持久化**：核心冲突选择现在会作为结构化数据保存到 setting 条目的 meta 中
- **assembler 多选支持**：世界书条目组装器现在正确处理多选维度，为每个选择生成独立条目

### 🐛 修复

- **stale closure bug**：修复多选切换时快速点击导致选择丢失的问题
- **自定义选项选中状态**：修复多选模式下自定义 E 卡片不显示选中高亮的问题
- **handleSaveCustom 多选支持**：修复保存自定义选项时替换所有多选选择的问题
- **AbortController 泄漏**：修复 AI 请求控制器未正确中止的问题
- **dead import 清理**：移除未使用的 generateAllOptions 导入

## v1.7.1 — 死代码清理 + 结构优化 (2026-06-26)

### 🔧 改进

- **统一 `findWorldDef`**：删除 `useGameEngine.ts` 中的重复定义，统一使用 `worldLoader.ts` 导出
- **提取管线降级工厂函数**：消除 `useGameEngine.ts` 中 12 处重复的降级检测代码
- **修复硬编码 key**：`worldLoader.ts` 中 `localStorage.getItem('world_travel_guide_custom_worlds')` 改为 `STORAGE_KEYS.CUSTOM_WORLDS`

### 🗑️ 清理

- 删除死文件：`src/types/api.ts`、`src/types/engine.ts`、`src/utils/moduleToWorldBook.ts`
- 删除死函数：`assembleSystemPromptLegacy`、`updateLastCallTime`、`createRoleCognitionFirewallPresetEntry`、`useMediaQuery`
- 删除死常量：`DEFAULT_TEXT_COLORIZATION_RULE_IDS`

### 🐛 修复

- 修复 `MessageBubble` 中 `getActivePreset()` 作为 Zustand selector 每次返回新对象引用导致的无限重渲染

## v1.7.0 — 天赋体系模块 + 记忆管线并行化 + 内置世界重构 (2026-06-21)

### ✨ 新功能

- **天赋体系模块**：完整的天赋系统，支持天赋大类和具体天赋生成，品质分为普通/精良/稀有/史诗/传说五档
- **天赋觉醒卡片**：AI 在叙事中触发天赋觉醒时，渲染内联天赋卡片（类似骰子检定卡片）
- **模块依赖显示**：选择成长体系时，数值属性自动显示"自动启用"标签

### 🔧 改进

- **记忆管线并行化**：写入阶段（叙事记忆、摘要保存、向量提取）改为并行执行，提升约 60-70% 性能
- **冲突裁决并行化**：事件卡和实体卡的冲突裁决改为 Promise.all 并行处理
- **天赋世界书集成**：天赋模块勾选后，自动注入天赋规则到世界书（绿灯触发）
- **内置世界重构**：重新规划 6 个内置世界，覆盖所有模块组合
  - 日式校园（无模块）→ 入门纯文游
  - 欲望魔都（数值）→ 都市题材
  - 武侠世界（数值+成长）→ 武侠题材
  - 末日废土（数值+成长+天赋+骰子）→ 异能冒险
  - 荒岛求生（生存资源）→ 生存题材
  - 边境贸易（经营资产）→ 经营题材
- **世界卡片样式重构**：提升卡片质感，添加难度标签，优化视觉效果

### 📦 技术变更

- 新增 `TALENT_RULES_PROMPT` 常量，定义天赋觉醒规则和 `[TALENT_GAIN]` 标记格式
- 新增 `InlineTalentCard` 组件，用于渲染天赋觉醒内联卡片
- 更新 `buildPipeline.ts`，添加天赋体系生成逻辑
- 更新 `pipelineTypes.ts`，写入阶段改为并行执行
- 删除赛博朋克、绯晶之乡、云汉皇朝·深宫世界文件
- 新增荒岛求生、边境贸易世界文件

---

## v1.6.3 — 删除核心锚点 + 管线单步重试 (2026-06-20)

### ✨ 新功能
- 管线单步重试：监控弹窗中失败的 API 阶段显示小重试按钮，支持单独重试某个阶段而非整条重试

### 🔧 改进
- 删除核心锚点（与人物事迹功能重复），节省 AI Token 消耗
- 管线重试按钮仅在需要调用 API 的阶段显示，本地阶段（检索收尾、上下文编译）不显示

## v1.6.1 — 生存资源制作系统 + SW 缓存修复 (2026-06-19)

### ✨ 新功能

- **生存资源制作系统**：支持配方生成、手动制作、资源消耗与产出，完整闭环
- **配方 AI 生成**：输入需求自动生成 JSON 配方，带错误容错和 ID 唯一保证
- **配方管理 UI**：制作面板支持查看配方列表、一键制作、删除配方

### 🔧 改进

- **生存资源配置提取**：补全 `amount` 字段提取，修复变量提取漏字段问题
- **apiConfig TDZ 修复**：将 `useConfigStore` 调用移到回调定义之前，消除变量提升错误
- **Vite 残留清理**：统一为 Bun 构建，移除所有 Vite 相关引用
- **Service Worker 缓存策略**：开发环境 `/app.js` 改为网络优先，避免缓存旧代码

---

## v1.6.0 — NPC 模块同步 + NSFW 重写 + PWA 支持 (2026-06-19)

### ✨ 新功能

- **NPC 模块同步**：NPC 继承世界的数值属性和成长体系，AI 补全和变量提取均支持 NPC 属性/段位更新
- **NSFW 预设重写**：无限制模式升级为六阶段流程（铺垫→探索→升温→攀升→释放→余韵），新增词汇规范和负面清单
- **PWA 支持**：Service Worker 缓存优先策略 + Web App Manifest，支持安装到桌面
- **变量结构扩展**：新增 NPC 段位（`npc_tier`）和经验值（`npc_xp`）变量定义

### 🔧 改进

- **加强预设破限**：默认模式和沉浸模式的创作指令增强，扩展角色年龄设定规则
- **世界编辑器防误触**：点击遮罩层不再关闭面板，防止意外丢失编辑内容
- **移动端头部优化**：显示世界名称而非世界 ID
- **世界卡片布局**：桌面端改为单列显示，间距加大
- **存档导入修复**：支持 `{save: {...}}` 嵌套格式的存档文件导入
- **存档导出文件名**：改为 `world-wanderer-save-{timestamp}.json`
- **ProfilePanel 去重**：移除与 RightPanel 重复的生存状态显示

### 🏗 技术架构

- React 18 + TypeScript + Zustand
- Bun 开发环境 + 构建打包
- IndexedDB 持久化存储
- CSS Layers 设计系统 (base/layout/state/theme/print/a11y)
- PWA: Service Worker + Web App Manifest

---

## v1.0.0 — 正式发布 (2026-06-13)

首个正式版本。

### ✨ 核心功能

- **AI 对话引擎**：流式响应，支持 OpenAI / DeepSeek / Google AI / 自定义端点
- **多阶段管线**：正文生成 → 记忆写入 → 摘要保存 → 向量提取 → 检索规划 → 上下文编译 → 变量提取
- **记忆系统**：编译式叙事记忆引擎（场景锚点、叙事线程、状态槽、关系边、事件卡、实体档案）
- **图谱可视化**：13 种 Mermaid 图谱视图
- **变量系统**：快照 / 回滚 / RFC 6902 Patch / NPC 感知合并
- **存档系统**：多存档 + 自动存档 + 导入导出 + F5 恢复
- **预设系统**：15 个结构化提示词模块 + 宏引擎 + 正则脚本
- **游戏向导**：5 步式角色创建（世界选择 → 角色创建 → 人物经历）
- **内置世界**：7 个世界观 + 世界编辑器

### 🏗 技术架构

- React 18 + TypeScript + Zustand
- Bun 开发环境 + 构建打包
- IndexedDB 持久化存储
