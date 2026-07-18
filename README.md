# <img src="https://unpkg.com/lucide-static@latest/icons/globe-2.svg" width="32" height="32" /> 世界漫游指南 (Omniplane Travels)

**AI 驱动的互动小说引擎** — 在自定义世界观中创建角色、展开冒险，与 AI 共同书写属于你的故事。

[![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)](https://react.dev/)
[![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript)](https://www.typescriptlang.org/)
[![Bun](https://img.shields.io/badge/Bun-1.3-FBF0CF?logo=bun)](https://bun.sh/)
[![Zustand](https://img.shields.io/badge/Zustand-5-3B3B3B)](https://zustand-demo.pmnd.rs/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## <img src="https://unpkg.com/lucide-static@latest/icons/sparkles.svg" width="20" height="20" /> 核心特性

### <img src="https://unpkg.com/lucide-static@latest/icons/theater.svg" width="16" height="16" /> 多世界观支持

内置 6 个精心设计的世界观，覆盖校园、都市、武侠、末日、荒岛、边境贸易题材。支持用户自建世界和 JSON 导入。

| 世界 | 题材 | 难度 | 模块 | 简介 |
|------|------|:----:|:----:|------|
| <img src="https://unpkg.com/lucide-static@latest/icons/flower-2.svg" width="14" height="14" /> 日式校园 | 校园 | 简单 | 无 | 充满青春、社团与青涩恋爱的日式高中生活 |
| <img src="https://unpkg.com/lucide-static@latest/icons/heart.svg" width="14" height="14" /> 欲望魔都 | 都市 | 中等 | 数值 | 欲望交织的繁华不夜城 |
| <img src="https://unpkg.com/lucide-static@latest/icons/swords.svg" width="14" height="14" /> 武侠世界 | 武侠 | 困难 | 数值+成长 | 剑气纵横的架空武林，恩怨情仇交织的江湖 |
| <img src="https://unpkg.com/lucide-static@latest/icons/skull.svg" width="14" height="14" /> 末日废土 | 末日 | 困难 | 全部 | 核战后的荒芜世界，异能与辐射怪物共存 |
| <img src="https://unpkg.com/lucide-static@latest/icons/palmtree.svg" width="14" height="14" /> 荒岛求生 | 生存 | 中等 | 生存 | 飞机失事后在无人岛上的生存挑战 |
| <img src="https://unpkg.com/lucide-static@latest/icons/store.svg" width="14" height="14" /> 边境贸易 | 经营 | 中等 | 经营 | 90年代中俄边境的贸易淘金时代 |

每个世界定义包含：世界观设定、规则体系、经济系统、时间系统、阵营势力、预设 NPC、模块配置、世界书条目。详见 [WorldDef Schema](src/data/worlds-schema.ts) 和 [worlds/](src/data/worlds/) 目录。

### <img src="https://unpkg.com/lucide-static@latest/icons/cpu.svg" width="16" height="16" /> 11 阶段 AI 管线

每次对话经过完整的 11 阶段处理管线，自动维护叙事连贯性、记忆一致性和变量准确性。

<img src="docs/diagrams/pipeline.svg" alt="11 阶段 AI 管线" width="100%" />

管线支持同层并行、层间串行，执行顺序可通过配置自定义。

### <img src="https://unpkg.com/lucide-static@latest/icons/brain.svg" width="16" height="16" /> 叙事记忆系统

维护一个结构化的叙事运行时，让 AI 在长对话中保持记忆连贯。

| 记忆类型 | 字段 | 说明 |
|----------|------|------|
| <img src="https://unpkg.com/lucide-static@latest/icons/map-pin.svg" width="12" height="12" /> 场景锚点 | `sceneAnchor` | 当前时间/地点/实体/目标/风险 |
| <img src="https://unpkg.com/lucide-static@latest/icons/waypoints.svg" width="12" height="12" /> 叙事线索 | `activeThreads[]` | 开放/阻塞/已解决的故事线，带优先级和关联实体 |
| <img src="https://unpkg.com/lucide-static@latest/icons/locate.svg" width="12" height="12" /> 状态槽 | `stateSlots[]` | 作用域状态值（玩家/NPC/地点/世界） |
| <img src="https://unpkg.com/lucide-static@latest/icons/git-branch.svg" width="12" height="12" /> 关系图谱 | `relationEdges[]` | 实体间的关系网络 |
| <img src="https://unpkg.com/lucide-static@latest/icons/zap.svg" width="12" height="12" /> 事件卡片 | `eventCards[]` | 重要事件，按重要性评分，热/温/冷状态自动转换 |
| <img src="https://unpkg.com/lucide-static@latest/icons/user-circle.svg" width="12" height="12" /> 实体档案 | `entityCards[]` | 角色/地点/阵营/物品/能力的详细档案 |
| <img src="https://unpkg.com/lucide-static@latest/icons/archive.svg" width="12" height="12" /> 归档 | `archiveCards[]` | 已解决/过期的故事弧归档 |
| <img src="https://unpkg.com/lucide-static@latest/icons/database.svg" width="12" height="12" /> 向量记忆 | `vectorMemory[]` | 长期事实，支持嵌入向量检索 |
| <img src="https://unpkg.com/lucide-static@latest/icons/save.svg" width="12" height="12" /> 检查点 | `checkpoints[]` | 运行时快照，支持一键回滚（最多 5 个） |

记忆数据随存档一起持久化到 IndexedDB，F5 刷新不丢失。

### <img src="https://unpkg.com/lucide-static@latest/icons/bar-chart-3.svg" width="16" height="16" /> 结构化游戏变量

游戏状态完全结构化，AI 每轮自动通过 `<UpdateVariable>` 更新变量，支持三种更新格式：

| 格式 | 示例 | 说明 |
|------|------|------|
| RFC 6902 Patch | `[{"op":"replace", "path":"玩家.生存状态.血量", "value":80}]` | 精确的 JSON 补丁操作 |
| 深度合并 | `{"玩家":{"生存状态":{"血量":80}}}` | 对象递归合并 |
| 文本赋值 | `玩家.生存状态.血量=80` | 简单的 key=value 文本 |

**状态结构概览：**

```
GameState
├── 世界 (WorldState)
│   ├── 时间系统 / 空间定位 / 社会环境
│   ├── 信息层级 [全局/区域/本地/流言/传闻]
│   └── 世界系统 [数值属性/成长体系/资源管理/骰子/天赋]
├── 玩家 (PlayerState)
│   ├── 生存状态 [血量/体力]
│   ├── 身份信息 [背景/职业/阶层/组织/特殊身份]
│   ├── 技能系统 / 货币 / 物品栏
│   ├── 笔记本 [危机/机遇/待办]
│   └── 成长状态 [层级/经验值/属性点]
└── 人物档案 (Record<string, NPCData>)
    └── [NPC_ID] — 姓名/种族/关系/外貌/性格/大事记/属性/技能/物品...
```

每次 AI 回复后自动创建快照附加到消息上，支持随时回溯到任意历史节点。

### <img src="https://unpkg.com/lucide-static@latest/icons/book-open.svg" width="16" height="16" /> SillyTavern 兼容世界书

完整的 Lorebook 扫描引擎，与 SillyTavern 世界书格式兼容。

<img src="docs/diagrams/worldbook.svg" alt="世界书扫描流程" width="100%" />

**扫描能力：** 正则关键词 (`/pattern/flags`) / 大小写敏感 / 全词匹配 / 选择逻辑 (AND_ANY/AND_ALL/NOT_ALL/NOT_ANY) / 排除关键词 / 分组互斥（权重随机或优先级胜出）/ 概率触发 / 递归扫描 / NPC 世界书自动去重

### <img src="https://unpkg.com/lucide-static@latest/icons/puzzle.svg" width="16" height="16" /> 模块化游戏系统

可插拔的游戏机制模块，每个世界可自由组合配置：

| 模块 | ID | 说明 |
|------|----|------|
| <img src="https://unpkg.com/lucide-static@latest/icons/bar-chart-3.svg" width="12" height="12" /> 数值属性 | `stat` | 生命/能量 + 六维属性 + 特色属性，带范围钳位 |
| <img src="https://unpkg.com/lucide-static@latest/icons/trending-up.svg" width="12" height="12" /> 成长体系 | `progression` | 段位制或等级制，可配置段位名称和 XP 曲线（依赖数值属性） |
| <img src="https://unpkg.com/lucide-static@latest/icons/leaf.svg" width="12" height="12" /> 生存资源 | `survival` | 荒岛求生/末日生存类，资源采集、制作、消耗（与数值/成长/天赋互斥） |
| <img src="https://unpkg.com/lucide-static@latest/icons/briefcase.svg" width="12" height="12" /> 经营资产 | `business` | 网吧/房东/商店模拟器类，资产、收支、利润 |
| <img src="https://unpkg.com/lucide-static@latest/icons/dice-6.svg" width="12" height="12" /> 骰子检定 | `dice` | d20+修正 vs DC，随机性判定机制，自然融入叙事 |
| <img src="https://unpkg.com/lucide-static@latest/icons/star.svg" width="12" height="12" /> 天赋体系 | `talent` | 天赋大类与具体天赋，角色固有特质与觉醒机制，自然融入叙事 |

模块在世界创建时勾选，AI 自动生成对应数据，游戏中自然融入叙事。天赋和骰子模块通过内联卡片增强交互体验。

### <img src="https://unpkg.com/lucide-static@latest/icons/calendar-clock.svg" width="16" height="16" /> 事件系统

事件包（Pack）→ 事件（Event）→ 卡片（Card）三级结构。事件包分四种类型：

| 类型 | 存储 | 说明 |
|------|------|------|
| `card` | `schema/events.json` | 事件包，包含多个事件，每个事件含多张卡片 |
| `rule` | `schema/rules.json` | 规则包，可视化节点图编辑器 |
| `worldbook` | — | 世界书包 |
| `bundle` | — | 混合包 |

事件中心提供事件包管理和事件库浏览，支持 `.opt-event` 格式导入/导出。

### <img src="https://unpkg.com/lucide-static@latest/icons/gavel.svg" width="16" height="16" /> 规则引擎

基于 React Flow 的可视化节点图编辑器，节点类型：

| 节点 | 说明 |
|------|------|
| <img src="https://unpkg.com/lucide-static@latest/icons/zap.svg" width="12" height="12" /> trigger | 事件触发器，匹配 AI 生成的事件类型 |
| <img src="https://unpkg.com/lucide-static@latest/icons/git-branch.svg" width="12" height="12" /> condition | 条件门，AND/OR/NOT 逻辑组合 |
| <img src="https://unpkg.com/lucide-static@latest/icons/gauge.svg" width="12" height="12" /> effect | 效果节点，修改变量/触发事件/资源变化 |
| <img src="https://unpkg.com/lucide-static@latest/icons/swords.svg" width="12" height="12" /> event | 主动生成 SimEvent |
| <img src="https://unpkg.com/lucide-static@latest/icons/globe.svg" width="12" height="12" /> worldState | 更新世界状态轴 |
| <img src="https://unpkg.com/lucide-static@latest/icons/shield-alert.svg" width="12" height="12" /> guardrail | 叙事层安全边界（终点节点） |
| <img src="https://unpkg.com/lucide-static@latest/icons/clock.svg" width="12" height="12" /> periodic | 周期触发器，每 N tick 自动触发，属于规则系统 |

- **When 条件编辑器**：可视化配置触发条件（路径选择、比较运算符、值匹配）
- **世界绑定**：规则与世界定义绑定，切换世界自动加载对应规则
- **模拟运行**：内置确定性解释器（8ms/8192 步死循环保护），支持规则校验和模拟
- **导入/导出**：规则 JSON 可复制到剪贴板，方便分享和复用

### <img src="https://unpkg.com/lucide-static@latest/icons/refresh-cw.svg" width="16" height="16" /> 世界演化引擎

注入玩家对话上下文，解决前后台叙事不同步问题。

- **Simulation 模块**：创建世界时可选择"世界演化"模块，自动注入默认规则
- **机械层结算器**：规则驱动的自动状态变化（资源消耗、属性变动等）
- **叙事层护栏**：`validateNarrativeEffects` 校验 AI 越界声明
- **可观测性**：EffectLog 面板展示变量变化日志
- **性能索引**：tag→rule / keyword→rule 索引优化匹配速度
- **三系统联动回滚**：世界演化快照与变量/记忆系统联动

### <img src="https://unpkg.com/lucide-static@latest/icons/hard-drive.svg" width="16" height="16" /> 完整存档管理

| 能力 | 说明 |
|------|------|
| 多存档 | 创建/删除/重命名，每个存档独立的世界+角色+对话+记忆 |
| 自动存档 | 每次对话结束 500ms 防抖自动保存，Promise 锁防止并发写入 |
| 导入/导出 | JSON 格式导出，跨设备迁移 |
| F5 恢复 | 刷新页面自动恢复上次存档（通过 `active_save_id`） |
| 快照回滚 | 每条 AI 消息附带变量快照，可回溯到任意历史节点 |
| 快照优化 | 保留首条 + 最近 10 条 + 每 10 条关键帧，防止存储膨胀 |
| 记忆恢复 | 回滚时同步恢复记忆系统检查点 |

### <img src="https://unpkg.com/lucide-static@latest/icons/smartphone.svg" width="16" height="16" /> 响应式设计

同一套面板组件（ProfilePanel / CharacterGrid / VariableSnapshotPanel 等）在桌面端渲染为 Drawer 抽屉，在移动端渲染为 MobileOverlay 滑入面板，无代码重复。

---

## <img src="https://unpkg.com/lucide-static@latest/icons/rocket.svg" width="20" height="20" /> 快速开始

### 环境要求

- [Bun](https://bun.sh/) (推荐) 或 Node.js 18+
- 一个 OpenAI 兼容的 AI API（OpenAI / DeepSeek / Google / 自定义）

### 安装与运行

```bash
# 克隆项目
git clone https://github.com/xuegao1416/Omni-plane-Travels.git
cd Omni-plane-Travels

# 安装依赖
bun install

# 启动开发服务器
bun run dev

# 构建生产版本
bun run build
```

### 配置 API

1. 启动后进入 **设置** 页面
2. 在 **API 设置** Tab 中填写：
   - API 端点（如 `https://api.openai.com/v1`）
   - API Key
   - 模型名称（如 `gpt-4o`）
3. 点击 **测试连接** 验证配置

---

## <img src="https://unpkg.com/lucide-static@latest/icons/gamepad-2.svg" width="20" height="20" /> 使用流程

### 1. 创建角色

<img src="docs/diagrams/character-creation.svg" alt="角色创建流程" width="100%" />

### 2. 游戏交互

- 在输入框输入行动，或点击 AI 推荐的 `[OPTION]` 选项
- AI 实时流式回复，支持中途停止
- 右侧面板查看世界状态、角色属性、待办事项
- 左侧面板管理角色档案、NPC、笔记本、变量快照

### 3. 存档管理

- 自动存档：每次对话结束自动保存
- 手动存档：从存档列表管理（加载/删除/重命名/导入/导出）
- 快照回滚：回溯到任意历史节点

---

## <img src="https://unpkg.com/lucide-static@latest/icons/folder-tree.svg" width="20" height="20" /> 项目结构

```
src/
├── api/                        # API 层
│   ├── client.ts               # 多 Provider API 客户端（流式/非流式/重试/降级）
│   ├── auxiliaryApi.ts         # 辅助 API（变量提取专用调用）
│   ├── imageGen.ts             # 生图 API（NovelAI/ComfyUI/OpenAI Compatible）
│   ├── imageGenTypes.ts        # 生图类型定义 + 常量
│   ├── rateLimiter.ts          # 限流器（防止 429 错误）
│   └── types.ts                # API 类型定义
├── components/                 # UI 组件
│   ├── event/                  # 事件系统
│   │   ├── EventsScreen.tsx        # 事件屏幕入口（中心/库/编辑器路由）
│   │   ├── EventCenter.tsx         # 事件中心（包列表 + 合集分组）
│   │   ├── EventLibrary.tsx        # 事件库浏览
│   │   ├── RuleEditor.tsx          # 规则编辑器（React Flow 节点图）
│   │   ├── CardEditor.tsx          # 卡片编辑器（事件包内容编辑）
│   │   ├── CardRenderer.tsx        # 卡片渲染器
│   │   ├── WhenConditionEditor.tsx # When 条件编辑器
│   │   ├── WhenPathSelect.tsx      # 条件路径选择器
│   │   ├── CollectionCard.tsx      # 合集卡片
│   │   ├── CollectionGroup.tsx     # 合集分组
│   │   ├── EventPackPreview.tsx    # 事件包预览
│   │   ├── EventImportWizard.tsx   # 事件导入向导
│   │   ├── WorldBookPicker.tsx     # 世界书选择器
│   │   └── ...                     # 更多事件组件
│   ├── start/                  # 开始界面
│   │   ├── MainMenuView.tsx        # 主菜单
│   │   ├── StartScreen.tsx         # 启动屏幕入口
│   │   ├── WizardShell.tsx         # 世界创建向导外壳
│   │   ├── ModuleSelector.tsx      # 模块选择器（世界创建时勾选）
│   │   ├── WorldEditorForm.tsx     # 世界编辑器
│   │   ├── WorldCard.tsx           # 世界卡片
│   │   ├── StepWorldBrowser.tsx    # 向导步骤：世界浏览
│   │   ├── StepWorldDetail.tsx     # 向导步骤：世界详情
│   │   ├── StepWorldSelect.tsx     # 向导步骤：世界选择
│   │   ├── StepPersonalInfo.tsx    # 向导步骤：个人信息
│   │   ├── StepCharacterHistory.tsx# 向导步骤：角色经历
│   │   ├── StepConfirm.tsx         # 向导步骤：确认
│   │   ├── NpcEditorModal.tsx      # NPC 编辑弹窗
│   │   └── SavesView.tsx           # 存档管理视图
│   ├── game/                   # 游戏界面
│   │   ├── GameScreen.tsx          # 游戏主屏幕
│   │   ├── MobileOverlay.tsx       # 移动端滑入面板
│   │   ├── VariableSettingsOverlay.tsx # 变量设置覆盖层
│   │   ├── chat/               # 聊天面板
│   │   │   ├── ChatPanel.tsx           # 聊天主面板
│   │   │   ├── MessageBubble.tsx       # 消息渲染（含内联卡片挂载）
│   │   │   ├── InputArea.tsx           # 输入区域
│   │   │   ├── ContextMenu.tsx         # 右键菜单
│   │   │   ├── InlineDiceCard.tsx      # 骰子检定内联卡片
│   │   │   ├── InlineTalentCard.tsx    # 天赋觉醒内联卡片
│   │   │   ├── InlineImageGenButton.tsx# 正文生图按钮
│   │   │   ├── ReasoningBlock.tsx      # 思考链展示
│   │   │   ├── PipelineStatus.tsx      # 管线状态指示器
│   │   │   ├── PipelineMonitorModal.tsx# 管线监控弹窗
│   │   │   └── pipelineUI.ts           # 管线 UI 工具函数
│   │   └── panels/             # 侧边面板
│   │       ├── RightPanel.tsx          # 右侧面板入口
│   │       ├── ProfilePanel.tsx        # 角色档案面板
│   │       ├── CharacterGrid.tsx       # NPC 网格
│   │       ├── NotebookPanel.tsx       # 笔记本面板
│   │       ├── WorldBookPanel.tsx      # 世界书面板
│   │       ├── VariableSnapshotPanel.tsx# 变量快照面板
│   │       ├── ImageGallery.tsx        # 图片画廊
│   │       ├── BusinessOverlay.tsx     # 经营资产覆盖层
│   │       ├── ModuleCard.tsx          # 模块卡片（旧格式兼容）
│   │       └── modules/        # 模块卡片组件
│   │           ├── BaseStatsCard.tsx       # 数值属性卡片
│   │           ├── SixDimCard.tsx          # 六维属性卡片
│   │           ├── ProgressionCard.tsx     # 成长体系卡片
│   │           ├── SurvivalCard.tsx        # 生存资源卡片
│   │           ├── BusinessCard.tsx        # 经营资产卡片
│   │           ├── DiceCard.tsx            # 骰子检定卡片
│   │           ├── TalentCard.tsx          # 天赋体系卡片
│   │           └── index.ts               # 模块卡片索引
│   ├── settings/               # 设置界面
│   │   ├── GeneralSettingsTab.tsx      # 通用设置
│   │   ├── ApiSettingsTab.tsx          # API 设置
│   │   ├── PresetSettingsTab.tsx       # 预设管理
│   │   ├── ImageGenSettingsTab.tsx     # 生图设置
│   │   ├── VariableSettingsTab.tsx     # 变量设置
│   │   ├── MemorySettingsTab.tsx       # 记忆设置入口
│   │   ├── ProxyTutorialOverlay.tsx    # 代理教程覆盖层
│   │   ├── SettingsUIComponents.tsx    # 设置 UI 通用组件
│   │   ├── apiPresetUtils.ts          # API 预设工具
│   │   └── memory/             # 记忆系统设置面板
│   │       ├── MemorySettingsOverlay.tsx   # 记忆设置覆盖层
│   │       ├── PromptTemplatesPanel.tsx    # Prompt 模板面板
│   │       ├── RetrievalConfigPanel.tsx    # 检索配置面板
│   │       ├── RuntimeGraphPanel.tsx       # 运行时图谱面板
│   │       ├── VectorConfigPanel.tsx       # 向量配置面板
│   │       ├── VectorExtractDialog.tsx     # 向量提取弹窗
│   │       ├── WriteConfigPanel.tsx        # 写入配置面板
│   │       ├── ExportPickerDialog.tsx      # 导出选择弹窗
│   │       └── index.ts                    # 模块索引
│   ├── shared/                 # 共享组件
│   │   ├── Avatar.tsx              # 头像组件
│   │   ├── Collapsible.tsx         # 可折叠容器
│   │   ├── Dialog.tsx              # 弹窗组件
│   │   ├── EmptyState.tsx          # 空状态展示
│   │   ├── ExcelRow.tsx            # 表格行组件
│   │   ├── MermaidGraphPanel.tsx   # Mermaid 图谱面板
│   │   ├── TemplatePickerDialog.tsx# 模板选择弹窗
│   │   ├── iconMap.tsx             # 图标映射
│   │   ├── qualityUtils.ts         # 品质工具函数
│   │   └── worldIcons.tsx          # 世界图标
│   └── ErrorBoundary.tsx       # 错误边界
├── config/                     # 配置常量
│   └── storageKeys.ts          # localStorage 键名统一管理
├── context/                    # React Context
│   ├── GameContext.tsx          # 游戏上下文（导航/引擎/存档）
│   └── UISettingsContext.tsx    # UI 设置上下文（主题/字号/染色）
├── data/                       # 数据定义
│   ├── worlds/                 # 内置世界 JSON（6 个世界）
│   ├── worlds.json             # 世界定义汇总
│   ├── worlds-schema.ts        # WorldDef Zod Schema
│   ├── worldLoader.ts          # 世界加载器（内置 + 自建）
│   ├── builtinPresets.ts       # 内置提示词预设 + 正则脚本
│   └── modules.ts              # 模块渲染类型映射（旧格式兼容）
├── engine/                     # 游戏引擎
│   ├── useGameEngine.ts        # 核心引擎 hook（管线编排 + 正文生成 + 记忆集成）
│   ├── pipelineExecutor.ts     # 管线执行器（同层并行/层间串行）
│   ├── pipelineTypes.ts        # 管线类型定义和默认执行顺序
│   ├── variableManager.ts      # 变量管理器（GameState CRUD + 快照 + NPC 感知）
│   ├── variableExtraction.ts   # 变量提取（独立 API 调用 + 重试）
│   ├── variableStructureDefs.ts# 变量结构定义（路径/显示名/分组）
│   ├── promptAssembler.ts      # 提示词组装器（预设 + 宏引擎 + 世界书 + 记忆）
│   ├── responseExtractor.ts    # 响应解析器（剥标签提取纯正文）
│   ├── contextManager.ts       # 上下文管理器（消息历史清理 + 正则脚本）
│   ├── macroEngine.ts          # 宏引擎（{{var}}/{{random}}/{{#if}}/{{roll}}）
│   ├── worldPersonality.ts     # 世界书加载 + 世界/模块注入
│   ├── types.ts                # 引擎类型定义（ChatMessage/GameEngine）
│   └── eventBus.ts             # 事件总线
├── hooks/                      # 自定义 Hooks
│   ├── useGame.ts              # 游戏上下文 Hook
│   ├── useWizard.ts            # 世界创建向导 Hook
│   ├── useAiFill.ts            # AI 角色自动填充
│   ├── useCharacterHistory.ts  # 角色经历管理
│   ├── useCharacterPortrait.ts # 角色画像（生图集成）
│   ├── useImageGen.ts          # 生图功能 Hook
│   ├── useNpcCreate.ts         # NPC 创建
│   ├── useNpcFill.ts           # NPC 自动填充
│   ├── useIsMobile.ts          # 移动端检测
│   ├── useBodyScrollLock.ts    # Body 滚动锁定
│   └── useUISettings.ts        # UI 设置 Hook
├── memory/                     # 记忆系统
│   ├── memoryStore.ts          # Zustand Store（运行态 + 配置 + 检查点）
│   ├── memoryPipeline.ts       # 记忆管线（写入/摘要/向量/检索/编译 9 阶段）
│   ├── memoryConfig.ts         # 配置默认值 + 归一化 + 迁移
│   ├── memoryPrompts.ts        # 记忆系统 Prompt 模板
│   ├── memoryUtils.ts          # 记忆工具函数
│   ├── useMemorySystem.ts      # 记忆系统 Hook（对外接口）
│   ├── narrativeParsers.ts     # 叙事记忆解析器
│   ├── narrativeGraph.ts       # 叙事图谱数据构建（Mermaid）
│   ├── narrativePng.ts         # 记忆数据 PNG 导出/导入
│   ├── vectorUtils.ts          # 向量工具函数
│   ├── types.ts                # 记忆类型定义（运行态/配置/向量事实）
│   └── index.ts                # 统一导出
├── modules/                    # 游戏模块系统
│   ├── schema.ts               # 模块 Zod Schema（属性/成长/生存/经营/骰子/天赋）
│   ├── defaults.ts             # 模块默认值工厂函数
│   ├── runtime.ts              # 模块运行时工具
│   ├── buildPipeline.ts        # 世界创建管线（种子→骨架→维度→一致性→深描→世界书→模块）
│   ├── buildContext.ts         # 管线上下文类型
│   ├── injector.ts             # 模块世界书注入器
│   ├── xpAlgorithm.ts          # 经验值算法
│   ├── prompts/                # 模块 Prompt 模板
│   │   ├── stat.ts             # 数值属性 Prompt
│   │   ├── progression.ts      # 成长体系 Prompt
│   │   ├── survival.ts         # 生存资源 Prompt
│   │   ├── business.ts         # 经营资产 Prompt
│   │   ├── dice.ts             # 骰子检定规则
│   │   ├── talent.ts           # 天赋体系 Prompt
│   │   └── index.ts            # Prompt 导出
│   └── index.ts                # 模块导出
├── schema/                     # 全局类型定义
│   └── variables.ts            # GameState/PlayerState/NPCData 结构
├── storage/                    # 持久化层
│   ├── db.ts                   # IndexedDB 存档管理（CRUD + 快照优化）
│   └── templateStore.ts        # 模板存储（玩家预设/历史预设）
├── stores/                     # Zustand Stores
│   ├── configStore.ts          # 全局配置管理
│   ├── saveStore.ts            # 存档管理
│   ├── presetStore.ts          # 提示词预设管理
│   └── imageStore.ts           # 生图配置管理
├── utils/                      # 工具函数
│   ├── markdown.ts             # Markdown 渲染（marked + DOMPurify + highlight.js）
│   ├── regexScripts.ts         # 正则脚本执行器
│   ├── text-colorization.ts    # 文本着色（对话引号染色）
│   ├── npcHelpers.ts           # NPC 管理工具（ID 解析/结构校验/快照）
│   ├── roleCognitionFirewall.ts# 角色认知防火墙（防 AI 泄露系统信息）
│   ├── ageStages.ts            # 年龄阶段动态计算
│   ├── nativeFetch.ts          # 原生 fetch 封装（Tauri/CORS 兼容）
│   ├── presetIO.ts             # 预设导入/导出
│   └── prompts/                # 提示词模板
│       ├── index.ts            # 提示词导出
│       ├── editor-prompts.ts   # 编辑器 Prompt
│       └── README.md           # 提示词说明
├── worldbook/                  # 世界书引擎
│   ├── index.ts                # 世界书管理器（v2 扫描注入）
│   ├── worldInfoEngine.ts      # SillyTavern 兼容扫描引擎
│   └── npcWorldbook.ts         # NPC 世界书去重
├── simulation/                 # 世界演化引擎
│   ├── engine.ts               # 演化引擎核心
│   ├── SimulationApi.ts        # 演化 API 调用
│   ├── llmIntegration.ts       # LLM 集成
│   ├── worldContext.ts         # 世界上下文构建
│   ├── presets.ts              # 预设规则
│   ├── storage.ts              # 演化数据存储
│   └── types.ts                # 演化类型定义
└── worldgen/                   # 世界生成管线（选择式）
    ├── types.ts                # 世界生成类型定义
    ├── index.ts                # 导出
    └── choice/                 # 选择式世界生成
        ├── choicePipeline.ts   # 主流程（选项生成 + 世界生成）
        ├── assembler.ts        # 世界书条目组装器
        ├── prompts.ts          # 维度选项生成 Prompt
        ├── types.ts            # 选择式流程类型定义
        └── index.ts            # 导出
```

---

## <img src="https://unpkg.com/lucide-static@latest/icons/layers.svg" width="20" height="20" /> 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                        UI 层                                 │
│  start/ (MainMenu/ModuleSelector/WorldEditor)                │
│  game/ (chat/MessageBubble + InlineCards)  │  panels/modules │
│  event/ (EventCenter/RuleEditor/CardEditor)                  │
│  settings/ (Api/Memory/Variable)                             │
└────────────────────────────────┬─────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────┐
│                      状态层                                   │
│  GameContext │ configStore │ saveStore │ presetStore │ imageStore │ memoryStore │
└────────────────────────────────┬─────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────┐
│                      引擎层                                   │
│  useGameEngine │ PipelineExecutor │ VariableManager           │
│  PromptAssembler │ MacroEngine │ EventBus │ ResponseExtractor │
└────────┬───────────────┬───────────────┬──────────┬─────────┘
         │               │               │          │
┌────────▼───────┐ ┌─────▼──────┐ ┌──────▼───────┐ ┌▼────────────┐
│ memory/*       │ │ worldbook/*│ │ modules/*    │ │ simulation/*│
│ 9阶段记忆管线   │ │ 世界书引擎  │ │ 模块系统      │ │ 世界演化引擎 │
│ (写入/摘要/向量 │ │ (SillyTavern│ │ (6个可选模块) │ │ (规则驱动   │
│  /检索/编译)    │ │  兼容扫描)  │ │              │ │  自动结算)  │
└────────────────┘ └────────────┘ └──────────────┘ └─────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────┐
│                      数据层                                   │
│  worldLoader │ variables.ts │ db.ts (IndexedDB)               │
└────────────────────────────────┬─────────────────────────────┘
                                 │
┌────────────────────────────────▼─────────────────────────────┐
│                      API 层                                   │
│  client.ts (多Provider) │ auxiliaryApi │ imageGen │ rateLimiter │
└─────────────────────────────────────────────────────────────┘
```

> 详细的架构文档见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

---

## <img src="https://unpkg.com/lucide-static@latest/icons/settings-2.svg" width="20" height="20" /> 技术细节

### AI 兼容性

| Provider | 流式 | 思考链 | 备注 |
|----------|:----:|:------:|------|
| OpenAI | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | 标准实现 |
| DeepSeek | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | 自动合并连续同角色消息 |
| Google Gemini | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | 自动适配端点和响应格式 |
| 自定义 | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | <img src="https://unpkg.com/lucide-static@latest/icons/check.svg" width="14" height="14" /> | 任何 OpenAI 兼容 API |

### 变量系统工作流

```
AI 生成回复
  → 独立 API 调用提取 <UpdateVariable> JSON
  → VariableManager 解析并应用更新
  → normalizeState() 校验数值范围
  → 创建快照附加到消息（支持回滚）
```

### 管线执行模型

**主管线**（每次对话）：
```
正文生成 → [记忆写入 + 摘要保存 + 向量提取]（并行）→ 查询改写 → 检索规划
→ 多轮补充 → 精排 → 检索收尾 → 上下文编译 → 变量提取
```

- 写入阶段并行执行，提升约 60-70% 性能
- 检索阶段串行执行（有依赖关系）
- 内置限流器防止 API 429 错误

**世界创建管线**（7 阶段）：
```
种子分析 → 骨架生成 → 维度展开 → 一致性校验 → 深度描写 → 世界书条目 → 模块数据
```

### <img src="https://unpkg.com/lucide-static@latest/icons/shield.svg" width="16" height="16" /> 安全特性

| 特性 | 说明 |
|------|------|
| API Key 加密存储 | Web Crypto AES-GCM non-extractable + IndexedDB，密钥不可导出 |
| iframe 沙箱净化 | DOMPurify 净化 + `sandbox=allow-scripts`，移除 `allow-same-origin` 防沙箱逃逸 |
| Tauri CSP | 最小白名单 Content Security Policy |
| 原型污染防护 | `isSafePath` / `containsDangerousKey` 校验 |
| 流式超时保护 | 120s AbortController 真正 abort，消除永久卡死 |
| 429 尊重 | Retry-After + 分桶限流，防止 API 滥用 |

---

## <img src="https://unpkg.com/lucide-static@latest/icons/file-text.svg" width="20" height="20" /> 文档

- [架构文档](docs/ARCHITECTURE.md) — 完整的架构分析、用户流程、数据流、各层职责
- [变更日志](docs/CHANGELOG.md) — 版本更新记录
- [用户教程](docs/tutorial.md) — 配置 API Key → 创建世界 → 发消息 → 变量回滚全流程
- [隐私政策](PRIVACY.md) — API Key 仅存本机、无账号、无遥测
- [内容政策](docs/content-policy.md) — NSFW 边界、分享合规、社区准则
- [治理](docs/governance.md) — 开源模式与社区治理

## <img src="https://unpkg.com/lucide-static@latest/icons/heart.svg" width="20" height="20" /> 致谢

### 记忆系统

本项目的记忆系统（编译式叙事记忆引擎）移植自 **lucklyjkop** 的项目，获得了原作者的授权许可。

- **原项目**：[异界转生录 (yijiekkk)](https://github.com/lucklyjkop/yijiekkk)
- **原作者**：[lucklyjkop](https://github.com/lucklyjkop)

#### 移植范围

| 模块 | 说明 |
|------|------|
| 记忆写入管线 | 叙事记忆提取 + 冲突裁决（事件卡冲突检测） |
| 摘要保存 | 3 类记忆压缩（玩家 / 角色 / 物品） |
| 检索规划 | 查询改写 → AI 规划 → 多轮补充 → 精排 |
| 上下文编译 | 将选中的记忆组装成注入文本 |
| 向量提取 | 长期事实记忆提取 |
| Mermaid 图谱 | 13 种图谱视图（场景、线程、状态、关系、事件、实体等） |

#### 适配说明

| 原项目 | 本项目 |
|--------|--------|
| Vue 3 Composition API | React 19 + Zustand |
| JavaScript | TypeScript（完整类型定义） |
| Pinia 状态管理 | Zustand Store |
| 暗金色图谱主题 | 项目浅色主题 |

感谢 lucklyjkop 的慷慨授权和详细的技术文档！

---

<div align="center">

<img src="https://unpkg.com/lucide-static@latest/icons/scale.svg" width="16" height="16" /> MIT License

</div>