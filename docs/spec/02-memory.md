> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（2、记忆系统）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 2、记忆系统

#### 2.0 记忆系统文件清单(漏列补充)

`src/memory/` 实际 17 个文件(核心 15 + 2 测试),其中漏列:

- `embeddingRuntime.ts` — 嵌入运行时(向量化任务调度)
- `embeddingRuntime.test.ts` — 嵌入运行时测试
- `memoryPipeline.regression.test.ts` — 记忆管线回归测试
- `memoryStore.checkpoint.test.ts` — 记忆 store 检查点测试

### 2.1 9 阶段管线 — `src/memory/memoryPipeline.ts`

**文件路径**: `src/memory/memoryPipeline.ts`

**9阶段管线**:

```typescript
// 阶段定义
type MemoryPipelineStage =
  | 'write'        // 提取叙事对象
  | 'summary'      // 生成结构化摘要
  | 'vector'       // 提取长期向量事实
  | 'query_rewrite' // 分析输入，提取检索关键词
  | 'retrieve_plan' // AI规划哪些记忆需要注入
  | 'multi_round'  // 多轮补充检索
  | 'rerank'       // AI打分重排序
  | 'finalize'     // 本地匹配 + 去重 + 排序
  | 'compile';     // 组装记忆上下文
```

**执行顺序图**:

```
main（正文生成完成）
  ↓
[write ──并行── summary ──并行── vector]  ← 3个并行阶段
  ↓ (全部完成)
query_rewrite  ← 串行
  ↓
retrieve_plan  ← 串行
  ↓
multi_round    ← 串行
  ↓
rerank         ← 串行
  ↓
finalize       ← 串行
  ↓
compile        ← 串行
```

#### 2.1.1 write阶段 — 叙事对象提取

```typescript
// 从AI响应中提取叙事对象：人物/地点/事件/关系
interface NarrativeObject {
  type: 'person' | 'place' | 'event' | 'relation';
  name: string;
  description: string;
  mentions: number;         // 提及次数
  firstMentionedRound: number;
  relatedObjects: string[]; // 相关对象ID
}

// 使用 narrativePromptTemplates.ingest 构建提示词
// 调用 API（writeConfig）提取叙事对象
// 结果写入 memoryStore.runtime.narrativeObjects
```

#### 2.1.2 summary阶段 — 结构化摘要生成

```typescript
// 生成当前场景的结构化摘要
interface NarrativeSummary {
  scene: string;           // 场景描述
  keyEvents: string[];     // 关键事件
  characterStates: Record<string, string>; // 角色状态
  activeThreads: string[]; // 开放线索
  importantFacts: string[]; // 重要事实
}

// 使用 narrativePromptTemplates.summary
// 结果写入 memoryStore.runtime.summarySaveHistory
```

#### 2.1.3 vector阶段 — 向量事实提取

```typescript
// 提取需要长期记忆的向量事实（实际定义见 memory/types.ts；字段远多于下）
interface VectorFact {
  fact: string;                       // 事实内容（非 content）
  title?: string;
  summary?: string;
  keywords: string[];
  entities: string[];
  primaryType: VectorFactType;        // 'task'|'character'|'relationship'|'location'|'faction'|'event'|'clue'|'item'|'ability'|'status'|'rule'|'world'|'other'（非 category）
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
// VectorMemoryItem = VectorFact & { id: string; searchText?; embeddingTimestamp? }

// 使用 narrativePromptTemplates.vectorExtract
// 结果写入 memoryStore.vectorMemory
// 同时调用 fetchEmbeddingBatch 向量化
```

#### 2.1.4 query_rewrite阶段 — 查询改写

```typescript
// 分析用户输入，提取检索关键词
interface QueryRewriteResult {
  originalQuery: string;
  keywords: string[];        // 扩展后的关键词列表
  concepts: string[];        // 概念提取
  searchDepth: number;       // 检索深度建议
  timeContext: string;       // 时间上下文
}

// 使用 narrativePromptTemplates.queryRewrite
// 结果写入 memCtx.queryRewriteResult
```

#### 2.1.5 retrieve_plan阶段 — 检索规划

