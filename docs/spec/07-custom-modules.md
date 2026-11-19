> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的自定义模块索引；实际代码是当前实现依据。
> 总索引见仓库根目录的 `PROJECT_FUNCTIONAL_SPEC.md`（相对本文件为 `../../PROJECT_FUNCTIONAL_SPEC.md`）。

## 7、自定义玩法模块与工坊

工坊采用“对话 → 工具操作 → 修改草稿 → 校验与试玩 → 手动保存应用”。优先由 `ai@7.0.99` 的 `ToolLoopAgent`（`src/custom-modules/agent.ts:194`）执行原生工具调用；接口明确不支持 tools 或模型忽略首步工具要求时，自动切换到普通文本兼容模式（`agent.ts:128` 定义的 `runTextFallback`，在 `:266-277` 的错误分类分支触发；首步 `prepareStep` 强制 `capabilities`，`:200`）。普通回答仍为自然语言。`@ai-sdk/openai-compatible@3.0.48` 复用现有模型配置、代理和 Tauri 原生 HTTP。

`src/custom-modules/` 实际共 **42 个文件 = 24 源 + 18 测试**。

### 7.1 状态所有权

| 文件 | 职责 |
| --- | --- |
| `agent.ts` | 原生 `ToolLoopAgent` 与文本兼容两套循环；逐步消息记录；共享 **12 次模型请求上限**（`:147`/`:199` `isStepCount(12)`）；连续 **2 次**相同工具错误即停（`:75-77`） |
| `agentTextProtocol.ts` | 单操作文本协议（严格 `{tool, input}` 外层）；与自然语言回答区分（非 `{`/`[` 开头即当回复）；`workshopTextMessages` 把工具结果改写成 user 角色数据，**不发送 tool role** |
| `agentTransport.ts` | 模型工厂 `createWorkshopModel`、限流等待 `awaitWorkshopRequestSlot`、错误分类 `classifyWorkshopError`；`optionalParameters = ['parallel_tool_calls','reasoning_effort','top_k']` 逐项降级（`:17`）；文本兼容模式删掉 `tools`/`tool_choice`/`parallel_tool_calls`/`response_format`（`:78`） |
| `workshopTools.ts` | 6 个工具：`capabilities` / `readDraft` / `createDraft` / `patchDraft` / `validateDraft` / `simulate`（`:11`）；原生走 `workshopToolSchemas`，网关兼容参数走 `workshopWireSchemas`（`moduleJson` / `valueJson`，`:33-48`），`decodeWorkshopToolInput` 解码后再用 canonical schema 校验 |
| `workshopSession.ts` | 稳定消息 ID、工具配对、独立草稿版本与显式回退；`sessionVersion: 3`（`:23`） |
| `workshopPersistence.ts` | 现有 IndexedDB `global` 中的会话索引（`moduleWorkshop.v3.world.<worldId>`）与记录；`persistWorkshopSession(session, expectedVersion, isCurrent)` 事务版本比较防止覆盖（`:29`）；旧 `customModuleAgentSessions.v3` 可迁移且原记录保留（`:60-67`） |
| `workshopStore.ts` | Zustand 工厂 `createModuleWorkshopStore`（`:41`）+ 单例 `useModuleWorkshopStore`（`:206`）；世界/会话与执行所有权、`stop`、`editMessage`、`regenerate`、迟到写入守卫 |
| `src/components/start/CustomModuleAgentWorkspace.tsx` | 会话列表、聊天、导入、保存绑定、导出和发布（179 行） |
| `src/components/start/WorkshopModulePanel.tsx` | 正式界面试玩、规则/资源、校验、版本、存档及高级 JSON（77 行） |
| `engineBridge.ts` | 状态所有者、提交队列（模块级 `pending` 串行）、存档作用域、通知和自动保存；`runCustomModuleTurnLifecycles` 在 `settled` 时先发 `onTick` 再发 `onTurnEnd` |

除完整路径外，文件均位于 `src/custom-modules/`。聊天与模块版本分别保存。删除消息不撤销草稿；编辑重发与重新生成截断所选位置之后的对话，保留全部版本。回退创建新版本。修改携带基础版本号，完整校验通过后，工具结果与新版本在同一会话事务中提交。

原生模式下，复杂模块通过 `moduleJson`、补丁值通过 `valueJson` 工具参数传输，避免兼容网关拒绝递归工具参数 Schema。`capabilities` 以 `moduleSchemaJson` 文本返回 V3 完整结构（`:73` 定义、`:92` 输出），防止 Gemini 将结构化 `$ref` 误认为附件引用（`workshopTools.ts:71-72` 注释即为此因）。

