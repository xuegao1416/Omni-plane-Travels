> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（2、记忆系统）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 2、记忆系统

#### 2.0 记忆系统文件清单

`src/memory/` 共 24 个文件 = **16 个源文件 + 8 个测试**。

**源文件（16）**：编译侧 `compileFormatter.ts`、候选池 `memoryCandidates.ts`、配置 `memoryConfig.ts`、主管线 `memoryPipeline.ts`、提示词 `memoryPrompts.ts`、Store `memoryStore.ts`、叙事图谱 `narrativeGraph.ts`、解析器 `narrativeParsers.ts`、记忆包 PNG `narrativePng.ts`、标准化 `normalize.ts`、类型 `types.ts`、向量工具 `vectorUtils.ts`、管线契约 `useMemorySystem.ts`、嵌入运行时 `embeddingRuntime.ts`、外部事实 `externalFacts.ts`、可见性 `memoryVisibility.ts`。

**测试（8）**：`embeddingRuntime.test.ts`、`externalFacts.test.ts`、`memoryVisibility.test.ts`、`memoryPipeline.regression.test.ts`、`memoryStore.checkpoint.test.ts`、`memoryCancellation.test.ts`、`memoryVersionChain.test.ts`、`narrativeGraph.test.ts`。

### 2.1 记忆管线 — `src/memory/memoryPipeline.ts`

**文件路径**: `src/memory/memoryPipeline.ts`

**阶段标识不定义在本模块**：真实类型是 `src/engine/pipelineTypes.ts:6-18` 的 `PipelineTaskId`，记忆相关 9 个任务统一带 `memory_` 前缀：

```typescript
type PipelineTaskId =
  | 'main' | 'variable' | 'settlement'                      // 非记忆任务
  | 'memory_write'                // 提取叙事对象
  | 'memory_summary'              // 生成结构化摘要
  | 'memory_vector'               // 提取长期向量事实
  | 'memory_query_rewrite'        // 分析输入，提取检索关键词
  | 'memory_retrieve_plan'        // AI 规划哪些记忆需要注入
  | 'memory_multi_round'          // 多轮补充检索
  | 'memory_rerank'               // AI 打分重排序
  | 'memory_retrieve_finalize'    // 本地匹配 + 去重 + 排序
  | 'memory_compile';             // 组装记忆上下文
```

`MemoryPipelineStage` 这个类型名**在仓库中不存在**。

**执行顺序**（`src/engine/pipelineTypes.ts:72-82` 的 `DEFAULT_EXECUTION_ORDER`，共 9 层；`variable` 是其后单独的第 10 层）：

```
main（正文生成完成）
  ↓
[memory_write ──并行── memory_summary ──并行── memory_vector]  ← 3 个并行阶段
  ↓ (全部完成)
memory_query_rewrite  ← 串行
  ↓
memory_retrieve_plan  ← 串行
  ↓
memory_multi_round    ← 串行
  ↓
memory_rerank         ← 串行
  ↓
memory_retrieve_finalize ← 串行
  ↓
memory_compile        ← 串行
  ↓
variable              ← 串行（变量提取，不属记忆）
  ↓
settlement            ← 循环外单独执行（玩法结算）
```

`settlement` **不在** `DEFAULT_EXECUTION_ORDER` 里，由 `src/engine/pipelineExecutor.ts:169-172` 在循环结束后单独 `executeMemoryTask('settlement', ...)` 调用。

另有一条文档未记录的前置路径：每轮正文生成前，`src/engine/useGameEngine.ts:953-961` 会先 `await executeMemoryPrepareForMain(memStore, memCtx)`，一次性完成本地摘要选择 + 向量召回 + 上下文编译；失败仅告警并沿用现有热态记忆。

#### 2.1.1 memory_write 阶段 — 叙事写入

```typescript
// 使用 templates.ingest（getDefaultNarrativeIngestPrompt）构建提示词
// AI 返回分组补丁，由 applyIngestToRuntime 合并
// 落盘字段：scenePatch / threadUpserts / stateSlotUpserts / relationUpserts /
//          relationNetworkUpserts / eventCandidates / entityPatches / archiveHints
//          并向 runtime.sourceEvents 追加本轮原始事件
```

