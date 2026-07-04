# 参考项目记忆系统文档

> 参考项目：D:\yijiekkk（异界转生录）
> 本文档供接手开发"世界漫游指南"记忆系统的开发者参考

---

## 一、架构总览

参考项目的记忆系统是一个**编译式叙事记忆引擎**，核心设计理念：

1. **写入管线（Ingest）**：每次 AI 回复后，调用 LLM 从叙事文本中提取结构化记忆对象
2. **摘要保存（Summary）**：定期将记忆压缩为 3 类摘要（玩家/角色/物品）
3. **检索规划（Retrieve）**：下次对话前，AI 规划需要注入哪些记忆
4. **上下文编译（Compile）**：将选中的记忆组装成文本注入到 prompt
5. **向量提取（Vector）**：提取长期事实作为向量记忆

### 数据流

```
AI 回复文本
    ↓
[写入] → 提取 sceneAnchor, threads, stateSlots, relations, events, entities
    ↓
[摘要] → 压缩为 playerMemories, otherCharacterMemories, itemMemories
    ↓
[检索] → 查询改写 → AI 规划 → 关键词匹配 → 精排
    ↓
[编译] → 组装为注入文本 → 注入下次 prompt
    ↓
[向量] → 提取长期事实 → 向量化存储
```

---

## 二、核心数据结构

### NarrativeMemoryRuntime（运行态）

```typescript
interface NarrativeMemoryRuntime {
  version: string;
  bankId: string;
  lastIngestCursor: number;
  lastIngestSuccessAt: number | null;
  lastIngestAttemptAt: number | null;
  lastIngestFailure: { message: string; at: number } | null;
  lastRebuildAt: number | null;

  sceneAnchor: SceneAnchor | null;
  activeThreads: NarrativeThread[];
  stateSlots: NarrativeStateSlot[];
  relationEdges: NarrativeRelationEdge[];
  relationNetwork: NarrativeRelationNetworkItem[];
  eventCards: NarrativeEventCard[];
  entityCards: NarrativeEntityCard[];
  archiveCards: NarrativeArchiveCard[];
  mutationLog: NarrativeMutation[];
  checkpoints: NarrativeCheckpoint[];
  summarySaveHistory: SummarySaveRecord[];
  lastSummarySave: SummarySaveRecord | null;
  lastRetrievePlan: RetrievePlanSnapshot | null;
  compiledContext: CompiledContextSnapshot | null;

  writeDebugLogs: DebugLog[];
  retrieveDebugLogs: DebugLog[];
  compileDebugLogs: DebugLog[];
}
```

### SceneAnchor（场景锚点）

```typescript
interface SceneAnchor {
  timeLabel: string;        // "深夜"
  locationLabel: string;    // "酒馆二楼"
  presentEntities: string[]; // ["玩家", "酒馆老板"]
  immediateGoal: string;    // "寻找线索"
  immediateRisk: string;    // "被追兵发现"
  conversationFocus: string; // "与老板对话"
  recentChange: string;     // "刚发生爆炸"
  confidence: number;       // 0-1
  updatedAt: number;
}
```

### NarrativeThread（叙事线程）

```typescript
interface NarrativeThread {
  id: string;
  title: string;
  summary: string;
  goal: string;
  status: 'open' | 'blocked' | 'resolved' | 'failed';
  priority: number;
  blockingReason: string;
  deadline: string;
  relatedEntities: string[];
  relatedItems: string[];
  relatedLocations: string[];
  sourceStartIndex: number;
  sourceEndIndex: number;
  createdAt: number;
  updatedAt: number;
}
```

### NarrativeEventCard（事件卡）

```typescript
interface NarrativeEventCard {
  id: string;
  title: string;
  summary: string;
  excerpt: string;
  importance: number;      // 1-5
  status: 'hot' | 'warm' | 'cold';
  timeLabels: string[];
  entityRefs: string[];
  locationRefs: string[];
  threadRefs: string[];
  sourceStartIndex: number;
  sourceEndIndex: number;
  createdAt: number;
  updatedAt: number;
}
```

