> 本文档是 `PROJECT_FUNCTIONAL_SPEC.md` 的拆分子文件（22、关键设计决策）。
> 总索引见 `../PROJECT_FUNCTIONAL_SPEC.md`。

## 22、关键设计决策

### 22.1 十大架构原则

| # | 原则      | 实现                                                                                                                                       | 目的            |
| - | ------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| 1 | 零框架耦合   | 事件与工作流类型保持在 `src/modules/schema.ts` / `workflowSchema.ts`，UI 画布通过 `workflowConverters.ts` 与运行时表示显式转换 | 类型定义不依赖 UI 框架 |
| 2 | 声明式 DSL | 白名单动作(set/addEvent/modifyResource 等)                                                                                                     | 永不执行玩家代码      |
| 3 | 确定性优先   | `performance.now()` 计时                                                                                                                   | 业务逻辑尽量可复现     |

> `Date.now()` 允许用于 ID、日志和交互时间戳；确定性要求只约束会影响同一输入机械结算结果的核心状态推进。
>   
> | 4 | 增量优先 | 消息分片 + compactHead | 避免全量重写存档 |
>   
> | 5 | 三重快照链 | ✅ **修正**:变量+记忆+演化快照绑定每条 AI 消息,但**任一项可能为 undefined**(异常隔离 try/catch 后只有部分快照生效) | 支持任意历史回滚(部分场景下降级) |
>   
> | 6 | 每存档 simulationState | simulationState 存 GameSave 内 | 解决多开串存档 |
>   
> | 7 | 模块化数据驱动 | 世界模块完全 AI 生成数据驱动 | 引擎解释执行,无需硬编码 |
>   
> | 8 | 双写模式 | ref + state | 性能关键路径避免重渲染 |
>   
> | 9 | 作用域守卫 | ✅ **修正**:**未找到** `isPipelineScopeCurrent()` 函数;实际用 `AbortController` + `controller.signal.aborted` 局部引用判断,`pipelineExecutor` 内部通过 signal 传递取消状态 | 取消/重试操作作用于正确上下文 |
>   
> | 10 | 二级开关 | ✅ **修正**:`sessionActivePacks` 二级开关实际**只设置了 sessionActivePacks**,未找到与 `global enabledIds` 的优先级裁决代码(sessionActivePacks 本身就是最终开关) | 防止跨世界事件包污染 |

### 22.2 安全机制

详见 §1.3.3 变量管理器安全机制(`DANGEROUS_PATH_SEGMENTS` / `CORE_OBJECT_PATHS` / `MAX_FAVORABILITY_DELTA` / `EXCLUDED_FROM_SNAPSHOT` / `NPC_INCLUDE_IN_SNAPSHOT` / `NPC_EXCLUDED_FROM_SNAPSHOT` / `createSafeSnapshotForPrompt`)。

> 注(2026-09-08):`FAVORABILITY_CLAMP` 对象和 `clampStat` 函数**实际不存在** — 实际使用 `MAX_FAVORABILITY_DELTA` 常量 + 内联 `Math.round(...)`。

### 22.3 性能优化

| 优化点           | 实现                                                                                                                                                                              | 效果         |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| 虚拟滚动          | visibleStart + 批量加载 80 条                                                                                                                                                        | 长对话不卡顿     |
| 双写模式          | messagesRef + messages state                                                                                                                                                    | 同步访问+触发 UI |
| 增量存档          | newMessages 过滤 + 滑动窗口优化                                                                                                                                                         | 减少写入量      |
| Coalescing 防抖 | ✅ `_saveQueued` 确实存在(`saveStore.ts`:68 声明、`:349` 置 `true`、`:355/:360` 由 do/while 循环重跑):`saveGame` 进行中再次调用则置 `_saveQueued=true` 并返回在途 Promise,循环结束后用最新 buildSaveData 再存一次,实现请求合并 | 合并连续存档请求   |
| 500ms 自动存档防抖  | setTimeout 清除重设计时器                                                                                                                                                              | 减少存档次数     |
| 快照优化          | optimizeSnapshots 保留关键帧                                                                                                                                                         | 内存占用降低     |
| 消息分片          | IndexedDB 分片+复合主键                                                                                                                                                               | 加载速度提升     |

### 22.4 世界书扫描算法详解

**WIScanner.checkEntry — 5 步验证链**:排除关键词 → 主关键词 → 次级关键词+逻辑(AND_ANY/NOT_ALL/NOT_ANY/AND_ALL) → 概率门控 → 通过。