**不存在 `NarrativeObject` 接口**，也不存在 `runtime.narrativeObjects` 字段。第 2.5 节表格里"叙事对象提取"的说法一并作废。合并入口是 `applyIngestToRuntime`（`src/memory/memoryPipeline.ts:1041`）。

#### 2.1.2 memory_summary 阶段 — 结构化摘要

```typescript
// src/memory/types.ts:694-698
interface NarrativeSummaryResult {
  otherCharacterMemories: SummaryMemoryItem[];
  playerMemories: SummaryMemoryItem[];
  itemMemories: SummaryMemoryItem[];
}
```

`SummaryMemoryItem` 定义见 `src/memory/types.ts:413`。解析函数 `parseNarrativeSummaryResult`（`src/memory/narrativeParsers.ts:412`）会补齐 `sourceType` / `layer` / `confidence` / `validFromRound` / `sourceEventIds` 等溯源字段，随后写入 `runtime.summarySaveHistory`。

#### 2.1.3 memory_vector 阶段 — 向量事实提取

```typescript
// 使用 templates.vectorExtract（getDefaultVectorExtractPrompt）
// 结果写入 memoryStore.vectorMemory
// 若启用语义检索（semanticRetrieveEnabled 且已配置本地模型或远端端点），
// 由 embeddingRuntime.createEmbeddingClient 调用 fetchEmbeddingBatch 补 embedding / embeddingTimestamp
// 向量化失败仅记 appendWriteDebugLog({ kind: 'vector_embedding' }) 调试日志并保留纯文本事实，不阻断写入
```

`VectorFact` 完整字段见 §2.2.2，此处不再重复。

#### 2.1.4 memory_query_rewrite 阶段 — 查询改写

```typescript
// src/memory/narrativeParsers.ts:506
interface VectorQueryRewriteResult {
  semanticQuery: string;
  retrievalKeywords: string[];
  entityFocus: string[];
  timeFocus: string[];
  locationFocus: string[];
  intent: string;
  needHistoricalCause: boolean;
  needRelationshipFocus: boolean;
}
```

解析器 `parseVectorQueryRewriteResult`（`:517`）。执行处 `src/memory/memoryPipeline.ts:612-613` **只写** `ctx._retrievalKeywords` 与 `ctx._semanticQuery`，不改写用户原始输入，也不写 `ctx._queryRewriteResult`。

#### 2.1.5 memory_retrieve_plan 阶段 — 检索规划

```typescript
// src/memory/types.ts:702
interface NarrativeRetrievePlannerResult {
  items: Array<{ title: string; reason?: string }>;
  retrievalKeywords: string[];
  notes?: string;
}
```

写入 `ctx._plannerResult` / `ctx._finalSelectedTitles` / `ctx._candidateList` / `ctx._allMemories`（`src/memory/memoryPipeline.ts:646-670`）。落盘快照为 `RetrievePlanSnapshot`（`src/memory/types.ts:445-451`）：`{ plannedAt; candidates: Array<{ title; source? }>; selectedTitles; selectedModes; strategy: string }`——`strategy` 是自由字符串，**不是** `'recent' | 'relevant' | 'comprehensive' | 'focused'` 四值枚举。

#### 2.1.6 memory_multi_round 阶段 — 多轮补充检索

多轮补充**默认关闭**（`memoryConfig.ts:69` `multiRoundEnabled: false`）。开启后默认上限 `multiRoundMaxRounds = 3`（`memoryConfig.ts:70`），配置面板可调 2–10（`src/components/settings/memory/RetrievalConfigPanel.tsx:74-76`）。循环从第 2 轮起（`memoryPipeline.ts:692` `for (let round = 2; round <= maxRounds; round++)`，首轮由 retrieve_plan 承担），任一轮无新增标题即提前终止。模板为 `templates.multiRoundRetrievePlanner` / `templates.multiRoundRetrievePlannerFinal`。

#### 2.1.7 memory_rerank 阶段 — 重排序

```typescript
// src/memory/narrativeParsers.ts:534
interface RerankResult {
  rankings: Array<{ index: number; score: number }>;
  needVectorRecall: boolean;
  vectorRecallReason: string;
  currentSceneRelationNetwork: string;
}
```

解析器 `parseRerankResult`（`:541`）；执行处 `src/memory/memoryPipeline.ts:738-791` 按 score 降序重排 `ctx._selectedEntries`。**`RerankedMemory` 类型不存在**，返回的是候选下标与分数，不含注入位置。失败时回退标题匹配结果并标记 `memory_rerank` 降级。

