> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（8、API 与存储系统）。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 8、API 与存储系统

### 8.1 API 客户端 — `src/api/`

#### 8.1.1 核心客户端 — `src/api/client.ts`

**文件路径**: `src/api/client.ts`

**文件规模**:901 行。

**导出函数清单**(13 个,全部 `export`):`getProxyUrl`(:9)、`prepareFetchRequest`(:35)、`buildEndpoint`(:79)、`getRequestTimeoutMs`(:116)、`extractFinishReason`(:245)、`requestCompletion`(:381)、`requestCompletionStream`(:448)、`requestStreamWithRetry`(:545)、`fetchModels`(:602)、`testConnection`(:661)、`fetchEmbedding`(:747)、`fetchEmbeddingBatch`(:782)、`fetchRerank`(:860)。另有四个类型/接口导出:`ConnectionRequestOptions`(:580)、`EmbeddingConfig`(:741)、`RerankConfig`(:849)、`RerankResult`(:855)。

**模块内私有函数(未 export)**:`hasVersionSegment`(:74)、`isDeepSeekConfig`(:104)、`buildRequestBody`(:122)、`getDeepSeekReasoningEffort`(:207)、`extractStreamContent`(:215)、`extractReasoningContent`(:236)、`mergeConsecutiveSameRole`(:253)、`normalizeMessages`(:266)、`parseSSEStream`(:284)、`withRetry`(:492)、`requestWithFallback`(:513)、`getModelListUrls`(:556)、`validateProxyUrl`(:581)、`getApiAccessError`(:589)。

**主入口调用链**:

```
requestStreamWithRetry(config, messages, options)      // :545
  → withRetry(async () => requestWithFallback(config, messages, options), options.signal)  // :492 签名默认值 maxRetries = 3, baseDelay = 1000
    → requestWithFallback(config, messages, options)   // :513
        → requestCompletionStream（流式）或 requestCompletion（降级）
          → parseSSEStream（流式）                     // :284
```

> **注 1**:`withRetry` 的 `maxRetries` / `baseDelay` 是**函数签名默认值**,`requestStreamWithRetry` 调用时**只传回调与 signal**、不显式传这两个实参。
>
> **注 2**:超时**不在** `requestStreamWithRetry` 内实现——它既不新建 `AbortController` 也不 `setTimeout`。超时由 `requestCompletionStream` 以 `nativeFetch(fetchUrl, { timeoutMs: getRequestTimeoutMs(config) })`(`:465`)下发,真正创建 controller 与 `setTimeout(() => controller.abort(new DOMException('Request timeout exceeded', 'TimeoutError')), timeoutMs)` 的位置是 `src/utils/nativeFetch.ts:24-28`,并通过 `addEventListener('abort')` 合并外部 signal。

**关键工具函数**:

| 函数                            | 签名                             | 用途                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getRequestTimeoutMs(config)` | `(ApiConfig) => number`        | DeepSeek 推理模型首 token 与完整生成较慢，默认 `300_000`ms；其他配置默认 `120_000`ms。DeepSeek 识别覆盖显式 provider、官方端点与明确的模型名，因此从 OpenAI 兼容 / 自定义入口接入时也享有相同策略；用户显式超时优先。`requestStreamWithRetry` 与 `callAuxiliaryApi` 共用此策略。 |
| `extractFinishReason(json)`   | `(any) => string \| undefined` | 归一化多 provider 的结束原因字段:`choices[0].finish_reason`(OpenAI) / `candidates[0].finishReason`(Gemini) / `stop_reason`(Anthropic),返回第一个非空字符串,否则 undefined。`CompletionResult.finishReason` 由 `requestCompletion` 与 `parseSSEStream` 各自填充。 |

#### 8.1.2 多 Provider 特殊处理

多 provider 的请求体差异在 `buildRequestBody` 内按 `config.provider` 分支处理；响应侧的多格式兼容由 `extractStreamContent` / `extractReasoningContent` / `extractFinishReason` 完成（见 §8.1.1）。

显式选择 `provider: deepseek` 时采用 DeepSeek 原生文本聊天协议：空地址与官方根地址使用 `/beta/chat/completions`，官方地址存在末尾 assistant 预填时确保使用 Beta；第三方明确版本路径和完整端点保持填写值。消息先合并相邻角色，中途 system 转 user 后再合并，仅末尾 assistant 加 `prefix: true`，输入消息不原地修改。复用 `reasoningEffort`：未设置或“关闭”明确发送 `thinking.disabled`，开启时发送 `thinking.enabled` 与对应强度（`medium → high`）；不发送 `top_k`，思考模式采样参数按当前官方支持范围处理。连接测试也使用该协议。OpenAI / custom 仅保留 DeepSeek 的识别超时和合并兼容，不自动启用这套专属参数。

上述对齐酒馆原生 DeepSeek 的普通三角色文本请求，不导入酒馆的工具、多媒体、姓名转换、插件或世界书组装管线。外部预设导入仍遵守本项目的宿主规范，不能因具备 API 前缀续写就视为完整支持 SPreset 原版运行时。

#### 8.1.3 SSE 流解析

流式增量由 `parseSSEStream`(`src/api/client.ts:284`) 产生：以空行 `\n\n` 切分事件块、只接受 `data: ` 前缀的载荷、跳过 `[DONE]`，逐帧交给 `extractStreamContent`(:215) 与 `extractReasoningContent`(:236) 提取正文与推理内容。

#### 8.1.4 降级策略

流式返回空文本时降级为非流式 `requestCompletion` 重试；`finishReason` 为 `content_filter` 时直接报「模型服务明确拒绝了本次请求」；流式请求返回 400 且消息含 `stream` 时同样转非流式。

#### 8.1.5 辅助 API

`src/api/` 实际共 **23 个文件**（13 个源文件 + 10 个测试）。

| 文件                                            | 职责                                       |
| --------------------------------------------- | ---------------------------------------- |
| `client.ts`                                   | 多 Provider 客户端（见 §8.1.1）                 |
| `auxiliaryApi.ts`                             | 变量提取专用辅助客户端（不承担嵌入/翻译，见下）                 |
| `imageGen.ts` / `imageGenTypes.ts`            | 图像生成 API 与类型                            |
| `imageTasks.ts`                               | 生图任务队列（`ImageTaskQueue`,:40）              |
| `structuredOutput.ts`                         | 结构化输出请求与校验（`requestStructuredCompletion`,:154） |
| `syntheticTool.ts`                            | 合成工具调用注入与流式累积（`createSyntheticToolDefinition`,:156） |
| `presets.ts`                                  | API 预设解析（`resolvePreset`,:25）             |
| `rateLimiter.ts`                              | 限流器（按 `provider@baseUrl` 分桶的最小间隔 + 429 屏蔽期） |
| `types.ts`                                    | API 层共享类型                                 |
| `comfy/comfyWorkflow.ts`                      | ComfyUI 工作流解析/校验/转换                      |
| `comfy/comfyExecution.ts`                     | ComfyUI 执行等待（`waitForComfyExecution`,:110） |
| `comfy/comfyOutput.ts`                        | 图像与错误提取（`findComfyImageOutput`,:27）       |
| 10 个测试                                         | `client.test.ts` / `client.embedding.test.ts` / `auxiliaryApi.test.ts` / `connectionRequests.test.ts` / `imageTasks.test.ts` / `structuredOutput.test.ts` / `imageCancellation.test.ts` / `openaiImageRequest.test.ts` / `comfy/*.test.ts`(2) |

**`auxiliaryApi.ts` 导出函数**:

- `callAuxiliaryApi(config, messages, variableUpdatePrompt, signal?)` — 变量提取专用 API 客户端。拼接 messages + 变量更新指令 → 非流式 POST → 用 `extractUpdateContent` 解析 `<UpdateVariable>` 标签 / ` ```json ` 代码块 / 裸 JSON,返回提取到的 JSON 字符串或 null。带独立 `AbortController` + `getRequestTimeoutMs` 超时,并尊重外部 `signal`。
- `extractVariableRules(entries)` — 签名 `(entries: { comment: string; content: string; enabled: boolean }[]) => string`。筛选 `e.enabled && e.comment.includes('[mvu_update]')` 的条目,`map(e => e.content)` 去空后 `join('\n\n')` 返回(标记匹配的是 `comment` 字段,不是 `content`)。
- `extractUpdateContent(content)` — **模块内私有函数(未 export)**,按 `<UpdateVariable>` 标签 → ` ```json ` 代码块 → 裸 JSON 顺序回退提取。

**`rateLimiter.ts` 关键常量与函数**:

- `MIN_INTERVAL = 1000`, `MAX_INTERVAL = 60000` — 限流间隔上下限(毫秒)。
- `bucketKeyForConfig(config)` → `${provider}@${base || 'no-baseurl'}`(小写,去尾斜杠;`config` 为空时返回 `default`)。同 provider + baseUrl 共享一个限流桶,实现按端点分桶隔离。
- `DEFAULT_BUCKET = 'default'` — 默认桶 key(rateLimiter.ts:9,**模块内 `const`,未 export**;同理 `MIN_INTERVAL`:18 / `MAX_INTERVAL`:19 也未 export)。作为 `setRateLimitInterval` / `getRateLimitInterval` 的 `bucket` 参数默认值。
- `notifyRateLimited(retryAfterHeader, bucket)` — 收到 429 时调用,记录 `retryAfterUntil` 屏蔽期 + 抬高桶间隔(有 Retry-After → `parsed + interval`;无 → 指数退避 ×2),夹在 `[MIN_INTERVAL, MAX_INTERVAL]` 之间。
- `parseRetryAfter(header)` — 解析 delta-seconds / HTTP-date,无法解析返回 null。
- `waitForRateLimit(bucketOrConfig?, signal?)` — 签名 `(bucketOrConfig?: string | ApiConfig, signal?: AbortSignal)`(`:104`)。调用前阻塞等待,先尊重 429 屏蔽期,再补足最小间隔,等待期间可被传入的 `AbortSignal` 中断。
- `setRateLimitInterval(ms, bucket?)` / `getRateLimitInterval(bucket?)` — 显式调整与查询桶间隔。
- `detectOptimalRateLimit(testApiCall, onProgress?)` — 自适应探测推荐限流间隔。

### 8.2 IndexedDB 存储层 — `src/storage/`

#### 8.2.1 数据库 — `src/storage/db.ts`

**文件路径**: `src/storage/db.ts`

**当前 DB 版本**: `DB_VERSION = 10`。支持 DB v4～v9 直接升级，包括已有消息分片的 v4 和 2.8.2 的 v5；在原子事务中补齐当前表和索引，保留全部既有记录，修正旧小说分段索引，失败则回滚并允许重试。存档 payload 的 v4→v5 迁移窗口独立于 DB 部署版本。下列仅为历史结构记录，不逐级重放：

- v1-v3:`saves` + `global` 两个 store；`saves` 含 `timestamp` 索引。
- v4:`messages` 分片 store + `saveId`、`saveId_seq` 索引。
- v5:`module_states`(`saveId`、`saveId_moduleId` 唯一) + `module_checkpoints`(`saveId`、`saveId_module_revision` 唯一)。
- v6:`novel_datasets`(timestamp 索引) + `novel_chapters` + `novel_segments`(datasetId_index) + `novel_chunks`(datasetId_index) + `novel_jobs`(datasetId_index)。
- v9:对 `novel_chapters` / `novel_segments` / `novel_chunks` / `novel_jobs` / `novel_archives` / `novel_checkpoints` 补 `datasetId` 索引;`novel_segments` 的 `datasetId_index` 改为复合 `[datasetId, index]`;新增 `novel_sources` store。
- v10: 当前结构还包含 `novel_materials`、`director_definitions`、`director_jobs`。

**16 个 store 清单**:

```typescript
const DB_NAME = 'omni-plane-travels';
const DB_VERSION = 10;
const SAVES_STORE = 'saves';                 // 1
const GLOBAL_STORE = 'global';               // 2 ← 易漏
const MESSAGES_STORE = 'messages';           // 3
export const MODULE_STATES_STORE = 'module_states';         // 4
export const MODULE_CHECKPOINTS_STORE = 'module_checkpoints'; // 5
export const NOVEL_CHAPTERS_STORE = 'novel_chapters';       // 6
export const NOVEL_CHUNKS_STORE = 'novel_chunks';           // 7
export const NOVEL_DATASETS_STORE = 'novel_datasets';       // 8
export const NOVEL_JOBS_STORE = 'novel_jobs';               // 9
export const NOVEL_SEGMENTS_STORE = 'novel_segments';       // 10
export const NOVEL_ARCHIVES_STORE = 'novel_archives';       // 11
export const NOVEL_CHECKPOINTS_STORE = 'novel_checkpoints'; // 12
export const NOVEL_SOURCES_STORE = 'novel_sources';         // 13
export const NOVEL_MATERIALS_STORE = 'novel_materials';     // 14
export const DIRECTOR_DEFINITIONS_STORE = 'director_definitions'; // 15
export const DIRECTOR_JOBS_STORE = 'director_jobs';         // 16
```

#### 8.2.2 GameSave 结构

```typescript
export interface GameSave {   // db.ts:132
  schemaVersion?: number;     // v4/v5 internal save schema marker; imports are normalized before persistence (:134)
  id: string;
  name: string;
  timestamp: number;
  messages: ChatMessage[];  // 老格式内联,新格式在 messages store
  gameState: GameState;
  worldId: string;
  personalInfo?: PlayerProfile;
  characterHistory?: string;
  memoryRuntime?: unknown;
  memoryConfig?: unknown;
  vectorMemory?: unknown[];   // 存储层按 unknown[] 声明,不绑定 VectorFact[]
  variableConfig?: { apiPresetId?: string };
  customWorld?: Record<string, unknown>;
  simulationState?: SimulationState;
  moduleStates?: ModuleStateRecord[];
  moduleCheckpoints?: ModuleStateRecord[];
  lifecycle?: SaveLifecycle;              // export type SaveLifecycle = 'active' | 'ended' (db.ts:129)
  endedAt?: number;
  endReason?: string;
  assetSourceSessionIds?: string[];       // 可移植存档换 id 时保留的原始生图作用域 (:164)
}
```

> **注**:`GameSave`(db.ts:132)、`SaveLifecycle`(db.ts:129)、`SaveMeta`(db.ts:178)、`CompactSaveRecord`(db.ts:718)均为 `export`。结构中**不存在** `enabledMods` 字段——「本局启用的事件包」由 `sessionActivePacks`(`src/stores/saveStore.ts:41`)在会话内表达，导出时写入 payload 的 `eventPacks`（见 §22 与 `exportSaveCapture`），不在存档头。

```typescript
// CompactSaveRecord — v5 存档头部格式（不含 messages） db.ts:718-742
export interface CompactSaveRecord {
  id: string; name: string; timestamp: number;
  schemaVersion: number; round: number;
  gameState: GameState; worldId: string;
  personalInfo?: PlayerProfile;
  characterHistory?: string;
  memoryRuntime?: unknown;
  memoryConfig?: unknown;
  vectorMemory?: unknown[];
  variableConfig?: { apiPresetId?: string };
  customWorld?: Record<string, unknown>;
  simulationState?: SimulationState;
  encodedHistory?: StorageEncoding; // 大 memoryRuntime/simulationState 的存储编码，读取后恢复明文字段
  messageCount: number;
  lastMessageSeq: number;
  estBytes?: number;
  lifecycle?: SaveLifecycle;
  endedAt?: number;
  endReason?: string;
  assetSourceSessionIds?: string[];  // :741
}
// 注意:CompactSaveRecord 不含 messages / moduleStates / moduleCheckpoints;含 assetSourceSessionIds(:741)
```

#### 8.2.3 增量存档逻辑

`saveGameIncremental` 实际签名(db.ts:792-800，**6 个参数**):

```typescript
export async function saveGameIncremental(
  saveId: string,
  compactHead: Omit<CompactSaveRecord, 'messageCount' | 'lastMessageSeq'>,
  newMessages: ChatMessage[],
  moduleStates: readonly ModuleStateRecord[] = [],
  moduleCheckpoints: readonly ModuleStateRecord[] = [],
  options: {
    replaceMessages?: boolean;
    keptModuleRevisions?: ReadonlySet<string>;
    importCommit?: { ... };
    createCommit?: SaveMeta;
  } = {},
): Promise<void>
```

1. 增量写消息分片 — 主键格式 **`` `${saveId}#${seq}` ``**(`#` 分隔,非 `..`;注释见 db.ts:282,写入见 :332/:334,冷消息裁剪见 :576),幂等靠 key 含 seq
2. 计算 lastMessageSeq
3. 写紧凑头部(`messageCount` / `lastMessageSeq` 由本函数补齐);`options.replaceMessages` 为真时先按 `saveId` 索引清空该存档的消息分片再全量重写(`:847-853`)
4. 模块状态:key = `` `${saveId}#${record.moduleId}` ``,revision 未变则跳过(幂等);传入 `keptModuleRevisions` 时同步裁剪未被引用的旧修订(`:877-883`)
5. 模块检查点:key = `` `${saveId}#${record.moduleId}#${record.revision}` ``,已存在则跳过(幂等)

#### 8.2.4 配额治理

配额治理在 `src/storage/db.ts`：`checkQuota()` 读 `navigator.storage.estimate()`，已用超过 90% 即 `isNearQuota`；`pruneColdMessages(saveId, keepRecent = 200)` 保留最近 200 条与每 10 条一个 keyframe，删除其余冷消息；`autoPruneIfNeeded(saveId)` 在每次 `performSave` 前先检查再自动清理。

#### 8.2.5 其他存储

| 文件                      | 职责                                                    |
| ----------------------- | ----------------------------------------------------- |
| `imageDb.ts`            | 图像 Blob 存储(头像/场景图)                                    |
| `imageUrls.ts`          | objectURL 租约管理(展示侧借用,不写入游戏状态)                          |
| `moduleStateDb.ts`      | 模块状态独立持久化(导出 `pruneModuleCheckpoints` 供测试/维护调用;自动保存路径实际通过 `saveGameIncremental` 的 `keptModuleRevisions` 裁剪) |
| `templateStore.ts`      | 本地模板库(玩家预设 / NPC 模板 / 人生经历预设,基于 **localStorage**),与 IndexedDB 无关 |
| `storageCodec.ts`       | 大字段 ZIP JSON 编码(v2 `zip-json-graph` 写、v1 `zip-json` 只读兼容) |
| `saveFileCodec.ts`      | `.save.zip` 文件打包/解包(含 `assets/manifest.json` + `assets/blobs/{i}.bin`) |
| `saveAssets.ts`         | 存档内图片资产的收集与还原                                         |
| `saveCoordinator.ts`    | 存档写入调度器(防抖/合并/串行/失败重试，见 §8.3.1)                       |
| `saveDependencyImport.ts` | 存档依赖(事件包/导演定义)导入                                  |
| `importOwnership.ts`    | 导入资产归属重映射                                             |
| `mapStorageBatch.ts`    | IndexedDB 批量读写封装                                       |
| `safeStorage.ts`        | localStorage 安全包装(配额/序列化失败降级)                         |

`src/storage/` 实际共 **28 个文件**（**13 个源文件 + 15 个测试**）。除上表外还包含 `db.ts`（见 §8.2.1）与 15 个 `*.test.ts`（`databaseUpgrade` / `directorMigration` / `directorSaveBundle` / `historySharing` / `imageUrls` / `mapStorageBatch` / `moduleStateDb` / `safeStorage` / `saveAtomicity` / `saveCoordinator` / `saveDependencyImport` / `saveFileCodec` / `saveImages` / `saveTransferIntegration` / `storageCodec` 等）。

### 8.3 全局 Zustand Stores — `src/stores/`

#### 8.3.1 存档 Store — `src/stores/saveStore.ts`

**`SaveState` 实际状态字段**(saveStore.ts:34):`savesMeta: SaveMeta[]`(:36)、`currentSaveId: string | null`(:37)、`currentSaveName: string`(:38)、`currentAssetSourceSessionIds: string[]`(:39)、`sessionActivePacks: string[] | undefined`(:41,`undefined` = 用全局已启用列表,`[]` = 全部关掉)、`saveFailure: { saveId: string; message: string } | null`(:68)。

**`SaveState` 实际 actions**(:44-67):`initialize` / `createSave` / `loadSave` / `activateSave` / `deleteSave` / `forceDeleteSave` / `renameSave` / `importSave` / `exportSave` / `performSave` / `setSessionActivePacks` / `saveGame` / `scheduleAutoSave` / `flushAutoSave`。

**存档写入调度器** — `src/storage/saveCoordinator.ts`(167 行)。store 层**不持有任何 promise/timer 状态**;`saveCoordinator` 在 `saveStore.ts:71` 构造:`new SaveCoordinator({ save: capture => useSaveStore.getState().performSave(capture) })`。

```typescript
// saveCoordinator.ts:54-64 enqueue — 同存档排队任务被最新快照单槽覆盖
if (queue.pending) { queue.pending = save; if (queue.waiters.length) ... }

// :66 schedule / :71 scheduleCapture（默认 delay = 500）
// :76-84 scheduleOperation — setTimeout + clearTimeout 实现 500ms 防抖
// :146-166 drain — 串行落盘
while (queue.pending) { const next = queue.pending; queue.pending = null; await save(next); }
```

其他成员:`subscribe`(:25,`SaveOutcome` = `{ status: 'saved' | 'failed'; saveId; revision; error? }`)、`request`(:34)、`create`(:45)、`flush`(:86)、`cancelScheduled`(:98)、`runScheduled`(:107)、`getFailedCapture`(:132)、`retryFailed`(:137)。

`saveStore` 侧对应实现:

```typescript
// saveGame(:303-307) — 只负责取快照后交给调度器
const capture = buildSaveData();
if (!capture) throw ...;
await saveCoordinator.request(capture);

// scheduleAutoSave(:309-319) — 身份校验后交给调度器做防抖
void saveCoordinator.scheduleCapture(saveId, () => {
  if (get().currentSaveId !== saveId || _autoSaveBuilder !== builder) return null;
  ...
}).catch(err => console.error('[auto-save] 保存失败（需要用户注意）:', err));
```

`flushAutoSave()`(:321-323) 直接 `await saveCoordinator.request(buildCurrentSave())`;**不做 debounce、不清定时器**——`SaveCoordinator.request` 会先取消同存档已排队的 scheduled 保存再入队。若 builder 未注入或捕获 id 与当前存档不符,`buildCurrentSave()`(:348) 抛 `当前旅程身份或捕获尚未就绪，进度未保存。`(:350)。

模块级变量只有 `_autoSaveBuilder`(:346,由 `GameContext` 的 `useEffect` 注入;`:367-369` 注释明确「不要清空 `_autoSaveBuilder`，否则自动存档会失效」);`saveCoordinator.subscribe(...)`(:331-336) 把结果写回 `saveFailure`;`:341` 切换存档时 `saveCoordinator.cancelScheduled(previous.currentSaveId)`。

**`validateSaveId(raw)`**(:25)— 私有函数,正则 `/^save_\d+_[a-z0-9]{6,}$/`(:27)过滤 localStorage 脏数据。

**performSave 核心逻辑**(:205-301):配额检查(`autoPruneIfNeeded`)→ `planMessageSave` 按 SHA-256 `contentFingerprint` 比对得出 `changedMessages` 与 `replaceMessages`(整段替换,`db.ts:302-327`)→ 模块检查点裁剪(仅保留 `keptModuleRevisions` 命中的 `${moduleId}#${revision}`)→ 构建 `compactHead` → `saveGameIncremental` 写入(失败则自动导出 `save-backup-${Date.now()}.json` 兜底后 rethrow)→ 元数据更新(`saveAllSaveMeta`,失败仅 warn 不阻塞)。**没有**「全量重写检测」或「离开最近 10 条窗口强制重写」的分支。

#### 8.3.2 全局 Stores 索引

`src/stores/` 共 **10 个 store 文件**（含 §8.3.1 的 `saveStore.ts`）。下表列出各 store 的职责、状态字段与 actions：

| Store                 | 职责             | 实际状态字段                                                                                                               | 实际 actions                                                                                                                                                                               |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveStore.ts`        | 存档 CRUD + 自动存档 | `savesMeta`, `currentSaveId`, `currentSaveName`, `currentAssetSourceSessionIds`, `sessionActivePacks`, `saveFailure`                                                | 见 §8.3.1                                                                                                                                                                                 |
| `presetStore.ts`      | API 预设管理       | `userPresets`(**非** `presets`), `activePresetId`, `builtinOverrides`, `builtinContentOverrides`                      | `savePreset`, `deletePreset`, `setActivePreset`, `resetToDefault`, `saveBuiltinOverride`, `saveBuiltinContentOverride`, `saveBuiltinEdits`, `restoreBuiltinDefaults`, `getActivePreset`, `getUserPresetById` |
| `authStore.ts`        | 用户认证           | `user: User \| null`, `isLoading`, `isAuthenticated`(**无** `token` / `mode`)                                         | `checkAuth`, `sendCode`, `register`, `login`, `resetPassword`, `logout`                                                                                                                  |
| `cloudSaveStore.ts`   | 云存档槽位          | `slots: CloudSaveSlot[]`(**非** `cloudSaves`), `isLoading`, `error`(**无** `syncing`)                                  | `fetchSlots`, `uploadSave`, `downloadSave`, `deleteSave`                                                                                                                                 |
| `configStore.ts`      | 全局 UI/API 配置   | `settings: UISettings`(**非** `config`), `apiConfig: ApiConfig \| null`, `apiRecoveryError`          | `updateSettings`, `setApiConfig`, `initApiConfig`, `t`, `initialize`                                                                                      |
| `imageStore.ts`       | 图像生成配置与任务队列    | `config: ImageGenConfig`, `configLoaded`, `configRecoveryError`, `configWarning`, `tasks: ImageTask[]`, `comfyData`(**无** `images: Map`) | `setConfig`, `initImageConfig`, `addTask`, `updateTask`, `removeTask`, `setTasks`, `setComfyData`(**无** `updateConfig`) |
| `novelConfigStore.ts` | 小说工作台配置        | `config: NovelWorkbenchConfig`, `loaded: boolean`, `recoveryError`, `warning`(**非** `progress`)                                                  | `initialize`, `save`                                                                                                                                                                     |
| `apiPresetStore.ts`   | API 预设与加密密钥快照  | `snapshot`（私有，含 `presets` / `initialized` / `error` / `warning`）/ `secrets`（私有；无 `presetList` 字段）(`:32 class ApiPresetStore`、`:116 apiPresetStore`、`:120 useApiPresets`)          | `load` / `save` / `resolve`                                                                                                                                                               |
| `simulationStore.ts`  | 世界推演运行时        | `simState`, `isSimulating`, `lastError`, `isMainlineReviewing`, `isBackgroundReviewing`(**无** `tick` / `activeStorylines`) | `updateConfig`, `setSimState`, `setIsSimulating`, `setLastError`, `setMainlineReviewing`, `setBackgroundReviewing`, `resetSimulation`, `loadFromStorage`, `syncFromEngine` |
| `workshopStore.ts`    | 工作坊资产浏览/发布     | `items: WorkshopItem[]`, `total`, `page`, `pageSize: 20`, `isLoading`, `error`(**无** `installedPacks` / `editing`)   | `fetchItems`, `fetchItem`, `downloadItem`, `createItem`, `deleteItem`, `checkInstall`, `getInstallPlan`                                                                                  |

> **注**:`src/stores/` 下**不存在** `portraitStore.ts`，也**不存在** `audioStore.ts`；NPC 头像走 `src/storage/imageUrls.ts` + `src/hooks/useStoredImageUrl.ts`(见 §11)，音频走 `src/utils/hallAudio.ts`(见 §18)。

**`configStore.ts` 导出类型**:`Theme = 'light' | 'dark' | 'metal' | 'green'`、`FontFamily = 'yahei' | 'source'`（**仅 2 值**）、`FontSize = '小' | '中' | '大'`、`LineHeight = '紧凑' | '舒适' | '宽松'`、`Language = 'zh-CN' | 'en'`、`UISettings`(10 字段:`language` / `theme` / `font` / `uiFontSize` / `bodyFontSize` / `lineHeight` / `centeredNarrative` / `autoScroll` / `disableEffects`)。

**`workshopStore.ts` 导出接口**:`WorkshopItem`、`WorkshopItemDetail extends WorkshopItem`(加 `data`)、`WorkshopInstallPlan`(`ok` / `rootId` / `items` / `recommendations` / `errors`,错误码 `'MISSING' | 'INCOMPATIBLE' | 'CYCLE'`)。

**`cloudSaveStore.ts` 导出接口**:`CloudSaveSlot { slotIndex; version; size; updatedAt }`。**`authStore.ts`**:`User { id; username; email }`。**`novelConfigStore.ts`**:`NovelWorkbenchConfig { api; analysisPreset; embeddingMode: 'off' | 'inherit' | 'local_endpoint'; embeddingEndpoint; embeddingModel; analysisRateLimitMs; embeddingRateLimitMs }`（7 字段）。

### 8.4 Cloudflare Workers 后端 — `src/server/`

`src/server/` 实际共 **11 个文件** = 9 个源文件 + 2 个测试:

| 源文件             | 职责           |
| --------------- | ------------ |
| `index.ts`      | Worker 路由总入口 |
| `db.ts`         | D1 访问封装      |
| `saves.ts`      | 云存档槽位 API    |
| `session.ts`    | 会话/令牌        |
| `playStats.ts`  | 游玩统计         |
| `workshop.ts`   | 工作坊资产/依赖安装计划 |
| `crypto.ts`     | 密码哈希/加密工具    |
| `email-auth.ts` | 邮箱验证码认证      |
| `types.ts`      | 后端共享类型       |

测试文件(2 个):`playStats.test.ts`、`workshop.test.ts`。

- 部署入口:根目录 `server.ts` + `wrangler.toml` + `functions/api/[[route]].ts`
- 9 个 D1 SQL 迁移 `migrations/0001_init.sql` ~ `0009_trial_reservation_leases.sql`(详见 §19.3)

---



### 8.5 当前存档 schema 与文件格式

- 内部 `SAVE_SCHEMA_VERSION = 5`，继续使用存档头和 `${saveId}#${seq}` 消息分片。自动迁移仅保留 **v4 分片 → v5**，入口为 `planV4ToV5Migration` / `loadSaveWithMigration`；事务内读取当前头后升级版本标记，不批量改写历史。
- 大消息 `snapshot` 存为 `MessageRecord.encodedSnapshot`；头部的大 `memoryRuntime/simulationState` 存为 `encodedHistory`。`storageCodec.ts` 使用带 version/type 的 ZIP JSON 编码：当前写出的恒为 **v2 `zip-json-graph`**（共享引用先展开为节点图，遇循环引用抛 `Cannot serialize cyclic storage data`），v1 `zip-json` 仅保留读取兼容；长度小于 4096 字节或压缩后不更小时保持明文。
- 编码在写事务前完成；三种消息读取函数在 cursor 事务结束后解码，`loadGame` / `loadSaveWithMigration` / `exportSave` 恢复正常对象。`gameState` 保持明文，模块应用/恢复可继续透传其余存档头字段。
- v0～v3 内部格式已退出兼容窗口，原始数据库记录不删除。需要先用相应旧 App 导出 JSON，再以外部协议导入。
- `exportSave` 仍返回外部协议 **2.0 JSON Blob**，供云端等消费者使用；外部 JSON v1/v2 导入由 `importSaveFromData` 规范化后直接写成 v5，不属于内部迁移链。
- 本地文件导出由 `saveFileCodec.ts` 打包为标准 DEFLATE ZIP(level 6)，扩展名 `.save.zip`。无图片资产时只含 `save.json`；含资产时另含 `assets/manifest.json` 与 `assets/blobs/{i}.bin`(`saveFileCodec.ts:5` 的 `ASSET_MANIFEST`)，导入时按 manifest 路径正则 `^assets/blobs/\d+\.bin$` 重组。本地 UI 与 `importSaveFromFile` 共用内容识别解码器，支持旧 JSON 和 ZIP；ZIP 校验 CRC，损坏或缺少 `save.json` 明确报错。
- 无损压缩不增加快照裁剪，也不改变现有回滚引用、模块 checkpoint 修订及云端裁剪策略。