### NarrativeEntityCard（实体卡）

```typescript
interface NarrativeEntityCard {
  id: string;
  name: string;
  entityType: 'character' | 'location' | 'faction' | 'item' | 'ability' | 'other';
  aliases: string[];
  currentStatus: string[];
  stableFacts: string[];
  currentStance: string;
  affiliations: string[];
  relatedThreads: string[];
  relatedEvents: string[];
  sourceStartIndex: number;
  sourceEndIndex: number;
  createdAt: number;
  updatedAt: number;
}
```

### NarrativeRelationEdge（关系边）

```typescript
interface NarrativeRelationEdge {
  id: string;
  sourceEntityId: string;
  targetEntityId: string;
  relationType: string;
  stance: 'ally' | 'neutral' | 'enemy';
  strength: number;       // 0-1
  summary: string;
  status: 'active' | 'broken' | 'superseded';
  sourceStartIndex: number;
  sourceEndIndex: number;
}
```

### VectorFact（向量事实）

```typescript
interface VectorFact {
  id: string;
  fact: string;
  title: string;
  summary: string;
  primaryType: 'task' | 'character' | 'relationship' | 'location' | 'faction' | 'event' | 'clue' | 'item' | 'ability' | 'status' | 'rule' | 'world';
  secondaryTypes: string[];
  keywords: string[];
  characters: string[];
  locations: string[];
  factions: string[];
  items: string[];
  abilities: string[];
  events: string[];
  rules: string[];
  timeMarkers: string[];
  importance: number;     // 1-5
  timeScope: string;
  state: 'active' | 'archived';
  sourceStartIndex: number;
  sourceEndIndex: number;
}
```

---

## 三、关键文件清单

| 文件 | 行数 | 作用 |
|------|------|------|
| `src/composables/useMemorySystem.js` | ~11000 | **核心**：整个记忆系统的 composable，包含所有管线逻辑 |
| `src/composables/useApi.js` | ~1000 | API 调用封装（callAI 函数） |
| `src/utils/memory-mermaid.js` | 1647 | Mermaid 图谱生成（13 种图谱） |
| `src/components/MermaidGraphPanel.vue` | 1998 | 图谱面板（平移缩放 + 节点交互 + 3D 布料物理） |
| `src/components/MemorySettings.vue` | ~500 | 记忆系统设置页 |
| `src/components/VariableSettings.vue` | 4896 | 变量系统设置（快照分层 + 回滚） |
| `src/stores/appStore.js` | - | Pinia store，包含 memoryRuntime 存储 |

---

## 四、管线阶段详解

### 阶段 1：写入（Ingest）

**触发时机**：每次 AI 回复后

**API 调用**：
- 使用 `callAI` 函数（非流式，`stream: false`）
- API 配置从 `writePipeline.apiPresetId` → `apiPresetId` 兜底
- temperature: 0.3

**Prompt 模板变量**：
- `{{玩家名字}}` — 玩家名称
- `{{叙事写入参考}}` — 当前场景摘要（sceneAnchor + 活跃线程）
- `{{剧情原文}}` — 用户输入 + "(等待AI回复)"

**AI 返回 JSON 结构**：
```json
{
  "scenePatch": { "timeLabel": "...", "locationLabel": "...", ... },
  "threadUpserts": [{ "id": "...", "title": "...", "status": "open", ... }],
  "eventCandidates": [{ "id": "...", "title": "...", "importance": 3, ... }],
  "entityPatches": [{ "id": "...", "name": "...", "entityType": "character", ... }]
}
```

**冲突裁决**（可选）：
- 对于 `eventCandidates`，如果已有同名事件，调用 AI 判断是替换、标记过期还是拒绝

**数据应用**：
- `applyIngestToRuntime()` 直接修改 runtime 对象
- 调用 `bumpRuntimeVersion()` 触发 UI 刷新

### 阶段 2：摘要保存（Summary）

**触发条件**：`writePipeline.saveSummaryAfterIngest === true`

**API 调用**：同写入，temperature 0.3

