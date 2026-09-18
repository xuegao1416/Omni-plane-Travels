> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（8、API 与存储系统）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 8、API 与存储系统

### 8.1 API 客户端 — `src/api/`

#### 8.1.1 核心客户端 — `src/api/client.ts`

**文件路径**: `src/api/client.ts`

**导出函数清单**(13 个,全部 `export`):`getProxyUrl`(:8)、`prepareFetchRequest`(:34)、`buildEndpoint`(:69)、`getRequestTimeoutMs`(:81)、`extractFinishReason`(:138)、`requestCompletion`(:238)、`requestCompletionStream`(:304)、`requestStreamWithRetry`(:400)、`fetchModels`(:458)、`testConnection`(:501)、`fetchEmbedding`(:574)、`fetchEmbeddingBatch`(:607)、`fetchRerank`(:685)。

**模块内私有函数(未 export)**:`buildRequestBody`(:85)、`mergeConsecutiveSameRole`(:145)、`normalizeMessages`(:159)、`parseSSEStream`(:165)、`withRetry`(:349)、`requestWithFallback`(:370)、`getModelListUrls`(:435)。

**主入口调用链**:

```
requestStreamWithRetry(config, messages, options)      // :400
  → const timeoutMs = getRequestTimeoutMs(config)
  → withRetry(async () => { ... })                     // :349 签名默认值 maxRetries = 3, baseDelay = 1000
      内部：合并外部 options.signal 与新建 AbortController
            setTimeout(timeoutMs) → controller.abort(new DOMException('Streaming timeout exceeded', 'TimeoutError'))
    → requestWithFallback(config, messages, { ...options, signal: controller.signal })   // :370
        → requestCompletionStream 或 requestCompletion（降级）
          → parseSSEStream（流式，:165）
```

> **注**:`withRetry` 的 `maxRetries` / `baseDelay` 是**函数签名默认值**,`requestStreamWithRetry` 调用时**只传回调**、不显式传这两个实参。

**关键工具函数**:

| 函数                            | 签名                             | 用途                                                                                                                                                                                                                                |
| ----------------------------- | ------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `getRequestTimeoutMs(config)` | `(ApiConfig) => number`        | DeepSeek 推理模型首 token 与完整生成较慢,返回 `300_000`ms;其它 provider 默认 `120_000`ms。`requestStreamWithRetry` 与 `callAuxiliaryApi` 都使用此值驱动 `AbortController` 超时。                                                                                |
| `extractFinishReason(json)`   | `(any) => string \| undefined` | 归一化多 provider 的结束原因字段:`choices[0].finish_reason`(OpenAI) / `candidates[0].finishReason`(Gemini) / `stop_reason`(Anthropic),返回第一个非空字符串,否则 undefined。`CompletionResult.finishReason` 由 `requestCompletion` 与 `parseSSEStream` 各自填充。 |

#### 8.1.2 多 Provider 特殊处理

§8.5 差异化处理与 §8.6 多格式兼容散节整合详见下方。

#### 8.1.3 SSE 流解析

流式字段路径详见 §8.6.1。

#### 8.1.4 降级策略

降级触发条件详见 §8.6.4。

#### 8.1.5 辅助 API

| 文件                                            | 职责                                       |
| --------------------------------------------- | ---------------------------------------- |
| `auxiliaryApi.ts`                             | 辅助 API(嵌入/补全/翻译)                         |
| `imageGen.ts`                                 | 图像生成 API                                 |
| `imageGenTypes.ts`                            | 图像生成类型                                   |
| `rateLimiter.ts`                              | 限流器(滑动窗口 + token bucket)                 |
| `types.ts`                                    | API 层共享类型                                 |
| `comfy/comfyWorkflow.ts`                      | ComfyUI 工作流客户端(本地 SD),`comfy/` 下仅此 1 个文件 |
| `client.test.ts` / `client.embedding.test.ts` | 客户端测试                                    |

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
- `waitForRateLimit(bucketOrConfig?)` — 调用前阻塞等待,先尊重 429 屏蔽期,再补足最小间隔。
- `setRateLimitInterval(ms, bucket?)` / `getRateLimitInterval(bucket?)` — 显式调整与查询桶间隔。
- `detectOptimalRateLimit(testApiCall, onProgress?)` — 自适应探测推荐限流间隔。