**关键词匹配三种模式**:正则(/pattern/flags)/全词匹配(\b 词边界)/子串匹配。

**递归扫描轮次控制**:excludeRecursion=true → 后续轮次不参与;preventRecursion=true → 立即终止递归链;默认 hasNew=true → 触发下一轮,最多 10 轮。

**分组互斥裁决**:useGroupScoring=true → groupWeight * Math.random() 加权随机;否则取 order 字段最大者。

### 22.5 卡片节点执行器设计

详见 §4.2 12 种节点类型(`narrative.title/text/image/dialog`、`choice.static/dynamic/conditional/weighted`、`effect.stat/resource/flag`、`flow.branch`)。

### 22.6 DAG 工作流引擎设计

**Kahn 算法拓扑排序**:入度 0 的节点先入队 → 出队时将其后继节点的入度 -1 → 后继入度变为 0 时入队 → 最终 sorted 长度 < 节点总数 → 检测到环。

**Connected Flow Gating**:只有所有 connected flow 类型输入都为 true 时才执行节点;未连接的 flow 输入不触发门控(节点可作为根触发器);跳过时 flow 输出全置 false 阻断下游。

**NodeOutputCache stub**:存在 `computeKey/get/set/clear` 方法但未被实际查询,是为未来 memoization 优化预留的基础。

### 22.7 规则引擎安全模型

**硬性上限 (DEFAULT_LIMITS)**:maxRulesPerMod=128 / maxEvalSet=1024 / maxConditionDepth=6 / maxActionsPerRule=16 / maxStepsPerTick=8192 / maxWallMs=8(严格主线程保护)。

**权限能力模型**:每个 action 执行前校验 ACTION_PERMISSION[kind];无权限 → warnings.push 跳过,不 abort 整次 evaluate。

**冷却机制确定性**:由外部 tick 驱动而非 wall clock,确保暂停/快进环境下行为一致。

### 22.8 存档系统设计

**v4 格式 vs v3 格式**:v3 messages 内联;v4 messageCount + lastMessageSeq + messages store 分片。

**增量写入幂等键**:`${saveId}#${seq}`,重复 put 不覆盖;revision 相同则跳过 moduleStates。

**滑动窗口补丁**:当"最近 10 条"窗口前移时,刚离开窗口且无快照的消息被强制重写一次,防止悬空引用。

**全量重写检测**:`dbMessageCount > allMessages.length` → 发生过 rollbackAndTruncate。

**导出包含完整事件包**:`collectPacksForExport` 收集所有已启用包的完整内容,确保导入后可独立运行。

### 22.9 战斗 V3 架构

**EncounterDecisionCard 决策流**:被动遭遇请求 → pendingEncounterRequest 写入 state → 显示 CombatEncounterDecisionCard → 用户决策(fight/escape/narrative)。

**Automation Timer**:敌方回合 260ms 后自动推进;策略切换后立即 `setTimeout(0)` 启动自动化;`combatAutomationTimerRef` 防止并发。

**CombatNarrationCoordinator**:战斗叙事协调器,支持 continue() 追加生成,preserveCombatOwnedState() 保护归属权。

### 22.10 GameContext F5 恢复协议

详见 §23.4(原 §10.4 整合)。

---


### 22.11 Schema 兼容窗口

项目内部历史 schema 采用“**canonical runtime + 单代迁移边界**”原则：

- runtime/UI/engine 只读取当前 canonical 字段；
- 旧字段只在明确的 import/load normalizer 中出现；
- 当前 Vn 最多保留 V(n-1)→Vn；更早 V(n-2)→V(n-1) 链路从当前代码删除；
- 转换完成后持久化/导出只写 canonical 格式，避免下一轮继续双读；
- D1 SQL migrations、SillyTavern/OpenAI-compatible 等外部协议兼容不属于内部 schema 历史，不套用“只留一代”删除规则。

当前实例：`WorldModule.data` 仅由 `normalizeModule.ts` 迁移；event pack 仅保留 v1 indexed→v2；WorldClock 仅保留 v1→v2；GameState 进入 V3 时不再经过 `combat-runtime-v1` 中间层。


### 22.12 内部存档只保留单代迁移

当前内部存档为 v4。自动迁移只接受 v3 内联消息格式并一次转换为 v4 分片；v0/v1/v2 不再串联升级。外部导出文件导入继续通过独立 normalization 进入 canonical v4，因此不与 IndexedDB 历史 schema 混用。