#### 2.1.8 memory_retrieve_finalize 阶段 — 最终化（纯本地）

`src/memory/memoryPipeline.ts:795-843`，实际四步：

1. 标题**双向包含匹配**（`:808-810`）
2. 关键词命中率 ≥ `keywordRecallThreshold / 100` 时补足候选（`:813-820`）
3. 按 `title.toLowerCase()` 去重（`:823-829`）
4. **按 `sourceFloor` 升序排序**（`:830` `deduped.sort((a, b) => a.sourceFloor - b.sourceFloor)`）

随后 `setRetrievePlan`（`:833-839`）。全程**无 `cosineSimilarity`、无注入位置策略**；`selectedModes` 统一记 `'keyword_hit'`。余弦相似度只出现在向量召回路径 `recallVectorFacts` 里。

#### 2.1.9 memory_compile 阶段 — 编译

```typescript
// src/memory/types.ts:453-459
interface CompiledContextSnapshot {
  compiledAt: number;
  fullText: string;
  sections: Record<string, string>;
  sceneAnchor?: SceneAnchor;
  runtimeFlow?: RuntimeFlowSnapshot;
}
```

`CompiledMemoryContext` 类型不存在；`injectionPoints` / `memoryCount` / `tokenCount` 三个字段也都不存在。编译核心是 `compileFormatter.formatRuntimeToCompiledText(...)`，返回 `CompiledOutput { text; tokenEstimate; sections: CompiledSectionBudget; hotIds: string[] }`（`src/memory/compileFormatter.ts:239`），再归一成上面的快照写入 `memoryStore.lastCompiledContext`。

#### 2.1.10 降级机制

只有 **4 个**阶段经 `withDegradationCheck` 包装（`src/engine/useGameEngine.ts:162-165`）：`memory_query_rewrite`、`memory_retrieve_plan`、`memory_multi_round`、`memory_rerank`。write(:159)、summary(:160)、vector(:161)、retrieveFinalize(:166)、compile(:167) 均为裸 `await`。

向 `_degradedStages` 追加的标识是 pipeline task id：`'memory_query_rewrite'`（`memoryPipeline.ts:622`）、`'memory_retrieve_plan'`（`:670`）、`'memory_multi_round'`（`:730`）、`'memory_rerank'`（`:787`）；向量召回在正文前准备阶段另有 `'memory_vector'` / `'memory_vector_strict_failure'` 两个标识（`:253` / `:258`）。

包装函数本体如下（`src/engine/useGameEngine.ts:93-105`，与原文档逐字一致）：

```typescript
function withDegradationCheck(
  memCtx: MemoryPipelineContext,
  label: string,
  task: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const before = memCtx._degradedStages?.length ?? 0;
    await task();
    if ((memCtx._degradedStages?.length ?? 0) > before) {
      throw new Error(`[降级] ${label}失败，使用回退策略`);
    }
  };
}
```

#### 2.1.11 写入重试与失败记账

`executeMemoryWrite` 与 `executeMemorySummary` 均按 `retryCount + 1` 次重试（`writePipeline.retryCount` 默认 2），间隔 `abortableDelay(retryDelayMs, ctx.signal)`（默认 1200ms）以响应取消。

失败记账**不对称**：
- **write** 重试全部耗尽后写一次 `lastIngestFailure`（含 `sourceStartIndex` / `cursor` / `attempt` / `maxAttempts` / `status: 'active'`）并抛错；注意 `attempt` 记的是 `maxAttempts` 而非当次序号（`memoryPipeline.ts:442-455`）。
- **summary** **不写** `lastIngestFailure`，只 `appendWriteDebugLog({ kind: 'summary', mode: 'error' })` 并抛 `new Error('摘要保存失败: ...')`（`memoryPipeline.ts:520-524`）。

成功时推进 `lastIngestCursor`，若此前有 `active` 失败则置为 `resolved` 并写 `resolvedAt`。