文本兼容模式不发送 `tools`、`tool_choice`、`parallel_tool_calls`、`response_format`，以单个 `{ tool, input }` 对象表达操作，模块与补丁值直接使用 JSON 对象和值。系统先读取能力和最新草稿，再将操作交给同一套本地工具、严格校验与版本事务处理；普通回答不会执行为代码，也不会从混杂正文中提取 JSON 执行。无效操作格式最多修正一次，截断或拒绝响应不执行操作。模型仍需具备基本 JSON 与规则编写能力，体验接口的使用范围不变。

仅明确不支持工具时自动降级，认证、限流、网络、schema 错误不会被误判为工具不支持。接口明确拒绝 `parallel_tool_calls`、`reasoning_effort` 或 `top_k` 时，逐项移除被拒绝的参数并有界重试。降级继续使用当前有效草稿，不重放已完成操作；工具调用 ID 按本轮与步骤隔离，兼容网关重复使用 `call_0` 等 ID。切换、停止或刷新不会自动重放工具。

### 7.2 V3 运行与宿主能力

模块声明 `currency`、`inventory`、`survival` 能力及物品定义。规则具有稳定 `id`，保留 `onGameStart`、`onTurnEnd`、`onTick`、`onChoice`、`onButton` 生命周期、自身状态和现有界面组件。

能力常量（`capabilities.ts:3-7`）：
- 生命周期 `CUSTOM_MODULE_LIFECYCLES` 5 个：`onGameStart` / `onTurnEnd` / `onTick` / `onChoice` / `onButton`
- 状态字段类型 `CUSTOM_MODULE_STATE_FIELD_TYPES` 6 种：`number` / `string` / `boolean` / `enum` / `array` / `object`
- 条件 `CUSTOM_MODULE_CONDITION_KINDS` 4 种：`compare` / `all` / `any` / `not`
- 动作 `CUSTOM_MODULE_ACTION_KINDS` 13 种：`set` / `add` / `subtract` / `toggle` / `append` / `remove` / `log` / `currency.consume` / `currency.grant` / `item.consume` / `item.grant` / `survival.consume` / `survival.grant`
- 视图组件 `CUSTOM_MODULE_VIEW_COMPONENTS` 11 种：`section` / `card` / `text` / `number` / `progress` / `badge` / `list` / `table` / `divider` / `conditional` / `button`

| 文件 | 职责 |
| --- | --- |
| `capabilities.ts` | `buildCustomModuleCapabilityCatalog(world)`（`:148`）按世界实际可用模块动态裁剪 `safeInputPaths`；`currency` 只在未启用 `business` 时暴露，启用 `business` 时改为暴露 `player.business.funds` / `assetCount`（`:151-172`）；始终 `writes: 'own-state-only'`（`:140`/`:187`） |
| `context.ts` | 只读宿主上下文 `buildCustomModuleHostContext`、事件白名单 `sanitizeCustomModuleEvent` |
| `hostRuntime.ts` | 把消耗、奖励和自身状态转换为 `GameplayTransaction`（`executeCustomModuleInGame:21`）；同一规则原子提交：先按路径合并重复消耗（`:62` `costs`）与授予（`:63` `grants`），以 `JSON.stringify([eventId, rule.id])` 作防重键写进 `runtime.processedEvents`（`:46-47`、`:105`） |
| `runtime.ts` / `actionExecutor.ts` | 条件、引用与自身状态动作求值（`runtime.ts`）；宿主动作（`currency.*` / `item.*` / `survival.*`）由 `hostRuntime.ts` 处理 |
| `engineBridge.ts` | `runCustomModulesForWorld` 纯计算（`:22`）；`runCustomModulesForWorldAndCommit` 串行提交并做 `JSON.stringify` 前后比对，状态已变则整批丢弃并回 `游戏状态已切换或变化，本次模块执行未提交。`（`:52`-`79`）；`runCustomModuleTurnLifecycles` 按 `settled` 决定是否先跑 `onTick`（`:81`） |
| `preview.ts` / `viewRenderer.tsx` | `preview.ts` 用 `createDefaultGameState()` 造副本（主货币 100、物品各 10、生存资源各 100）并跑 `onGameStart`（`simulateCustomModule` / `createCustomModulePreview` / `createCustomModulePreviewState`）；`viewRenderer.tsx` 用正式渲染器出图 |
| `schema.ts` / `manifestSchema.ts` / `validator.ts` / `normalize.ts` | V3 定义、严格结构与语义校验、导入边界转换 |
| `stateStore.ts` | 模块自身状态生命周期：`createInitialCustomModuleState`（`:45`）、`installCustomModuleState`（`:67`）、`migrateCustomModuleState`（`:91`，附冲突列表）、`removeCustomModuleState`（`:103`） |

