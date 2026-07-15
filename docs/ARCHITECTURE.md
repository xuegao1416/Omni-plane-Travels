# 世界漫游指南 - 架构文档

## 项目概述

**项目名称**: 世界漫游指南 (Omniplane Travels) v2.6.1

**项目定位**: AI 驱动的互动小说引擎 (AI-Powered Interactive Fiction Engine)，支持多世界观、多阶段管线、编译式记忆系统。

**技术栈**:
- 前端框架: React 19 + TypeScript
- 构建工具: Bun
- 状态管理: Zustand + React Context (useReducer)
- 持久化: IndexedDB (存档) + localStorage (配置)
- AI API: OpenAI-compatible SSE 流式接口，支持 OpenAI / DeepSeek / Google / 自定义 Provider
- PWA: Service Worker + Web App Manifest，支持离线安装和缓存优先策略
- 样式: 纯 CSS + CSS 变量设计系统 + CSS Layers (base/layout/state/theme/print/a11y)
- 国际化: i18n (zh/en/ja/ko)

---

## 架构层次

```
┌─────────────────────────────────────────────────────────────┐
│                    UI 层 (components/*)                      │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │  start/*      │  │  game/*       │  │  settings/*   │   │
│  │  开始界面      │  │  游戏界面      │  │  设置界面      │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               状态层 (context/*, stores/*)                   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │ GameContext    │  │ configStore   │  │  saveStore    │   │
│  │ UISettingsCtx │  │ memoryStore   │  │               │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               引擎层 (engine/*)                              │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │ useGameEngine │  │ pipelineExec  │  │ variableMgr   │   │
│  │ (核心编排)     │  │ (管线执行)     │  │ (变量管理)     │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │ promptAssemb  │  │ responseExtr  │  │ macroEngine   │   │
│  │ (提示词组装)   │  │ (响应解析)     │  │ (宏引擎)      │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐  ┌───────────────┐  ┌───────────────┐
│  memory/*     │  │  worldbook/*  │  │  modules/*    │
│  记忆系统      │  │  世界书引擎   │  │  模块系统      │
└───────────────┘  └───────────────┘  └───────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               数据层 (data/*, schema/*, storage/*)           │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │ worldLoader   │  │ variables.ts  │  │ db.ts         │   │
│  │ builtinPresets│  │ worlds-schema │  │ templateStore │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│               API 层 (api/*)                                │
│  ┌───────────────┐  ┌───────────────┐  ┌───────────────┐   │
│  │ client.ts     │  │ auxiliaryApi  │  │ rateLimiter   │   │
│  └───────────────┘  └───────────────┘  └───────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

---

## 路由与导航

本项目**不使用 React Router**，导航完全由状态驱动。

### 顶层路由

`GameContext` 内部通过 `useReducer` 管理一个三屏状态机：

```
Screen: 'start' | 'settings' | 'game'
```

`navigate(screen)` 压栈前进，`goBack()` 弹栈返回。无 URL 同步、无浏览器历史集成。

### StartScreen 内部子路由

`useStartScreen()` hook 管理 `view: 'main' | 'wizard' | 'saves'` 三种视图。

### Provider 嵌套层级

```
ErrorBoundary
  └── UISettingsProvider (主题/字体/语言/i18n)
        └── GameProvider (导航状态/游戏引擎/存档逻辑)
              └── AppContent (switch 分发三个 Screen)