```typescript
// AI规划哪些记忆分片需要注入
interface RetrievePlan {
  strategy: 'recent' | 'relevant' | 'comprehensive' | 'focused';
  targetMemoryIds: string[];     // 需要注入的记忆ID
  injectionOrder: string[];      // 注入顺序
  reasoning: string;             // 规划理由
  estimatedTokens: number;       // 预估token消耗
}

// 使用 narrativePromptTemplates.retrievePlanner
```

#### 2.1.6 multi_round阶段 — 多轮补充检索

```typescript
// 基于检索结果，进行多轮补充检索
// 每轮检索可能发现新的相关记忆
// 最多5轮迭代（防止无限循环）
// 使用 narrativePromptTemplates.multiRoundRetrievePlanner
```

#### 2.1.7 rerank阶段 — 重排序

```typescript
// AI对检索结果打分重排序
interface RerankedMemory {
  memoryId: string;
  score: number;         // 相关性分数 0-1
  reason: string;        // 评分理由
  injectionPosition: 'before' | 'after' | 'replace';
}

// 使用 narrativePromptTemplates.rerank
```

#### 2.1.8 finalize阶段 — 最终化

```typescript
// 本地匹配 + 去重 + 排序
// 1. 余弦相似度匹配（vectorUtils.cosineSimilarity）
// 2. 去重（相同内容的记忆只保留一条）
// 3. 按分数降序排序
// 4. 应用注入位置策略
```

#### 2.1.9 compile阶段 — 编译

```typescript
// 将处理后的记忆组装成上下文文本
interface CompiledMemoryContext {
  fullText: string;       // 完整上下文文本
  tokenCount: number;     // token计数
  memoryCount: number;    // 包含的记忆条数
  injectionPoints: Array<{ position: string; content: string }>;
}

// 编译阶段由 compileFormatter 生成注入文本
// 结果写入 memoryStore.lastCompiledContext
```

#### 2.1.10 降级机制

```typescript
// 每个阶段失败时（如向量化失败）向 ctx._degradedStages 追加阶段标识
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

// 降级时使用简化逻辑（如直接返回空结果），不阻塞主线
```

#### 2.1.11 Stage Store隔离

```typescript
// 重试时使用 stagedStore 代理
// 写入先暂存到 runtime/vectors 本地副本
// commit() 时才写入真实 store
// 确保取消的请求不污染存档状态

class StagedMemoryStore ❌ 实际未找到此 export 类名(可能已废弃或重构) {
  runtime: Partial<NarrativeMemoryRuntime>;
  vectors: VectorFact[];
  
  commit(realStore: MemoryStore): void {
    // 合并到真实store
    realStore.runtime = { ...realStore.runtime, ...this.runtime };
    realStore.vectorMemory.push(...this.vectors);
  }
}
```

---

### 2.2 记忆 Store — `src/memory/memoryStore.ts`

**文件路径**: `src/memory/memoryStore.ts`

```typescript
// 实际接口 — `src/memory/memoryStore.ts`
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

  // 运行时(注意:不是 initialize)
  initMemoryRuntime: (bankId?: string) => void;     // 实际是 initMemoryRuntime 不是 initialize
  getMemoryRuntime: () => NarrativeMemoryRuntime;
  resetMemoryRuntime: () => void;
  bumpRuntimeVersion: () => void;

  // Checkpoint
  createCheckpoint: () => NarrativeCheckpoint | null;
  restoreCheckpoint: (checkpointId: string) => boolean;

  // Narrative 元素 CRUD(全部 upsert*/update* 模式,无 addNarrativeObject)
  updateSceneAnchor: (patch: Partial<SceneAnchor>) => void;
  appendSourceEvent: (event: NarrativeSourceEvent) => void;
  upsertThread: (thread: NarrativeThread) => void;
  removeThread: (id: string) => void;
  upsertStateSlot: (slot: NarrativeStateSlot) => void;
  // ... 等

  // 实际不存在的方法:
  // ❌ addNarrativeObject / addVectorFact / updateThreadStatus / archiveThread
  // ❌ search / getRecentFacts / compileContext
  // ❌ getCheckpoint（注意：createCheckpoint / restoreCheckpoint 实际存在，见上）
  // ❌ clearPipelineOutputs（实际存在：() => void）
  // 注：store 另有大量 upsert*/append*/set*/remove* 方法(如 upsertRelationEdge、upsertEventCard、
  //     setVectorMemory、appendMutation、appendSummarySaveRecord、setCompiledContext、toJSON/fromJSON 等)
}
```