**提交契约（CAS）**：写入在本地 runtime 副本上完成后，经 `commitMemoryRuntime(runtime, expectedVersion, baseline)` 提交（`src/memory/memoryStore.ts:119` 声明，`:449-467` 实现）。版本或基线不一致时抛 `DOMException('记忆版本已变化，请重试当前阶段', 'AbortError')`。合并采用"只合并不覆盖"——`structuredFacts` 会先排除 `summarySaveHistory` / `lastSummarySave` / `sourceEvents` / `checkpoints` / `lastCompiledContext` / `lastRuntimeFlow` / `lastRetrievePlan` / 三个 `debugLogs` / `vectorMemory`。

---

### 2.2 记忆 Store — `src/memory/memoryStore.ts`

**文件路径**: `src/memory/memoryStore.ts`

```typescript
// 接口定义 — `src/memory/memoryStore.ts`
interface MemoryStore {
  // 状态(13 个，完整定义见 memory/types.ts MemoryStoreState)
  config: MemorySystemConfig;
  memoryRuntime: NarrativeMemoryRuntime | null;
  vectorMemory: VectorMemoryItem[];
  writeDebugLogs: DebugLog[];
  retrieveDebugLogs: DebugLog[];
  compileDebugLogs: DebugLog[];
  lastCompiledContext: CompiledContextSnapshot | null;
  lastRuntimeFlow: RuntimeFlowSnapshot | null;
  lastRetrievePlan: RetrievePlanSnapshot | null;
  isLoading: boolean;
  loadingStage: string;
  error: string | null;
  runtimeVersion: number;
  // ... 共 13 个状态字段（另含 toJSON/fromJSON 序列化方法）

  // 配置
  setConfig: (config: Partial<MemorySystemConfig>) => void;
  resetConfig: () => void;

  // 运行时
  initMemoryRuntime: (bankId?: string) => void;
  getMemoryRuntime: () => NarrativeMemoryRuntime;
  resetMemoryRuntime: () => void;
  bumpRuntimeVersion: () => void;

  // Checkpoint
  createCheckpoint: (retainedIds?: readonly string[]) => NarrativeCheckpoint | null;
  restoreCheckpoint: (checkpointId: string) => boolean;

  // Narrative 元素 CRUD（均为 upsert*/update* 模式）
  updateSceneAnchor: (patch: Partial<SceneAnchor>) => void;
  appendSourceEvent: (event: NarrativeSourceEvent) => void;
  upsertThread: (thread: NarrativeThread) => void;
  removeThread: (id: string) => void;
  upsertStateSlot: (slot: NarrativeStateSlot) => void;
  // ... 等
}
```

#### 2.2.1 NarrativeMemoryRuntime 结构

完整定义见 `src/memory/types.ts`。以下为节选，字段名以源码为准（本节此前使用的"中文键名 + 推测字段"写法已全部作废）：