**Prompt 模板变量**：
- `{{玩家名字}}`
- `{{batchText}}` — 当前批次文本

**AI 返回 JSON 结构**：
```json
{
  "playerMemories": [{ "title": "...", "summary": "...", "keywords": [...] }],
  "otherCharacterMemories": [{ "title": "...", "summary": "...", "keywords": [...] }],
  "itemMemories": [{ "title": "...", "summary": "...", "keywords": [...] }]
}
```

**存储**：写入 `runtime.summarySaveHistory`

### 阶段 3：检索规划（Retrieve）

**前置检查**：`collectAllMemoriesFromRuntime(runtime).length === 0` 则跳过

**步骤**：
1. **查询改写**（可选）：调用 AI 提取检索关键词
2. **AI 检索规划**：将记忆候选列表发给 AI，让 AI 选择需要注入的记忆
3. **标题匹配**：AI 返回的标题与记忆标题匹配
4. **关键词匹配**：按命中率阈值筛选
5. **去重排序**：按 sourceFloor 排序

**API 调用**：
- 查询改写：temperature 0.3
- 检索规划：temperature 0.3, timeout 60s

### 阶段 4：上下文编译（Compile）

**无 API 调用**，纯本地文本拼接

**输出结构**：
```
【当前场景】
地点：xxx
时间：xxx
当前目标：xxx
当前风险：xxx

【本层摘要】
- 标题：摘要内容

【角色记忆】
- 角色名：记忆内容

【物品记忆】
- 物品名：描述
```

### 阶段 5：向量提取（Vector）

**触发条件**：`config.vectorEnabled === true`

**API 调用**：temperature 0.3

**AI 返回 JSON**：`VectorFact[]` 数组

**存储**：`memStore.appendVectorMemories(vectorItems)`

---

## 五、Mermaid 图谱系统

### 架构

`memory-mermaid.js` 是纯函数模块，无框架依赖：

```javascript
// 核心接口
buildMemoryRuntimeGraphPayload(options) → { definition: string, nodeDetails: Record<string, NodeDetail> }
buildMemoryRuntimeMermaidGraph(options) → string  // 仅返回 definition
TAB_LABELS → Record<string, string>  // tab key → 中文标签
```

### 13 种图谱

| Tab Key | 名称 | 数据源 |
|---------|------|--------|
| `scene` | 场景锚点 | sceneAnchor |
| `threads` | 活跃线程 | activeThreads |
| `states` | 状态槽 | stateSlots |
| `relations` | 关系边 | relationEdges |
| `relationNetwork` | 关系网络 | relationNetwork |
| `events` | 事件卡 | eventCards |
| `entities` | 实体卡 | entityCards |
| `archives` | 归档卡 | archiveCards |
| `vector` | 向量记忆 | vectorMemory |
| `summary` | 摘要与检索 | summarySaveHistory + lastRetrievePlan |
| `mutations` | 变更记录 | mutationLog |
| `checkpoints` | 检查点 | checkpoints |
| `logs` | 调试日志 | writeDebugLogs + retrieveDebugLogs + compileDebugLogs |

### 图谱构建器模式

```javascript
const builder = createGraphBuilder('TB' | 'LR');
builder.addNode(id, label, shape, className, nodeDetail);
builder.addEdge(from, to, label, style);
return builder.getResult(); // → { definition, nodeDetails }
```

### 15 个 CSS 类

| 类名 | 填充色 | 描边色 | 用途 |
|------|--------|--------|------|
| center | #27190f | #d4a853 | 根节点 |
| scene | #1b2740 | #8cc6ff | 场景锚点 |
| thread | #2a2038 | #c6a8ff | 叙事线程 |
| state | #133128 | #7be0c0 | 状态槽 |
| relation | #3a2417 | #ffb36d | 关系边 |
| event | #341a25 | #ff95b2 | 事件卡 |
| entity | #1d2540 | #8ab8ff | 实体卡 |
| archive | #262833 | #9ca7d8 | 归档卡 |
| vector | #143243 | #63d3e4 | 向量事实 |
| summary | #2f2535 | #f4d06f | 摘要历史 |
| mutation | #302614 | #ffd166 | 变更记录 |
| checkpoint | #172d37 | #8ac6ff | 检查点 |
| log | #1d2b30 | #7be0c0 | 调试日志 |
| accent | #332816 | #d4a853 | 筛选节点 |
| muted | #151925 | #596273 | 补充信息 |