#### 2.2.1 NarrativeMemoryRuntime 结构（完整定义见 `memory/types.ts`；下列为节选，实际还含 version/bankId/mutationLog/sourceEvents/lastSummarySave/lastRetrievePlan 等字段，且 SceneAnchor、NarrativeThread 等子结构字段以源码为准）

```typescript
interface NarrativeMemoryRuntime {
  // 场景锚点 — 当前场景的上下文快照
  sceneAnchor: {
    时间: string;              // "第3天上午"
    地点: string;              // "长安城集市"
    涉及实体: string[];        // ["玩家", "李四", "王五"]
    当前目标: string;          // "完成采购任务"
    当前风险: string;          // "可能被发现身份"
    情绪氛围: string;          // "紧张"
  };
  
  // 叙事线索 — 跟踪开放/阻塞/已解决的 storyline
  activeThreads: Array<{
    id: string;
    名称: string;
    状态: 'open' | 'blocked' | 'resolved';
    重要性: number;            // 1-5
    创建回合: number;
    最后活跃回合: number;
    相关实体: string[];
    摘要: string;
  }>;
  
  // 作用域状态值 — 快速访问的键值对
  stateSlots: Array<{
    slot: string;              // "玩家血量" / "当前天气"
    scope: 'player' | 'npc' | 'location' | 'world';
    key: string;               // 具体key
    value: string;
    updatedRound: number;
  }>;
  
  // 关系边 — 实体之间的关系图
  relationEdges: Array<{
    id: string;
    source: string;            // 实体A
    target: string;            // 实体B
    relation: string;          // "朋友" / "敌人" / "恋人"
    weight: number;            // 关系强度 0-1
    updatedRound: number;
    备注?: string;
  }>;
  
  // 关系网络节点
  relationNetwork: Array<{
    id: string;
    type: 'person' | 'place' | 'faction' | 'item';
    name: string;
    importance: number;        // 1-10
    描述: string;
    首次出现回合: number;
  }>;
  
  // 重要事件卡（实际类型为 NarrativeEventCard，见 memory/types.ts；hot/warm/cold 状态衰减）
  eventCards: Array<{
    id: string;
    title: string;
    summary: string;
    excerpt: string;
    importance: number;
    status: 'hot' | 'warm' | 'cold';
    entityRefs: string[];
    locationRefs: string[];
    threadRefs: string[];
    timeLabels: string[];
    sourceStartIndex: number | null;
    sourceEndIndex: number | null;
    createdAt?: number;
    updatedAt?: number;
  }>;
  
  // 实体档案 — 人物/地点/组织的详细信息卡
  entityCards: Array<{
    id: string;
    type: 'person' | 'place' | 'faction' | 'item' | 'event';
    name: string;
    描述: string;
    关键属性: Record<string, unknown>;
    关系: string[];            // 关联的relationEdge ids
    创建回合: number;
    最后活跃回合: number;
    重要性: number;
  }>;
  
  // 归档线索ID列表
  archiveCards: string[];
  
  // 向量记忆（长期事实；实际为可选字段 vectorMemory?: VectorFact[]）
  vectorMemory?: VectorFact[];
  
  // 检查点（最多5个）
  checkpoints: Array<{
    id: string;
    round: number;
    timestamp: number;
    data: SerializedMemoryRuntime;
  }>;
  
  // AI生成的摘要历史
  summarySaveHistory: Array<{
    round: number;
    summary: string;
    keyFacts: string[];
    topicTags: string[];
  }>;
}
```

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

// 实际存储类型为 VectorMemoryItem（extends VectorFact，额外含 id / searchText? / embeddingTimestamp?）
````

````

---