模型不能提交任意宿主变量路径或执行 JavaScript。资源不足时，整条规则的资源和自身状态变化均不生效。

### 7.3 定义、存档与迁移

`storage.ts` 把模块记录存在 IndexedDB `global` 的 `customGameplayModules.v1` 下（`:15`），记录形状 `StoredCustomGameplayModule { module; status; worldIds; installedAt; updatedAt; worldDefinitions? }`（`:5-13`），其中 `worldDefinitions` 是「每个世界明确绑定的定义快照」，所以保存草稿不会自动更新世界绑定。对外导出 `listCustomGameplayModules:53`、`getCustomGameplayModule:57`、`saveCustomGameplayModule:62`、`bindCustomGameplayModule:86`、`disableCustomGameplayModuleForWorld:98`、`versionSatisfies:120`、`resolveCustomGameplayModulesForWorld:134`（返回 `{ modules, warnings }`）、`getCustomGameplayModulesForWorld:182`、`deleteCustomGameplayModule:187`、`restoreCustomGameplayModule:192`、`clearCustomGameplayModules:197`。

`saveDefinitions.ts` 在存档**首次**进入游戏时固定可解析的定义，且是一次性追加式迁移：`pinCustomModuleDefinitions(gameState, worldId)`（`:8`）以 `gameState.customModuleBindingsInitialized` 作为幂等闸门，空绑定集合也会被固化；缺失存档版本的模块只记警告 `模块 <id> 的存档版本 <version> 定义缺失，请在工坊手动应用可用版本。`。`ensureSaveCustomModuleDefinitions(saveId)`（`:35`）把这次迁移持久化，最多重试 3 次，全程用整条存档记录的 `JSON.stringify` 比对做 CAS，超限抛 `存档正在变化，暂时无法固定模块版本，请重试。`

存档持有定义快照，运行界面和规则使用该快照。`saveApplication.ts` 提供预览、应用与恢复点还原：

- `setCustomModuleActiveSave(saveId)`（`:13`）登记「正在运行」租约；`assertInactive`（`:20`）在有效租约时抛 `请先退出正在运行的存档，再应用或恢复模块。`
- `previewSaveModuleApplication`（`:101`）先 `loadSaveWithMigration` 确认存档可读，再只读事务取存档头与模块分区，产出 `SaveModuleApplicationPreview`（含 `baseRevision` / `baseModuleRevision` / `changes` / `conflicts` / `nextGameState`）。
- `applySaveModuleApplication`（`:111`）在**一个** `['saves','global','module_states','module_checkpoints']` 事务里：比对 `revision(head) !== preview.baseRevision` 或 `moduleRevision(...) !== preview.baseModuleRevision` 即抛 `存档已变化，请重新预览后应用。`；为新旧分区各写一条 checkpoint（键 `<saveId>#<moduleId>#<revision>`），更新 `moduleRevisions`，把 `SaveModuleRecovery` 追加进 `customModuleSaveRecoveries.v1:<saveId>`，最后写存档头。宿主能力不能删掉其它内置模块的分区（`:138-139`）。
- `restoreSaveModuleRecovery`（`:162`）要求恢复点未被用过（`recovery.restoredAt`）且存档头/分区仍等于应用后的版本，否则抛 `存档在应用后已变化，不能覆盖后续进度；请使用匹配当前存档的恢复点。`；成功后回写 `previousGameState` 与 `previousModuleStates`，并给恢复点打 `restoredAt`。

新增模块只初始化自身（`createInitialCustomModuleState`），更新已有模块走 `migrateCustomModuleState` 而不会重发初始化奖励。

会话只迁移**直接上一代 V2**：`migrateWorkshopSession(value, world)`（`workshopSession.ts:137`）只在 `sessionVersion === 2` 且世界 id 相同时返回迁移结果，否则 `undefined`，旧聊天以纯文本消息保留。内部模块仅迁移 V2 → V3——`normalizeCustomGameplayModule` 在 `source === 'internal'` 时遇到 `schemaVersion === 1` 直接报 `本地模块仅支持 V2 → V3 迁移；V1 原始数据已保留，请导出后重新导入。`（`normalize.ts:36-38`）；新建必须 `schemaVersion: 3`，外部导入兼容 1 / 2 / 3，在导入边界转换后进入 V3（`normalize.ts:71-76`、`:84-102`）。