```typescript
// SceneAnchor — src/memory/types.ts:184-199（无「情绪氛围」字段）
sceneAnchor: {
  timeLabel: string; locationLabel: string; presentEntities: string[];
  immediateGoal: string; immediateRisk: string; conversationFocus: string;
  recentChange: string; confidence: number;
  updatedAt?: number; sourceType?: MemorySourceType;
  validFromRound?: number; validUntilRound?: number; sourceEventIds?: string[];
}

// NarrativeThread — src/memory/types.ts:248-265（状态 6 个，非 3 个）
activeThreads: Array<{
  id: string; title: string; summary: string; goal: string;
  status: 'open' | 'blocked' | 'suspended' | 'resolved' | 'failed' | 'superseded';
  priority: number; blockingReason: string;
  relatedEntities: string[]; relatedItems: string[]; relatedLocations: string[];
  deadline: string; sourceStartIndex: number | null; sourceEndIndex: number | null;
  category?: string; createdAt?: number; updatedAt?: number;
}>;

// NarrativeStateSlot — 267-281
stateSlots: Array<{
  id: string; scopeType: string; scopeId: string; slotType: string;
  value: string; summary: string; status: string; priority: number;
  sourceStartIndex: number | null; sourceEndIndex: number | null;
  history?: Array<{ value: string; summary: string; recordedAt: number }>;
}>;

// NarrativeRelationEdge — 283-298
relationEdges: Array<{
  id: string; sourceEntityId: string; targetEntityId: string;
  relationType: string; stance: string; strength: number;
  status: 'active' | 'broken' | 'changed'; summary: string;
  sourceStartIndex: number | null; sourceEndIndex: number | null;
  locationScope?: string;
}>;

// NarrativeRelationNetworkItem — 300-315（是「关系边」，不是实体节点）
relationNetwork: Array<{
  id: string; sourceEntityId: string; targetEntityId: string;
  relationType: string; summary: string; strength: number;
  status: string; confidence: number;
}>;

// NarrativeEventCard — 318-332（hot/warm/cold 状态衰减）
eventCards: Array<{
  id: string; title: string; summary: string; excerpt: string;
  importance: number; status: 'hot' | 'warm' | 'cold';
  entityRefs: string[]; locationRefs: string[]; threadRefs: string[];
  timeLabels: string[]; sourceStartIndex: number | null; sourceEndIndex: number | null;
  createdAt?: number; updatedAt?: number;
}>;

// NarrativeEntityCard — 336-355；类型枚举见 :334（6 值，无 'event'）
entityCards: Array<{
  name: string;
  entityType: 'character' | 'location' | 'faction' | 'item' | 'ability' | 'other';
  aliases: string[]; currentStatus: string; stableFacts: string[];
  currentStance: string; affiliations: string[];
  relatedThreads: string[]; relatedEvents: string[];
  locationFacts?: Record<string, unknown>;
  factHistory?: Array<{ fact: string; recordedAt: number }>;
}>;

// NarrativeArchiveCard — 357-369（对象卡，非 ID 字符串数组）
archiveCards: Array<{
  id: string; title: string; arcTitle: string; summary: string;
  timeSpan: string; keywords: string[]; entityRefs: string[]; archivedAt: number;
}>;

// 向量记忆（长期事实）
vectorMemory?: VectorFact[];

// NarrativeCheckpoint — 380-390；上限 10（memoryStore.ts:792 MAX_CHECKPOINTS = 10）
checkpoints: Array<{
  id: string; createdAt: number; lastIngestCursor: number;
  activeThreadCount: number; eventCount: number; entityCount: number;
  snapshot?: unknown; vectorMemory?: VectorFact[];
}>;

// SummarySaveRecord — 392-411；历史上限 MAX_SUMMARY_HISTORY = 500（memoryStore.ts:56）
summarySaveHistory: Array<{
  id?: string; savedAt: number; status: 'success' | 'error';
  sourceStartIndex: number; sourceEndIndex: number; sourceEventIds?: string[];
  applyResult: { otherCharacterCount: number; playerCount: number; itemCount: number;
                 eventCount?: number; archiveCount?: number; vectorCount?: number };
  summaryData?: { otherCharacterMemories: SummaryMemoryItem[];
                  playerMemories: SummaryMemoryItem[]; itemMemories: SummaryMemoryItem[] };
}>;
```

冲突的旧摘要记录会标 `superseded` 并裁到 `MAX_SUMMARY_HISTORY = 500`（`src/memory/memoryStore.ts:838-869`、`:56`）。

#### 2.2.2 VectorFact 结构（以 `memory/types.ts` 为准）