### 2.3 向量与嵌入运行时

#### 2.3.1 向量工具 — `src/memory/vectorUtils.ts`

**文件路径**: `src/memory/vectorUtils.ts`

```typescript
// 余弦相似度计算
function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// 实体槽位构建 — 将实体信息转换为向量检索用的字符串
function buildEntitySlot(entity: {
  name: string;
  type: string;
  description?: string;
  aliases?: string[];
}): string {
  const parts = [entity.name];
  if (entity.aliases) parts.push(...entity.aliases);
  if (entity.description) parts.push(entity.description);
  return parts.join(' ');
}

// 批量向量化
async function embedTexts(
  texts: string[],
  config: EmbeddingConfig,
): Promise<Array<{ text: string; embedding: number[] }>> {
  const response = await fetchEmbeddingBatch(texts, config);
  // 返回文本及其对应的向量
}

// 相似度搜索
function searchBySimilarity(
  query: string,
  facts: VectorFact[],
  topK: number = 10,
): VectorFact[] {
  const queryEmbedding = embedTexts([query])[0].embedding;
  return facts
    .filter(f => f.embedding)
    .map(f => ({
      fact: f,
      similarity: cosineSimilarity(queryEmbedding, f.embedding!),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK)
    .map(r => r.fact);
}
````

---

### 2.4 提示词模板 — `src/memory/memoryPrompts.ts`

**文件路径**: `src/memory/memoryPrompts.ts`

**10个提示词模板**:

```typescript
// writePrompt — 叙事对象提取
// 输入: batchText (用户+AI的回合内容)
// 输出: JSON数组 [{ type, name, description, mentions, relatedObjects }]
const writePrompt = `你是一个叙事分析系统。从以下对话中提取所有重要的叙事对象...

## 提取对象类型
- person: 人物（玩家、NPC、路人等）
- place: 地点（城市、建筑、自然景观等）
- event: 事件（发生的行为、决定、冲突等）
- relation: 关系（人与人、人与地点的关系变化）

## 输出格式
请以JSON数组格式输出，每项包含：
- type: 对象类型
- name: 对象名称
- description: 简要描述
- mentions: 提及次数
- relatedObjects: 相关对象列表

## 对话内容
{batchText}`;

// summaryPrompt — 结构化摘要生成
// 输入: recentContext (最近N条消息)
// 输出: JSON { scene, keyEvents, characterStates, activeThreads, importantFacts }
const summaryPrompt = `分析以下对话，生成结构化摘要...

## 输出格式
{
  "scene": "当前场景描述",
  "keyEvents": ["关键事件1", "关键事件2"],
  "characterStates": { "角色名": "状态描述" },
  "activeThreads": ["开放线索1", "开放线索2"],
  "importantFacts": ["重要事实1", "重要事实2"]
}

## 最近对话
{recentContext}`;

// vectorExtractPrompt — 向量事实提取
// 输入: batchText, currentFacts (已存在的向量事实)
// 输出: JSON数组 [{ fact, primaryType, secondaryTypes, entities, importance, timeScope, state, ... }]（字段见 VectorFact 类型，非 content/entitySlots/category）
const vectorExtractPrompt = `从对话中提取需要长期记忆的重要事实...

## 重要性评分标准
- 10: 主线剧情关键转折点
- 7-9: 重要人物关系变化、重大发现
- 4-6: 中等重要的事件和决定
- 1-3: 日常细节、闲聊内容

## 分类
- character: 人物相关信息
- plot: 剧情相关事实
- world: 世界设定相关
- rule: 规则和机制相关
- relationship: 关系变化

## 对话内容
{batchText}`;

// queryRewritePrompt — 查询改写
// 输入: userText (用户当前输入)
// 输出: JSON { keywords, concepts, searchDepth, timeContext }
const queryRewritePrompt = `分析用户输入，提取用于记忆检索的关键词...

## 用户输入
{userText}`;

// retrievePlanPrompt — 检索规划
// 输入: queryResult, vectorMemory, budget (token预算)
// 输出: JSON { strategy, targetMemoryIds, injectionOrder }
const retrievePlanPrompt = `根据检索结果，规划记忆注入策略...

## 可用记忆
{availableMemories}

## Token预算
{maxTokens}

## 用户查询
{userQuery}`;

