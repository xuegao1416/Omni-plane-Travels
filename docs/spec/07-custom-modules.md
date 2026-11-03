> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的自定义模块索引；实际代码是当前实现依据。

## 7、自定义玩法模块与工坊

工坊采用“对话 → 工具操作 → 修改草稿 → 校验与试玩 → 手动保存应用”。优先由 `ai@7.0.99` 的 `ToolLoopAgent` 执行原生工具调用；接口明确不支持 tools 或模型忽略首步工具要求时，自动切换到普通文本兼容模式。普通回答仍为自然语言。`@ai-sdk/openai-compatible@3.0.48` 复用现有模型配置、代理和 Tauri 原生 HTTP。

### 7.1 状态所有权

| 文件 | 职责 |
| --- | --- |
| `agent.ts` | 原生与文本工具循环、逐步消息记录、共享 12 次模型请求上限、连续两次相同工具错误停止 |
| `agentTextProtocol.ts` | 单操作文本协议、操作与自然语言区分、无 tool role 的模型历史 |
| `agentTransport.ts` | 请求适配、限流等待、错误分类、明确被拒绝的可选参数降级；桌面与文本兼容模式使用非流式请求 |
| `workshopTools.ts` | 能力、读取、创建、局部修改、校验与模拟工具 |
| `workshopSession.ts` | 稳定消息 ID、工具配对、独立草稿版本与显式回退 |
| `workshopPersistence.ts` | 现有 IndexedDB `global` 中的会话索引与记录，事务版本比较防止覆盖 |
| `workshopStore.ts` | 世界/会话与执行所有权、取消、编辑重发、重新生成和迟到写入守卫 |
| `src/components/start/CustomModuleAgentWorkspace.tsx` | 会话列表、聊天、导入、保存绑定、导出和发布 |
| `src/components/start/WorkshopModulePanel.tsx` | 正式界面试玩、规则/资源、校验、版本、存档及高级 JSON |

除完整路径外，文件均位于 `src/custom-modules/`。聊天与模块版本分别保存。删除消息不撤销草稿；编辑重发与重新生成截断所选位置之后的对话，保留全部版本。回退创建新版本。修改携带基础版本号，完整校验通过后，工具结果与新版本在同一会话事务中提交。

原生模式下，复杂模块通过 `moduleJson`、补丁值通过 `valueJson` 工具参数传输，避免兼容网关拒绝递归工具参数 Schema。`capabilities` 以 `moduleSchemaJson` 文本返回 V3 完整结构，防止 Gemini 将结构化 `$ref` 误认为附件引用。

文本兼容模式不发送 `tools`、`tool_choice`、`parallel_tool_calls`、`response_format`，以单个 `{ tool, input }` 对象表达操作，模块与补丁值直接使用 JSON 对象和值。系统先读取能力和最新草稿，再将操作交给同一套本地工具、严格校验与版本事务处理；普通回答不会执行为代码，也不会从混杂正文中提取 JSON 执行。无效操作格式最多修正一次，截断或拒绝响应不执行操作。模型仍需具备基本 JSON 与规则编写能力，体验接口的使用范围不变。

仅明确不支持工具时自动降级，认证、限流、网络、schema 错误不会被误判为工具不支持。接口明确拒绝 `parallel_tool_calls`、`reasoning_effort` 或 `top_k` 时，逐项移除被拒绝的参数并有界重试。降级继续使用当前有效草稿，不重放已完成操作；工具调用 ID 按本轮与步骤隔离，兼容网关重复使用 `call_0` 等 ID。切换、停止或刷新不会自动重放工具。

### 7.2 V3 运行与宿主能力

模块声明 `currency`、`inventory`、`survival` 能力及物品定义。规则具有稳定 `id`，保留 `onGameStart`、`onTurnEnd`、`onTick`、`onChoice`、`onButton` 生命周期、自身状态和现有界面组件。

| 文件 | 职责 |
| --- | --- |
| `capabilities.ts` / `context.ts` | 世界可用输入与事件白名单、只读宿主上下文 |
| `hostRuntime.ts` | 将消耗、奖励和自身状态转换为 `GameplayTransaction`；同一规则原子提交，先合并重复消耗，以事件 ID 与规则 ID 防重 |
| `runtime.ts` / `actionExecutor.ts` | 条件、引用与自身状态动作；宿主动作由宿主运行入口处理 |
| `engineBridge.ts` | 状态所有者、提交队列、存档作用域、通知和自动保存；机械结算后分发 tick 与回合事件 |
| `preview.ts` / `viewRenderer.tsx` | 独立游戏状态副本调用同一宿主逻辑，使用正式渲染器 |
| `schema.ts` / `manifestSchema.ts` / `validator.ts` / `normalize.ts` | V3 定义、严格结构与语义校验、导入边界转换 |

模型不能提交任意宿主变量路径或执行 JavaScript。资源不足时，整条规则的资源和自身状态变化均不生效。

### 7.3 定义、存档与迁移

`storage.ts` 保存最新定义以及每个世界明确绑定的定义快照。保存草稿不会自动更新世界绑定。`saveDefinitions.ts` 在存档首次加载时固定可解析的定义，包括空绑定集合；无法解析的版本显示警告。

存档持有定义快照，运行界面和规则使用该快照。`saveApplication.ts` 支持影响预览、兼容状态迁移、手动应用和恢复点还原。应用和恢复检查存档头及模块分区版本，在同一事务中更新存档、分区、检查点和恢复记录；正在运行的存档不可离线应用。新增模块只初始化自身，更新已有模块不会重发初始化奖励。

会话只迁移直接上一代 V2，保留旧聊天与有效草稿。内部模块仅迁移 V2 → V3，更早原始数据保留并提示重新导入。外部导入兼容 V1/V2，在导入边界转换后进入 V3。