````typescript
```typescript
export type VectorFactType =
  | 'task' | 'character' | 'relationship' | 'location' | 'faction'
  | 'event' | 'clue' | 'item' | 'ability' | 'status' | 'rule' | 'world' | 'other';

export interface VectorFact {
  fact: string;                       // 事实内容（非 content）
  title?: string;
  summary?: string;
  keywords: string[];
  entities: string[];
  primaryType: VectorFactType;        // 非 category
  secondaryTypes: VectorFactType[];
  characters: string[];
  locations: string[];
  factions: string[];
  items: string[];
  abilities: string[];
  events: string[];
  rules: string[];
  timeMarkers: string[];
  importance: number;
  timeScope: 'short' | 'mid' | 'long';
  state: 'active' | 'resolved' | 'expired' | 'unknown';
  sourceStartIndex?: number | null;
  sourceEndIndex?: number | null;
  createdAt?: number;
  embedding?: number[];
  sourceType?: MemorySourceType;
  layer?: MemoryLayer;
  confidence?: number;
  evidence?: string[];
  validFromRound?: number | null;
  validUntilRound?: number | null;
  validFromLabel?: string;
  validUntilLabel?: string;
  supersedesId?: string | null;
  previousVersionId?: string | null;
  conflictStatus?: 'none' | 'disputed' | 'superseded' | 'rejected';
  sourceEventIds?: string[];
}

// 存储类型为 VectorMemoryItem（extends VectorFact，额外含 id / searchText? / embeddingTimestamp?）
````

````

---

### 2.3 向量与嵌入运行时

#### 2.3.1 向量工具 — `src/memory/vectorUtils.ts`

**文件路径**: `src/memory/vectorUtils.ts`（12 个导出，全部为纯函数/归一化工具）

真实导出面:`cosineSimilarity`(:15)、`normalizeVectorFactType`(:45)、`normalizeVectorTypeList`(:89)、`normalizeVectorEntityField`(:110)、`buildVectorFallbackEntitySlots`(:118)、`collectVectorSlotEntities`(:179)、`normalizeVectorFactImportance`(:206)、`normalizeVectorFactTimeScope`(:212)、`normalizeVectorFactState`(:218)、`normalizeVectorFact`(:226)、`normalizeVectorMemoryItem`(:280)、`resolveVectorFactArrayFromPayload`(:298)。

```typescript
// src/memory/vectorUtils.ts:15-36 —— 取 min(len) 对齐，而非长度不等即返回 0
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  const len = Math.min(vecA.length, vecB.length);
  if (len === 0) return 0;
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < len; i++) {
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dotProduct += a * b; normA += a * a; normB += b * b;
  }
  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  return dotProduct / denominator;
}
```

**`buildEntitySlot` / `embedTexts` / `searchBySimilarity` 三个函数在仓库中不存在**。对应能力分别是:

- **实体槽位** → `buildVectorFallbackEntitySlots`(:118) 与 `collectVectorSlotEntities`(:179)——从向量事实的 `entities` / `characters` / `locations` 等字段回退拼出检索用槽位字符串。
- **批量向量化** → 统一走 `embeddingRuntime.createEmbeddingClient(config).embed(texts, options)`；底层 `fetchEmbeddingBatch` 定义在 `src/api/client.ts:782`，由 `src/memory/embeddingRuntime.ts:176-177` 动态 `await import('../api/client')` 取得。
- **相似度检索** → `memoryPipeline.recallVectorFacts`（`src/memory/memoryPipeline.ts:108-188`）：先过滤不可见 / 已过期 / 被取代事实，再用 `cosineSimilarity` 打分（`:152`），过 `vectorScoreThreshold` 取候选，缺失 embedding 时按 batchSize 64 补齐，必要时走 `fetchRerank` 重排，最后按 `primaryType` 限流并截取 `vectorRetrieveTopK`。

#### 2.3.2 嵌入运行时 — `src/memory/embeddingRuntime.ts`

`DEFAULT_LOCAL_EMBEDDING_MODEL = 'onnx-community/bge-small-zh-v1.5-ONNX'`(:4)。对外导出:

- 模型管理:`getInstalledLocalEmbeddingModels`(:134)、`isLocalEmbeddingModelInstalled`(:144)、`deleteLocalEmbeddingModel`(:148)、`clearAllLocalEmbeddingModels`(:159)、`warmLocalEmbeddingModel`(:223)、`isLocalEmbeddingModelLoaded`(:236)。
- 端点与客户端:`resolveEmbeddingEndpoint`(:180) 按 `vectorRuntime` 三值分流(`'remote'` / `'local'` / `'local_endpoint'`),`createEmbeddingClient`(:189) 是唯一入口。
- 类型:`EmbeddingClient`(:6)、`EmbeddingRuntimeDependencies`(:10)、`LocalEmbeddingProgress`(:15)、`LocalEmbeddingProgressCallback`(:23)、`LocalEmbeddingModelMetadata`(:25)、`LocalEmbeddingModelManagerDependencies`(:31)。

相关配置字段在 `src/memory/types.ts:104-149`:`vectorRuntime`、`localEmbeddingModelId`、`vectorRerankApiUrl`、`vectorRerankModel`、`vectorRetrieveMode`。

---

### 2.4 提示词模板 — `src/memory/memoryPrompts.ts`

**文件路径**: `src/memory/memoryPrompts.ts`

**11 个提示词模板**：每个模板由 `getDefault*` 工厂导出，占位符统一为 `{{...}}` 双花括号（如 `{{玩家名字}}` / `{{剧情原文}}` / `{{叙事写入参考}}` / `{{batchText}}` / `{{inputText}}` / `{{recentContext}}`）。

文档此前列出的 `writePrompt` / `summaryPrompt` / `vectorExtractPrompt` / `queryRewritePrompt` / `retrievePlanPrompt` / `rerankPrompt` / `compiledText` **七个常量在仓库中均不存在**。真实导出面（`src/memory/memoryPrompts.ts`）：

| 行号 | 工厂函数 | 模板键 | 作用 |
| --- | --- | --- | --- |
| :11 | `getDefaultVectorExtractPrompt` | `vectorExtract` | 向量事实提取（12 类主分类、importance 1-5） |
| :147 | `getDefaultNarrativeIngestPrompt` | `ingest` | 叙事写入补丁提取 |
| :236 | `getDefaultNarrativeQueryRewritePrompt` | `queryRewrite` | 检索关键词改写 |
| :273 | `getDefaultNarrativeSummaryPrompt` | `summary` | 结构化摘要生成 |
| :312 | `getDefaultNarrativeRetrievePlannerPrompt` | `retrievePlanner` | 检索规划 |
| :345 | `getDefaultMultiRoundRetrievePlannerPrompt` | `multiRoundRetrievePlanner` | 多轮补充规划 |
| :369 | `getDefaultMultiRoundRetrievePlannerFinalPrompt` | `multiRoundRetrievePlannerFinal` | 多轮补充收尾 |
| :393 | `getDefaultNarrativeRerankPrompt` | `rerank` | 精排打分 |
| :424 | `getDefaultNarrativeConflictJudgePrompt` | `conflictJudge` | 冲突裁决 |
| :453 | `getDefaultVectorQueryRewritePrompt` | `vectorQueryRewrite` | 向量查询改写 |
| :480 | `getDefaultVectorRerankPrompt` | `vectorRerank` | 向量召回重排 |

另有两个装配函数：`createDefaultNarrativePromptTemplates`（:507）与 `normalizeNarrativePromptTemplates(templates: unknown)`（:525）。`NarrativePromptTemplates` 类型（`src/memory/types.ts:154-165`）为上述 11 个模板字段 + `_version?`。

**两个容易写错的取值**：

- **主分类是 12 类**，无 `plot`：`task` / `character` / `relationship` / `location` / `faction` / `event` / `clue` / `item` / `ability` / `status` / `rule` / `world`。
- **`importance` 是 1–5 整数**（5 为长期关键事实、1 为临时细节），**不是 10 分制**。

`compiledText` 不是提示词——编译注入文本由 `compileFormatter` 程序化渲染，见 §2.5。

---

### 2.5 编译/叙事/候选

| 文件                                                                | 职责                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/memory/compileFormatter.ts`                                  | 把 `NarrativeMemoryRuntime` 按「热态常驻层 + 查询扩展层」两段编译成注入文本，控制 token 预算与排版 |
| `src/memory/narrativeGraph.ts` | 把运行时渲染成 Mermaid 图谱负载，供记忆面板可视化标签页使用，**与管线阶段无关** |
| `src/memory/narrativeParsers.ts`                                  | 从 AI 响应容错解析六类结构:`parseNarrativeIngestResult`(:186) / `parseNarrativeSummaryResult`(:412) / `parseNarrativeRetrievePlannerResult`(:461) / `parseNarrativeConflictJudgeResult`(:489) / `parseVectorQueryRewriteResult`(:517) / `parseRerankResult`(:541) |
| `src/memory/narrativePng.ts`                                      | 记忆包 PNG 隐写导出/导入:`createMemoryDataPngBlob`(:441) / `extractMemoryPackFromPng`(:454) / `isMemoryPngFile`(:496) / `getMemoryExportFileName`(:501) |
| `src/memory/memoryCandidates.ts`                                  | 把运行时各结构化集合投影为统一 `MemoryEntry` 检索池,并按受众(`player`/`director`)做可见性投影:`collectMemoryEntries(runtime, audience = 'player')`(:96);**无去重/合并** |
| `src/memory/memoryConfig.ts`                                      | 记忆系统配置 schema(嵌入模型/管线预算/降级策略)                                |
| `src/memory/normalize.ts`                                         | 记忆数据标准化(版本兼容/字段合并)                                           |
| `src/memory/types.ts`                                      | `NarrativeMemoryRuntime` / `VectorFact` / `NarrativeCheckpoint` 等类型定义 |