// rerankPrompt — 重排序
// 输入: query, retrievedMemories
// 输出: JSON数组 [{ memoryId, score, reason, injectionPosition }]
const rerankPrompt = `对检索到的记忆进行相关性打分...

## 用户查询
{query}

## 待评分记忆
{memories}`;

// 编译注入文本（由 compileFormatter 生成）
// 输入: runtime, queryKeywords, budget, resourceState
// 输出: string
const compiledText = `将记忆片段编译成连贯的上下文文本...

## 记忆片段
{memories}

## 用户查询
{query}

## Token预算
{maxTokens}`;
```

---

### 2.5 编译/叙事/候选

| 文件                                                                | 职责                                                           |
| ----------------------------------------------------------------- | ------------------------------------------------------------ |
| `src/memory/compileFormatter.ts`                                  | 把 `RerankedMemory[]` 编译成最终注入文本(`fullText`),控制 token 预算与排版    |
| `src/memory/narrativeGraph.ts` | `multi_round` 阶段遍历相关记忆 |
| `src/memory/narrativeParsers.ts`                                  | 从 AI 响应解析叙事对象,补充 `write` 阶段提取不到的实体引用                         |
| `src/memory/narrativePng.ts`                                      | 叙事图 PNG 导出(可视化调试,可选)                                         |
| `src/memory/memoryCandidates.ts`                                  | 候选记忆去重/合并策略(`entities`/`keywords`/`primaryType` 重叠检测)        |
| `src/memory/memoryConfig.ts`                                      | 记忆系统配置 schema(嵌入模型/管线预算/降级策略)                                |
| `src/memory/normalize.ts`                                         | 记忆数据标准化(版本兼容/字段合并)                                           |
| `src/memory/types.ts`                                      | `NarrativeMemoryRuntime` / `VectorFact` / `Checkpoint` 等类型定义 |

**`compileFormatter` 与 `compile` 阶段的关系**:

- 编译阶段 `executeMemoryCompile` 调用 `compileFormatter.formatRuntimeToCompiledText(runtime, queryKeywords, budget, resourceState)` 生成注入文本
- 输出写入 `memoryStore.lastCompiledContext`,供下次 `mainTask` 步骤 6 使用
- 失败兜底:返回空字符串,不阻塞主线(但会触发 `_degradedStages` 标记)

**叙事图谱 (`narrativeGraph`)**:

```typescript
interface NarrativeGraph {
  nodes: Map<string, GraphNode>;      // entityId -> node
  edges: Map<string, GraphEdge[]>;    // entityId -> related edges
  addNode(node: GraphNode): void;
  addEdge(edge: GraphEdge): void;
  traverse(startId: string, depth: number): GraphNode[];  // BFS
  findRelated(entityId: string, hops: number): VectorFact[];
}
```

### 2.6 记忆系统 Hook — `src/memory/useMemorySystem.ts`

**文件路径**: `src/memory/useMemorySystem.ts`

**职责**: 提供给 React 组件使用的记忆系统访问入口,封装 store 订阅 + 初始化 + 加载逻辑。

```typescript
export function useMemorySystem() {
  const config = useMemoryStore(s => s.config);
  const runtime = useMemoryStore(s => s.runtime);
  const vectorMemory = useMemoryStore(s => s.vectorMemory);
  
  return {
    config,
    runtime,
    vectorMemory,
    search: (query: string, opts?: SearchOptions) => useMemoryStore.getState().search(query, opts),
    compileContext: (input: string, cfg: CompileConfig) => useMemoryStore.getState().compileContext(input, cfg),
    reset: () => useMemoryStore.getState().resetMemoryRuntime(),
  };
}
```

**典型消费者**:

- `GameScreen` 订阅 `runtime` 变化触发重新渲染(场景锚点/活跃线索变化)
- `NotebookPanel`(7.4 内部组件)读取 `vectorMemory` 显示重要事实
- 调试工具读取原始 store state

---