### 8.2 IndexedDB 存储层 — `src/storage/`

#### 8.2.1 数据库 — `src/storage/db.ts`

**文件路径**: `src/storage/db.ts`

**当前 DB 版本**: `DB_VERSION = 10`。支持 DB v4～v9 直接升级，包括已有消息分片的 v4 和 2.8.2 的 v5；在原子事务中补齐当前表和索引，保留全部既有记录，修正旧小说分段索引，失败则回滚并允许重试。存档 payload 的 v3→v4 迁移窗口独立于 DB 部署版本。下列仅为历史结构记录，不逐级重放：

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
interface GameSave {
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
  vectorMemory?: unknown[];   // 注意:实际类型是 unknown[],非 VectorFact[]
  variableConfig?: { apiPresetId?: string };
  customWorld?: Record<string, unknown>;
  simulationState?: SimulationState;
  enabledMods?: string[];
  moduleStates?: ModuleStateRecord[];     // 注意:类型名是 ModuleStateRecord,非 RecordState
  moduleCheckpoints?: ModuleStateRecord[];
  lifecycle?: SaveLifecycle;              // export type SaveLifecycle = 'active' | 'ended' (db.ts:117)
  endedAt?: number;
  endReason?: string;
}
```

> **注**:`interface GameSave`(db.ts:120)**未加 export**;`SaveLifecycle`(db.ts:117)、`SaveMeta`(db.ts:164)、`CompactSaveRecord`(db.ts:740)均为 `export`。`enabledMods` 带 TODO 注释,计划下次格式升级改名为 `enabledEventPacks`。

```typescript
// CompactSaveRecord — v4+存档存储格式(不含 messages),db.ts:740
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
  enabledMods?: string[];
  messageCount: number;
  lastMessageSeq: number;
  estBytes?: number;
  lifecycle?: SaveLifecycle;
  endedAt?: number;
  endReason?: string;
}
// 注意:CompactSaveRecord 不含 messages / moduleStates / moduleCheckpoints
```

#### 8.2.3 增量存档逻辑

`saveGameIncremental` 实际签名(db.ts:892):

```typescript
export async function saveGameIncremental(
  saveId: string,
  compactHead: Omit<CompactSaveRecord, 'messageCount' | 'lastMessageSeq'>,
  newMessages: ChatMessage[],
  moduleStates: readonly ModuleStateRecord[] = [],
  moduleCheckpoints: readonly ModuleStateRecord[] = [],
): Promise<void>
```

1. 增量写消息分片 — 主键格式 **`` `${saveId}#${seq}` ``**(`#` 分隔,非 `..`;db.ts:283 注释、372/521/908 均为此格式),幂等靠 key 含 seq
2. 计算 lastMessageSeq
3. 写紧凑头部(`messageCount` / `lastMessageSeq` 由本函数补齐)
4. 模块状态:key = `` `${saveId}#${record.moduleId}` ``,revision 未变则跳过(幂等)
5. 模块检查点:key = `` `${saveId}#${record.moduleId}#${record.revision}` ``,已存在则跳过(幂等)

#### 8.2.4 配额治理

配额治理详见 §8.7。

#### 8.2.5 其他存储

| 文件                      | 职责                                                    |
| ----------------------- | ----------------------------------------------------- |
| `imageDb.ts`            | 图像 Blob 存储(头像/场景图)                                    |
| `moduleStateDb.ts`      | 模块状态独立持久化(导出 `pruneModuleCheckpoints`,被 saveStore 调用) |
| `moduleStateDb.test.ts` | 模块状态持久化测试                                             |
| `templateStore.ts`      | 模板存储(角色/世界模板)                                         |

`src/storage/` 实际共 5 个文件(`db.ts` / `imageDb.ts` / `moduleStateDb.ts` / `moduleStateDb.test.ts` / `templateStore.ts`)。

### 8.3 全局 Zustand Stores — `src/stores/`

#### 8.3.1 存档 Store — `src/stores/saveStore.ts`

**`SaveState` 实际状态字段**(saveStore.ts:33):`savesMeta: SaveMeta[]`、`currentSaveId: string | null`、`currentSaveName: string`、`sessionActivePacks: string[] | undefined`。