---

## 六、MermaidGraphPanel 组件

### Props

```typescript
{
  graphDefinition: string;      // Mermaid 定义字符串
  nodeDetails: Record<string, NodeDetail>;  // 节点详情映射
  title: string;
  subtitle: string;
  highlightNodeId: string;      // 高亮节点 ID
  highlightMarkerTitle: string;
}
```

### 核心功能

1. **Mermaid 加载**：通过 vendor script 加载 `mermaid.min.js`
2. **渲染**：`mermaid.render(id, definition)` → 注入 SVG
3. **平移缩放**：
   - 指针拖拽（PointerEvent + setPointerCapture）
   - 滚轮缩放（保持光标下世界坐标不变）
   - 双指捏合缩放
   - 常量：MIN_SCALE=0.45, MAX_SCALE=4.2, STEP_SCALE=1.18
4. **节点交互**：
   - 渲染后扫描 SVG 中的 `g.node` 元素
   - 匹配 `nodeDetails` 中的 key
   - 点击节点显示详情浮层
5. **3D 布料物理**（当前已禁用）：
   - Three.js + Verlet 积分
   - 24×18 粒子网格
   - Canvas2D 纹理渲染节点详情

---

## 七、API 调用模式

参考项目使用 `callAI` 函数（来自 `useApi.js`）：

```javascript
// 记忆系统统一使用非流式
const chatApiConfig = {
  ...resolvedApiConfig,
  stream: false,
  skipPromptBuild: true
};

const response = await callAI(chatApiConfig, promptMessages, null, null);
// response = { content: string, stats: {...} }
```

**关键点**：
- `stream: false` — 记忆系统不用流式
- `skipPromptBuild: true` — 跳过预设构建，直接用传入的 messages
- API 配置从 preset 系统解析，支持多 provider
- 有自动重试和流式→非流式回退机制

---

## 八、当前项目（世界漫游指南）存在的问题

### 已知问题

1. **记忆管线 API 调用超时**：
   - `callMemoryAI` 使用 `requestCompletion`（非流式）
   - 部分 API 对非流式响应很慢，30s 超时不够
   - 已改为 120s 超时 + 移除 `responseFormat: 'json'`

2. **Zustand 引用相等性**：
   - `applyIngestToRuntime` 原地修改 runtime 对象
   - Zustand 检测不到变化，不触发 React 刷新
   - 已修复：`bumpRuntimeVersion()` 现在创建新引用

3. **存档不保存记忆运行态**：
   - `GameSave` 接口缺少 `memoryRuntime` 字段
   - 加载存档后记忆系统归零
   - 已修复：存档和加载都包含记忆数据

4. **图谱面板未接入**：
   - `RuntimeGraphPanel` 只显示 JSON，未使用 Mermaid 图谱
   - 已添加 `MermaidGraphPanel` 组件和图谱/JSON 双视图切换

### 待解决

1. 记忆管线错误需要在 UI 中可见（已添加调试日志写入）
2. 首轮对话时记忆为空，检索跳过是正常行为
3. 向量提取需要单独的 embedding API，当前未配置

---

## 九、移植建议

1. **先确保 API 调用成功**：在控制台看 `[记忆AI]` 日志，确认非流式调用能正常返回
2. **从写入阶段开始**：先让 `executeMemoryWrite` 成功写入数据，再调后续阶段
3. **参考项目用 `callAI` 包装了所有 API 调用**：有重试、回退、错误处理。当前项目直接裸调 `requestCompletion`，缺少这些保护
4. **图谱是纯函数**：`memory-mermaid.js` 可以直接抄，不需要改
5. **MermaidGraphPanel 的 3D 布料物理可以跳过**：参考项目自己也禁用了