```

---

## 完整用户流程

### 1. 主界面 (MainMenuView)

用户打开应用，看到三个按钮：

| 按钮 | 行为 |
|------|------|
| 开始游戏 | `view = 'wizard'`, `step = 1` |
| 读取存档 | `view = 'saves'`，显示存档列表 |
| 设置 | `navigate('settings')` |

### 2. 向导流程 (WizardShell, 4 步)

#### Step 1 — 选择世界 (StepWorldBrowser)

- **左侧面板**: 搜索框 + 难度过滤 + 世界卡片网格（单列显示，7 个内置世界 + 用户自建世界 + 新建/导入）
- **右侧面板**: 选中世界的详情，4 个 Tab（概览/系统/经济/人物）
- 点击世界卡片 → `setSelectedWorld(w.id)` → 右侧显示详情
- 世界数据来源: `worldLoader.ts` 从 `./worlds/*.json` 加载 + localStorage 中的自建世界

#### Step 2 — 角色创建 (StepPersonalInfo)

- **左栏**: 姓名/年龄/性别/性格/外貌/背景/视角 + 预设管理 + AI 补全按钮
- **右栏**: 5 个 Tab（身份/属性/技能/物品/NPC）
- 属性 Tab 通过 `ModuleInitEditor` 根据世界 modules 动态渲染

#### Step 3 — 人物经历 (StepCharacterHistory)

- 根据角色年龄动态生成经历片段（序章 + 各年龄段）
- 每个片段: 草稿区 + AI 生成按钮
- "一键生成全部" 批量 AI 生成

#### Step 4 — 总确认 (StepConfirm)

- 只读摘要: 角色状态、自建 NPC、开局内容预览
- 点"开始冒险" → `handleStartGame()`

### 3. handleStartGame() 调用链

```
handleStartGame()
├── 1. saveStore.resetModuleVariables()        // 重置模块变量
├── 2. buildFullCharacterHistory()              // 拼接经历片段
├── 3. 弹出存档命名对话框，校验名称唯一性
├── 4. dispatch(SET_WORLD / SET_PERSONAL_INFO / SET_CHARACTER_HISTORY)
├── 5. engine.reset(worldDef)                   // 重置引擎，应用世界 modules
├── 6. engine.setPlayerProfile(profile)         // 写入玩家变量
├── 7. engine.applyModuleInitData(data)         // 写入模块初始数据
├── 8. engine.setInitialNPCs(npcs)              // 写入初始 NPC
├── 9. engine.addMessage(角色经历首条消息)        // 附带变量快照
├── 10. saveStore.createNewGame(name) + performSave()  // 持久化到 IndexedDB
└── 11. navigate('game')                        // 进入游戏界面
```

### 4. 游戏界面 (GameScreen)

#### 桌面端布局（三栏，900px 以上）

| 区域 | 宽度 | 内容 |
|------|------|------|
| 左侧导航栏 | 52px | Home / Profile / Characters / Notebook / Variables / Memory / 全屏 / Settings |
| 中间 ChatPanel | flex: 1 | 消息列表 + 输入框 + 管线监控 |
| 右侧 RightPanel | 可折叠 | 世界状态/目标/属性/待办/消息 |
| DrawerPanel | 滑出覆盖 | Profile / Characters / Notebook / Variables / Memory |

#### 移动端布局（900px 以下）

全屏 ChatPanel + 三个 MobileOverlay 滑入面板（左导航/左内容/右信息）+ 头部显示世界名称（通过 `findWorldDef` 将 ID 转换为名称）。

#### 右侧面板 (RightPanel) 内容

- 世界状态（时间/地点/天气/权力结构/社会氛围）
- 当前目标
- 模块卡片（BaseStatsCard / SixDimCard / ProgressionCard / ResourceCard / TalentCard，统一由 ModuleCardList 渲染，包含世界/玩家/角色三种模式）
- 待办事项
- 最新消息

---

## 核心流程：单轮对话

### sendMessage() 完整调用链

```
用户输入文字 → 点击发送
│
v
sendMessage() [useGameEngine.ts]
│
├── 创建 user ChatMessage，加入 messages[]
├── 创建空 assistant ChatMessage (streaming=true)，加入 messages[]
│   → UI 显示"思考中..."占位符
├── 创建 PipelineExecutor
│
v
PipelineExecutor.execute()
│
├── ═══ Stage 1: mainTask() ═══
│   ├── varMgr.createSafeSnapshotForPrompt()    // 安全变量快照（隐藏 NPC 私密数据）
│   ├── worldBook.scanAndBuildInjection()        // 扫描世界书条目
│   ├── buildPlayerProfileBlock()                // 构建玩家档案文本块
│   ├── memStore.getCompiledContext()            // 获取记忆上下文
│   ├── assembleSystemPrompt(preset, ctx)        // 组装系统提示词
│   │   └── [世界书注入] + [玩家档案] + [角色认知防火墙] + [记忆上下文] + [预设体]
│   │       预设体 = 16 个结构化提示条目，通过 MacroEngine 解析宏变量
│   ├── 构建 apiMessages: [system, ...history (注入 atDepth 条目), user]
│   ├── requestStreamWithRetry()                 // 流式 HTTP 请求
│   │   ├── SSE 流解析，onDelta 实时更新消息内容
│   │   ├── onReasoning 捕获思考链
│   │   └── 3 次重试 + 指数退避 + 流式降级非流式
│   └── parseResponse()                          // 解析 AI 响应
│       └── 提取 <contenttext>, <thinking>, [OPTION], <summary>
│
├── ═══ Stage 2-10: 记忆管线 ═══ (详见"记忆系统"章节)
│
├── ═══ Stage 11: variable ═══
│   ├── 等待 delayMs + 3000ms（避免与记忆 API 限流冲突）
│   ├── 调用辅助 API（非流式），发送变量快照 + 世界书规则 + 用户消息 + AI 内容
│   ├── AI 返回 <UpdateVariable> JSON
│   ├── varMgr.applyUpdateVariable(json)
│   │   ├── JSON 数组 → RFC 6902 patch 操作
│   │   ├── JSON 对象 → 深度合并
│   │   └── key=value 文本 → 逐条设置
│   └── normalizeState() → 校验 + 钳位所有模块数值
│
v
Post-pipeline:
├── 创建变量快照 → attach 到 AI 消息（用于回滚）
├── 创建记忆检查点 → attach checkpoint ID
├── optimizeSnapshots() → 防止快照无限增长（保留首条 + 最近 10 条 + 每 10 条关键帧）
├── 触发 auto-save → 500ms 防抖 → 写入 IndexedDB
└── isGenerating = false → UI 更新
```

### 回滚机制

删除消息或"从此处重发"时：

```
deleteSingleMessage(id) / resendFromMessage(id)
├── 从目标消息向前回溯，找到最近的 snapshot
├── varMgr.restoreSnapshot(snapshot)    → 恢复游戏变量
├── 回溯找到最近的 memoryCheckpointId
├── memStore.restoreCheckpoint(id)      → 恢复记忆状态
├── 截断 messages 数组
└── 重新调用 sendMessage()（如果是重发）
```

---

## 管线执行顺序

```
执行顺序（写入阶段并行，检索阶段串行）:

1. main                        → AI 生成正文
2. [memory_write               → 提取叙事对象（场景/线索/关系/事件/实体）]
   [memory_summary             → 生成结构化摘要（玩家/角色/物品记忆）]    ← 并行执行
   [memory_vector              → 提取长期向量事实]
3. memory_query_rewrite        → 分析输入，提取检索关键词
4. memory_retrieve_plan        → AI 规划哪些记忆需要注入
5. memory_multi_round          → 多轮补充检索
6. memory_rerank               → AI 打分重排序
7. memory_retrieve_finalize    → 本地匹配 + 去重 + 排序
8. memory_compile              → 组装记忆上下文到系统提示词
9. variable                    → 独立 API 调用提取变量更新
```

管线执行器 (`PipelineExecutor`) 支持同层并行、层间串行。执行顺序通过 `PipelineConfig.executionOrder` (二维数组) 配置。写入阶段（步骤2）并行执行，提升约 60-70% 性能。内置限流器防止 API 429 错误。

---

## 各层职责

### 1. API 层 (`src/api/`)

负责与 AI 服务通信，支持多 Provider。

**关键文件**:
- `client.ts` — 多 Provider API 客户端
- `auxiliaryApi.ts` — 辅助 API 客户端（变量提取专用）
- `rateLimiter.ts` — 限流器（默认 10s 间隔）
- `types.ts` — API 类型定义

**核心能力**:
- **端点拼接** (`buildEndpoint`): 智能处理 `/chat/completions`、`/v1`、`/openai`、`/v1beta` 等各种 URL 格式
- **流式解析** (`parseSSEStream`): 支持增量和累积两种模式，自动检测 Provider 行为
- **多格式提取** (`extractStreamContent`): 兼容 OpenAI / Gemini / Anthropic / 通用格式
- **重试逻辑** (`withRetry`): HTTP 408/429/5xx 指数退避，最多 3 次
- **降级策略** (`requestWithFallback`): 流式失败 → 降级非流式
- **DeepSeek 适配**: 连续同角色消息自动合并（DeepSeek 要求交替角色）
- **Embedding / Rerank API**: 记忆系统向量检索和精排用

### 2. 数据层 (`src/data/`, `src/schema/`, `src/storage/`)

**关键文件**:
- `data/worldLoader.ts` — 世界数据加载器，从 `worlds/` 目录导入 7 个内置世界 JSON
- `data/worlds-schema.ts` — 世界定义 Schema (WorldDef)
- `data/builtinPresets.ts` — 内置预设包（16 个结构化提示条目 + 正则脚本）
- `schema/variables.ts` — GameState 类型定义
- `storage/db.ts` — IndexedDB 存储层
- `storage/templateStore.ts` — 模板存储层

#### 世界定义结构 (WorldDef)

```typescript
interface WorldDef {
  id: string; name: string; description: string; entryId: number | null;
  tags: string[]; icon: string; coverColor: string;
  setting: { overview, timePeriod, location, atmosphere };
  rules: { powerSystem, socialStructure, specialRules[] };
  economy: { currency: { name, symbol, description }, priceLevel };
  timeSystem: { calendar, startTime, timeSpeed };
  factions: FactionDef[]; presetNPCs: PresetNPCDef[];
  // v2.0 结构化框架
  coreStats?: StatDef[];           // 数值属性定义
  progression?: ProgressionDef;    // 成长体系（层级/技能点/声望/军衔）
  conflict?: ConflictDef;          // 冲突系统
  resources?: ResourceManagementDef; // 资源管理
  relationships?: RelationshipDef; // 关系系统
  events?: WorldEventDef[];        // 世界事件
  worldBookEntries?: WorldBookEntryDef[]; // 内联世界书条目
  modules?: WorldModule[];         // 模块化系统实例
}
```

#### 游戏状态结构 (GameState)

```typescript
interface GameState {
  世界: {
    时间系统, 空间定位, 社会环境,
    信息层级: [全局事件, 区域动态, 本地新闻, 流言, 传闻],
    世界系统: { 数值属性, 成长体系, 资源管理, 骰子检定, 天赋系统 }
  };
  玩家: {
    生存状态: { 血量, 体力 },
    身份信息: { 背景信息, 职业, 阶层, 所属组织, 特殊身份 },
    技能系统, 货币: { 主货币, 副货币[] }, 物品栏,
    笔记本: { 危机[], 机遇[], 待办[] },
    成长状态: { 当前层级索引, 经验值, 属性点 }
  };
  人物档案: Record<string, NPCData>;
  memoryRuntime?: Record<string, unknown>;
  memoryConfig?: Record<string, unknown>;
}
```

NPCData 包含: 姓名/种族/性别/年龄/背景、生存状态、社会身份、关系数据（好感度/关系类型）、个人信息（外貌/表层性格/深层性格/当前想法/穿着/位置/状态）、种族信息、大事记、属性/天赋/技能/物品/装备、**成长状态（段位索引/经验值/属性点）**、分类（在场/离场/重点）。

NPC 模块同步: 创建 NPC 时自动继承世界的 `coreStats` 作为默认属性值，AI 补全和变量提取均支持 NPC 的属性和段位更新。

#### 存储策略

**localStorage** (轻量配置，统一前缀 `world_travel_guide_`):

| Key | 用途 |
|-----|------|
| `world_travel_guide_ui_settings` | UI 设置（主题/字体/语言） |
| `world_travel_guide_api_config` | API 连接配置 |
| `world_travel_guide_memory_config` | 记忆系统配置 |
| `world_travel_guide_pipeline` | 管线配置 |
| `world_travel_guide_player_presets` | 主角预设模板 |
| `world_travel_guide_custom_worlds` | 用户自建世界 |
| `world_travel_guide_active_save_id` | 当前存档 ID（F5 恢复用） |

**IndexedDB** (`chuanyue-simulator`, 重量数据):
- `saves` store: 完整 GameSave（messages + gameState + memoryRuntime 等）
- `global` store: SaveMeta[] 存档元数据列表

**导入导出格式**: 导出文件为 `{ save: GameSave }` 嵌套结构，导出文件名 `world-wanderer-save-{timestamp}.json`。导入时从 `rawData.save` 提取存档数据。

### 3. 引擎层 (`src/engine/`)

**关键文件**:
- `useGameEngine.ts` — 游戏引擎核心 hook（~1140 行），整合管线执行器、变量管理器、世界书管理器、记忆系统
- `pipelineExecutor.ts` — 管线执行器类
- `pipelineTypes.ts` — 管线类型定义，11 个任务 ID
- `variableManager.ts` — 变量管理器类
- `promptAssembler.ts` — 提示词组装器
- `macroEngine.ts` — 轻量宏引擎
- `eventBus.ts` — 事件总线（单例）
- `variableExtraction.ts` — 变量提取器
- `variableStructureDefs.ts` — 变量结构定义（~62 个路径，含 NPC 段位/经验值）

#### 变量管理器 (VariableManager)

- **路径访问**: `getVar('玩家.生存状态.血量')` / `setVar(path, value)`
- **Patch 操作**: `applyPatches([{op:'replace', path:'...', value:...}])` — RFC 6902 风格
- **AI 更新**: `applyUpdateVariable(text)` — 解析 `<UpdateVariable>` JSON，支持数组/对象/文本三种格式
- **快照机制**: `createSnapshot()` / `restoreSnapshot(snapshot)` — 每条 AI 消息附带快照
- **安全快照**: `createSafeSnapshotForPrompt()` — 隐藏 NPC 私密数据（深层性格/当前想法）
- **模块钳位**: `validateAndClampModuleValues()` — 自动校验数值属性/成长体系/资源管理的合法范围
- **NPC 感知**: 路径解析支持 NPC 名称到 ID 的自动映射
- **NPC 模块同步**: `setInitialNPCs()` 自动将世界 modules 的属性定义同步到每个 NPC 的 `属性`、`天赋`、`装备` 字段
- **状态规范化**: `normalizeState()` — 每次状态变更后自动执行，确保 NPC 分类默认值、大事记格式、笔记本容量限制

#### 宏引擎 (MacroEngine)

支持 8 种宏语法，最多 10 轮嵌套解析:

| 宏 | 用途 |
|----|------|
| `{{getvar::key}}` | 读取变量 |
| `{{setvar::key::value}}` | 写入变量（副作用） |
| `{{incvar::key}}` / `{{decvar::key}}` | 递增/递减变量 |
| `{{#if::condition::true::false}}` | 条件分支 |
| `{{random::opt1::opt2}}` | 随机选择 |
| `{{roll NdM+K}}` | 骰子投掷 |
| `{{key}}` | 通用变量查找 |

#### 事件总线事件

| 事件 | 触发时机 |
|------|----------|
| `MESSAGE_SENT` | 用户消息创建 |
| `GENERATION_STARTED` | AI 占位消息创建 |
| `PIPELINE_UPDATE` | 管线阶段状态变化 |
| `MESSAGE_RECEIVED` | AI 响应完成 |
| `GENERATION_ENDED` | 管线全部完成 |
| `VARIABLE_UPDATE_ENDED` | 变量提取完成 |
| `VARIABLE_EXTRACTION_FAILED` | 变量提取失败 |

### 4. 记忆系统 (`src/memory/`)

负责叙事记忆的写入、检索、编译。

**关键文件**:
- `memoryStore.ts` — Zustand Store，管理全部记忆状态
- `types.ts` — 类型定义（~600 行）
- `memoryConfig.ts` — 默认配置工厂 + 规范化
- `memoryPipeline.ts` — 9 阶段记忆管线执行器
- `memoryPrompts.ts` — 叙事记忆提示词模板
- `narrativeParsers.ts` — AI 响应解析器
- `vectorUtils.ts` — 向量工具函数

#### 运行时状态 (NarrativeMemoryRuntime)

| 字段 | 类型 | 说明 |
|------|------|------|
| `sceneAnchor` | SceneAnchor | 当前场景上下文（时间/地点/实体/目标/风险） |
| `activeThreads[]` | NarrativeThread | 开放/阻塞/已解决的叙事线索 |
| `stateSlots[]` | NarrativeStateSlot | 作用域状态值（玩家/NPC/地点/世界） |
| `relationEdges[]` | RelationEdge | 实体关系图边 |
| `relationNetwork[]` | RelationNetworkItem | 关系网络节点 |
| `eventCards[]` | NarrativeEventCard | 重要事件（热/温/冷状态） |
| `entityCards[]` | NarrativeEntityCard | 实体档案 |
| `archiveCards[]` | NarrativeArchiveCard | 归档旧线索 |
| `vectorMemory[]` | VectorFact | 长期向量事实 |
| `checkpoints[]` | NarrativeCheckpoint | 回滚检查点（最多 5 个） |
| `summarySaveHistory[]` | SummarySave | AI 生成的摘要历史 |

#### 9 阶段管线详解

| 阶段 | 函数 | 说明 |
|------|------|------|
| memory_write | `executeMemoryWrite` | 构建运行时参考块 → AI 提取叙事对象 → 冲突判断 → 合并到运行时 |
| memory_summary | `executeMemorySummary` | AI 生成结构化摘要（玩家/角色/物品记忆）→ 追加到历史 |
| memory_vector | `executeMemoryVector` | AI 提取长期事实 → 规范化为 VectorMemoryItem |
| memory_query_rewrite | `executeMemoryQueryRewrite` | AI 分析用户输入 → 提取检索关键词 + 语义查询 |
| memory_retrieve_plan | `executeMemoryRetrievePlan` | 收集所有记忆 → AI 规划器按标题选择相关记忆 |
| memory_multi_round | `executeMemoryMultiRound` | 多轮补充检索，捕获首轮遗漏的记忆 |
| memory_rerank | `executeMemoryRerank` | AI 打分重排序 |
| memory_retrieve_finalize | `executeMemoryRetrieveFinalize` | 标题匹配 + 关键词匹配 → 去重 → 最终检索计划 |
| memory_compile | `executeMemoryCompile` | 组装最终上下文字符串（场景/玩家摘要/角色记忆/物品记忆） |

### 5. 世界书系统 (`src/worldbook/`)

SillyTavern 兼容的 Lorebook 扫描引擎。

**关键文件**:
- `index.ts` — 世界书管理器，解析 + 扫描 + 注入
- `worldInfoEngine.ts` — 核心扫描引擎（481 行）
- `npcWorldbook.ts` — NPC 世界书生成 + 去重

#### 扫描流程

```
card.json → parseWorldBook() → WorldBookEntry[]
                                      ↓
聊天历史 + 用户输入 → scanWorldInfo() → 激活的条目
                                      ↓
                              按位置分组注入
                              ├── beforeChar (系统提示前)
                              ├── afterChar (系统提示后)
                              └── atDepth (消息历史中特定深度)
```

#### 核心能力

- **关键词匹配**: 正则 (`/pattern/flags`)、大小写敏感、全词匹配
- **选择逻辑**: AND_ANY / AND_ALL / NOT_ALL / NOT_ANY
- **递归扫描**: 最多 10 轮，新激活条目的内容加入下一轮扫描缓冲
- **分组互斥**: 同组条目按权重随机或按优先级胜出
- **概率触发**: 每个条目有独立的激活概率
- **位置注入**: before / after / atDepth / ANTop / ANBottom / EMTop / EMBottom
- **NPC 去重**: NPC 在游戏变量中存在时，自动抑制其世界书条目（避免重复信息）
- **世界编辑器**: 点击遮罩层不再关闭面板（防误触丢失内容），通过 `e.stopPropagation()` 实现

### 6. 模块系统 (`src/modules/`)

负责游戏属性、成长、资源等模块。

**模块类型**:
- `StatModuleSchema` — 数值属性（力量/敏捷/体质/智力/感知/魅力 + 自定义属性）
- `ProgressionModuleSchema` — 成长体系（层级/技能点/声望/军衔）
- `ResourceModuleSchema` — 资源管理（货币 + 资源物品）
- `DiceModuleSchema` — 骰子检定
- `TalentModuleSchema` — 天赋体系

### 7. PWA 支持

**关键文件**:
- `sw.js` — Service Worker (缓存优先策略，预缓存构建产物)
- `manifest.json` — Web App Manifest (应用名称/图标/主题色/显示模式)
- `icon-192.png` / `icon-512.png` — PWA 图标 (PNG 格式)
- `build.ts` — 构建脚本，自动生成 SW 和 manifest

### 8. 状态层 (`src/context/`, `src/stores/`)

**关键文件**:
- `context/GameContext.tsx` — 游戏上下文 Provider，整合 GameEngine + 全局导航状态
- `context/UISettingsContext.tsx` — UI 设置上下文 Provider（主题/字体/语言/i18n）
- `stores/configStore.ts` — Zustand Store，管理 UI 设置和 API 配置，持久化到 localStorage
- `stores/saveStore.ts` — Zustand Store，管理存档元数据，自动存档调度（500ms 防抖 + Promise 锁防并发写入）

### 9. UI 层 (`src/components/`)

#### 组件层级

```
App.tsx
├── ErrorBoundary
├── UISettingsProvider
└── GameProvider
    └── AppContent
        ├── StartScreen (view: main/saves/wizard)
        │   ├── MainMenuView → 三个按钮
        │   ├── SavesView → 存档列表（加载/删除/重命名/导入/导出）
        │   └── WizardShell → 4 步向导
        │       ├── StepWorldBrowser (世界卡片网格 + 详情面板)
        │       ├── StepPersonalInfo (角色创建 + AI 补全)
        │       ├── StepCharacterHistory (经历生成)
        │       └── StepConfirm (确认)
        ├── SettingsScreen (tab: general/api/variable/memory)
        └── GameScreen
            ├── LeftNavBar (52px, 桌面端)
            ├── ChatPanel
            │   ├── MessageBubble[] (消息渲染)
            │   │   ├── ReasoningBlock (可折叠思考链)
            │   │   ├── HTML/iframe 内容 (dangerouslySetInnerHTML / srcDoc)
            │   │   ├── InlineDiceCard (React Portal 注入)
            │   │   └── ContextMenu (右键: 编辑/复制/重发/删除)
            │   ├── InputArea (输入框 + 操作选项药丸 + 发送/停止)
            │   └── PipelineMonitorModal (11 阶段实时状态)
            ├── DrawerPanel (桌面端滑出面板)
            │   ├── ProfilePanel (角色面板: 基本信息/技能/物品/货币)
            │   ├── CharacterGrid (NPC 网格 + 详情弹窗 + 大事记编辑)
            │   ├── NotebookPanel (笔记本)
            │   ├── VariableSnapshotPanel (变量快照查看/回滚/导入/导出)
            │   └── MemorySettingsOverlay (记忆系统设置)
            ├── RightPanel (世界状态/目标/属性模块/待办/消息)
            └── MobileOverlays (移动端: 左导航/左内容/右信息)
```

#### 消息渲染管线 (MessageBubble)

AI 消息经过多阶段渲染:

1. `processRegexScripts` — 剥离 AI 元数据标签（思考/摘要/免责声明）
2. `parseContent` — Markdown → HTML（marked + highlight.js + DOMPurify）
3. 文本着色规则应用
4. `[OPTION]` 块 → 可点击药丸卡片
5. `[DICE_ROLL]` 占位符 → React Portal 注入 InlineDiceCard
6. 事件委托处理代码块复制按钮和操作选项点击

#### 管线监控弹窗 (PipelineMonitorModal)

实时显示 11 阶段管线状态:
- 流式可视化条：每个节点显示图标/标签/状态（旋转/完成/跳过/错误）
- 详情列表：每阶段的描述/状态/错误信息/数据长度
- 底部：总耗时 + 重试按钮

---

## 依赖规则

### 1. 方向依赖
- 上层可以依赖下层
- 下层不能依赖上层
- 同层之间通过接口通信

### 2. 禁止循环依赖
- 模块之间不能相互引用
- 如需双向通信，使用事件总线或回调

### 3. 接口隔离
- 上层通过接口调用下层
- 下层不关心上层的具体实现

---

## 附录

### 管线任务 ID

```typescript
type PipelineTaskId =
  | 'main'
  | 'memory_write'
  | 'memory_summary'
  | 'memory_vector'
  | 'memory_query_rewrite'
  | 'memory_retrieve_plan'
  | 'memory_multi_round'
  | 'memory_rerank'
  | 'memory_retrieve_finalize'
  | 'memory_compile'
  | 'variable'
```

### 内置预设提示条目 (16 个)

| Order | 名称 | 说明 |
|-------|------|------|
| 50 | 变量上下文快照 | 注入 `{{VAR_SNAPSHOT}}` 宏 |
| 100 | 任务指令 | 创作引擎规则 |
| 200 | 叙事规则 | 认知边界、视角限制 |
| 300 | 情感平衡 | 防止极端情绪 |
| 400 | 人物刻画 | 角色写作指南 |
| 500 | 关系规则 | 健康关系动态 |
| 600 | 写作规则 | Show-don't-tell、无突兀转场 |
| 700 | 写作风格 | 语调/节奏/对话格式 |
| 800 | 视角边界 | AI 不得撰写用户行动 |
| 900 | 对话平衡 | 提高对话比例 |
| 1000 | 表达规则 | 禁用词和短语 |
| 1100 | NSFW 内容 | 六阶段流程（铺垫→探索→升温→攀升→释放→余韵）+ 词汇规范 + 负面清单 |
| 1200 | 思考链 | 强制 `<thinking>` 输出 |
| 1300 | 写作流程 | 6 步创作工作流 |
| 1400 | 输出格式 | 强制 `<contenttext>` + `[OPTION]` |
| 1500 | 完整性声明 | `<integrity>` 标签 |

### 正则脚本

**DISPLAY_SCRIPTS** (渲染时执行): 剥离 `<thinking>`/`<integrity>`/元数据标签，转换 `[OPTION]` 为 HTML 卡片，渲染 `[DICE_ROLL]` 占位符

**PROMPT_SCRIPTS** (发送前执行): 从消息历史中剥离相同标签，保持上下文干净