**`SaveState` 实际 actions**:`initialize` / `createNewGame` / `loadSave` / `deleteSave` / `forceDeleteSave` / `renameSave` / `importSave` / `exportSave` / `performSave` / `setSessionActivePacks` / `saveGame` / `scheduleAutoSave` / `flushAutoSave`。

**自动存档调度**(模块级变量在 saveStore.ts:67-69,`_autoSaveBuilder` 在 :408;`scheduleAutoSave` 是 **store 方法**而非独立函数):

```typescript
let _savePromise: Promise<void> | null = null;
let _saveQueued = false;
let _saveTimer: ReturnType<typeof setTimeout> | null = null;
// ...（文件末尾 :408）
let _autoSaveBuilder: (() => GameSave | null) | null = null;

// store 方法（saveStore.ts:371）
  scheduleAutoSave: () => {
    if (_saveTimer) clearTimeout(_saveTimer);
    // debounce 500ms 后通过全局注入的 _autoSaveBuilder 执行保存
    _saveTimer = setTimeout(() => {
      _saveTimer = null;
      if (_autoSaveBuilder) {
        console.log('[auto-save] 触发自动存档...');
        get().saveGame(_autoSaveBuilder).catch(err => {
          console.error('[auto-save] 保存失败（需要用户注意）:', err);
        });
      } else {
        console.warn('[auto-save] _autoSaveBuilder 未注入，跳过存档');
      }
    }, 500);
  },
```

`flushAutoSave()`(:388)清掉 `_saveTimer` 后立即 `await get().saveGame(_autoSaveBuilder)`;若 `_autoSaveBuilder` 未注入则 `throw new Error('[auto-save] _autoSaveBuilder 未注入，无法立即存档')`。

`saveGame(buildSaveData)` 用 `_savePromise` + `_saveQueued` 做并发合并:已有在飞请求时置 `_saveQueued = true` 并复用同一 Promise,`do...while (_saveQueued)` 循环补跑。

**`validateSaveId(raw)`**(:24)— 私有函数,正则 `/^save_\d+_[a-z0-9]{6,}$/` 过滤 localStorage 脏数据。

**performSave 核心逻辑**:配额检查(`autoPruneIfNeeded`)→ 检测全量重写 → 确定新增消息 → 滑动窗口优化(离开"最近 10 条"窗口的无快照消息重写)→ 模块检查点裁剪(仅保留 `keptModuleRevisions` 命中的 `${moduleId}#${revision}`)→ 构建 `compactHead` → `saveGameIncremental` 写入(失败则自动导出 `save-backup-${Date.now()}.json` 兜底后 rethrow)→ 元数据更新(`saveAllSaveMeta`,失败仅 warn 不阻塞)。

#### 8.3.2 全局 Stores 索引

`src/stores/` 共 **10 个 store 文件**（含 §8.3.1 的 `saveStore.ts`）。下表列出各 store 的职责、状态字段与 actions：