`narrativeGraph.ts` 只被 `src/components/settings/memory/runtimeGraph/GraphView.tsx:4` 与本文件的测试 `narrativeGraph.test.ts:2` 引用；`memoryCandidates.ts` 的消费方是检索候选池构建(`memoryPipeline.ts`)。

**`compileFormatter` 与 `compile` 阶段的关系**:

- 编译阶段 `executeMemoryCompile` 调用 `formatRuntimeToCompiledText(runtime, queryKeywords, budget, resourceState)` 生成注入文本。签名:`formatRuntimeToCompiledText(runtime: NarrativeMemoryRuntime, queryKeywords: string[], budget = DEFAULT_COMPILE_BUDGET, resourceState?: ResourceSnapshot[]): CompiledOutput`(`src/memory/compileFormatter.ts:246`;热态常驻层与查询扩展层的分段构造在 `:363-370`)。
- `CompiledOutput`(`:239`)= `{ text; tokenEstimate; sections: CompiledSectionBudget; hotIds: string[] }`,由 `executeMemoryCompile` 归一成 `CompiledContextSnapshot` 写入 `memoryStore.lastCompiledContext`。
- 注入位置是**系统提示第 4 段**(`src/engine/promptAssembler.ts:96-102`,顺序为 1 世界书 / 2 玩家档案 / 3 角色认知防火墙 / 4 编译后的记忆上下文 / 5 剧情导演指导 / 6 预设提示词条目),拼装在 `:230-231`,取值 `src/engine/useGameEngine.ts:1112 memCtx ? memStore.lastCompiledContext?.fullText || '' : ''`。
- **compile 无内部兜底**:`executeMemoryCompile`(`src/memory/memoryPipeline.ts:847-901`)没有 try/catch,异常上抛给 `src/engine/pipelineExecutor.ts:255-287`——那里记 debug 日志、把该 stage 标 `status: 'error'`,不中断后续层级。「返回空字符串、触发 `_degradedStages`」的说法不成立(`memory_compile` 不在 `withDegradationCheck` 的 4 个包装里)。