| Store                 | 职责             | 实际状态字段                                                                                                               | 实际 actions                                                                                                                                                                               |
| --------------------- | -------------- | -------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `saveStore.ts`        | 存档 CRUD + 自动存档 | `savesMeta`, `currentSaveId`, `currentSaveName`, `sessionActivePacks`                                                | 见 §8.3.1                                                                                                                                                                                 |
| `presetStore.ts`      | API 预设管理       | `userPresets`(**非** `presets`), `activePresetId`, `builtinOverrides`, `builtinContentOverrides`                      | `savePreset`, `deletePreset`, `setActivePreset`, `resetToDefault`, `saveBuiltinOverride`, `saveBuiltinContentOverride`, `restoreBuiltinDefaults`, `getActivePreset`, `getUserPresetById` |
| `authStore.ts`        | 用户认证           | `user: User \| null`, `isLoading`, `isAuthenticated`(**无** `token` / `mode`)                                         | `checkAuth`, `sendCode`, `register`, `login`, `resetPassword`, `logout`                                                                                                                  |
| `cloudSaveStore.ts`   | 云存档槽位          | `slots: CloudSaveSlot[]`(**非** `cloudSaves`), `isLoading`, `error`(**无** `syncing`)                                  | `fetchSlots`, `uploadSave`, `downloadSave`, `deleteSave`                                                                                                                                 |
| `configStore.ts`      | 全局 UI/API 配置   | `settings: UISettings`(**非** `config`), `apiConfig: ApiConfig \| null`          | `updateSettings`, `setApiConfig`, `initApiConfig`, `t`, `initialize`                                                                                      |
| `imageStore.ts`       | 图像生成配置与任务队列    | `config: ImageGenConfig`, `tasks: ImageTask[]`, `comfyData`(**无** `images: Map`)                                     | `updateConfig`, `setConfig`, `initImageConfig`, `addTask`, `updateTask`, `removeTask`, `setTasks`, `setComfyData`                                                                        |
| `novelConfigStore.ts` | 小说工作台配置        | `config: NovelWorkbenchConfig`, `loaded: boolean`(**非** `progress`)                                                  | `initialize`, `save`                                                                                                                                                                     |
| `portraitStore.ts`    | NPC 头像 URL 映射  | `portraits: Record<string, string>`(npcId → objectURL,**非** `Map<npcId, blob>`)                                      | `setPortrait`, `clearPortrait`                                                                                                                                                           |
| `simulationStore.ts`  | 世界推演运行时        | `simState: SimulationState`, `isSimulating: boolean`, `lastError: string \| null`(**无** `tick` / `activeStorylines`) | `updateConfig`, `setSimState`, `setIsSimulating`, `setLastError`, `resetSimulation`, `loadFromStorage`, `syncFromEngine`                                                                 |
| `workshopStore.ts`    | 工作坊资产浏览/发布     | `items: WorkshopItem[]`, `total`, `page`, `pageSize: 20`, `isLoading`, `error`(**无** `installedPacks` / `editing`)   | `fetchItems`, `fetchItem`, `downloadItem`, `createItem`, `deleteItem`, `checkInstall`, `getInstallPlan`                                                                                  |

**`configStore.ts` 导出类型**:`Theme = 'light' \| 'dark' \| 'metal' \| 'green'`、`FontFamily = 'yahei' \| 'source' \| 'menglong' \| 'hanchan' \| 'shanggu'`、`FontSize = '小' \| '中' \| '大'`、`LineHeight = '紧凑' \| '舒适' \| '宽松'`、`Language = 'zh-CN' \| 'en'`、`UISettings`(8 字段:`language` / `theme` / `font` / `uiFontSize` / `bodyFontSize` / `lineHeight` / `centeredNarrative` / `autoScroll`)。

**`workshopStore.ts` 导出接口**:`WorkshopItem`、`WorkshopItemDetail extends WorkshopItem`(加 `data`)、`WorkshopInstallPlan`(`ok` / `rootId` / `items` / `recommendations` / `errors`,错误码 `'MISSING' \| 'INCOMPATIBLE' \| 'CYCLE'`)。

**`cloudSaveStore.ts` 导出接口**:`CloudSaveSlot { slotIndex; version; size; updatedAt }`。**`authStore.ts`**:`User { id; username; email }`。**`novelConfigStore.ts`**:`NovelWorkbenchConfig { api; embeddingMode: 'off' \| 'inherit' \| 'local_endpoint'; embeddingEndpoint; embeddingModel }`。

### 8.4 Cloudflare Workers 后端 — `src/server/`

`src/server/` 实际共 **14 个文件** = 10 个源文件 + 4 个测试:

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

### 8.5~8.7 (Provider / 多格式兼容 / 配额治理)

§8.5/§8.6/§8.7 实际内容在 §8.5~8.7 子节中。

---



## 8.9 当前存档 schema 与兼容窗口（v2.8.4）

- 内部 `SAVE_SCHEMA_VERSION = 4`。v4 将存档头和消息分离，消息按 `${saveId}#${seq}` 存在 messages store。
- 自动迁移只保留直接上一代：**v3 内联 messages → v4 分片**，入口为 `planV3ToV4Migration` / `migrateV3ToV4`。
- v0/v1/v2 内部 IndexedDB 结构已退出当前兼容窗口，不再通过多代链式迁移加载。
- 外部存档 JSON 导入由 `importSaveFromData` 规范化后直接写成当前 v4；这是文件导入协议，不属于内部 schema 历史链。
- 当前 v4 运行时不再回退读取老的内联 messages 记录。