**叙事图谱 (`narrativeGraph`)**:

文件共 1386 行，对外只导出两个入口：

- `buildMemoryRuntimeGraphPayload(options: GraphPayloadOptions)`（L1276）— 把运行时结构转成 `GraphBuilderResult`（`definition` 文本 + `nodeDetails` 明细）
- `buildMemoryRuntimeMermaidGraph(options: GraphPayloadOptions)`（L1384）— 直接产出 Mermaid 文本
- 另有 `TAB_LABELS`（L30）与 `GraphPayloadOptions` 接口（L1250）

内部的 `GraphNode`（L171）/ `GraphEdge`（L178）/ `GraphBuilderResult`（L185）与 `createGraphBuilder(direction)`（L190，提供 `addNode` 等构建方法）均不导出，仅供本文件组装图谱使用。

### 2.6 管线上下文类型 — `src/memory/useMemorySystem.ts`

**文件路径**: `src/memory/useMemorySystem.ts`（60 行）

**职责**: 现为**纯类型模块**，不再包含 React Hook。早先的同名 Hook 没有运行时调用方，已移除，仅保留管线契约类型：

- `MemoryPipelineContext`（L16）— 管线各阶段共享的输入输出载体：`floor` / `signal` / `batchText` / `inputText` / `assistantText` / `recentContext` / `playerName` / `apiConfig` 及各阶段独立 `*ApiConfig`；管线间共享数据用下划线前缀字段（`_queryRewriteResult` / `_plannerResult` / `_rerankResult` / `_selectedEntries` / `_selectedVectorFacts` / `_compiledContext` / `_retrievalKeywords` / `_semanticQuery` / `_finalSelectedTitles` / `_candidateList` / `_allMemories` / `_hitDetails` / `_degradedStages`），另有 `resourceState`
- `RetrieveResult`（L8）— `entries` / `retrievalKeywords` / `compiledContext` / `hitDetails`
- 重新导出 `MemoryEntry`（L6）

**典型消费者**: `src/engine/useGameEngine.ts:57`、`src/engine/turnRecovery.ts:1`、`src/memory/memoryPipeline.ts:8`、`src/memory/memoryPipeline.regression.test.ts:12` 均以 `import type { MemoryPipelineContext }` 引用，无运行时依赖。

---

